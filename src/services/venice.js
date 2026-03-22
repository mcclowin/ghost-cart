import OpenAI from 'openai';

const venice = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: 'https://api.venice.ai/api/v1',
});

/**
 * Parse a natural language shopping query into structured search terms
 */
export async function parseQuery(userQuery) {
  const response = await venice.chat.completions.create({
    model: 'venice-uncensored',
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
  const response = await venice.chat.completions.create({
    model: 'venice-uncensored',
    messages: [
      {
        role: 'system',
        content: `You are a shopping comparison expert. Given search results from multiple stores, rank them by best value.
For each result, provide:
- relevanceScore (0-100): how well it matches the query
- valueScore (0-100): price vs quality assessment  
- trustScore (0-100): seller reliability
- warnings: any red flags (counterfeit risk, suspiciously cheap, bad seller)
- recommendation: brief text

Return JSON array sorted by overall score.`
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

export { venice };
