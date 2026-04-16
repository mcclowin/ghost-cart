/**
 * SerpAPI Google Shopping integration
 * 
 * Strategy:
 * 1. Google Shopping search → product candidates with images, prices, ratings
 * 2. Extract ALL URL fields — some results have direct store URLs
 * 3. For results with only Google redirect URLs → flag for Tavily resolution
 */

/**
 * Check if a URL is a real store product page (not a Google redirect)
 */
function isDirectStoreUrl(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    // Google internal URLs are NOT direct store links
    return !hostname.includes('google.com') && !hostname.includes('google.co.');
  } catch {
    return false;
  }
}

/**
 * Extract the best available URL from a SerpAPI shopping result
 * SerpAPI returns multiple URL fields — we want the most direct one
 */
function extractBestUrl(item) {
  // Priority order: direct store link first, Google fallback last
  const candidates = [
    item.product_link,     // Sometimes a direct store URL
    item.link,             // Main link — often Google redirect
    item.source_link,      // Seller's direct link (if available)
    item.second_hand_link, // For used items
  ].filter(Boolean);

  // Return first direct store URL, or the first available
  const directUrl = candidates.find(isDirectStoreUrl);
  const googleUrl = candidates[0]; // Fallback

  return {
    url: directUrl || googleUrl,
    isDirect: !!directUrl,
    googleFallbackUrl: directUrl ? null : googleUrl,
  };
}

/**
 * Search Google Shopping via Bright Data SERP API
 */
export async function searchGoogleShopping(query, options = {}) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_ZONE || 'serp_api1';
  if (!apiKey) {
    console.warn('⚠️ BRIGHTDATA_API_KEY not set — skipping Google Shopping');
    return [];
  }

  const country = process.env.LENS_COUNTRY || 'uk';
  const brightdataCountry = country === 'uk' ? 'gb' : country;

  try {
    const shoppingUrl = new URL('https://www.google.com/search');
    shoppingUrl.searchParams.set('q', query);
    shoppingUrl.searchParams.set('tbm', 'shop');
    shoppingUrl.searchParams.set('hl', options.language || 'en');
    shoppingUrl.searchParams.set('gl', country);
    shoppingUrl.searchParams.set('num', (options.limit || 20).toString());
    shoppingUrl.searchParams.set('brd_json', '1');

    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        zone,
        url: shoppingUrl.toString(),
        format: 'raw',
        country: brightdataCountry,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('Google Shopping: invalid JSON response');
      return [];
    }

    // Bright Data returns shopping results in 'organic' or 'shopping' array
    const shoppingResults = data.shopping || data.organic || [];
    if (shoppingResults.length === 0) {
      console.log('No Google Shopping results found');
      return [];
    }

    let directCount = 0;
    let needsResolution = 0;

    const results = shoppingResults.map((item, index) => {
      const url = item.link || item.url || '';
      const isDirect = isDirectStoreUrl(url);
      if (isDirect) directCount++;
      else needsResolution++;

      return {
        marketplace: item.source || item.seller || 'Google Shopping',
        title: item.title || '',
        price: {
          amount: parseFloat(item.extracted_price || item.price?.replace(/[^0-9.]/g, '')) || null,
          currency: 'GBP',
          display: item.price || 'See store',
        },
        image: item.thumbnail || item.image || null,
        url: url,
        isDirect,
        googleFallbackUrl: isDirect ? null : url,
        rating: item.rating || null,
        reviews: item.reviews || null,
        seller: {
          name: item.source || item.seller || 'Unknown',
          rating: null,
        },
        shipping: item.delivery || item.shipping || null,
        condition: 'New',
        badge: null,
        productId: null,
        pageToken: null,
        serpPosition: item.position || index + 1,
        source: 'google_shopping',
      };
    });

    console.log(`   → ${directCount} direct store URLs, ${needsResolution} need resolution`);
    return results;

  } catch (error) {
    console.error('Google Shopping search error:', error.message);
    return [];
  }
}

/**
 * Get detailed product info including seller offers with REAL store URLs
 * Uses SerpAPI Immersive Product API
 * Costs 1 API credit per call — use sparingly
 */
export async function getProductOffers(pageToken, options = {}) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey || !pageToken) return [];

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google_immersive_product',
      page_token: pageToken,
      more_stores: '1', // Get up to 13 stores
    });

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    return (data.stores || []).map(store => ({
      marketplace: store.source || 'Unknown',
      title: store.title || data.title || '',
      price: {
        amount: parseFloat(store.extracted_price) || null,
        currency: 'GBP',
        display: store.price || 'See store',
      },
      url: store.link || null,
      isDirect: isDirectStoreUrl(store.link),
      shipping: store.delivery || null,
      condition: store.condition || 'New',
      source: 'immersive_product',
    }));

  } catch (error) {
    console.error('SerpAPI Immersive Product error:', error.message);
    return [];
  }
}
