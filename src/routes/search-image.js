/**
 * POST /api/search-image
 *
 * Pipeline:
 *   1. Vision LLM: image → clothing attributes + search query
 *   2. Google Shopping: search query → priced alternatives
 *   3. Combine + dedupe + rank
 *   4. Save results → generate page URL
 *   5. Return { dm_text, page_url }
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { extname } from 'path';
import { analyzeClothingImage } from '../services/vision.js';
import { parseQuery, rankResults, reconcileImageDiscovery } from '../services/venice.js';
import { searchGoogleShopping, getProductOffers } from '../services/search-serp.js';
import { resolveShoppingResults } from '../services/search-web.js';
import { inferLensExactMatch, searchGoogleLens } from '../services/search-lens.js';
import { saveResult } from '../services/results-store.js';
import { logSearch, logBrand, logResults } from '../services/db.js';

const router = Router();

const UPLOADS_DIR = 'media/uploads';
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

function pickUploadExtension(file) {
  const fromName = extname(file.originalname || '').toLowerCase();
  if (fromName) return fromName;

  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };

  return mimeToExt[file.mimetype] || '.jpg';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${pickUploadExtension(file)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

const BASE_URL = process.env.BASE_URL || process.env.AGENT_BASE_URL || 'http://localhost:3000';
const LENS_PROVIDER = process.env.LENS_PROVIDER || 'none';
const SHOPPING_RESOLUTION_LIMIT = Number(process.env.IMAGE_SHOPPING_RESOLUTION_LIMIT || 12);
const MIN_IMAGE_RESULTS = Number(process.env.IMAGE_MIN_RESULTS || 6);
const EXACT_IGNORE_TOKENS = new Set([
  'a', 'an', 'and', 'black', 'blue', 'brown', 'by', 'calf', 'cotton', 'for',
  'gray', 'grey', 'green', 'in', 'leather', 'low', 'men', 'mid', 'rubber',
  'shoe', 'shoes', 'sneaker', 'sneakers', 'suede', 'the', 'top', 'tops',
  'trainer', 'trainers', 'white', 'with', 'women',
]);

function resolvePublicBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.get('host');
  if (host && !/^localhost(?::\d+)?$/.test(host) && !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
    return `${req.protocol}://${host}`;
  }

  return BASE_URL;
}

function buildLensImageUrl(publicBaseUrl, file) {
  if (!file?.filename) return null;
  if (LENS_PROVIDER !== 'brightdata_url' && LENS_PROVIDER !== 'serpapi') return null;
  return `${publicBaseUrl.replace(/\/$/, '')}/uploads/${file.filename}`;
}

function normaliseDisplayPrice(price) {
  if (!price) return '—';
  if (typeof price === 'string') return price;
  if (typeof price === 'object') return price.display || (price.amount != null ? `£${price.amount}` : 'See store');
  if (typeof price === 'number') return `£${price.toFixed(2)}`;
  return '—';
}

function tokenizeExact(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildExactConstraints(discovery) {
  if (!discovery?.hasExactModel || !discovery.exactSearchQuery) return null;

  const tokens = tokenizeExact(discovery.exactSearchQuery);
  const significantTokens = [...new Set(tokens.filter(token => (
    token.length > 2
    && !EXACT_IGNORE_TOKENS.has(token)
    && !/^\d+$/.test(token)
  )))];

  const brandTokens = significantTokens.slice(0, Math.min(significantTokens.length > 2 ? 2 : 1, significantTokens.length));
  const modelTokens = significantTokens.slice(brandTokens.length);
  const shape =
    /\blow\b/.test(discovery.exactSearchQuery) ? 'low' :
    /\bhigh\b/.test(discovery.exactSearchQuery) ? 'high' :
    /\bmid\b/.test(discovery.exactSearchQuery) ? 'mid' :
    null;
  // Only enforce color for explicit single-color queries like "triple black".
  // Multi-color products (e.g. "white silver black") are handled by the search
  // engine naturally — hard-filtering on one color rejects good results.
  const preferredColor =
    /\btriple black\b/i.test(discovery.exactSearchQuery) ? 'triple black' :
    /\btriple white\b/i.test(discovery.exactSearchQuery) ? 'triple white' :
    null;

  return { brandTokens, modelTokens, shape, preferredColor };
}

function matchesExactConstraints(item, constraints) {
  if (!constraints) return true;
  const haystack = `${item.title || ''} ${item.snippet || ''} ${item.url || ''}`.toLowerCase();
  const brandMatches = constraints.brandTokens.filter(token => haystack.includes(token));
  const modelMatches = constraints.modelTokens.filter(token => haystack.includes(token));

  // Brand must appear
  if (constraints.brandTokens.length > 0 && brandMatches.length === 0) {
    return false;
  }
  // Require at least half of model tokens (not all — listings vary in how they describe items)
  const minModelMatches = Math.max(1, Math.ceil(constraints.modelTokens.length / 2));
  if (constraints.modelTokens.length > 0 && modelMatches.length < minModelMatches) {
    return false;
  }

  if (constraints.shape === 'low' && /\bhigh\b|\bhigh-top\b|\bmid\b/i.test(haystack)) {
    return false;
  }
  if (constraints.shape === 'high' && /\blow\b|\blow-top\b/i.test(haystack)) {
    return false;
  }
  if (constraints.shape === 'mid' && /\blow\b|\blow-top\b|\bhigh\b|\bhigh-top\b/i.test(haystack)) {
    return false;
  }

  if (constraints.preferredColor === 'triple black' && !/\btriple black\b|\ball black\b/i.test(haystack)) {
    return false;
  }
  if (constraints.preferredColor === 'triple white' && !/\btriple white\b|\ball white\b/i.test(haystack)) {
    return false;
  }

  return true;
}

function normalisePriceAmount(price) {
  if (price == null) return null;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const match = price.match(/(\d+(?:[.,]\d{1,2})?)/);
    return match ? parseFloat(match[1].replace(',', '.')) : null;
  }
  if (typeof price === 'object' && price.amount != null) {
    const amount = Number(price.amount);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function isLikelyProductUrl(url) {
  const value = String(url || '');
  if (!value) return false;
  if (/instagram|youtube|reddit|pinterest|facebook/i.test(value)) return false;
  return /\/itm\/|\/dp\/|\/product\/|\/products\/|\/sneakers\/|sku|stylecode|goat|stockx|novelship|farfetch|maisonmargiela|ssense/i.test(value);
}

const RESALE_DOMAINS = /\b(ebay|depop|vinted|poshmark|therealreal|vestiairecollective|thredup|grailed|mercari|tradesy)\b/i;
const USED_KEYWORDS = /\bpre[- ]?owned\b|\bused\b|\bvintage\b|\bsecondhand\b|\bsecond[- ]hand\b/i;

function isUsedProduct(item) {
  const url = String(item.url || '');
  const title = String(item.title || '');
  if (RESALE_DOMAINS.test(url)) return true;
  if (USED_KEYWORDS.test(title)) return true;
  return false;
}

function scoreExactCandidate(item, constraints) {
  const haystack = `${item.title || ''} ${item.snippet || ''} ${item.url || ''}`.toLowerCase();
  let score = 40;

  const modelMatches = constraints?.modelTokens?.filter(token => haystack.includes(token)) || [];
  const brandMatches = constraints?.brandTokens?.filter(token => haystack.includes(token)) || [];
  score += modelMatches.length * 16;
  score += brandMatches.length * 8;

  if (constraints?.shape === 'low' && /\blow\b|\blow-top\b/i.test(haystack)) score += 10;
  if (constraints?.shape === 'high' && /\bhigh\b|\bhigh-top\b/i.test(haystack)) score += 10;
  if (constraints?.shape === 'mid' && /\bmid\b|\bmid-top\b/i.test(haystack)) score += 10;

  if (constraints?.preferredColor === 'triple black' && /\btriple black\b|\ball black\b/i.test(haystack)) score += 14;
  else if (constraints?.preferredColor === 'triple white' && /\btriple white\b|\ball white\b/i.test(haystack)) score += 14;
  else if (constraints?.preferredColor && haystack.includes(constraints.preferredColor)) score += 8;

  if (isLikelyProductUrl(item.url)) score += 14;
  if (/replica/i.test(haystack) && !(constraints?.modelTokens || []).includes('replica')) score -= 24;
  if (/future/i.test(haystack) && (constraints?.modelTokens || []).includes('future')) score += 12;
  if (/high-top|high top/i.test(haystack) && constraints?.shape === 'low') score -= 25;
  if (/mid-top|mid top/i.test(haystack) && constraints?.shape === 'low') score -= 20;

  if (normalisePriceAmount(item.price) != null) score += 6;
  if (item.source === 'google_lens_exact') score += 10;

  return Math.max(0, Math.min(100, score));
}

function rankExactCandidates(results, constraints) {
  const ranked = results
    .filter(item => !isUsedProduct(item))
    .map(item => {
      const overallScore = scoreExactCandidate(item, constraints);
      return {
        marketplace: item.marketplace,
        title: item.title,
        price: normaliseDisplayPrice(item.price),
        url: item.url,
        image: item.image || null,
        relevanceScore: overallScore,
        valueScore: normalisePriceAmount(item.price) != null ? 62 : 50,
        trustScore: isLikelyProductUrl(item.url) ? 78 : 58,
        overallScore,
        warnings: [],
        recommendation: 'Strong exact-match candidate from the Lens-identified product family',
      };
    })
    .filter(item => item.overallScore >= 58)
    .sort((a, b) => b.overallScore - a.overallScore);

  return {
    results: ranked.slice(0, 4).map((item, index) => ({ ...item, rank: index + 1 })),
    filtered: [],
    bestPick: ranked[0]
      ? `${ranked[0].title} looks like the strongest exact match for the Lens-identified item.`
      : 'No strong exact-match shop listings found.',
    privacyNote: 'Your search was processed with zero data retention',
  };
}

function buildExactLensFallback(lensResults, constraints) {
  const candidates = [...(lensResults?.exactMatches || []), ...(lensResults?.visualMatches || [])]
    .filter(item => item?.url)
    .filter(item => matchesExactConstraints(item, constraints))
    .filter(item => isLikelyProductUrl(item.url))
    .map(item => {
      const overallScore = Math.max(72, scoreExactCandidate(item, constraints));
      return {
        marketplace: item.marketplace,
        title: item.title,
        price: normaliseDisplayPrice(item.price),
        url: item.url,
        image: item.image || null,
        relevanceScore: overallScore,
        valueScore: 55,
        trustScore: 72,
        overallScore,
        warnings: ['Direct Lens fallback while exact shop results were sparse'],
        recommendation: 'Direct Lens product hit',
      };
    });

  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }

  return {
    results: deduped.slice(0, 6).map((item, index) => ({ ...item, rank: index + 1 })),
    filtered: [],
    bestPick: deduped[0] ? `${deduped[0].title} was surfaced directly by Lens.` : 'No Lens fallback hits available.',
    privacyNote: 'Your search was processed with zero data retention',
  };
}

function buildBackfillCandidates(results, parsed, existingUrls, desiredCount) {
  const needed = Math.max(0, desiredCount - existingUrls.size);
  if (needed === 0) return [];

  const color = String(parsed?.color || '').toLowerCase();
  const style = String(parsed?.style || '').toLowerCase();

  return results
    .filter(item => item?.url && !existingUrls.has(item.url))
    .filter(item => item.price && item.marketplace)
    .map(item => {
      const haystack = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
      let score = 0;
      if (item.source === 'google_shopping_resolved') score += 20;
      if (item.source === 'google_shopping') score += 12;
      if (item.rating || item.seller?.rating) score += 6;
      if (item.reviews || item.seller?.feedbackScore) score += 4;
      if (color && haystack.includes(color)) score += 10;
      if (style && haystack.includes(style)) score += 6;
      if (/pinterest|instagram|youtube|facebook|ideas|shorts/i.test(item.url)) score -= 18;
      if (/search|category|collection/i.test(item.url)) score -= 14;

      return { item, score };
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, needed)
    .map((entry, index) => ({
      rank: existingUrls.size + index + 1,
      marketplace: entry.item.marketplace,
      title: entry.item.title,
      price: normaliseDisplayPrice(entry.item.price),
      url: entry.item.url,
      image: entry.item.image || null,
      relevanceScore: Math.min(78, 48 + entry.score),
      valueScore: entry.item.price?.amount != null ? 68 : 50,
      trustScore: entry.item.rating || entry.item.seller?.rating ? 66 : 54,
      overallScore: Math.min(76, 52 + entry.score),
      warnings: ['Backfilled from shopping candidates because strict ranking was too sparse'],
      recommendation: 'Useful fallback candidate from Google Shopping results',
    }));
}

async function runShoppingBranch(label, searchQuery, minimumResults = MIN_IMAGE_RESULTS, options = {}) {
  console.log(`🏪 ${label}: ${searchQuery}`);
  const parsed = await parseQuery(searchQuery);
  const primarySearch = parsed.searchTerms?.[0] || searchQuery;

  const shoppingResults = await searchGoogleShopping(primarySearch, {
    maxPrice: parsed.maxPrice,
    limit: 20,
  });

  let shoppingProducts = [];
  let directResults = [];
  let resolvedResults = [];

  if (options.exactMode && shoppingResults.length > 0) {
    // ── Exact mode: use SerpAPI Product Offers for real store URLs ──
    // Pick top results with pageTokens and get actual store links
    const withTokens = shoppingResults.filter(r => r.pageToken).slice(0, 6);
    if (withTokens.length > 0) {
      console.log(`🏷️ ${label}: fetching real store URLs for ${withTokens.length} products...`);
      const offerBatches = await Promise.all(
        withTokens.map(async (item) => {
          const offers = await getProductOffers(item.pageToken);
          return offers.map(offer => ({
            ...offer,
            image: offer.image || item.image || null,
          }));
        })
      );
      const allOffers = offerBatches.flat();
      console.log(`   → Got ${allOffers.length} store offers with direct URLs`);
      shoppingProducts = allOffers;
    }

    // Also include any direct URLs from the original results
    directResults = shoppingResults.filter(r => r.isDirect);
    shoppingProducts = [...shoppingProducts, ...directResults];

    // Fallback to Tavily resolution if no offers found
    if (shoppingProducts.length === 0) {
      const needsResolution = shoppingResults.filter(r => !r.isDirect);
      if (needsResolution.length > 0) {
        console.log(`🔗 ${label}: no product offers, falling back to URL resolution...`);
        resolvedResults = await resolveShoppingResults(needsResolution, SHOPPING_RESOLUTION_LIMIT, { query: primarySearch });
        shoppingProducts = [...directResults, ...resolvedResults];
      }
    }
  } else {
    // ── Alternatives mode: use Tavily resolution as before ──
    directResults = shoppingResults.filter(r => r.isDirect);
    const needsResolution = shoppingResults.filter(r => !r.isDirect);

    if (needsResolution.length > 0) {
      console.log(`🔗 ${label}: resolving ${needsResolution.length} URLs...`);
      resolvedResults = await resolveShoppingResults(needsResolution, SHOPPING_RESOLUTION_LIMIT, { query: primarySearch });
    }
    shoppingProducts = [...directResults, ...resolvedResults];
  }

  if (shoppingProducts.length === 0 && shoppingResults.length > 0) {
    console.log(`   ⚠️ ${label}: using raw Google Shopping fallback`);
    shoppingResults.slice(0, 8).forEach(r => {
      shoppingProducts.push({ ...r, url: r.url || r.googleFallbackUrl, source: 'google_shopping_fallback' });
    });
  }

  // Filter used products from exact matches, deduplicate
  const seen = new Set();
  const candidates = shoppingProducts
    .filter(item => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .filter(item => options.exactMode ? !isUsedProduct(item) : true);

  const ranked = candidates.length > 0
    ? await rankResults(searchQuery, candidates, parsed)
    : { results: [], bestPick: 'No results found', filtered: [] };

  const rankedResults = [...(ranked.results || [])];
  if (!options.disableBackfill && rankedResults.length < minimumResults) {
    const existingUrls = new Set(rankedResults.map(item => item.url).filter(Boolean));
    const backfill = buildBackfillCandidates(shoppingProducts, parsed, existingUrls, minimumResults);
    if (backfill.length > 0) {
      console.log(`   ↪ ${label}: backfilled ${backfill.length} extra shopping candidates`);
      rankedResults.push(...backfill);
    }
  }

  return {
    query: primarySearch,
    parsed,
    shoppingResults,
    directResults,
    resolvedResults,
    ranked: {
      ...ranked,
      results: rankedResults.map((item, index) => ({ ...item, rank: index + 1 })),
    },
  };
}

router.post('/search-image', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  const searchId = randomUUID().split('-')[0];
  const imagePath = req.file?.path || null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { username, thread_id, post_url, post_author, caption } = req.body;
    const publicBaseUrl = resolvePublicBaseUrl(req);
    const lensImageUrl = buildLensImageUrl(publicBaseUrl, req.file);

    console.log(`\n🔍 [${searchId}] Image search from @${username || 'unknown'}`);

    console.log('🚀 Step 1+2: Vision + Google Lens (parallel)...');
    if (lensImageUrl) {
      console.log(`   🌐 Lens upload URL: ${lensImageUrl}`);
    } else {
      console.log(`   🔍 Lens: disabled (${LENS_PROVIDER})`);
    }

    const [vision, lensResults] = await Promise.all([
      analyzeClothingImage(imagePath, { caption: caption || '', post_author: post_author || '' })
        .catch(err => { console.error('Vision failed:', err.message); return null; }),
      lensImageUrl
        ? searchGoogleLens(lensImageUrl, { provider: LENS_PROVIDER, limit: 8, visualLimit: 10 })
        : Promise.resolve({ exactMatches: [], visualMatches: [] }),
    ]);

    const primaryItem = vision?.items?.[0];
    const searchQuery = primaryItem?.search_query || caption?.replace(/#\w+/g, '').trim() || 'clothing';

    if (primaryItem) {
      console.log(`   👁️ Vision: ${primaryItem.item_type} (${primaryItem.color || '?'}) → "${searchQuery}"`);
    } else {
      console.log(`   👁️ Vision: failed, using caption fallback → "${searchQuery}"`);
    }
    console.log('🧩 Step 3: Reconciling discovery...');
    // LLM reconciliation is the primary path — it can read all Lens titles
    // and understand brand vs reseller names. Heuristic is fallback only.
    const discovery = await reconcileImageDiscovery({
      caption: caption || '',
      vision,
      lensResults,
    }).catch(err => {
      console.error('Discovery reconciliation failed, falling back to heuristic:', err.message);
      // Fallback: use heuristic consensus if LLM fails
      const heuristicResult = inferLensExactMatch(lensResults, primaryItem);
      if (heuristicResult) {
        heuristicResult.hasExactModel = true;
        heuristicResult.alternativeSearchQuery = searchQuery;
        heuristicResult.source = 'lens_heuristic_fallback';
        return heuristicResult;
      }
      return {
        hasExactModel: false,
        exactModel: null,
        exactSearchQuery: null,
        confidence: 'low',
        alternativeSearchQuery: searchQuery,
        rationale: 'Reconciliation failed',
      };
    });

    if (!discovery.alternativeSearchQuery) {
      discovery.alternativeSearchQuery = searchQuery;
    }

    if (discovery.hasExactModel) {
      console.log(`   🎯 Exact model: ${discovery.exactModel} (${discovery.confidence}) → "${discovery.exactSearchQuery}"`);
    } else {
      console.log(`   🎯 Exact model: none (${discovery.confidence})`);
    }
    console.log(`   🧭 Alternatives query → "${discovery.alternativeSearchQuery}"`);

    console.log('🏪 Step 4: Exact match + alternatives searches...');
    const exactPromise = discovery.hasExactModel && discovery.exactSearchQuery
      ? runShoppingBranch('Exact match search', discovery.exactSearchQuery, 4, {
        exactMode: true,
        disableBackfill: true,
      })
      : Promise.resolve(null);
    const alternativePromise = runShoppingBranch('Alternatives search', discovery.alternativeSearchQuery || searchQuery, 3);

    const [exactBranch, alternativesBranch] = await Promise.all([exactPromise, alternativePromise]);

    // No Lens fallback — trust the LLM-ranked shopping results

    const primaryRanked = exactBranch?.ranked?.results?.length
      ? exactBranch.ranked
      : alternativesBranch.ranked;
    const resultCount = primaryRanked.results?.length || 0;
    console.log(`🏆 Step 5: Returning ${resultCount} primary results`);

    // ── Step 6: Save + generate response ──
    const resultData = {
      id: searchId,
      username: username || 'unknown',
      thread_id: thread_id || null,
      post_url: post_url || null,
      post_author: post_author || null,
      caption: caption || null,
      originalImage: req.file?.filename ? `/uploads/${req.file.filename}` : null,
      vision: vision || { items: [], confidence: 'low' },
      lensResults: {
        exactCount: lensResults.exactMatches.length,
        visualCount: lensResults.visualMatches.length,
        exactMatches: lensResults.exactMatches.slice(0, 5),
        visualMatches: lensResults.visualMatches.slice(0, 8),
      },
      discovery,
      exact: exactBranch ? {
        query: exactBranch.query,
        parsed: exactBranch.parsed,
        ranked: exactBranch.ranked,
        sourceCounts: {
          googleShopping: exactBranch.shoppingResults.length,
          directUrls: exactBranch.directResults.length,
          resolvedUrls: exactBranch.resolvedResults.length,
        },
      } : null,
      alternatives: {
        query: alternativesBranch.query,
        parsed: alternativesBranch.parsed,
        ranked: alternativesBranch.ranked,
        sourceCounts: {
          googleShopping: alternativesBranch.shoppingResults.length,
          directUrls: alternativesBranch.directResults.length,
          resolvedUrls: alternativesBranch.resolvedResults.length,
        },
      },
      parsed: alternativesBranch.parsed,
      ranked: primaryRanked,
      sources: {
        googleLens: lensResults.exactMatches.length + lensResults.visualMatches.length,
        exactGoogleShopping: exactBranch?.shoppingResults.length || 0,
        alternativeGoogleShopping: alternativesBranch.shoppingResults.length,
        exactResolvedUrls: exactBranch?.resolvedResults.length || 0,
        alternativeResolvedUrls: alternativesBranch.resolvedResults.length,
      },
      duration: Date.now() - startTime,
      createdAt: new Date().toISOString(),
    };

    saveResult(searchId, resultData);

    const pageUrl = `${publicBaseUrl.replace(/\/$/, '')}/find/${searchId}`;
    const dmText = formatDmReply(vision, exactBranch?.ranked, alternativesBranch.ranked, discovery, pageUrl);
    const duration = Date.now() - startTime;

    console.log(`✅ [${searchId}] Done in ${duration}ms — ${resultCount} results\n`);

    // ── DB logging (fire-and-forget) ──
    logSearch({
      source: username ? 'instagram' : 'web',
      username: username || null,
      query: searchQuery,
      imageFilename: req.file?.filename || null,
      durationMs: duration,
      resultCount,
    }).then(dbId => {
      if (!dbId) return;
      if (primaryItem) {
        logBrand({
          searchId: dbId,
          brand: primaryItem.brand,
          itemType: primaryItem.item_type,
          color: primaryItem.color,
          style: primaryItem.style,
          material: primaryItem.material,
          confidence: vision?.confidence,
        });
      }
      logResults(dbId, primaryRanked.results || []);
    }).catch(() => {});

    res.json({
      dm_text: dmText,
      page_url: pageUrl,
      searchId,
      resultCount,
      duration,
      results: primaryRanked,
      exactResults: exactBranch?.ranked || null,
      alternativeResults: alternativesBranch.ranked,
      discovery,
      lensResults: resultData.lensResults,
      vision: resultData.vision,
      sources: resultData.sources,
      privacy: primaryRanked.privacyNote || 'Processed privately',
    });

  } catch (error) {
    console.error(`❌ [${searchId}] Error:`, error);
    res.json({
      dm_text: "Something went wrong. Try again? 🙏",
      page_url: null,
      searchId,
      error: error.message,
    });
  } finally {
    // Keep uploaded images — they're shown on the results page
  }
});


function formatDmReply(vision, exactRanked, alternativeRanked, discovery, pageUrl) {
  const exactResults = exactRanked?.results || [];
  const alternativeResults = alternativeRanked?.results || [];
  const primary = vision?.items?.[0];

  if (exactResults.length === 0 && alternativeResults.length === 0) {
    return "Couldn't find matches for that one. Try a different angle or a clearer photo? 📸";
  }

  let msg = '';

  // What we detected
  if (primary) {
    const desc = [primary.color, primary.brand, primary.item_type].filter(Boolean).join(' ');
    if (desc) msg += `🔍 ${desc}\n\n`;
  }

  const topExact = exactResults[0];
  if (topExact) {
    msg += `🎯 Exact: ${topExact.title}\n`;
    if (topExact.price) msg += `💰 ${topExact.price} — ${topExact.marketplace || ''}\n`;
  } else if (discovery?.hasExactModel) {
    msg += `🎯 Exact model: ${discovery.exactModel}\n`;
  }

  const topAlt = alternativeResults[0];
  if (topAlt) {
    msg += `\n🧭 Alt: ${topAlt.title}\n`;
    if (topAlt.price) msg += `💰 ${topAlt.price} — ${topAlt.marketplace || ''}\n`;
  }

  const extraCount = Math.max(0, exactResults.length - 1) + Math.max(0, alternativeResults.length - 1);
  if (extraCount > 0) {
    msg += `\n📦 +${extraCount} more options\n`;
  }

  msg += `\n👉 ${pageUrl}`;

  return msg;
}


export { router as searchImageRouter };
