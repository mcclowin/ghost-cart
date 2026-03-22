/**
 * SerpAPI Google Shopping integration
 * Returns structured product data: title, price, store, rating, image, link
 * Docs: https://serpapi.com/google-shopping-api
 */

/**
 * Search Google Shopping via SerpAPI
 * @param {string} query - Search terms
 * @param {object} options - Search options
 * @returns {Array} Normalized product results
 */
export async function searchGoogleShopping(query, options = {}) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn('⚠️ SERPAPI_KEY not set — skipping Google Shopping');
    return [];
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google_shopping',
      q: query,
      gl: options.country || 'uk',     // UK results
      hl: options.language || 'en',
      num: (options.limit || 10).toString(),
    });

    // Add price range if specified
    if (options.minPrice) params.append('tbs', `mr:1,price:1,ppr_min:${options.minPrice}`);
    if (options.maxPrice) params.append('tbs', `mr:1,price:1,ppr_max:${options.maxPrice}`);

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    if (!data.shopping_results) {
      console.log('No Google Shopping results found');
      return [];
    }

    return data.shopping_results.map(item => ({
      marketplace: item.source || 'Google Shopping',
      title: item.title,
      price: {
        amount: parseFloat(item.extracted_price) || null,
        currency: 'GBP',
        display: item.price || 'See store',
      },
      image: item.thumbnail || null,
      url: item.link || item.product_link,
      rating: item.rating || null,
      reviews: item.reviews || null,
      seller: {
        name: item.source || 'Unknown',
        rating: item.seller_rating || null,
      },
      shipping: item.delivery || null,
      condition: item.second_hand_condition || 'New',
      badge: item.tag || null, // "Great price", "Top quality", etc.
      // SerpAPI specific
      productId: item.product_id || null,
      serpPosition: item.position,
    }));

  } catch (error) {
    console.error('SerpAPI search error:', error.message);
    return [];
  }
}

/**
 * Search Google web results for product pages on specific stores
 * Useful when Google Shopping doesn't cover a store
 */
export async function searchGoogleWeb(query, sites = [], limit = 5) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const siteFilter = sites.length > 0
      ? ' ' + sites.map(s => `site:${s}`).join(' OR ')
      : '';

    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google',
      q: query + siteFilter,
      gl: 'uk',
      hl: 'en',
      num: limit.toString(),
    });

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    return (data.organic_results || []).map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      marketplace: extractDomain(item.link),
    }));

  } catch (error) {
    console.error('SerpAPI web search error:', error.message);
    return [];
  }
}

function extractDomain(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    // Pretty names
    const names = {
      'amazon.co.uk': 'Amazon',
      'ebay.co.uk': 'eBay',
      'selfridges.com': 'Selfridges',
      'zara.com': 'Zara',
      'asos.com': 'ASOS',
      'aliexpress.com': 'AliExpress',
      'espares.co.uk': 'eSpares',
      'currys.co.uk': 'Currys',
      'argos.co.uk': 'Argos',
      'johnlewis.com': 'John Lewis',
    };
    return names[domain] || domain;
  } catch {
    return 'Unknown';
  }
}
