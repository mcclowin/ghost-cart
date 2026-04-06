/**
 * Google AI Mode identification via Bright Data Scrapers API.
 *
 * Takes Lens output, builds a prompt, asks Google AI Mode
 * to identify the exact product (brand, model, colorway).
 */

const AI_DATASET_ID = 'gd_mcswdt6z2elth3zqr2';

function buildLensDescription(lensResults) {
  const related = (lensResults.relatedSearches || []).filter(Boolean);

  // Send ALL data with full titles AND URLs (URLs often contain colorway in slug)
  const organicItems = (lensResults.exactMatches || [])
    .filter(o => o.title)
    .map(o => `[${o.marketplace}] ${o.title} — ${o.url || ''}`);

  const visualItems = (lensResults.visualMatches || [])
    .filter(i => i.title)
    .map(i => `[${i.marketplace}] ${i.title} — ${i.url || ''}`);

  const offerItems = (lensResults.offers || [])
    .filter(o => o.title || o.url)
    .map(o => `${o.title} — ${o.marketplace} — ${o.price?.display || ''} — ${o.url || ''}`);

  const parts = [];
  if (related.length > 0) parts.push(`Google suggests this is: ${related.join(', ')}`);
  if (offerItems.length > 0) parts.push(`Shopping offers:\n${offerItems.join('\n')}`);
  if (organicItems.length > 0) parts.push(`Web results:\n${organicItems.join('\n')}`);
  if (visualItems.length > 0) parts.push(`Visual matches:\n${visualItems.join('\n')}`);
  return parts.join('\n\n');
}

/**
 * Identify a product using Google AI Mode.
 * @param {object} lensResults - The Lens SERP results
 * @returns {object} { brand, model, colorway, fullName, alternativeQuery, stores, raw }
 */
export async function aiModeIdentify(lensResults) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) {
    console.log('   ⚠️ BRIGHTDATA_API_KEY not set — skipping AI Mode');
    return null;
  }

  const description = buildLensDescription(lensResults);
  if (!description || description.length < 20) {
    console.log('   ⚠️ Lens returned no useful data for AI Mode');
    return null;
  }

  const prompt = `I photographed a product and ran Google Lens. Here is everything Lens returned:

${description}

Based on this, identify the EXACT product:
1) Brand name
2) Model/product name
3) Color/colorway — CHECK the actual product page URLs listed above to verify the correct colorway. The Lens titles may be cached or wrong. The actual product pages have the real colorway name. Use the official colorway name from the brand, not generic colors like "grey" or "brown".
4) Top 3-5 stores where I can buy this exact product in this exact colorway, with direct links

IMPORTANT: Look carefully at ALL clues — Instagram handles (@alo = Alo Yoga), subreddit names (r/aloyoga), hashtags, URL slugs, and store listing titles often reveal the brand and colorway even when the main titles don't. Visit the product URLs to confirm the colorway before answering.`;

  console.log(`   🤖 AI Mode: querying Google AI with ${description.length} chars of Lens data...`);

  try {
    const resp = await fetch(
      `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${AI_DATASET_ID}&notify=false&include_errors=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input: [{ url: 'https://google.com/aimode', prompt, country: '' }] }),
      },
    );

    const data = await resp.json();
    const answer = data.answer_text || '';
    const links = data.links_attached || [];

    console.log(`   🤖 AI Mode answer (${answer.length} chars): ${answer.slice(0, 200)}...`);
    if (links.length > 0) {
      console.log(`   🤖 AI Mode links:`);
      for (const l of links.slice(0, 5)) {
        console.log(`      🔗 ${l.text || '?'}: ${(l.url || '').slice(0, 80)}`);
      }
    }

    return { answer, links, raw: data };
  } catch (err) {
    console.error(`   🤖 AI Mode failed: ${err.message}`);
    return null;
  }
}

/**
 * Use Venice LLM to extract a clean product name from AI Mode's answer.
 * AI Mode gives us the rich identification, LLM just formats it for search.
 */
export async function parseAiModeAnswer(aiResult, lensResults, fallbackQuery, llm) {
  if (!aiResult?.answer) {
    return {
      hasExactModel: false,
      exactModel: null,
      exactSearchQuery: null,
      confidence: 'low',
      alternativeSearchQuery: fallbackQuery || 'clothing',
      rationale: 'AI Mode returned no answer',
      source: 'ai_mode_empty',
      aiModeLinks: [],
      aiModeAnswer: null,
    };
  }

  const answer = aiResult.answer;
  const links = aiResult.links || [];
  const firstSentence = answer.split(/[.!]\s/)[0] || answer.slice(0, 150);

  // Use Venice LLM to extract clean product name from AI Mode's answer
  let exactSearchQuery = null;
  let alternativeSearchQuery = fallbackQuery || 'clothing';

  try {
    const model = process.env.LLM_PROVIDER === 'venice' ? 'venice-uncensored' : 'gpt-4o-mini';
    console.log(`   🧠 Extracting product name from AI Mode answer...`);
    const resp = await llm.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Extract the exact product name from this AI identification for a shopping search.
Return JSON only:
{
  "exactProduct": "Brand Model Colorway",
  "alternativeSearch": "Brand Model"
}
Rules:
- exactProduct: include brand + model name + colorway. E.g. "Alo Yoga Sweet Escape Zip Up Hoodie Candy Heart Pink"
- alternativeSearch: just brand + general product type. E.g. "Alo Yoga zip up hoodie"
- If multiple items (e.g. a set), use the main/top item
- No explanations, just the JSON`,
        },
        { role: 'user', content: answer },
      ],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(resp.choices[0].message.content);
    exactSearchQuery = parsed.exactProduct || null;
    alternativeSearchQuery = parsed.alternativeSearch || alternativeSearchQuery;
    console.log(`   🧠 Extracted: "${exactSearchQuery}"`);
    console.log(`   🧠 Alternative: "${alternativeSearchQuery}"`);
  } catch (err) {
    console.log(`   ⚠️ LLM extraction failed: ${err.message}`);
    // Fallback: use first sentence
    exactSearchQuery = firstSentence.replace(/^Based on.*?,\s*/i, '').slice(0, 100);
  }

  const hasExactModel = !!exactSearchQuery && exactSearchQuery.length > 5;
  const confidence = hasExactModel ? 'high' : 'low';

  return {
    hasExactModel,
    exactModel: exactSearchQuery,
    exactSearchQuery,
    confidence,
    alternativeSearchQuery,
    rationale: firstSentence,
    source: 'ai_mode',
    aiModeLinks: links,
    aiModeAnswer: answer,
  };
}
