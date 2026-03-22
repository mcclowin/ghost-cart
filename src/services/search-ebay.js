/**
 * eBay Browse API integration
 * Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

/**
 * Search eBay for products
 * @param {string} query - Search terms
 * @param {number} limit - Max results (default 5)
 * @returns {Array} Normalized product results
 */
export async function searchEbay(query, limit = 5) {
  try {
    const token = await getAccessToken();
    
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      sort: 'price',
    });

    const response = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', // UK marketplace
        },
      }
    );

    const data = await response.json();

    if (!data.itemSummaries) return [];

    return data.itemSummaries.map(item => ({
      marketplace: 'eBay',
      title: item.title,
      price: {
        amount: parseFloat(item.price.value),
        currency: item.price.currency,
      },
      image: item.image?.imageUrl || null,
      url: item.itemWebUrl,
      condition: item.condition || 'Unknown',
      seller: {
        name: item.seller?.username || 'Unknown',
        rating: item.seller?.feedbackPercentage || null,
        feedbackScore: item.seller?.feedbackScore || null,
      },
      shipping: item.shippingOptions?.[0]?.shippingCost?.value 
        ? `£${item.shippingOptions[0].shippingCost.value}`
        : 'See listing',
      itemId: item.itemId,
    }));
  } catch (error) {
    console.error('eBay search error:', error.message);
    return [];
  }
}
