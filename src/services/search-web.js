/**
 * Web search via Tavily + Firecrawl for stores without APIs
 * Used for: Amazon, AliExpress, Selfridges, Zara, etc.
 */

/**
 * Search via Tavily API (finds product pages across the web)
 */
export async function searchTavily(query, sites = []) {
  try {
    const searchQuery = sites.length > 0
      ? `${query} ${sites.map(s => `site:${s}`).join(' OR ')}`
      : query;

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: searchQuery,
        max_results: 10,
        include_domains: sites.length > 0 ? sites : undefined,
      }),
    });

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Tavily search error:', error.message);
    return [];
  }
}

/**
 * Scrape a product page via Firecrawl (through Locus wrapped API)
 */
export async function scrapeProductPage(url) {
  try {
    const response = await fetch('https://beta-api.paywithlocus.com/api/wrapped/firecrawl/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LOCUS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown'],
      }),
    });

    const data = await response.json();
    return data.success ? data.data : null;
  } catch (error) {
    console.error('Firecrawl scrape error:', error.message);
    return null;
  }
}

/**
 * Search specific store via Tavily + scrape results
 * @param {string} query - Product search query  
 * @param {string} store - Store domain (e.g. 'selfridges.com')
 * @param {string} storeName - Display name
 */
export async function searchStore(query, store, storeName) {
  const webResults = await searchTavily(query, [store]);
  
  const products = [];
  for (const result of webResults.slice(0, 3)) {
    // Basic extraction from Tavily result metadata
    products.push({
      marketplace: storeName,
      title: result.title,
      url: result.url,
      snippet: result.content,
      price: null, // Will be extracted by Venice AI from snippet
      image: null,
    });
  }

  return products;
}

/**
 * Search across multiple web stores based on product category
 */
export async function searchAllWebStores(query, productType = 'general') {
  // Category-aware store selection
  const storesByCategory = {
    fashion: [
      'selfridges.com', 'zara.com', 'asos.com', 'hm.com',
      'uniqlo.com', 'net-a-porter.com', 'farfetch.com',
      'amazon.co.uk', 'ebay.co.uk',
    ],
    electronics: [
      'amazon.co.uk', 'currys.co.uk', 'argos.co.uk',
      'ebay.co.uk', 'aliexpress.com', 'johnlewis.com',
    ],
    'spare parts': [
      'espares.co.uk', 'partselect.co.uk', 'ebay.co.uk',
      'amazon.co.uk', 'aliexpress.com',
    ],
    luxury: [
      'selfridges.com', 'harrods.com', 'net-a-porter.com',
      'farfetch.com', 'mrporter.com', 'matchesfashion.com',
    ],
    general: [
      'amazon.co.uk', 'ebay.co.uk', 'argos.co.uk',
      'selfridges.com', 'johnlewis.com', 'aliexpress.com',
    ],
  };

  const category = productType?.toLowerCase() || 'general';
  const stores = storesByCategory[category] || storesByCategory.general;

  // Search Tavily with ALL relevant stores in one call (more efficient)
  const results = await searchTavily(`buy ${query}`, stores);

  return results.map(r => ({
    marketplace: extractStoreName(r.url),
    title: r.title,
    url: r.url,
    snippet: r.content,
    price: extractPriceFromText(r.title + ' ' + (r.content || '')),
    image: null, // Tavily doesn't return images — SerpAPI does
  }));
}

/**
 * Extract price from text using regex
 */
function extractPriceFromText(text) {
  if (!text) return null;
  // Match £XX.XX, $XX.XX, EUR XX.XX patterns
  const match = text.match(/[£$€]\s?(\d{1,5}(?:[.,]\d{2})?)/);
  if (match) {
    return {
      amount: parseFloat(match[1].replace(',', '.')),
      currency: match[0].startsWith('£') ? 'GBP' : match[0].startsWith('$') ? 'USD' : 'EUR',
      display: match[0],
    };
  }
  return null;
}

function extractStoreName(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    const names = {
      'amazon.co.uk': 'Amazon', 'ebay.co.uk': 'eBay',
      'selfridges.com': 'Selfridges', 'zara.com': 'Zara',
      'asos.com': 'ASOS', 'hm.com': 'H&M', 'uniqlo.com': 'Uniqlo',
      'net-a-porter.com': 'NET-A-PORTER', 'farfetch.com': 'Farfetch',
      'mrporter.com': 'MR PORTER', 'matchesfashion.com': 'MATCHES',
      'harrods.com': 'Harrods', 'currys.co.uk': 'Currys',
      'argos.co.uk': 'Argos', 'johnlewis.com': 'John Lewis',
      'aliexpress.com': 'AliExpress', 'espares.co.uk': 'eSpares',
      'partselect.co.uk': 'PartSelect',
    };
    return names[domain] || domain;
  } catch { return 'Unknown'; }
}
