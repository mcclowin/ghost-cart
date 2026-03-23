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
 * Search Google Shopping via SerpAPI
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
      gl: options.country || 'uk',
      hl: options.language || 'en',
      num: (options.limit || 10).toString(),
    });

    if (options.minPrice) params.append('min_price', options.minPrice);
    if (options.maxPrice) params.append('max_price', options.maxPrice);

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    if (!data.shopping_results) {
      console.log('No Google Shopping results found');
      return [];
    }

    let directCount = 0;
    let needsResolution = 0;

    const results = data.shopping_results.map(item => {
      const urlInfo = extractBestUrl(item);
      if (urlInfo.isDirect) directCount++;
      else needsResolution++;

      return {
        marketplace: item.source || 'Google Shopping',
        title: item.title,
        price: {
          amount: parseFloat(item.extracted_price) || null,
          currency: 'GBP',
          display: item.price || 'See store',
        },
        image: item.thumbnail || null,
        url: urlInfo.url,
        isDirect: urlInfo.isDirect,
        googleFallbackUrl: urlInfo.googleFallbackUrl,
        rating: item.rating || null,
        reviews: item.reviews || null,
        seller: {
          name: item.source || 'Unknown',
          rating: item.seller_rating || null,
        },
        shipping: item.delivery || null,
        condition: item.second_hand_condition || 'New',
        badge: item.tag || null,
        productId: item.product_id || null,
        pageToken: item.serpapi_product_api_comparisons || item.page_token || null,
        serpPosition: item.position,
        source: 'google_shopping',
      };
    });

    console.log(`   → ${directCount} direct store URLs, ${needsResolution} need resolution`);
    return results;

  } catch (error) {
    console.error('SerpAPI search error:', error.message);
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
