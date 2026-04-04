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
import { searchGoogleShopping } from '../services/search-serp.js';
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
const MIN_IMAGE_RESULTS = Number(process.env.IMAGE_MIN_RESULTS || 3);

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

const RESALE_DOMAINS = /\b(ebay|depop|vinted|poshmark|therealreal|vestiairecollective|thredup|grailed|mercari|tradesy)\b/i;
const USED_KEYWORDS = /\bpre[- ]?owned\b|\bused\b|\bvintage\b|\bsecondhand\b|\bsecond[- ]hand\b/i;

function isUsedProduct(item) {
  const url = String(item.url || '');
  const title = String(item.title || '');
  if (RESALE_DOMAINS.test(url)) return true;
  if (USED_KEYWORDS.test(title)) return true;
  return false;
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

// ── Lens-first exact matches (deterministic) ──
const SOCIAL_URL_PATTERN = /instagram|youtube|reddit|pinterest|facebook|tiktok|twitter|threads/i;
const CATEGORY_URL_PATTERN = /\/collections?\b|\/category\b|\/search\?|\/shop\/?$|\/brand\//i;

function isBuyableUrl(url) {
  if (!url) return false;
  if (SOCIAL_URL_PATTERN.test(url)) return false;
  if (CATEGORY_URL_PATTERN.test(url)) return false;
  return true;
}

function buildExactMatchesFromLens(lensResults, discovery) {
  const allCandidates = [];

  // 1. Offers — best quality (direct buy links with prices)
  for (const offer of (lensResults.offers || [])) {
    if (!isBuyableUrl(offer.url)) continue;
    if (isUsedProduct(offer)) continue;
    allCandidates.push({
      marketplace: offer.marketplace || 'Unknown',
      title: offer.title || discovery.exactModel || '',
      price: offer.price ? (typeof offer.price === 'string' ? offer.price : offer.price.display || '') : '',
      url: offer.url,
      image: offer.image || null,
      source: 'lens_offer',
      availability: offer.availability || null,
    });
  }

  // 2. Organic results — direct store URLs
  for (const item of (lensResults.exactMatches || [])) {
    if (!isBuyableUrl(item.url)) continue;
    if (isUsedProduct(item)) continue;
    allCandidates.push({
      marketplace: item.marketplace || 'Unknown',
      title: item.title || '',
      price: '',
      url: item.url,
      image: item.image || null,
      source: 'lens_organic',
    });
  }

  // 3. Visual matches — have images
  for (const item of (lensResults.visualMatches || [])) {
    if (!isBuyableUrl(item.url)) continue;
    if (isUsedProduct(item)) continue;
    allCandidates.push({
      marketplace: item.marketplace || 'Unknown',
      title: item.title || '',
      price: '',
      url: item.url,
      image: item.image || null,
      source: 'lens_visual',
    });
  }

  // Deduplicate by URL
  const seen = new Set();
  const deduped = allCandidates.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Log what we found
  console.log(`   🎯 Lens exact candidates: ${deduped.length} buyable (${allCandidates.length - deduped.length} dupes removed)`);
  for (const c of deduped.slice(0, 8)) {
    const priceStr = c.price ? ` ${c.price}` : '';
    const imgStr = c.image ? ' 🖼️' : '';
    console.log(`      ${c.source === 'lens_offer' ? '💰' : '📄'} [${c.marketplace}]${priceStr}${imgStr} — ${c.url.slice(0, 70)}`);
  }

  const results = deduped.slice(0, 4).map((item, index) => ({
    rank: index + 1,
    marketplace: item.marketplace,
    title: item.title,
    price: item.price,
    url: item.url,
    image: item.image,
    overallScore: 80 - (index * 5),
    relevanceScore: 80,
    source: item.source,
  }));

  return {
    ranked: {
      results,
      bestPick: results[0]?.title || 'No exact matches found',
    },
    query: discovery.exactSearchQuery,
  };
}

// ── Alternatives: Google Shopping + Tavily ──
async function runShoppingBranch(label, searchQuery, minimumResults = MIN_IMAGE_RESULTS, options = {}) {
  console.log(`🏪 ${label}: ${searchQuery}`);
  const parsed = await parseQuery(searchQuery);
  const primarySearch = parsed.searchTerms?.[0] || searchQuery;

  const shoppingResults = await searchGoogleShopping(primarySearch, {
    maxPrice: parsed.maxPrice,
    limit: 20,
  });

  const directResults = shoppingResults.filter(r => r.isDirect);
  const needsResolution = shoppingResults.filter(r => !r.isDirect);

  let resolvedResults = [];
  if (needsResolution.length > 0) {
    console.log(`🔗 ${label}: resolving ${needsResolution.length} URLs...`);
    resolvedResults = await resolveShoppingResults(needsResolution, SHOPPING_RESOLUTION_LIMIT, { query: primarySearch });
  }

  let shoppingProducts = [...directResults, ...resolvedResults];

  if (shoppingProducts.length === 0 && shoppingResults.length > 0) {
    console.log(`   ⚠️ ${label}: using raw Google Shopping fallback`);
    shoppingResults.slice(0, 8).forEach(r => {
      shoppingProducts.push({ ...r, url: r.url || r.googleFallbackUrl, source: 'google_shopping_fallback' });
    });
  }

  // Deduplicate
  const seen = new Set();
  const candidates = shoppingProducts.filter(item => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

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

    // ── Step 4a: Exact matches from Lens data (deterministic) ──
    let exactBranch = null;
    if (discovery.hasExactModel && discovery.exactSearchQuery) {
      console.log('🎯 Step 4a: Building exact matches from Lens data...');
      exactBranch = buildExactMatchesFromLens(lensResults, discovery);
    }

    // ── Step 4b: Alternatives from Google Shopping + Tavily ──
    console.log('🏪 Step 4b: Alternatives search...');
    const alternativesBranch = await runShoppingBranch(
      'Alternatives search',
      discovery.alternativeSearchQuery || searchQuery,
      3,
    );

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
        ranked: exactBranch.ranked,
        source: 'lens_direct',
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
