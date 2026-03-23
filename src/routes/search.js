import { Router } from 'express';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchGoogleShopping } from '../services/search-serp.js';
import { resolveShoppingResults } from '../services/search-web.js';
import { randomUUID } from 'crypto';

const router = Router();

// In-memory store for search results
const searchResults = new Map();

/**
 * POST /api/search
 * 
 * Pipeline:
 * 1. Venice AI parses query → structured search terms
 * 2. SerpAPI Google Shopping → discovery candidates
 * 3. Tavily → resolve exact store product URLs
 * 4. Heuristics → rank resolved listings
 */
router.post('/search', async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchId = randomUUID();
    const startTime = Date.now();

    // ── Step 1: Parse query with Venice AI (private) ──
    console.log(`\n🔍 [${searchId.slice(0,8)}] Query: "${query}"`);
    console.log('🧠 Step 1: Parsing query privately via LLM...');
    const parsed = await parseQuery(query);
    console.log(`   → Search terms: ${parsed.searchTerms?.join(', ')}`);
    console.log(`   → Brand: ${parsed.brand || 'any'}, Type: ${parsed.productType || 'general'}`);

    const primarySearch = parsed.searchTerms?.[0] || query;

    // ── Step 2: Discover candidates via Google Shopping ──
    console.log('🏪 Step 2: Searching Google Shopping for product candidates...');
    const shoppingResults = await searchGoogleShopping(primarySearch, {
      maxPrice: parsed.maxPrice,
      limit: Math.max(maxResults * 4, 20),
    });

    console.log(`   → Google Shopping: ${shoppingResults.length} results`);

    // ── Step 3: Resolve exact product URLs via Tavily ──
    console.log('🔗 Step 3: Resolving store product URLs via Tavily...');
    const resolvedResults = await resolveShoppingResults(
      shoppingResults,
      Math.max(maxResults * 2, 12),
      { query: primarySearch }
    );
    console.log(`   → Resolved store URLs: ${resolvedResults.length}`);

    // Deduplicate resolved URLs
    const seen = new Set();
    const dedupedResolvedResults = resolvedResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    const allResults = dedupedResolvedResults;

    // ── Step 4: Rank resolved listings ──
    console.log('🏆 Step 4: Ranking resolved product pages...');
    let ranked;
    if (allResults.length > 0) {
      ranked = await rankResults(query, allResults, parsed);
    } else {
      ranked = { results: [], bestPick: 'No results found', privacyNote: '' };
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Done in ${duration}ms — ${allResults.length} results ranked\n`);

    // Store results
    const searchRecord = {
      id: searchId,
      query,
      parsed,
      allResults,
      ranked,
      duration,
      createdAt: new Date().toISOString(),
    };
    searchResults.set(searchId, searchRecord);

    res.json({
      searchId,
      query,
      resultCount: allResults.length,
      results: ranked,
      duration,
      sources: {
        googleShopping: shoppingResults.length,
        resolvedUrls: dedupedResolvedResults.length,
      },
      privacy: 'All queries processed with zero data retention',
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

/**
 * GET /api/results/:searchId
 */
router.get('/results/:searchId', (req, res) => {
  const result = searchResults.get(req.params.searchId);
  if (!result) {
    return res.status(404).json({ error: 'Search not found' });
  }
  res.json(result);
});

function extractDomain(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    const names = {
      'amazon.co.uk': 'Amazon', 'ebay.co.uk': 'eBay',
      'selfridges.com': 'Selfridges', 'argos.co.uk': 'Argos',
      'currys.co.uk': 'Currys', 'johnlewis.com': 'John Lewis',
      'aliexpress.com': 'AliExpress', 'asos.com': 'ASOS',
    };
    return names[domain] || domain;
  } catch { return 'Unknown'; }
}

export { router as searchRouter };
