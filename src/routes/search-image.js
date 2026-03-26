/**
 * POST /api/search-image
 *
 * Accepts an image (multipart) + optional metadata.
 * Pipeline: vision → search → rank → save → return DM text + page URL.
 *
 * This is the entry point the IG bridge calls.
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { analyzeClothingImage } from '../services/vision.js';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchGoogleShopping } from '../services/search-serp.js';
import { resolveShoppingResults, validateResolvedResults } from '../services/search-web.js';
import { hasFirecrawlKey } from '../services/firecrawl.js';

const router = Router();

// File upload handling
const upload = multer({
  dest: 'media/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Results storage directory
const RESULTS_DIR = 'data/results';
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// Base URL for result pages (configure via env)
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * POST /api/search-image
 * Body: multipart/form-data with "image" file + optional fields
 */
router.post('/search-image', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  const searchId = randomUUID().split('-')[0]; // Short ID like "a3f2b1c9"

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const imagePath = req.file.path;
    const { username, thread_id, post_url, post_author, caption } = req.body;

    console.log(`\n🔍 [${searchId}] Image search from @${username || 'unknown'}`);
    if (post_url) console.log(`   📎 Post: ${post_url}`);

    // ── Step 1: Vision analysis ──
    console.log('👁️  Step 1: Analyzing image...');
    const vision = await analyzeClothingImage(imagePath, {
      caption: caption || '',
      post_author: post_author || '',
    });

    const primaryItem = vision.items?.[0];
    if (!primaryItem) {
      return res.json({
        dm_text: "I couldn't identify any clothing in that image. Try sending a clearer photo? 📸",
        page_url: null,
        searchId,
      });
    }

    console.log(`   → ${vision.items.length} item(s) detected`);
    console.log(`   → Primary: ${primaryItem.item_type} (${primaryItem.color || 'unknown color'})`);
    console.log(`   → Search query: "${primaryItem.search_query}"`);

    // ── Step 2: Parse search query via LLM ──
    console.log('📝 Step 2: Parsing search terms...');
    const parsed = await parseQuery(primaryItem.search_query);
    const primarySearch = parsed.searchTerms?.[0] || primaryItem.search_query;
    console.log(`   → Terms: ${parsed.searchTerms?.join(', ')}`);

    // ── Step 3: Google Shopping search ──
    console.log('🏪 Step 3: Google Shopping...');
    const shoppingResults = await searchGoogleShopping(primarySearch, {
      maxPrice: parsed.maxPrice,
      limit: 20,
    });

    // ── Step 4: Split and resolve URLs ──
    const directResults = shoppingResults.filter((r) => r.isDirect);
    const needsResolution = shoppingResults.filter((r) => !r.isDirect);
    console.log(`   → ${directResults.length} direct, ${needsResolution.length} need resolution`);

    let resolvedResults = [];
    if (needsResolution.length > 0) {
      console.log('🔗 Step 4: Resolving URLs...');
      resolvedResults = await resolveShoppingResults(needsResolution, 8, {
        query: primarySearch,
      });
      console.log(`   → Resolved: ${resolvedResults.length}`);
    }

    // Combine + dedupe
    const seen = new Set();
    const allResults = [...directResults, ...resolvedResults].filter((r) => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // If URL resolution killed everything, fall back to raw shopping results
    // (Google redirect URLs are ugly but still work for users)
    if (allResults.length === 0 && shoppingResults.length > 0) {
      console.log('⚠️  No resolved URLs — falling back to raw Google Shopping results');
      const fallback = shoppingResults.slice(0, 10).map(r => ({
        ...r,
        url: r.url || r.googleFallbackUrl || null,
        isDirect: false,
        source: 'google_shopping_fallback',
      })).filter(r => r.url);
      allResults.push(...fallback);
    }

    // ── Step 5: Validate (optional) ──
    let validatedResults = allResults;
    if (allResults.length > 0 && hasFirecrawlKey()) {
      console.log('🧾 Step 5: Validating product pages...');
      const validated = await validateResolvedResults(allResults, parsed, 8);
      if (validated.length > 0) validatedResults = validated;
    }

    // ── Step 6: Rank ──
    console.log(`🏆 Step 6: Ranking ${validatedResults.length} results...`);
    const ranked =
      validatedResults.length > 0
        ? await rankResults(primaryItem.search_query, validatedResults, parsed)
        : { results: [], bestPick: 'No results found', privacyNote: '' };

    // ── Step 7: Save results ──
    const resultData = {
      id: searchId,
      username: username || 'unknown',
      thread_id: thread_id || null,
      post_url: post_url || null,
      post_author: post_author || null,
      caption: caption || null,
      vision,
      parsed,
      ranked,
      sources: {
        googleShopping: shoppingResults.length,
        directUrls: directResults.length,
        resolvedUrls: resolvedResults.length,
      },
      duration: Date.now() - startTime,
      createdAt: new Date().toISOString(),
    };

    const resultPath = join(RESULTS_DIR, `${searchId}.json`);
    writeFileSync(resultPath, JSON.stringify(resultData, null, 2));
    console.log(`💾 Results saved: ${resultPath}`);

    // ── Step 8: Format DM response ──
    const pageUrl = `${BASE_URL}/find/${searchId}`;
    const dmText = formatDmReply(vision, ranked, pageUrl);
    const duration = Date.now() - startTime;

    console.log(`✅ [${searchId}] Done in ${duration}ms — ${ranked.results?.length || 0} results\n`);

    res.json({
      dm_text: dmText,
      page_url: pageUrl,
      searchId,
      resultCount: ranked.results?.length || 0,
      duration,
    });
  } catch (error) {
    console.error(`❌ [${searchId}] Error:`, error);
    res.json({
      dm_text: "Something went wrong analyzing your image. Try again? 🙏",
      page_url: null,
      searchId,
      error: error.message,
    });
  }
});

/**
 * Format search results into a DM-friendly reply.
 */
function formatDmReply(vision, ranked, pageUrl) {
  const items = vision.items || [];
  const results = ranked.results || [];
  const primary = items[0];

  if (results.length === 0) {
    const itemDesc = primary
      ? `${primary.color || ''} ${primary.item_type || 'item'}`.trim()
      : 'that item';
    return `I analyzed your image and identified a ${itemDesc}, but couldn't find exact matches online right now. Try sending a different angle or a clearer photo? 📸`;
  }

  // Build concise DM
  let msg = `✨ Found it!\n\n`;

  // What we detected
  if (primary) {
    const desc = [primary.color, primary.brand, primary.item_type].filter(Boolean).join(' ');
    msg += `🔍 Detected: ${desc}\n\n`;
  }

  // Top result
  const top = results[0];
  if (top) {
    msg += `🎯 Best match: ${top.title}\n`;
    if (top.price) msg += `💰 ${top.price}\n`;
    msg += `\n`;
  }

  // More results count
  if (results.length > 1) {
    msg += `📦 +${results.length - 1} more options found\n\n`;
  }

  // Link to full results page
  msg += `👉 Full results & alternatives:\n${pageUrl}`;

  return msg;
}

export { router as searchImageRouter };
