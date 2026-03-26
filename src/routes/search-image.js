/**
 * POST /api/search-image
 *
 * Pipeline:
 *   1. Vision LLM: image → clothing attributes + search query
 *   2. Google Lens: image → exact visual product matches
 *   3. Google Shopping: search query → priced alternatives
 *   4. Combine + dedupe + rank
 *   5. Save results → generate page URL
 *   6. Return { dm_text, page_url }
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { analyzeClothingImage } from '../services/vision.js';
import { searchGoogleLens } from '../services/search-lens.js';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchGoogleShopping } from '../services/search-serp.js';
import { resolveShoppingResults } from '../services/search-web.js';

const router = Router();

const upload = multer({
  dest: 'media/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

const RESULTS_DIR = 'data/results';
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL || process.env.AGENT_BASE_URL || 'http://localhost:3000';

router.post('/search-image', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  const searchId = randomUUID().split('-')[0];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const imagePath = req.file.path;
    const { username, thread_id, post_url, post_author, caption } = req.body;
    // The bridge can pass the original IG image URL for Google Lens
    const imageUrl = req.body.image_url || null;

    console.log(`\n🔍 [${searchId}] Image search from @${username || 'unknown'}`);

    // ── Step 1 & 2: Run vision + Google Lens in PARALLEL ──
    console.log('🚀 Step 1+2: Vision + Google Lens (parallel)...');

    const [vision, lensResults] = await Promise.all([
      // Vision: image → attributes
      analyzeClothingImage(imagePath, { caption: caption || '', post_author: post_author || '' })
        .catch(err => { console.error('Vision failed:', err.message); return null; }),

      // Google Lens: image → exact matches (needs public URL)
      imageUrl
        ? searchGoogleLens(imageUrl, { limit: 10 })
            .catch(err => { console.error('Lens failed:', err.message); return { exactMatches: [], visualMatches: [] }; })
        : Promise.resolve({ exactMatches: [], visualMatches: [] }),
    ]);

    const primaryItem = vision?.items?.[0];
    const searchQuery = primaryItem?.search_query || caption?.replace(/#\w+/g, '').trim() || 'clothing';

    if (primaryItem) {
      console.log(`   👁️ Vision: ${primaryItem.item_type} (${primaryItem.color || '?'}) → "${searchQuery}"`);
    } else {
      console.log(`   👁️ Vision: failed, using caption fallback → "${searchQuery}"`);
    }
    console.log(`   🔍 Lens: ${lensResults.exactMatches.length} exact, ${lensResults.visualMatches.length} visual`);

    // ── Step 3: Google Shopping with vision-derived query ──
    console.log('🏪 Step 3: Google Shopping...');
    const parsed = await parseQuery(searchQuery);
    const primarySearch = parsed.searchTerms?.[0] || searchQuery;

    const shoppingResults = await searchGoogleShopping(primarySearch, {
      maxPrice: parsed.maxPrice,
      limit: 20,
    });

    // ── Step 4: Resolve shopping URLs if needed ──
    const directResults = shoppingResults.filter(r => r.isDirect);
    const needsResolution = shoppingResults.filter(r => !r.isDirect);

    let resolvedResults = [];
    if (needsResolution.length > 0) {
      console.log(`🔗 Step 4: Resolving ${needsResolution.length} URLs...`);
      resolvedResults = await resolveShoppingResults(needsResolution, 6, { query: primarySearch });
    }

    // ── Step 5: Combine all sources ──
    console.log('🏆 Step 5: Combining + ranking...');

    // Lens exact matches are highest priority (visually matched products)
    const lensProducts = lensResults.exactMatches.map(r => ({
      ...r,
      isDirect: true,
      matchType: 'exact',
    }));

    // Shopping results (direct + resolved)
    const shoppingProducts = [...directResults, ...resolvedResults];

    // Fallback: if resolution killed everything, use raw shopping
    if (shoppingProducts.length === 0 && shoppingResults.length > 0) {
      console.log('   ⚠️ Using raw Google Shopping results as fallback');
      shoppingResults.slice(0, 8).forEach(r => {
        shoppingProducts.push({ ...r, url: r.url || r.googleFallbackUrl, source: 'google_shopping_fallback' });
      });
    }

    // Combine + dedupe by URL
    const seen = new Set();
    const allResults = [];
    for (const r of [...lensProducts, ...shoppingProducts]) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      allResults.push(r);
    }

    // Rank
    const ranked = allResults.length > 0
      ? await rankResults(searchQuery, allResults, parsed)
      : { results: [], bestPick: 'No results found', filtered: [] };

    const resultCount = ranked.results?.length || 0;
    console.log(`   → ${resultCount} ranked results`);

    // ── Step 6: Save + generate response ──
    const resultData = {
      id: searchId,
      username: username || 'unknown',
      thread_id: thread_id || null,
      post_url: post_url || null,
      post_author: post_author || null,
      caption: caption || null,
      vision: vision || { items: [], confidence: 'low' },
      lensResults: {
        exactCount: lensResults.exactMatches.length,
        visualCount: lensResults.visualMatches.length,
      },
      parsed,
      ranked,
      sources: {
        googleLens: lensResults.exactMatches.length,
        googleShopping: shoppingResults.length,
        directUrls: directResults.length,
        resolvedUrls: resolvedResults.length,
      },
      duration: Date.now() - startTime,
      createdAt: new Date().toISOString(),
    };

    const resultPath = join(RESULTS_DIR, `${searchId}.json`);
    writeFileSync(resultPath, JSON.stringify(resultData, null, 2));

    const pageUrl = `${BASE_URL}/find/${searchId}`;
    const dmText = formatDmReply(vision, ranked, lensResults, pageUrl);
    const duration = Date.now() - startTime;

    console.log(`✅ [${searchId}] Done in ${duration}ms — ${resultCount} results\n`);

    res.json({ dm_text: dmText, page_url: pageUrl, searchId, resultCount, duration });

  } catch (error) {
    console.error(`❌ [${searchId}] Error:`, error);
    res.json({
      dm_text: "Something went wrong. Try again? 🙏",
      page_url: null,
      searchId,
      error: error.message,
    });
  }
});


function formatDmReply(vision, ranked, lensResults, pageUrl) {
  const results = ranked.results || [];
  const primary = vision?.items?.[0];

  if (results.length === 0 && lensResults.exactMatches.length === 0) {
    return "Couldn't find matches for that one. Try a different angle or a clearer photo? 📸";
  }

  let msg = '';

  // What we detected
  if (primary) {
    const desc = [primary.color, primary.brand, primary.item_type].filter(Boolean).join(' ');
    if (desc) msg += `🔍 ${desc}\n\n`;
  }

  // Top result
  const top = results[0];
  if (top) {
    msg += `🎯 ${top.title}\n`;
    if (top.price) msg += `💰 ${top.price} — ${top.marketplace || ''}\n`;
  }

  if (results.length > 1) {
    msg += `\n📦 +${results.length - 1} more options\n`;
  }

  msg += `\n👉 ${pageUrl}`;

  return msg;
}


export { router as searchImageRouter };
