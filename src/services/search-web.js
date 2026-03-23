/**
 * Web search via Tavily + Firecrawl for stores without APIs
 * Used for: Amazon, AliExpress, Selfridges, Zara, etc.
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
  'Currys': ['currys.co.uk'],
  'Farfetch': ['farfetch.com'],
  'Harrods': ['harrods.com'],
  'John Lewis': ['johnlewis.com'],
  'NET-A-PORTER': ['net-a-porter.com'],
  'Selfridges': ['selfridges.com'],
  'Uniqlo': ['uniqlo.com'],
  'Zara': ['zara.com'],
};
const MAX_VALIDATION_CANDIDATES = 8;
const PRODUCT_URL_PATTERNS = [
  /\/prd\/\d+/i,
  /\/product(s)?\//i,
  /\/p\/\d+/i,
  /\/item\//i,
  /\/dp\//i,
  /\/buy\//i,
];
const CATEGORY_URL_PATTERNS = [
  /\/cat\//i,
  /\/search/i,
  /\/refine/i,
  /\/collections?\//i,
  /\/category\//i,
  /\/outerwear(\/|$)/i,
  /\/promo\//i,
  /\/offers?(\/|$)/i,
  /\/jackets?(\/|$)/i,
  /[?&](cid|refine|search|q)=/i,
];
const CATEGORY_TITLE_PATTERNS = [
  /\bshop\b/i,
  /\bdiscover\b/i,
  /\bcollections?\b/i,
  /\bouterwear\b/i,
  /\bjackets? & coats\b/i,
  /\bjackets?\b.*\bcoats?\b/i,
];
const TITLE_NOISE_TOKENS = new Set(['mens', 'men', 'womens', 'women', 'womans', 'man', 'woman']);
const QUERY_NOISE_TOKENS = new Set([
  'for', 'with', 'and', 'the', 'a', 'an', 'in', 'on', 'to',
  'mens', 'men', 'womens', 'women', 'womans', 'man', 'woman',
  'jacket', 'jackets', 'coat', 'coats', 'puffer', 'puffy',
  'insulated', 'quilted', 'hooded',
]);
const COLOR_TOKENS = new Set([
  'mustard', 'yellow', 'gold', 'amber', 'ochre', 'khaki', 'olive',
  'green', 'blue', 'navy', 'black', 'white', 'grey', 'gray', 'stone',
  'pink', 'red', 'burgundy', 'brown', 'tan', 'beige', 'cream', 'orange',
  'purple', 'lilac', 'silver', 'metallic',
]);
const STYLE_SYNONYMS = {
  puffy: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  puffer: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  padded: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  hooded: ['hooded', 'hood', 'parka'],
  quilted: ['quilted', 'padded', 'insulated'],
  insulated: ['insulated', 'padded', 'down', 'puffer'],
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

function stripTitleNoise(text) {
  return tokenize(text)
    .filter(token => !TITLE_NOISE_TOKENS.has(token))
    .join(' ');
}

function extractQuerySignalTokens(text) {
  return tokenize(text).filter(token => !QUERY_NOISE_TOKENS.has(token));
}

function extractColorTokens(text) {
  return tokenize(text).filter(token => COLOR_TOKENS.has(token));
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

function normaliseText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainMatchesExpected(url, expectedDomains) {
  if (!expectedDomains.length) return true;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return expectedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function scoreUrlShape(url) {
  let score = 0;
  if (PRODUCT_URL_PATTERNS.some(pattern => pattern.test(url))) score += 0.45;
  if (CATEGORY_URL_PATTERNS.some(pattern => pattern.test(url))) score -= 0.6;
  return score;
}

function scoreCategorySignals(match) {
  const title = match.title || '';
  const url = match.url || '';
  let score = 0;

  if (CATEGORY_TITLE_PATTERNS.some(pattern => pattern.test(title))) score -= 0.25;
  if (
    !PRODUCT_URL_PATTERNS.some(pattern => pattern.test(url)) &&
    /\b(view all|shop all|results for|discover more)\b/i.test(match.content || '')
  ) {
    score -= 0.25;
  }

  return score;
}

function scorePriceEvidence(item, matchText) {
  const priceText = item.price?.display || '';
  if (!priceText) return 0;
  if (matchText.includes(priceText.toLowerCase())) return 0.12;

  const amount = item.price?.amount;
  if (amount == null) return 0;
  const simpleAmount = String(amount).replace(/\.00$/, '');
  return matchText.includes(simpleAmount) ? 0.06 : 0;
}

function scoreTitleEvidence(item, matchTitle, matchText) {
  const titleScore = titleOverlapScore(item.title, `${matchTitle} ${matchText}`);
  const normalisedItemTitle = normaliseText(item.title);
  const normalisedMatchTitle = normaliseText(matchTitle);

  let score = titleScore;
  if (normalisedMatchTitle && normalisedMatchTitle.includes(normalisedItemTitle)) score += 0.2;
  if (normalisedItemTitle && normalisedItemTitle.includes(normalisedMatchTitle)) score += 0.08;
  return score;
}

function scoreQuerySignal(match, queryHints = {}) {
  const combined = `${match.title || ''} ${match.content || ''} ${match.url || ''}`.toLowerCase();
  let score = 0;

  for (const token of queryHints.signalTokens || []) {
    if (combined.includes(token)) score += 0.12;
  }

  const matchColors = new Set(extractColorTokens(combined));
  const desiredColors = queryHints.colorTokens || [];
  if (desiredColors.length > 0) {
    const matchedColorCount = desiredColors.filter(token => matchColors.has(token)).length;
    score += matchedColorCount * 0.35;

    const conflictingColors = [...matchColors].filter(
      token => !desiredColors.includes(token)
    );
    if (matchedColorCount === 0) {
      score -= conflictingColors.length > 0 ? 0.45 : 0.18;
    }
  }

  return score;
}

function scoreTavilyMatch(item, match, expectedDomains, queryHints) {
  const matchTitle = match.title || '';
  const matchText = `${match.title || ''} ${match.content || ''}`.toLowerCase();
  const url = match.url || '';

  let score = 0;
  score += scoreTitleEvidence(item, matchTitle, matchText);
  score += scoreQuerySignal(match, queryHints);
  score += scoreUrlShape(url);
  score += scoreCategorySignals(match);
  score += scorePriceEvidence(item, matchText);

  if (domainMatchesExpected(url, expectedDomains)) score += 0.1;
  if ((match.content || '').length > 120) score += 0.03;
  if (/out of stock|sold out/i.test(matchText)) score -= 0.2;

  return score;
}

function selectBestTavilyMatch(item, matches, expectedDomains = [], queryHints = {}) {
  let best = null;
  let bestScore = -Infinity;

  for (const match of matches) {
    const score = scoreTavilyMatch(item, match, expectedDomains, queryHints);
    if (score > bestScore) {
      bestScore = score;
      best = match;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

function buildResolutionQueries(item) {
  const priceText = item.price?.display || '';
  const title = item.title || '';
  const strippedTitle = stripTitleNoise(title);
  const marketplace = item.marketplace || '';

  return [
    `${title} ${marketplace} ${priceText}`.trim(),
    `${strippedTitle} ${marketplace} ${priceText}`.trim(),
    `${strippedTitle} ${priceText}`.trim(),
  ].filter(Boolean);
}

function buildContextQueries(contextQuery, marketplace, priceText) {
  if (!contextQuery) return [];
  return [
    `${contextQuery} ${marketplace} ${priceText}`.trim(),
    `${contextQuery} ${marketplace}`.trim(),
    contextQuery.trim(),
  ].filter(Boolean);
}

/**
 * Resolve Google Shopping listings to real store product URLs via Tavily.
 * This replaces Google result pages with likely canonical product pages.
 */
export async function resolveShoppingResults(shoppingResults, limit = 12, options = {}) {
  const candidates = shoppingResults.slice(0, limit);
  const contextQuery = options.query || '';
  const queryHints = {
    signalTokens: extractQuerySignalTokens(contextQuery),
    colorTokens: extractColorTokens(contextQuery),
  };

  const resolved = await Promise.all(candidates.map(async (item) => {
    const domains = getMarketplaceDomains(item.marketplace);
    const queryVariants = [
      ...buildResolutionQueries(item),
      ...buildContextQueries(contextQuery, item.marketplace || '', item.price?.display || ''),
    ];
    const matchGroups = await Promise.all(
      queryVariants.map(query => searchTavily(query, domains, 8))
    );
    const matches = [];
    const seenUrls = new Set();
    for (const group of matchGroups) {
      for (const match of group) {
        if (!match?.url || seenUrls.has(match.url)) continue;
        seenUrls.add(match.url);
        matches.push(match);
      }
    }

    const bestMatch = selectBestTavilyMatch(item, matches, domains, queryHints);

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
 * Scrape a product page via the direct Firecrawl API
 */
export async function scrapeProductPage(url) {
  try {
    const response = await firecrawlScrape(url);
    if (!response.ok) {
      console.error('Firecrawl scrape failed:', response.body?.message || response.body?.error || response.status);
      return null;
    }

    const payload = response.body?.data || response.body;
    return payload?.data || payload || null;
  } catch (error) {
    console.error('Firecrawl scrape error:', error.message);
    return null;
  }
}

function overlapRatio(expected, actual) {
  const left = new Set(tokenize(expected));
  const right = new Set(tokenize(actual));
  if (left.size === 0 || right.size === 0) return 0;

  let matches = 0;
  for (const token of left) {
    if (right.has(token)) matches += 1;
  }

  return matches / left.size;
}

function looksLikeCategoryPage(markdown) {
  const text = String(markdown || '').toLowerCase();
  return (
    /\b(filter|sort by|view all|showing \d+|results for|shop all|related categories|collection)\b/.test(text) ||
    (/\bjackets\b/.test(text) && !/\bpuffer\b|\bparka\b|\bhooded\b|\bdown jacket\b|\binsulated\b/.test(text))
  );
}

function selectValidationExcerpt(markdown) {
  const text = String(markdown || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 280) || null;
}

function buildValidationContext(parsed = {}) {
  const color = String(parsed.color || '').trim().toLowerCase() || null;
  const style = String(parsed.style || '').trim().toLowerCase() || null;
  const brand = String(parsed.brand || '').trim().toLowerCase() || null;
  const model = String(parsed.model || '').trim().toLowerCase() || null;
  const productType = String(parsed.productType || '').trim().toLowerCase() || null;
  const styleTerms = style
    ? (STYLE_SYNONYMS[style] || [style]).filter(Boolean)
    : [];

  return {
    color,
    style,
    styleTerms,
    brand,
    model,
    productType,
  };
}

function textIncludesAny(text, values = []) {
  return values.some(value => value && text.includes(value));
}

function assessValidationMatch(item, markdown, context) {
  const normalizedText = String(markdown || '').toLowerCase();
  const titleMatch = overlapRatio(item.title, normalizedText);
  const priceText = String(item.price?.display || '').toLowerCase();
  const hasPrice = priceText ? normalizedText.includes(priceText) : true;
  const categoryPage = looksLikeCategoryPage(normalizedText);
  const warnings = [];

  const hasColor = context.color ? normalizedText.includes(context.color) : true;
  const hasStyle = context.styleTerms.length > 0 ? textIncludesAny(normalizedText, context.styleTerms) : true;
  const hasBrand = context.brand ? normalizedText.includes(context.brand) : true;
  const hasModel = context.model ? normalizedText.includes(context.model) : true;
  const hasProductType = context.productType ? normalizedText.includes(context.productType) : true;

  if (context.color && !hasColor) warnings.push(`Missing required color: ${context.color}`);
  if (context.styleTerms.length > 0 && !hasStyle) warnings.push(`Missing required style: ${context.style}`);
  if (context.brand && !hasBrand) warnings.push(`Missing expected brand: ${context.brand}`);
  if (context.model && !hasModel) warnings.push(`Missing expected model: ${context.model}`);
  if (context.productType && !hasProductType) warnings.push(`Missing product type: ${context.productType}`);
  if (!hasPrice) warnings.push('Missing expected price');
  if (categoryPage) warnings.push('Looks like a category/search page');

  const isValid = (
    titleMatch >= 0.3 &&
    hasPrice &&
    !categoryPage &&
    hasColor &&
    hasStyle &&
    hasBrand &&
    hasModel &&
    hasProductType
  );

  return {
    isValid,
    titleMatch,
    hasPrice,
    hasColor,
    hasStyle,
    hasBrand,
    hasModel,
    hasProductType,
    warnings,
  };
}

export async function validateResolvedResults(results, parsed = {}, limit = MAX_VALIDATION_CANDIDATES) {
  const candidates = results.slice(0, limit);
  const context = buildValidationContext(parsed);

  const validated = await Promise.all(candidates.map(async (item) => {
    const page = await scrapeProductPage(item.url);
    const markdown = page?.markdown || page?.content || '';
    if (!markdown) return null;

    const assessment = assessValidationMatch(item, markdown, context);
    if (!assessment.isValid) {
      return null;
    }

    return {
      ...item,
      snippet: selectValidationExcerpt(markdown) || item.snippet,
      validated: true,
      validationSource: 'firecrawl',
      validationSummary: {
        titleMatch: Math.round(assessment.titleMatch * 100),
        hasColor: assessment.hasColor,
        hasStyle: assessment.hasStyle,
        hasProductType: assessment.hasProductType,
      },
    };
  }));

  return validated.filter(Boolean);
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
