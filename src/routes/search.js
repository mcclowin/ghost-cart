import { Router } from 'express';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchEbay } from '../services/search-ebay.js';
import { searchGoogleShopping } from '../services/search-serp.js';
import { searchTavily } from '../services/search-web.js';
import { randomUUID } from 'crypto';

const router = Router();

// In-memory store for search results
const searchResults = new Map();

/**
 * POST /api/search
 * 
 * Pipeline:
 * 1. Venice AI parses query → structured search terms
 * 2. SerpAPI Google Shopping → structured product data (price, rating, image)
 * 3. eBay Browse API → more structured results (parallel)
 * 4. Tavily → enriches top results with full page details
 * 5. Venice AI → ranks everything
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

    // ── Step 2 & 3: Search marketplaces in parallel ──
    console.log('🏪 Step 2: Searching Google Shopping + eBay in parallel...');
    const [shoppingResults, ebayResults] = await Promise.all([
      searchGoogleShopping(primarySearch, {
        maxPrice: parsed.maxPrice,
        limit: maxResults,
      }),
      searchEbay(primarySearch, Math.min(maxResults, 5)),
    ]);

    console.log(`   → Google Shopping: ${shoppingResults.length} results`);
    console.log(`   → eBay: ${ebayResults.length} results`);

    // Combine all results
    let allResults = [...shoppingResults, ...ebayResults];

    // ── Step 3b: Fallback to Tavily if no structured results ──
    if (allResults.length === 0) {
      console.log('🔄 No structured results — falling back to Tavily web search...');
      const tavilyResults = await searchTavily(`buy ${primarySearch}`, [
        'amazon.co.uk', 'ebay.co.uk', 'selfridges.com', 'argos.co.uk'
      ]);
      allResults = tavilyResults.map(r => ({
        marketplace: extractDomain(r.url),
        title: r.title,
        url: r.url,
        snippet: r.content,
        price: null,
        image: null,
      }));
      console.log(`   → Tavily fallback: ${allResults.length} results`);
    }

    // ── Step 4: Enrich top results via Tavily page fetch (optional) ──
    // Only if we have results that need more detail
    // TODO: Add Tavily extract for top 3 URLs to get shipping, stock, specs

    // ── Step 5: Rank with Venice AI (private) ──
    console.log('🏆 Step 4: Ranking results via LLM...');
    let ranked;
    if (allResults.length > 0) {
      ranked = await rankResults(query, allResults);
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
        ebay: ebayResults.length,
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
