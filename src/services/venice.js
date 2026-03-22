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
      if (auth.access_token) return auth.access_token;
    }
  } catch (e) {}
  return null;
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

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Validate and rank search results
 */
export async function rankResults(query, results) {
  if (!hasValidKey) {
    console.log('   📊 Returning raw results (no LLM for ranking)');
    return {
      results: results.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        ...r,
        relevanceScore: 50,
        valueScore: 50,
        trustScore: 50,
        overallScore: 50,
        warnings: [],
        recommendation: 'Add an LLM key for smart ranking',
      })),
      bestPick: 'Add an LLM API key for intelligent ranking',
      privacyNote: 'Search processed locally',
    };
  }

  console.log(`   🏆 Ranking ${results.length} results via ${provider}...`);
  const response = await llm.chat.completions.create({
    model,
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
      "relevanceScore": 0-100,
      "valueScore": 0-100,
      "trustScore": 0-100,
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

ONLY include results where isActualProduct is true.`
      },
      {
        role: 'user',
        content: `User searched for: "${query}"\n\nRaw results:\n${JSON.stringify(results, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

export { llm };
