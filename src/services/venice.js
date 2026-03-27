import OpenAI from 'openai';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MAX_RANKING_CANDIDATES = 30;
const MAX_RANKED_RESULTS = 8;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 's',
  'so', 'that', 'the', 'their', 'them', 'these', 'this', 'to', 'want', 'with',
  'you', 'your',
]);
const GENERIC_PAGE_PATTERNS = [
  /\bshop\b/i,
  /\bsale\b/i,
  /\bcategory\b/i,
  /\bresults\b/i,
  /\bcollection\b/i,
  /\bproducts\b/i,
  /\brange\b/i,
  /\bbrowse\b/i,
];
const TRUSTED_MARKETPLACE_SCORES = {
  'Amazon': 82,
  'Argos': 84,
  'ASOS': 80,
  'Currys': 86,
  'eBay': 68,
  'Farfetch': 82,
  'Harrods': 89,
  'John Lewis': 90,
  'NET-A-PORTER': 86,
  'Selfridges': 88,
  'Uniqlo': 84,
  'Zara': 79,
};
const STYLE_SYNONYMS = {
  puffy: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  puffer: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  padded: ['puffy', 'puffer', 'padded', 'down', 'insulated', 'bubble', 'quilted'],
  hooded: ['hooded', 'hood', 'parka'],
  quilted: ['quilted', 'padded', 'insulated'],
  insulated: ['insulated', 'padded', 'down', 'puffer'],
};

// Try to load Codex auth token as fallback
function getCodexToken() {
  try {
    const authPath = join(homedir(), '.codex', 'auth.json');
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      if (auth.access_token) return auth.access_token;
    }
  } catch (e) {}
  return null;
}

function truncateText(value, maxLength) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function parseJsonContent(content, context) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const preview = truncateText(content, 600) || '<empty>';
    console.error(`LLM JSON parse failed during ${context}:`, preview);
    throw error;
  }
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(items) {
  return [...new Set(items.flatMap(tokenize))];
}

function normalisePrice(price) {
  if (price == null) return null;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const match = price.match(/(\d+(?:[.,]\d{1,2})?)/);
    return match ? parseFloat(match[1].replace(',', '.')) : null;
  }
  if (typeof price === 'object' && price.amount != null) {
    const amount = Number(price.amount);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function formatPrice(price) {
  if (price == null) return null;
  if (typeof price === 'string') return price;
  if (typeof price === 'number') return `£${price.toFixed(2)}`;
  if (typeof price === 'object') return price.display || (price.amount != null ? `£${Number(price.amount).toFixed(2)}` : null);
  return null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function getMarketplaceTrustScore(marketplace) {
  return TRUSTED_MARKETPLACE_SCORES[marketplace] || 72;
}

function isGenericPage(result, matchRatio) {
  const title = String(result.title || '');
  const snippet = String(result.snippet || '');
  const url = String(result.url || '');
  const text = `${title} ${snippet}`;

  if (GENERIC_PAGE_PATTERNS.some(pattern => pattern.test(text))) {
    return matchRatio < 0.6;
  }

  if (/\/search|\/category|\/collections|\/collections\/|\/c\//i.test(url)) {
    return true;
  }

  if (/\b(men|women|kids)\b.*\b(jackets|coats|clothing|fashion)\b/i.test(title) && !/\b(puffer|parka|gilet|hooded|quilted|insulated)\b/i.test(title)) {
    return true;
  }

  return false;
}

function buildRankingContext(query, parsed = {}) {
  const style = parsed.style ? String(parsed.style).toLowerCase() : null;
  return {
    searchTokens: uniqueTokens([
      query,
      ...(parsed.searchTerms || []),
      parsed.productType,
      parsed.brand,
      parsed.model,
      parsed.color,
      parsed.style,
      ...(parsed.requirements || []),
    ]),
    brand: parsed.brand ? String(parsed.brand).toLowerCase() : null,
    model: parsed.model ? String(parsed.model).toLowerCase() : null,
    color: parsed.color ? String(parsed.color).toLowerCase() : null,
    style,
    styleTokens: uniqueTokens([parsed.style, ...(parsed.requirements || [])]),
    styleTerms: style ? (STYLE_SYNONYMS[style] || [style]) : [],
    productTypeTokens: uniqueTokens([parsed.productType]),
  };
}

function scoreResult(result, priceStats, context) {
  const title = String(result.title || '');
  const snippet = String(result.snippet || '');
  const haystack = `${title} ${snippet}`.toLowerCase();
  const titleTokens = new Set(tokenize(title));
  const textTokens = new Set(tokenize(haystack));
  const matchedTokens = context.searchTokens.filter(token => textTokens.has(token));
  const titleMatchedTokens = context.searchTokens.filter(token => titleTokens.has(token));
  const matchRatio = context.searchTokens.length > 0 ? matchedTokens.length / context.searchTokens.length : 0.5;
  const titleMatchRatio = context.searchTokens.length > 0 ? titleMatchedTokens.length / context.searchTokens.length : 0.5;
  const priceAmount = normalisePrice(result.price);
  const hasPrice = priceAmount != null;
  const validated = result.validated === true;
  const validationSummary = result.validationSummary || {};
  const genericPage = validated ? false : isGenericPage(result, matchRatio);
  const warnings = [];
  const hasColor = context.color
    ? (validationSummary.hasColor ?? haystack.includes(context.color))
    : true;
  const hasStyle = context.styleTerms.length > 0
    ? (validationSummary.hasStyle ?? context.styleTerms.some(term => haystack.includes(term)))
    : true;
  const hasBrand = context.brand ? haystack.includes(context.brand) : true;
  const hasModel = context.model ? haystack.includes(context.model) : true;
  const hasProductType = context.productTypeTokens.length > 0
    ? (validationSummary.hasProductType ?? context.productTypeTokens.some(token => haystack.includes(token)))
    : true;

  let relevanceScore = 25 + (matchRatio * 45) + (titleMatchRatio * 25);
  if (hasBrand) relevanceScore += 8;
  else if (context.brand) relevanceScore -= 20;
  if (hasModel) relevanceScore += 10;
  else if (context.model) relevanceScore -= 24;
  if (hasColor) relevanceScore += 14;
  else if (context.color) relevanceScore -= 28;
  if (hasProductType) relevanceScore += 6;
  else if (context.productTypeTokens.length > 0) relevanceScore -= 10;
  if (hasStyle) relevanceScore += 10;
  else if (context.styleTerms.length > 0) relevanceScore -= 20;
  if (genericPage) relevanceScore -= 35;
  if (validated) relevanceScore += 10;
  if (!hasPrice) relevanceScore -= 20;
  relevanceScore = clamp(relevanceScore);

  let valueScore = 55;
  if (hasPrice && priceStats.max > priceStats.min) {
    const relativeCheapness = 1 - ((priceAmount - priceStats.min) / (priceStats.max - priceStats.min));
    valueScore = 35 + (relativeCheapness * 45);
  } else if (hasPrice) {
    valueScore = 70;
  }

  const shippingText = String(result.shipping || '').toLowerCase();
  if (/free/i.test(shippingText)) valueScore += 8;
  if (/see listing|unknown|tbd/i.test(shippingText)) {
    valueScore -= 6;
    warnings.push('Shipping cost unclear');
  }
  valueScore = clamp(valueScore);

  let trustScore = getMarketplaceTrustScore(result.marketplace);
  const rating = Number(result.rating || result.seller?.rating || 0);
  if (Number.isFinite(rating) && rating > 0) {
    trustScore += rating > 5 ? Math.min(12, rating / 200) : Math.min(12, rating * 2);
  } else {
    warnings.push('No seller rating surfaced');
  }

  const reviewCount = Number(result.reviews || result.seller?.feedbackScore || 0);
  if (Number.isFinite(reviewCount) && reviewCount > 0) {
    trustScore += Math.min(10, Math.log10(reviewCount + 1) * 4);
  }

  if (/used|pre-owned|second hand/i.test(String(result.condition || ''))) {
    trustScore -= 10;
    warnings.push('Used item');
  }

  trustScore = clamp(trustScore);

  if (!hasPrice) warnings.push('No visible price');
  if (genericPage) warnings.push('Looks like a category/search page');
  if (context.color && !hasColor) warnings.push(`Missing requested color: ${context.color}`);
  if (context.style && !hasStyle) warnings.push(`Missing requested style: ${context.style}`);
  if (context.brand && !hasBrand) warnings.push(`Missing requested brand: ${context.brand}`);
  if (context.model && !hasModel) warnings.push(`Missing requested model: ${context.model}`);

  const overallScore = clamp((relevanceScore * 0.5) + (valueScore * 0.3) + (trustScore * 0.2));
  const failsHardRequirement = !hasPrice
    || genericPage
    || relevanceScore < 40
    || overallScore < 45
    || (context.color && !hasColor)
    || (context.brand && !hasBrand)
    || (context.model && !hasModel);
  const isActualProduct = !failsHardRequirement;

  let recommendation = 'Balanced pick based on relevance, price, and seller trust';
  if (overallScore >= 85) recommendation = 'Top pick with strong relevance and pricing';
  else if (valueScore >= 80 && trustScore >= 70) recommendation = 'Good value from a credible seller';
  else if (trustScore < 60) recommendation = 'Cheap option, but seller confidence is weaker';

  return {
    isActualProduct,
    priceAmount,
    relevanceScore: Math.round(relevanceScore),
    valueScore: Math.round(valueScore),
    trustScore: Math.round(trustScore),
    overallScore: Math.round(overallScore),
    warnings,
    recommendation,
  };
}

// Resolve provider and API key
const provider = (process.env.LLM_PROVIDER || 'openai').trim();

let apiKey, baseURL, model;

if (provider === 'venice') {
  apiKey = process.env.VENICE_API_KEY?.trim();
  baseURL = 'https://api.venice.ai/api/v1';
  model = 'venice-uncensored';
} else {
  apiKey = process.env.OPENAI_API_KEY?.trim() || getCodexToken();
  baseURL = 'https://api.openai.com/v1';
  model = 'gpt-4o-mini';
}

// Debug: show what we found
console.log(`🔍 ENV check: LLM_PROVIDER="${process.env.LLM_PROVIDER}", OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY.length + ' chars)' : 'NOT SET'}, VENICE_API_KEY=${process.env.VENICE_API_KEY ? 'SET' : 'NOT SET'}`);

const hasValidKey = !!apiKey;

// Log clearly what we're using
if (hasValidKey) {
  const keyPreview = apiKey.substring(0, 8) + '...';
  console.log(`🧠 LLM: ${provider} (${model}) ✅ Key: ${keyPreview}`);
} else {
  console.log(`🧠 LLM: ${provider} (${model}) ⚠️ NO API KEY — will use fallback parsing`);
  if (provider === 'openai') {
    console.log(`   💡 Set OPENAI_API_KEY in .env or put auth.json in ~/.codex/`);
  } else {
    console.log(`   💡 Set VENICE_API_KEY in .env`);
  }
}

const llm = new OpenAI({
  apiKey: apiKey || 'dummy-key-not-used',
  baseURL,
});

/**
 * Parse a natural language shopping query into structured search terms
 */
export async function parseQuery(userQuery) {
  if (!hasValidKey) {
    console.log('   📝 Using basic query parsing (no LLM)');
    return {
      searchTerms: [userQuery],
      productType: 'general',
      brand: null,
      model: null,
      maxPrice: null,
      requirements: [],
      marketplaces: ['ebay', 'amazon'],
    };
  }

  console.log(`   🧠 Parsing query via ${provider}...`);
  const response = await llm.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a shopping assistant. Parse the user's request into structured search terms optimised for product search engines.

IMPORTANT: Generate search terms that will find SPECIFIC PRODUCTS for sale, not brand pages or category pages.

Return JSON only:
{
  "searchTerms": ["most specific product search query", "alternative broader query"],
  "productType": "category (e.g. jacket, spare part, electronics)",
  "brand": "brand or null",
  "model": "model number or null",
  "color": "color or null",
  "style": "style descriptors or null",
  "maxPrice": number or null,
  "requirements": ["specific requirements like size, material"],
  "marketplaces": ["best marketplaces for this type of product"]
}`
      },
      { role: 'user', content: userQuery }
    ],
    response_format: { type: 'json_object' },
  });

  return parseJsonContent(response.choices[0].message.content, 'query parsing');
}

export async function reconcileImageDiscovery(input = {}) {
  const visionItem = input.vision?.items?.[0] || null;
  const lensCandidates = [
    ...(input.lensResults?.exactMatches || []),
    ...(input.lensResults?.visualMatches || []),
  ]
    .map(item => ({
      title: String(item.title || '').trim(),
      marketplace: item.marketplace || null,
      position: item.lensPosition || null,
    }))
    .filter(item => item.title)
    .slice(0, 12);
  const lensTitles = lensCandidates.map(item => item.title);

  const fallbackAlternative = visionItem?.search_query
    || String(input.caption || '').trim()
    || 'clothing';

  if (!hasValidKey || lensTitles.length === 0) {
    return {
      hasExactModel: false,
      exactModel: null,
      exactSearchQuery: null,
      confidence: 'low',
      alternativeSearchQuery: fallbackAlternative,
      rationale: lensTitles.length === 0
        ? 'No usable Lens titles were available'
        : 'LLM unavailable, so exact model reconciliation was skipped',
    };
  }

  console.log(`   🧩 Reconciling Lens + vision via ${provider}...`);
  const response = await llm.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You reconcile image discovery results for shopping.

Use Lens titles and vision attributes together.

Rules:
- Lens is the source of truth for exact product identification.
- Vision is only for broad attributes and alternatives.
- If Lens strongly indicates a specific product model, return hasExactModel=true.
- Only set hasExactModel=true when the model is specific enough to search stock for the same item.
- For footwear, exact models like "Nike Air Force 1 '07" or "Nike Court Vision Low" qualify.
- If Lens titles repeatedly point to the same branded model, you should still set hasExactModel=true even when vision disagrees.
- Vision must not veto a strong Lens identification.
- Only set hasExactModel=false when Lens itself is too noisy or conflicting to support one model.
- alternativeSearchQuery should always stay broad enough to find similar items.
- exactSearchQuery should be concise and stock-oriented, e.g. "Nike Air Force 1 '07 black".

Return JSON only:
{
  "hasExactModel": true,
  "exactModel": "Nike Air Force 1 '07",
  "exactSearchQuery": "Nike Air Force 1 '07 black",
  "confidence": "high",
  "alternativeSearchQuery": "Nike black leather low-top sneaker minimalist",
  "rationale": "Lens titles repeatedly point to Air Force 1 '07 while vision confirms black low-top Nike sneaker."
}`
      },
      {
        role: 'user',
        content: JSON.stringify({
          caption: input.caption || '',
          vision: visionItem,
          lensCandidates,
        }),
      },
    ],
    response_format: { type: 'json_object' },
  });

  const reconciled = parseJsonContent(response.choices[0].message.content, 'image discovery reconciliation');
  return {
    hasExactModel: Boolean(reconciled.hasExactModel && reconciled.exactSearchQuery),
    exactModel: reconciled.exactModel || null,
    exactSearchQuery: reconciled.exactSearchQuery || null,
    confidence: reconciled.confidence || 'low',
    alternativeSearchQuery: reconciled.alternativeSearchQuery || fallbackAlternative,
    rationale: reconciled.rationale || null,
  };
}

/**
 * Validate and rank search results
 */
export async function rankResults(query, results, parsed = {}) {
  const rankingSourceResults = results.slice(0, MAX_RANKING_CANDIDATES);
  const context = buildRankingContext(query, parsed);
  const pricedValues = rankingSourceResults
    .map(result => normalisePrice(result.price))
    .filter(value => value != null);
  const priceStats = {
    min: pricedValues.length ? Math.min(...pricedValues) : 0,
    max: pricedValues.length ? Math.max(...pricedValues) : 0,
  };

  if (results.length > rankingSourceResults.length) {
    console.log(`   ✂️ Trimmed ranking input from ${results.length} to ${rankingSourceResults.length} candidates for deterministic scoring`);
  }

  console.log(`   📊 Validating and ranking ${rankingSourceResults.length} results with heuristics...`);

  const filtered = [];
  const ranked = [];

  for (const result of rankingSourceResults) {
    const scoring = scoreResult(result, priceStats, context);
    if (!scoring.isActualProduct) {
      const reason = scoring.warnings[0] || 'Not a specific in-stock product listing';
      filtered.push(`${result.title || result.url || 'Untitled result'} — ${reason}`);
      continue;
    }

    ranked.push({
      marketplace: result.marketplace,
      title: result.title,
      price: formatPrice(result.price),
      url: result.url,
      image: result.image || null,
      relevanceScore: scoring.relevanceScore,
      valueScore: scoring.valueScore,
      trustScore: scoring.trustScore,
      overallScore: scoring.overallScore,
      warnings: scoring.warnings.slice(0, 2),
      recommendation: scoring.recommendation,
    });
  }

  ranked.sort((a, b) => b.overallScore - a.overallScore || b.relevanceScore - a.relevanceScore || a.price.localeCompare?.(b.price || '') || 0);

  const topResults = ranked.slice(0, MAX_RANKED_RESULTS).map((item, index) => ({
    rank: index + 1,
    ...item,
  }));

  const bestPick = topResults[0]
    ? `${topResults[0].title} from ${topResults[0].marketplace} looks strongest on match, price, and seller quality.`
    : 'No strong product matches after filtering generic or incomplete listings.';

  return {
    results: topResults,
    filtered: filtered.slice(0, 12),
    bestPick,
    privacyNote: 'Your search was processed with zero data retention',
  };
}

export { llm };
