import { Router } from 'express';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchGoogleShopping } from '../services/search-serp.js';
import { resolveShoppingResults } from '../services/search-web.js';
import { randomUUID } from 'crypto';

const router = Router();
const searchResults = new Map();

/**
 * POST /api/search
 * 
 * Pipeline:
 * 1. LLM parses query → structured search terms
 * 2. SerpAPI Google Shopping → product candidates (images, prices, ratings)
 * 3. Split results: direct store URLs vs Google redirects
 * 4. Tavily resolves ONLY the Google redirect URLs (not all)
 * 5. Heuristic ranking of all results
 */
router.post('/search', async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const searchId = randomUUID();
    const startTime = Date.now();

    // ── Step 1: Parse query ──
    console.log(`\n🔍 [${searchId.slice(0,8)}] Query: "${query}"`);
    const parsed = await parseQuery(query);
    const primarySearch = parsed.searchTerms?.[0] || query;
    console.log(`   → Terms: ${parsed.searchTerms?.join(', ')}`);

    // ── Step 2: SerpAPI Google Shopping ──
    console.log('🏪 Step 2: Google Shopping...');
    const shoppingResults = await searchGoogleShopping(primarySearch, {
      maxPrice: parsed.maxPrice,
      limit: Math.max(maxResults * 3, 20),
    });

    // ── Step 3: Split direct vs needs-resolution ──
    const directResults = shoppingResults.filter(r => r.isDirect);
    const needsResolution = shoppingResults.filter(r => !r.isDirect);
    
    console.log(`   → ${directResults.length} direct URLs, ${needsResolution.length} need resolution`);

    // ── Step 4: Resolve only the Google redirect URLs via Tavily ──
    let resolvedResults = [];
    if (needsResolution.length > 0) {
      console.log('🔗 Step 3: Resolving Google redirects via Tavily...');
      resolvedResults = await resolveShoppingResults(
        needsResolution,
        Math.min(needsResolution.length, 8),
        { query: primarySearch }
      );
      console.log(`   → Resolved: ${resolvedResults.length}`);
    }

    // ── Combine: direct + resolved ──
    const allResults = [...directResults, ...resolvedResults];

    // Deduplicate by URL
    const seen = new Set();
    const deduped = allResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // ── Step 5: Rank ──
    console.log(`🏆 Step 4: Ranking ${deduped.length} results...`);
    const ranked = deduped.length > 0
      ? await rankResults(query, deduped, parsed)
      : { results: [], bestPick: 'No results found', privacyNote: '' };

    const duration = Date.now() - startTime;
    console.log(`✅ Done in ${duration}ms\n`);

    const searchRecord = {
      id: searchId, query, parsed, ranked, duration,
      createdAt: new Date().toISOString(),
    };
    searchResults.set(searchId, searchRecord);

    res.json({
      searchId, query,
      resultCount: deduped.length,
      results: ranked,
      duration,
      sources: {
        googleShopping: shoppingResults.length,
        directUrls: directResults.length,
        resolvedUrls: resolvedResults.length,
      },
      privacy: 'All queries processed with zero data retention',
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

router.get('/results/:searchId', (req, res) => {
  const result = searchResults.get(req.params.searchId);
  if (!result) return res.status(404).json({ error: 'Search not found' });
  res.json(result);
});

export { router as searchRouter };
