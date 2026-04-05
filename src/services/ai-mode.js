/**
 * Google AI Mode identification via Bright Data Scrapers API.
 *
 * Takes Lens output, builds a prompt, asks Google AI Mode
 * to identify the exact product (brand, model, colorway).
 */

const AI_DATASET_ID = 'gd_mcswdt6z2elth3zqr2';

function buildLensDescription(lensResults) {
  const related = (lensResults.relatedSearches || []).filter(Boolean);
  const organicTitles = (lensResults.exactMatches || [])
    .map(o => `[${o.marketplace}] ${o.title}`)
    .filter(Boolean)
    .slice(0, 10);
  const visualTitles = (lensResults.visualMatches || [])
    .map(i => `[${i.marketplace}] ${i.title}`)
    .filter(Boolean)
    .slice(0, 10);
  const offerTitles = (lensResults.offers || [])
    .map(o => `${o.title} — ${o.marketplace} — ${o.price?.display || ''}`)
    .filter(Boolean);

  const parts = [];
  if (related.length > 0) parts.push(`Google suggests: ${related.join(', ')}`);
  if (offerTitles.length > 0) parts.push(`Shopping: ${offerTitles.join('; ')}`);
  if (organicTitles.length > 0) parts.push(`Web: ${organicTitles.join('; ')}`);
  if (visualTitles.length > 0) parts.push(`Visual: ${visualTitles.join('; ')}`);
  return parts.join('. ');
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
3) Color/colorway (use the official colorway name from the brand, not generic colors)
4) Top 3-5 stores where I can buy it with direct links

IMPORTANT: Look carefully at ALL clues — Instagram handles (@alo = Alo Yoga), subreddit names (r/aloyoga), hashtags, and store listing titles often reveal the brand and colorway even when the main titles don't.`;

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
 * Use the AI Mode answer directly — no regex parsing.
 * The answer_text IS the identification. The links_attached ARE the buy links.
 */
export function parseAiModeAnswer(aiResult, lensResults, fallbackQuery) {
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
    };
  }

  const answer = aiResult.answer;
  const links = aiResult.links || [];

  // The first sentence usually contains the product identification
  // e.g. "the product is the Alo Yoga tracksuit in their Candy Heart Pink colorway"
  // Use the first ~150 chars as the display title, cleaned up
  const firstSentence = answer.split(/[.!]\s/)[0] || answer.slice(0, 150);

  // For exactSearchQuery: extract product name from links if available
  // Link text often has clean product names like "Accolade Crew Neck Pullover"
  const productLinks = links.filter(l =>
    l.url && !/google\.com\/search/.test(l.url) && l.text && l.text !== '?'
  );
  const linkProductNames = productLinks.map(l => l.text).filter(Boolean);

  // Build exactSearchQuery from link product names or from the answer
  let exactSearchQuery = null;
  if (linkProductNames.length > 0) {
    // Use the first product link name — it's usually the cleanest
    exactSearchQuery = linkProductNames[0];
  }

  // If no good link names, try to extract from the answer text
  if (!exactSearchQuery) {
    // Look for "the product is [the] XXXXX" pattern
    const productMatch = answer.match(/(?:the product is|this is|identified as|you photographed is)\s+(?:the\s+)?(.{10,100}?)(?:\.|,\s*(?:worn|from|in their))/i);
    if (productMatch) {
      exactSearchQuery = productMatch[1].trim();
    }
  }

  const hasExactModel = !!exactSearchQuery;
  const confidence = hasExactModel ? 'high' : 'low';

  // For alternatives: use a broader version or fallback
  const alternativeSearchQuery = exactSearchQuery
    ? exactSearchQuery.split(/\s+/).slice(0, 4).join(' ')
    : fallbackQuery || 'clothing';

  console.log(`   🤖 AI Mode answer: "${answer.slice(0, 200)}..."`);
  console.log(`   🤖 Product links: ${linkProductNames.join(', ') || 'none'}`);
  console.log(`   🤖 exactSearchQuery: "${exactSearchQuery || 'none'}"`);
  console.log(`   🤖 alternativeSearchQuery: "${alternativeSearchQuery}"`);

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
