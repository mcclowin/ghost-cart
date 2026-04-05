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
  const provider = options.provider || process.env.LENS_PROVIDER || 'serpapi';

  if (!imageUrl) {
    console.warn('   ⚠️ Google Lens needs a public image URL — skipping');
    return { exactMatches: [], visualMatches: [] };
  }

  if (provider === 'brightdata_url') {
    return searchBrightDataLens(imageUrl, options);
  }

  if (provider === 'none') {
    return { exactMatches: [], visualMatches: [] };
  }

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

const LENS_STOP_WORDS = new Set([
  'a', 'an', 'and', 'avant', 'buy', 'boutiques', 'by', 'collection', 'collections',
  'con', 'de', 'el', 'en', 'for', 'from', 'high', 'herren', 'in', 'instagram', 'low',
  'men', 'mid', 'new', 'of', 'on', 'pour', 'primavera', 'printemps', 'reel', 'selling',
  'sneaker', 'sneakers', 'spring', 'summer', 'the', 'top', 'tops', 'vintage', 'with',
  'women',
]);

const PRODUCT_HOST_BONUS = [
  /goat\.com/i,
  /stockx\.com/i,
  /novelship/i,
  /farfetch/i,
  /grailed/i,
  /vestiaire/i,
  /ebay\./i,
  /maisonmargiela/i,
];

const SOCIAL_HOST_PENALTY = [
  /instagram\.com/i,
  /youtube\.com/i,
  /reddit\.com/i,
  /pinterest\./i,
  /facebook\.com/i,
];

const COLOR_TERMS = [
  'triple black', 'triple white', 'black', 'white', 'grey', 'gray', 'silver',
  'cream', 'beige', 'brown', 'tan', 'red', 'blue', 'green', 'yellow', 'pink',
  'purple', 'orange', 'burgundy', 'gold', 'navy',
];

function lensTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1 && !LENS_STOP_WORDS.has(token));
}

function titleSpecificityScore(title) {
  const tokens = lensTokens(title);
  if (tokens.length < 2) return 0;
  let score = Math.min(tokens.length, 8);
  if (/\b[a-z]\d{2,}[a-z0-9-]*\b/i.test(title)) score += 3;
  if (/['"]/i.test(title)) score += 1;
  return score;
}

function normaliseLensTitle(title) {
  return String(title || '')
    .replace(/^buy\s+/i, '')
    .replace(/\s+-\s+[A-Z0-9-]+(?:\s*\.\.\.)?$/i, '')
    .replace(/\s*\.\.\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicaliseExactTitle(title) {
  return String(title || '')
    .replace(/^buy\s+/i, '')
    .replace(/['"]+/g, ' ')
    .replace(/\b(?:men|women|man|woman|mens|womens)\b/ig, ' ')
    .replace(/\b(?:us|uk|eu)\s*\d{1,2}(?:\.\d+)?\b/ig, ' ')
    .replace(/\b\d{1,2}(?:\.\d+)?\b/g, ' ')
    .replace(/\b(?:leather|rubber|cotton|calf|suede|canvas)\b/ig, ' ')
    .replace(/\b(?:shoe|shoes|sneaker|sneakers|trainer|trainers)\b/ig, ' ')
    .replace(/\blow top\b/ig, 'low')
    .replace(/\bhigh top\b/ig, 'high-top')
    .replace(/\s+-\s+[A-Z0-9-]+(?:\s*\.\.\.)?$/i, '')
    .replace(/\s*\.\.\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function overlapScore(a, b) {
  const aTokens = new Set(lensTokens(a));
  const bTokens = new Set(lensTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let matches = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) matches += 1;
  }
  return matches / Math.max(aTokens.size, bTokens.size);
}

function extractColors(text) {
  const lower = String(text || '').toLowerCase();
  return COLOR_TERMS.filter(color => lower.includes(color));
}

function stripColorTerms(text) {
  let value = String(text || '');
  for (const color of [...COLOR_TERMS].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`\\b${color.replace(/\s+/g, '\\s+')}\\b`, 'ig');
    value = value.replace(pattern, ' ');
  }
  return value.replace(/\s+/g, ' ').trim();
}

function getVisionColors(visionItem) {
  const raw = visionItem?.color;
  if (Array.isArray(raw)) return raw.map(value => String(value || '').toLowerCase()).filter(Boolean);
  if (raw) return [String(raw).toLowerCase()];
  return [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryBrightDataError(status, message) {
  if (status >= 500) return true;
  return /unknown_proxy_error|proxy request failed|econnrefused|timed out|socket hang up/i.test(message || '');
}

function chooseClusterColor(cluster, visionItem) {
  const colorScores = new Map();

  for (const [index, item] of cluster.entries()) {
    const position = Number(item.lensPosition || (index + 1));
    const positionalWeight = Math.max(1, 12 - Math.min(position, 12));
    const sourceWeight = item.source === 'google_lens_exact' ? 5 : 3;
    const productWeight = isProductLikeLensCandidate(item) ? 4 : 0;
    const weight = positionalWeight + sourceWeight + productWeight;

    for (const color of extractColors(`${item.title} ${item.url}`)) {
      const specificityWeight = color.includes(' ') ? 3 : 1;
      colorScores.set(color, (colorScores.get(color) || 0) + weight + specificityWeight);
    }
  }

  const rankedColors = [...colorScores.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const lensPreferred = rankedColors[0]?.[0] || null;
  if (lensPreferred) {
    return lensPreferred;
  }

  const visionColors = getVisionColors(visionItem);
  return visionColors[0] || null;
}

function isProductLikeLensCandidate(item) {
  const url = String(item.url || '');
  const title = String(item.title || '');
  if (!url || !title) return false;
  if (SOCIAL_HOST_PENALTY.some(pattern => pattern.test(url))) return false;
  if (/\/search|\/collections|\/category|\/ideas\//i.test(url)) return false;
  if (/\/itm\/|\/dp\/|\/product\/|\/products\/|\/sneakers\/|sku|stylecode|s\d{2,}/i.test(url)) return true;
  return PRODUCT_HOST_BONUS.some(pattern => pattern.test(url));
}

/**
 * Clean a Lens title into a usable search query.
 * Minimal cleanup: strip store junk, sizes, gendered/non-English terms.
 * Keep colors and model identifiers exactly as Lens returned them.
 */
function cleanLensTitle(title) {
  return String(title || '')
    .replace(/^buy\s+/i, '')
    // Strip non-English gendered terms
    .replace(/\b(?:herren|damen|homme|femme|donna|uomo|hombre|mujer)\b/ig, ' ')
    // Strip non-English color terms (keep English colors as-is from Lens)
    .replace(/\b(?:weiss|weiß|schwarz|noir|blanc|blanche|bianco|bianca|nero|nera|blanco|blanca|negro|negra|grau|gris)\b/ig, ' ')
    // Strip sizes and gendered words
    .replace(/\b(?:men|women|man|woman|mens|womens|unisex)\b/ig, ' ')
    .replace(/\b(?:us|uk|eu)\s*\d{1,2}(?:\.\d+)?\b/ig, ' ')
    // Strip trailing SKU/ellipsis junk
    .replace(/\s+-\s+[A-Z0-9-]+(?:\s*\.\.\.)?$/i, '')
    .replace(/\s*\.\.\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferLensExactMatch(lensResults = {}, visionItem = null) {
  const candidates = [...(lensResults.exactMatches || []), ...(lensResults.visualMatches || [])]
    .map(item => ({
      ...item,
      title: normaliseLensTitle(item.title),
    }))
    .filter(item => item.title && item.url);

  const productLike = candidates.filter(isProductLikeLensCandidate);
  const pool = productLike.length > 0 ? productLike : candidates;
  if (pool.length === 0) return null;

  // Rank candidates: support (how many similar titles), position, source, specificity
  const ranked = pool
    .map((item, index) => {
      const support = pool.reduce((count, other) => (
        overlapScore(item.title, other.title) >= 0.45 ? count + 1 : count
      ), 0);
      const sourceWeight = item.source === 'google_lens_exact' ? 5 : 3;
      const specificity = titleSpecificityScore(item.title);
      const position = Number(item.lensPosition || (index + 1));
      const positionalWeight = Math.max(0, 10 - Math.min(position, 10)) / 2;
      const productWeight = isProductLikeLensCandidate(item) ? 6 : 0;
      return {
        ...item,
        support,
        score: (support * 4) + sourceWeight + specificity + positionalWeight + productWeight,
      };
    })
    .sort((a, b) => b.score - a.score || b.support - a.support);

  const winner = ranked[0];
  if (!winner) return null;

  if (winner.support < 2 && winner.score < 18) {
    return null;
  }

  // Pick the best title from the cluster — most specific, product-like, English
  const cluster = pool.filter(item => overlapScore(winner.title, item.title) >= 0.45);
  const bestTitle = cluster
    .map(item => {
      const cleaned = cleanLensTitle(item.title);
      let score = titleSpecificityScore(cleaned);
      if (item.source === 'google_lens_exact') score += 4;
      if (isProductLikeLensCandidate(item)) score += 4;
      // Prefer titles with model numbers (e.g. "Kayano 14", "1201A019")
      if (/[A-Z]\d{2,}|S\d{2,}|\d{3,}[A-Z]/.test(item.title)) score += 3;
      // Penalise very short or very long titles
      const words = cleaned.split(/\s+/).length;
      if (words < 3) score -= 4;
      if (words > 10) score -= 2;
      return { cleaned, score };
    })
    .filter(entry => entry.cleaned)
    .sort((a, b) => b.score - a.score)[0]?.cleaned || cleanLensTitle(winner.title);

  return {
    exactModel: bestTitle,
    exactSearchQuery: bestTitle,
    confidence: winner.support >= 3 ? 'high' : 'medium',
    rationale: `Lens consensus: "${bestTitle}" from ${winner.support} overlapping product-like hits.`,
    sourceUrl: winner.url,
    support: winner.support,
  };
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

async function searchBrightDataLens(imageUrl, options = {}) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_ZONE || 'serp_api1';
  const maxAttempts = Number(process.env.BRIGHTDATA_LENS_RETRIES || 3);
  const baseDelayMs = Number(process.env.BRIGHTDATA_LENS_RETRY_DELAY_MS || 900);
  if (!apiKey) {
    console.warn('⚠️ BRIGHTDATA_API_KEY not set — skipping Bright Data Lens');
    return { exactMatches: [], visualMatches: [] };
  }

  const lensCountry = process.env.LENS_COUNTRY || 'uk';
  const brightdataCountry = lensCountry === 'uk' ? 'gb' : lensCountry;

  const lensUrl = new URL('https://lens.google.com/uploadbyurl');
  lensUrl.searchParams.set('url', imageUrl);
  lensUrl.searchParams.set('hl', options.language || 'en');
  lensUrl.searchParams.set('gl', lensCountry);
  lensUrl.searchParams.set('brd_json', '1');

  console.log(`   🔍 Google Lens: searching via Bright Data (country: ${lensCountry})...`);

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          zone,
          url: lensUrl.toString(),
          format: 'raw',
          country: brightdataCountry,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`Bright Data ${response.status}: ${body.slice(0, 240)}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();

      // ── Log full Lens response structure ──
      const topKeys = Object.keys(data);
      console.log(`   🔬 Lens response keys: ${topKeys.join(', ')}`);

      // ── Parse organic results (text-based matches) ──
      const exactMatches = (data.organic || [])
        .filter(item => item.link)
        .slice(0, options.limit || 8)
        .map((item, index) => ({
          title: item.title || item.source || '',
          price: null,
          url: item.link,
          image: item.image_url || item.image || null,
          marketplace: item.source || extractStoreName(item.link) || 'Unknown',
          source: 'google_lens_exact',
          lensPosition: item.global_rank || item.rank || index + 1,
        }));

      // ── Parse visual matches (image similarity) ──
      const visualMatches = (data.images || [])
        .filter(item => item.link)
        .slice(0, options.visualLimit || 12)
        .map((item, index) => ({
          title: item.title || item.source || '',
          price: null,
          url: item.link,
          image: normaliseImageUrl(item.image),
          marketplace: item.source || extractStoreName(item.link) || 'Unknown',
          source: 'google_lens_visual',
          lensPosition: item.global_rank || item.rank || index + 1,
        }));

      // ── Parse offers (direct buy links with prices — best source) ──
      const offers = (data.offers || [])
        .filter(item => item.link)
        .map((item, index) => ({
          title: item.title || '',
          price: item.price ? { display: item.price.replace(/\*$/, ''), amount: null } : null,
          url: item.link,
          image: null,
          marketplace: item.source || extractStoreName(item.link) || 'Unknown',
          source: 'google_lens_offer',
          availability: item.availability || null,
          lensPosition: index + 1,
        }));

      // ── Parse related searches ──
      const relatedSearches = (data.related_search || [])
        .map(item => item.title)
        .filter(Boolean)
        .slice(0, 10);

      // ── Detailed logging ──
      console.log(`   → Lens: ${exactMatches.length} exact, ${visualMatches.length} visual, ${offers.length} offers`);

      if (relatedSearches.length > 0) {
        console.log(`   → Lens related searches: ${relatedSearches.join(', ')}`);
      }

      if (offers.length > 0) {
        console.log(`   → Lens offers:`);
        for (const o of offers) {
          console.log(`      💰 ${o.marketplace}: ${o.price?.display || 'no price'} — ${o.availability || '?'} — ${o.url.slice(0, 70)}`);
        }
      }

      console.log(`   → Lens organic URLs:`);
      for (const e of exactMatches) {
        console.log(`      📄 [${e.marketplace}] ${e.title.slice(0, 50)} — ${e.url.slice(0, 70)}`);
      }

      console.log(`   → Lens visual URLs:`);
      for (const v of visualMatches) {
        const hasImg = v.image ? '🖼️' : '  ';
        console.log(`      ${hasImg} [${v.marketplace}] ${v.title.slice(0, 50)} — ${v.url.slice(0, 70)}`);
      }

      return { exactMatches, visualMatches, offers, relatedSearches };
    } catch (error) {
      lastError = error;
      const retryable = shouldRetryBrightDataError(error.status || 0, error.message || '');
      if (!retryable || attempt === maxAttempts) {
        break;
      }

      const delayMs = baseDelayMs * attempt;
      console.warn(`   ↻ Bright Data Lens retry ${attempt}/${maxAttempts - 1} in ${delayMs}ms: ${error.message}`);
      await sleep(delayMs);
    }
  }

  console.error('Google Lens error (Bright Data):', lastError?.message || 'Unknown error');
  return { exactMatches: [], visualMatches: [] };
}

function normaliseImageUrl(value) {
  if (!value || typeof value !== 'string') return null;
  return value.startsWith('http') ? value : null;
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
