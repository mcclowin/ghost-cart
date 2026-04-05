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
 * Parse the AI Mode answer into structured discovery fields.
 * No LLM needed — just extract from the structured text.
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
    };
  }

  // Strip markdown bold/italic for easier parsing
  const answer = aiResult.answer.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');

  // Stop pattern — these indicate the next field or section
  const STOP = `(?=\\s*(?:\\d\\)|Brand|Model|Product|Color|Colorway|Top|Where|Store|Buy|Shop|$))`;

  // Extract brand
  const brandMatch = answer.match(new RegExp(`Brand(?:\\s*Name)?[:\\s]+(.+?)${STOP}`, 'i'));
  let brand = brandMatch?.[1]?.trim() || '';
  // Clean up citation artifacts like "Instagram +1"
  brand = brand.replace(/\s*(?:Instagram|Facebook|Reddit|TikTok|X|YouTube).*$/i, '').trim();

  // Extract model
  const modelMatch = answer.match(new RegExp(`(?:Model|Product\\s*Name|Model\\/Product\\s*Name)[:\\s]+(.+?)${STOP}`, 'i'));
  const model = modelMatch?.[1]?.trim() || '';

  // Extract colorway
  const colorMatch = answer.match(new RegExp(`(?:Color|Colorway|Color\\/Colorway)[:\\s]+(.+?)${STOP}`, 'i'));
  const colorway = colorMatch?.[1]?.trim() || '';

  // Log what we're parsing
  console.log(`   🤖 Parsing from: "${answer.slice(0, 300)}..."`);
  console.log(`   🤖 Regex matches: brand="${brand}" model="${model}" colorway="${colorway}"`);

  // Build the full product name
  const fullName = [brand, model, colorway].filter(Boolean).join(' ').trim();

  // Build exact search query (for shopping search)
  const exactSearchQuery = fullName || null;

  // Build alternative query (broader)
  const altParts = [brand, model].filter(Boolean);
  const alternativeSearchQuery = altParts.length > 0
    ? altParts.join(' ')
    : fallbackQuery || 'clothing';

  const hasExactModel = !!brand && !!model;
  const confidence = hasExactModel ? (colorway ? 'high' : 'medium') : 'low';

  console.log(`   🤖 Parsed: brand="${brand}" model="${model}" colorway="${colorway}"`);
  console.log(`   🤖 exactSearchQuery: "${exactSearchQuery || 'none'}"`);

  return {
    hasExactModel,
    exactModel: [brand, model].filter(Boolean).join(' ') || null,
    exactSearchQuery,
    confidence,
    alternativeSearchQuery,
    rationale: `AI Mode identified: ${fullName || 'unknown'}`,
    source: 'ai_mode',
    aiModeLinks: aiResult.links || [],
  };
}
