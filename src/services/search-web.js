/**
 * Web search via Tavily + Firecrawl for stores without APIs
 * Used for: Amazon, AliExpress, Selfridges, Zara, etc.
 */

const MARKETPLACE_DOMAINS = {
  'ASOS': ['asos.com'],
  'Mountain Warehouse': ['mountainwarehouse.com'],
  'Mainline': ['mainlinemenswear.co.uk'],
  'Superdry': ['superdry.com'],
  'superdry.com': ['superdry.com'],
  'Argos': ['argos.co.uk'],
  'Amazon': ['amazon.co.uk'],
  'Currys': ['currys.co.uk'],
  'Farfetch': ['farfetch.com'],
  'Harrods': ['harrods.com'],
  'John Lewis': ['johnlewis.com'],
  'NET-A-PORTER': ['net-a-porter.com'],
  'Selfridges': ['selfridges.com'],
  'Uniqlo': ['uniqlo.com'],
  'Zara': ['zara.com'],
};

/**
 * Search via Tavily API (finds product pages across the web)
 */
export async function searchTavily(query, sites = [], maxResults = 10) {
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
        max_results: maxResults,
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

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function getMarketplaceDomains(marketplace) {
  if (!marketplace) return [];
  if (MARKETPLACE_DOMAINS[marketplace]) return MARKETPLACE_DOMAINS[marketplace];
  if (marketplace.includes('.')) return [marketplace.toLowerCase()];
  return [];
}

function titleOverlapScore(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches += 1;
  }

  return matches / leftTokens.size;
}

function selectBestTavilyMatch(item, matches) {
  let best = null;
  let bestScore = 0;

  for (const match of matches) {
    const score = titleOverlapScore(item.title, `${match.title || ''} ${match.content || ''}`);
    if (score > bestScore) {
      bestScore = score;
      best = match;
    }
  }

  return bestScore >= 0.35 ? best : null;
}

/**
 * Resolve Google Shopping listings to real store product URLs via Tavily.
 * This replaces Google result pages with likely canonical product pages.
 */
export async function resolveShoppingResults(shoppingResults, limit = 12) {
  const candidates = shoppingResults.slice(0, limit);

  const resolved = await Promise.all(candidates.map(async (item) => {
    const domains = getMarketplaceDomains(item.marketplace);
    const query = `${item.title} ${item.marketplace || ''} ${item.price?.display || ''}`.trim();
    const matches = await searchTavily(query, domains, 3);
    const bestMatch = selectBestTavilyMatch(item, matches);

    if (!bestMatch) return null;

    return {
      marketplace: extractStoreName(bestMatch.url) || item.marketplace,
      title: item.title,
      url: bestMatch.url,
      snippet: bestMatch.content || null,
      price: item.price,
      image: item.image || null,
      rating: item.rating || null,
      reviews: item.reviews || null,
      seller: item.seller || null,
      shipping: item.shipping || null,
      condition: item.condition || 'New',
      badge: item.badge || null,
      originalGoogleUrl: item.url,
      serpPosition: item.serpPosition,
      productId: item.productId || null,
      source: 'google_shopping_resolved',
    };
  }));

  const seen = new Set();
  return resolved.filter(item => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
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
