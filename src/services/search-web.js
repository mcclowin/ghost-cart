/**
 * Web search via Tavily for URL resolution
 * Strategy: SerpAPI gives us product + store name → Tavily finds the exact URL on that store
 */
import { firecrawlScrape } from './firecrawl.js';

const MARKETPLACE_DOMAINS = {
  'ASOS': ['asos.com'],
  'Mountain Warehouse': ['mountainwarehouse.com'],
  'Mainline': ['mainlinemenswear.co.uk'],
  'Superdry': ['superdry.com'],
  'superdry.com': ['superdry.com'],
  'Argos': ['argos.co.uk'],
  'Amazon': ['amazon.co.uk'],
  'Amazon.co.uk': ['amazon.co.uk'],
  'Amazon.co.uk - Amazon.co.uk-Seller': ['amazon.co.uk'],
  'Currys': ['currys.co.uk'],
  'Farfetch': ['farfetch.com'],
  'Harrods': ['harrods.com'],
  'John Lewis': ['johnlewis.com'],
  'NET-A-PORTER': ['net-a-porter.com'],
  'Selfridges': ['selfridges.com'],
  'Uniqlo': ['uniqlo.com'],
  'Zara': ['zara.com'],
  'Debenhams': ['debenhams.com'],
  'Animal': ['animal.co.uk'],
  'Helly Hansen': ['hellyhansen.com'],
  'COACH': ['uk.coach.com', 'coach.com'],
  'Labo Mono': ['labomono.com'],
  'Secret Sales': ['secretsales.com'],
  'Potters of Buxton': ['pottersofbuxton.co.uk'],
  'Trekitt': ['trekitt.co.uk'],
  'Cotopaxi UK': ['cotopaxi.com'],
  'Fjern': ['fjern.co'],
};

const CATEGORY_URL_PATTERNS = [
  /\/cat\//i,
  /\/categories\//i,
  /\/search\?/i,
  /\/refine/i,
  /\/collections?\//i,
  /\/category\//i,
  /\/outerwear(\/|$)/i,
  /\/promo\//i,
  /\/offers?(\/|$)/i,
  /[?&](cid|refine|q)=/i,
  /\/shop\//i,
];

const COLOR_TOKENS = new Set([
  'mustard', 'yellow', 'gold', 'amber', 'ochre', 'khaki', 'olive',
  'green', 'blue', 'navy', 'black', 'white', 'grey', 'gray', 'stone',
  'pink', 'red', 'burgundy', 'brown', 'tan', 'beige', 'cream', 'orange',
  'purple', 'lilac', 'silver', 'metallic', 'nautical',
]);

// Colors that are close enough to count as a match
const COLOR_SYNONYMS = {
  'mustard': ['mustard', 'yellow', 'gold', 'amber', 'ochre', 'nautical yellow', 'wax yellow'],
  'yellow': ['yellow', 'mustard', 'gold', 'amber', 'nautical yellow', 'wax yellow'],
  'navy': ['navy', 'dark blue'],
  'grey': ['grey', 'gray'],
  'beige': ['beige', 'cream', 'stone', 'sand'],
};
const STYLE_SYNONYMS = {
  puffy: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  puffer: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  padded: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  insulated: ['insulated', 'padded', 'down', 'puffer', 'quilted'],
  quilted: ['quilted', 'padded', 'insulated', 'puffer'],
};

/**
 * Search via Tavily API
 */
export async function searchTavily(query, sites = [], maxResults = 5) {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
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

function getMarketplaceDomains(marketplace) {
  if (!marketplace) return [];
  if (MARKETPLACE_DOMAINS[marketplace]) return MARKETPLACE_DOMAINS[marketplace];
  // Try to extract domain from marketplace name
  const lower = marketplace.toLowerCase();
  for (const [key, domains] of Object.entries(MARKETPLACE_DOMAINS)) {
    if (key.toLowerCase() === lower) return domains;
  }
  if (marketplace.includes('.')) return [marketplace.toLowerCase()];
  return [];
}

function isCategoryUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '/';
    const segments = pathname.split('/').filter(Boolean);
    if (CATEGORY_URL_PATTERNS.some(pattern => pattern.test(url))) {
      return true;
    }
    if (!isProductUrl(url) && segments.length <= 1 && !parsed.search) {
      return true;
    }
    return false;
  } catch {
    return CATEGORY_URL_PATTERNS.some(pattern => pattern.test(url));
  }
}

function isProductUrl(url) {
  // URLs with product IDs, SKUs, or specific product paths
  return /\/prd\/\d+|\/product\/|\/p\/\d+|\/dp\/|\/item\/|\/\d{5,}|\.html$/i.test(url);
}

function extractColorTokens(text) {
  const lower = (text || '').toLowerCase();
  const found = [];
  for (const color of COLOR_TOKENS) {
    if (lower.includes(color)) found.push(color);
  }
  return found;
}

function colorsMatch(queryColor, resultColors) {
  if (!queryColor) return true; // no color requirement
  const synonyms = COLOR_SYNONYMS[queryColor.toLowerCase()] || [queryColor.toLowerCase()];
  return resultColors.some(c => synonyms.includes(c.toLowerCase()));
}

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
}

function titleOverlap(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0) return 0;
  let matches = 0;
  for (const t of setA) if (setB.has(t)) matches++;
  return matches / setA.size;
}

/**
 * Score a Tavily result against the original SerpAPI product
 */
function scoreMatch(item, match, queryColor) {
  const url = match.url || '';
  const text = `${match.title || ''} ${match.content || ''}`.toLowerCase();
  const matchColors = extractColorTokens(text);

  let score = 0;

  // Title overlap (most important)
  score += titleOverlap(item.title, text) * 0.4;

  // URL shape
  if (isProductUrl(url)) score += 0.2;
  if (isCategoryUrl(url)) score -= 0.5;

  // Color match
  if (queryColor) {
    if (colorsMatch(queryColor, matchColors)) {
      score += 0.25;
    } else if (matchColors.length > 0) {
      score -= 0.3; // has a DIFFERENT color
    }
  }

  // Price mentioned
  const priceStr = item.price?.display || '';
  if (priceStr && text.includes(priceStr.toLowerCase().replace('£', ''))) {
    score += 0.1;
  }

  // Content quality
  if ((match.content || '').length > 100) score += 0.05;

  return score;
}

/**
 * Resolve Google Shopping results to real store product URLs
 * ONE Tavily call per product (not 3-6)
 */
export async function resolveShoppingResults(shoppingResults, limit = 12, options = {}) {
  const candidates = shoppingResults.slice(0, limit);
  const contextQuery = options.query || '';
  const queryColors = extractColorTokens(contextQuery);
  const queryColor = queryColors[0] || null;

  console.log(`   🔗 Resolving ${candidates.length} products (color filter: ${queryColor || 'none'})...`);

  const resolved = await Promise.all(candidates.map(async (item) => {
    const domains = getMarketplaceDomains(item.marketplace);
    
    // ONE well-constructed query per product
    const query = `${item.title} ${queryColor || ''}`.trim();
    
    const matches = await searchTavily(query, domains, 5);

    if (matches.length === 0) {
      console.log(`   ❌ ${item.marketplace}: no Tavily results for "${item.title.slice(0, 40)}..."`);
      return null;
    }

    // Score all matches, pick best
    let best = null;
    let bestScore = -Infinity;
    for (const match of matches) {
      const s = scoreMatch(item, match, queryColor);
      if (s > bestScore) { bestScore = s; best = match; }
    }

    // Threshold: 0.25 (more permissive than before)
    if (bestScore < 0.25 || !best) {
      console.log(`   ⚠️ ${item.marketplace}: best score ${bestScore.toFixed(2)} below threshold for "${item.title.slice(0, 40)}..."`);
      return null;
    }

    console.log(`   ✅ ${item.marketplace}: ${bestScore.toFixed(2)} → ${best.url.slice(0, 70)}...`);

    return {
      marketplace: extractStoreName(best.url) || item.marketplace,
      title: item.title,
      url: best.url,
      snippet: best.content || null,
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
      resolutionScore: bestScore,
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
 * Validate resolved results via Firecrawl (SOFT validation)
 * Scores attributes rather than requiring all to match
 */
export async function validateResolvedResults(results, parsed = {}, limit = 8) {
  const candidates = results.slice(0, limit);
  const queryColor = (parsed.color || '').toLowerCase();
  const queryStyle = (parsed.style || '').toLowerCase();
  const styleTerms = queryStyle ? (STYLE_SYNONYMS[queryStyle] || [queryStyle]) : [];
  const productTypeTerms = tokenize(parsed.productType || '');

  const validated = await Promise.all(candidates.map(async (item) => {
    let page;
    try {
      page = await scrapeProductPage(item.url);
    } catch (e) {
      return item; // can't validate → pass through
    }

    const markdown = page?.markdown || page?.content || '';
    if (!markdown) return item; // no content → pass through (don't kill)

    const text = markdown.toLowerCase();
    let score = 0;
    const pageColors = extractColorTokens(text);
    const hasColor = queryColor ? colorsMatch(queryColor, pageColors) : true;
    const hasStyle = styleTerms.length > 0 ? styleTerms.some(term => text.includes(term)) : true;
    const hasProductType = productTypeTerms.length > 0 ? productTypeTerms.some(term => text.includes(term)) : true;
    const addToCartDetected = /\badd to (bag|cart|basket)\b/.test(text);
    const variantDetected = /\bsize\b.*\b(s|m|l|xl)\b/.test(text);

    // Title overlap
    const overlap = titleOverlap(item.title, text);
    score += overlap * 0.3;

    // Color check (soft — use synonyms)
    if (queryColor) {
      if (hasColor) {
        score += 0.3;
      } else if (pageColors.length > 0) {
        score -= 0.2; // wrong color, but don't kill it
      }
    } else {
      score += 0.15; // no color requirement, neutral
    }

    if (styleTerms.length > 0) {
      score += hasStyle ? 0.15 : -0.08;
    }

    if (productTypeTerms.length > 0) {
      score += hasProductType ? 0.1 : -0.05;
    }

    // Price on page
    const priceStr = item.price?.display || '';
    if (priceStr && text.includes(priceStr.replace('£', ''))) {
      score += 0.15;
    }

    // Category page detection
    if (/\b(filter|sort by|view all|showing \d+|results for|shop all|brand page)\b/.test(text)) {
      score -= 0.5;
    }
    if (isCategoryUrl(item.url)) score -= 0.5;
    if (!addToCartDetected && !variantDetected && !/\b(£|\$|€)\s?\d/.test(text)) score -= 0.25;

    // Product page signals
    if (addToCartDetected) score += 0.2;
    if (variantDetected) score += 0.1;

    if (score < 0.1) {
      console.log(`   🚫 Validation rejected: ${item.title.slice(0, 50)} (score: ${score.toFixed(2)})`);
      return null;
    }

    return {
      ...item,
      snippet: text.slice(0, 280).replace(/\s+/g, ' ').trim() || item.snippet,
      validated: true,
      validationScore: score,
      validationSummary: {
        overlap,
        hasColor,
        pageColors,
        hasStyle,
        hasProductType,
        addToCartDetected,
        variantDetected,
      },
    };
  }));

  return validated.filter(Boolean);
}

/**
 * Scrape a product page via Firecrawl
 */
export async function scrapeProductPage(url) {
  try {
    const response = await firecrawlScrape(url);
    if (!response.ok) return null;
    const payload = response.body?.data || response.body;
    return payload?.data || payload || null;
  } catch (error) {
    console.error('Firecrawl scrape error:', error.message);
    return null;
  }
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
      'animal.co.uk': 'Animal', 'superdry.com': 'Superdry',
      'debenhams.com': 'Debenhams', 'mountainwarehouse.com': 'Mountain Warehouse',
      'mainlinemenswear.co.uk': 'Mainline', 'hellyhansen.com': 'Helly Hansen',
      'secretsales.com': 'Secret Sales', 'trekitt.co.uk': 'Trekitt',
      'cotopaxi.com': 'Cotopaxi', 'fjern.co': 'Fjern',
      'uk.coach.com': 'COACH', 'coach.com': 'COACH',
      'labomono.com': 'Labo Mono',
    };
    return names[domain] || domain;
  } catch { return 'Unknown'; }
}
