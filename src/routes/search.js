import { Router } from 'express';
import { parseQuery, rankResults } from '../services/venice.js';
import { searchEbay } from '../services/search-ebay.js';
import { searchAllWebStores } from '../services/search-web.js';
import { randomUUID } from 'crypto';

const router = Router();

// In-memory store for search results (replace with DB in production)
const searchResults = new Map();

/**
 * POST /api/search
 * Submit a product search query
 */
router.post('/search', async (req, res) => {
  try {
    const { query, maxResults = 5, marketplaces } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchId = randomUUID();

    // Step 1: Venice AI parses the natural language query privately
    console.log(`🔍 Parsing query privately via Venice AI: "${query}"`);
    const parsed = await parseQuery(query);
    console.log('📋 Parsed:', JSON.stringify(parsed, null, 2));

    // Step 2: Search across marketplaces in parallel
    console.log('🏪 Searching marketplaces...');
    const [ebayResults, webResults] = await Promise.all([
      searchEbay(parsed.searchTerms[0], maxResults),
      searchAllWebStores(parsed.searchTerms[0]),
    ]);

    const allResults = [...ebayResults, ...webResults];
    console.log(`📦 Found ${allResults.length} results across all marketplaces`);

    // Step 3: Venice AI ranks results privately
    let ranked;
    if (allResults.length > 0) {
      console.log('🏆 Ranking results via Venice AI...');
      ranked = await rankResults(query, allResults);
    } else {
      ranked = { results: [], message: 'No results found' };
    }

    // Store results
    const searchRecord = {
      id: searchId,
      query,
      parsed,
      results: allResults,
      ranked,
      createdAt: new Date().toISOString(),
    };
    searchResults.set(searchId, searchRecord);

    res.json({
      searchId,
      query,
      resultCount: allResults.length,
      results: ranked,
      privacy: 'All queries processed by Venice AI with zero data retention',
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

/**
 * GET /api/results/:searchId
 * Retrieve results for a previous search
 */
router.get('/results/:searchId', (req, res) => {
  const result = searchResults.get(req.params.searchId);
  if (!result) {
    return res.status(404).json({ error: 'Search not found' });
  }
  res.json(result);
});

export { router as searchRouter };
