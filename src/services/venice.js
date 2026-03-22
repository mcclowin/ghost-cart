import OpenAI from 'openai';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Try to load Codex auth token as fallback
function getCodexToken() {
  try {
    const authPath = join(homedir(), '.codex', 'auth.json');
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
      if (auth.access_token) {
        console.log('🔑 Found Codex auth token');
        return auth.access_token;
      }
    }
  } catch (e) {}
  return null;
}

const provider = process.env.LLM_PROVIDER || 'openai';
const openaiKey = process.env.OPENAI_API_KEY || getCodexToken() || 'dummy-key-replace-me';

const config = {
  venice: {
    apiKey: process.env.VENICE_API_KEY || 'dummy-key-replace-me',
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'venice-uncensored',
  },
  openai: {
    apiKey: openaiKey,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
};

const activeConfig = config[provider];

const llm = new OpenAI({
  apiKey: activeConfig.apiKey,
  baseURL: activeConfig.baseURL,
});

const MODEL = activeConfig.model;
const hasValidKey = activeConfig.apiKey !== 'dummy-key-replace-me';
console.log(`🧠 LLM Provider: ${provider} (model: ${MODEL}) ${hasValidKey ? '✅' : '⚠️ NO API KEY'}`);

/**
 * Parse a natural language shopping query into structured search terms
 */
export async function parseQuery(userQuery) {
  if (!hasValidKey) {
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

  const response = await llm.chat.completions.create({
    model: MODEL,
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

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Validate and rank search results - filter out irrelevant/non-product results
 */
export async function rankResults(query, results) {
  if (!hasValidKey) {
    return {
      results: results.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        ...r,
        relevanceScore: 50,
        valueScore: 50,
        trustScore: 50,
        overallScore: 50,
        warnings: [],
        recommendation: 'Configure LLM for intelligent ranking',
      })),
      bestPick: 'Add an LLM API key for smart ranking',
      privacyNote: 'Search processed locally',
    };
  }

  const response = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a shopping comparison expert. Given search results from multiple stores, you must:

1. FILTER OUT irrelevant results:
   - Generic brand/category pages (not a specific product listing)
   - Products that don't match what the user asked for
   - Out of stock items
   - Results with no price

2. RANK remaining results by best value

3. For each VALID result, provide scores and details

Return JSON:
{
  "results": [
    {
      "rank": 1,
      "marketplace": "store name",
      "title": "exact product name",
      "price": "£XX.XX",
      "url": "direct product URL",
      "image": "image URL if available",
      "relevanceScore": 0-100 (how well it matches the query),
      "valueScore": 0-100 (price vs quality),
      "trustScore": 0-100 (seller/store reliability),
      "overallScore": 0-100,
      "isActualProduct": true,
      "warnings": ["any red flags"],
      "recommendation": "brief text"
    }
  ],
  "filtered": ["list of results removed and why"],
  "bestPick": "which one to buy and why in one sentence",
  "privacyNote": "Your search was processed with zero data retention"
}

ONLY include results where isActualProduct is true. Be strict — if it's a category page, brand page, or doesn't match the query, exclude it.`
      },
      {
        role: 'user',
        content: `User searched for: "${query}"\n\nRaw results from stores:\n${JSON.stringify(results, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

export { llm };
