import OpenAI from 'openai';

// Supports Venice AI, OpenAI, or any OpenAI-compatible provider
const provider = process.env.LLM_PROVIDER || 'openai';

const config = {
  venice: {
    apiKey: process.env.VENICE_API_KEY || 'dummy-key-replace-me',
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'venice-uncensored',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key-replace-me',
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
console.log(`🧠 LLM Provider: ${provider} (model: ${MODEL}) ${hasValidKey ? '✅' : '⚠️ NO API KEY — LLM calls will fail'}`);

/**
 * Parse a natural language shopping query into structured search terms
 */
export async function parseQuery(userQuery) {
  if (!hasValidKey) {
    // Fallback: basic parsing without LLM
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
        content: `You are a shopping assistant. Parse the user's request into structured search terms. 
Return JSON only:
{
  "searchTerms": ["primary search query", "alternative query"],
  "productType": "category",
  "brand": "brand or null",
  "model": "model number or null",
  "maxPrice": number or null,
  "requirements": ["specific requirements"],
  "marketplaces": ["best marketplaces to check"]
}`
      },
      { role: 'user', content: userQuery }
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Rank and compare search results from multiple marketplaces
 */
export async function rankResults(query, results) {
  if (!hasValidKey) {
    // Fallback: return results as-is with basic scoring
    return {
      results: results.map((r, i) => ({
        rank: i + 1,
        ...r,
        relevanceScore: 50,
        valueScore: 50,
        trustScore: 50,
        overallScore: 50,
        warnings: [],
        recommendation: 'LLM not configured — showing raw results',
      })),
      bestPick: 'Configure an LLM API key for intelligent ranking',
      privacyNote: 'Your search was processed locally (no LLM key configured)',
    };
  }

  const response = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a shopping comparison expert. Given search results from multiple stores, rank them by best value.
Return JSON:
{
  "results": [
    {
      "rank": 1,
      "marketplace": "store name",
      "title": "product title",
      "price": "price string",
      "url": "product url",
      "relevanceScore": 0-100,
      "valueScore": 0-100,
      "trustScore": 0-100,
      "overallScore": 0-100,
      "warnings": ["any red flags"],
      "recommendation": "brief text"
    }
  ],
  "bestPick": "which one and why",
  "privacyNote": "Your search was processed with zero data retention"
}`
      },
      {
        role: 'user',
        content: `Query: "${query}"\n\nResults:\n${JSON.stringify(results, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

export { llm };
