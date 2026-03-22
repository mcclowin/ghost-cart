import OpenAI from 'openai';

// Supports Venice AI, OpenAI, or any OpenAI-compatible provider
// Set LLM_PROVIDER=venice|openai in .env to switch
const provider = process.env.LLM_PROVIDER || 'openai'; // default to openai for testing

const config = {
  venice: {
    apiKey: process.env.VENICE_API_KEY,
    baseURL: 'https://api.venice.ai/api/v1',
    model: 'venice-uncensored',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini', // cheap for testing
  },
};

const activeConfig = config[provider];

const llm = new OpenAI({
  apiKey: activeConfig.apiKey,
  baseURL: activeConfig.baseURL,
});

const MODEL = activeConfig.model;

console.log(`🧠 LLM Provider: ${provider} (model: ${MODEL})`);

/**
 * Parse a natural language shopping query into structured search terms
 */
export async function parseQuery(userQuery) {
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
