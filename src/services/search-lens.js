/**
 * Google Lens via SerpAPI — visual product search.
 * Finds exact product matches by image similarity.
 *
 * This is the most important search for clothing identification.
 * Google Lens returns visually similar products with direct store URLs.
 */

/**
 * Search Google Lens with an image URL.
 * @param {string} imageUrl - Public URL of the image
 * @param {object} options - { country, language, limit }
 * @returns {Array} Product matches with URLs, prices, store names
 */
export async function searchGoogleLens(imageUrl, options = {}) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn('⚠️ SERPAPI_KEY not set — skipping Google Lens');
    return { exactMatches: [], visualMatches: [] };
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google_lens',
      url: imageUrl,
      hl: options.language || 'en',
      country: options.country || 'uk',
    });

    console.log('   🔍 Google Lens: searching by image...');
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    // Extract exact matches (products with prices)
    const exactMatches = (data.visual_matches || [])
      .filter(item => item.price && item.link)
      .slice(0, options.limit || 10)
      .map(item => ({
        title: item.title || '',
        price: item.price?.extracted_value
          ? { amount: item.price.extracted_value, currency: item.price.currency || 'GBP', display: item.price.value || '' }
          : { amount: null, currency: 'GBP', display: item.price?.value || 'See store' },
        url: item.link,
        image: item.thumbnail || null,
        marketplace: extractStoreName(item.link) || item.source || 'Unknown',
        source: 'google_lens_exact',
        lensPosition: item.position,
      }));

    // Extract visual matches (similar looking items, may not have prices)
    const visualMatches = (data.visual_matches || [])
      .filter(item => item.link && !item.price)
      .slice(0, 5)
      .map(item => ({
        title: item.title || '',
        price: null,
        url: item.link,
        image: item.thumbnail || null,
        marketplace: extractStoreName(item.link) || item.source || 'Unknown',
        source: 'google_lens_visual',
        lensPosition: item.position,
      }));

    console.log(`   → Lens: ${exactMatches.length} with prices, ${visualMatches.length} visual matches`);
    return { exactMatches, visualMatches };

  } catch (error) {
    console.error('Google Lens error:', error.message);
    return { exactMatches: [], visualMatches: [] };
  }
}

/**
 * Search Google Lens with a local image file (uploads via data URL workaround).
 * SerpAPI requires a public URL, so we need to provide one.
 *
 * Options:
 *   - Pass a public URL directly (best)
 *   - Use SerpAPI's base64 upload (if supported)
 */
export async function searchGoogleLensWithFile(imagePath, options = {}) {
  // SerpAPI Google Lens needs a public URL.
  // If we have a post_url from Instagram, we can try to get the image from there.
  // Otherwise we need to host the image temporarily or use a data URL workaround.
  //
  // For now: if options.imageUrl is provided (e.g. from IG preview_url), use that.
  // Otherwise fall back to no Lens results.
  if (options.imageUrl) {
    return searchGoogleLens(options.imageUrl, options);
  }

  console.warn('   ⚠️ Google Lens needs a public image URL — skipping (no imageUrl provided)');
  return { exactMatches: [], visualMatches: [] };
}


function extractStoreName(url) {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    const names = {
      'amazon.co.uk': 'Amazon', 'amazon.com': 'Amazon',
      'ebay.co.uk': 'eBay', 'ebay.com': 'eBay',
      'asos.com': 'ASOS', 'zara.com': 'Zara',
      'hm.com': 'H&M', 'uniqlo.com': 'Uniqlo',
      'shein.com': 'SHEIN', 'shein.co.uk': 'SHEIN',
      'net-a-porter.com': 'NET-A-PORTER',
      'farfetch.com': 'Farfetch', 'selfridges.com': 'Selfridges',
      'harrods.com': 'Harrods', 'johnlewis.com': 'John Lewis',
      'newlook.com': 'New Look', 'next.co.uk': 'Next',
      'boohoo.com': 'boohoo', 'prettylittlething.com': 'PrettyLittleThing',
      'missguided.co.uk': 'Missguided', 'riverisland.com': 'River Island',
      'depop.com': 'Depop', 'vinted.co.uk': 'Vinted',
      'nike.com': 'Nike', 'adidas.co.uk': 'Adidas',
      'nordstrom.com': 'Nordstrom', 'macys.com': "Macy's",
    };
    return names[domain] || domain;
  } catch { return null; }
}
