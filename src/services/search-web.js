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
 * Search across multiple web stores
 */
export async function searchAllWebStores(query) {
  const stores = [
    { domain: 'amazon.co.uk', name: 'Amazon' },
    { domain: 'selfridges.com', name: 'Selfridges' },
    { domain: 'zara.com', name: 'Zara' },
    { domain: 'aliexpress.com', name: 'AliExpress' },
  ];

  const allResults = await Promise.all(
    stores.map(s => searchStore(query, s.domain, s.name))
  );

  return allResults.flat();
}
