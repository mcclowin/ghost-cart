/**
 * Vision analysis — image → clothing attributes
 * Supports: Anthropic Claude (preferred), OpenAI GPT-4o, fallback
 */
import { readFileSync } from 'fs';

// Try Anthropic first, then OpenAI
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const openaiKey = process.env.OPENAI_API_KEY?.trim();

let visionProvider = null;
let Anthropic, OpenAI;

if (anthropicKey) {
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default;
    visionProvider = 'anthropic';
    console.log('👁️ Vision: Anthropic Claude ✅');
  } catch (e) {
    console.warn('Anthropic SDK import failed:', e.message);
  }
}

if (!visionProvider && openaiKey) {
  try {
    OpenAI = (await import('openai')).default;
    visionProvider = 'openai';
    console.log('👁️ Vision: OpenAI GPT-4o ✅');
  } catch (e) {
    console.warn('OpenAI SDK import failed:', e.message);
  }
}

if (!visionProvider) {
  console.warn('👁️ Vision: ⚠️ No API key — using fallback (caption only)');
}

const VISION_PROMPT = `You are a fashion product identification expert. Analyze this clothing image and extract precise, searchable attributes.

Identify ALL clothing items visible. For each item, extract:

Return JSON:
{
  "items": [
    {
      "item_type": "e.g. puffer jacket, midi dress, sneakers",
      "brand": "brand if visible/identifiable, null otherwise",
      "color": "primary color(s)",
      "pattern": "solid, striped, floral, etc.",
      "material": "leather, denim, cotton, etc. if identifiable",
      "style": "casual, formal, streetwear, etc.",
      "distinguishing_features": "notable details like logo, hardware, cut",
      "search_query": "optimized Google Shopping search query for this exact item",
      "alt_search_query": "broader alternative search query"
    }
  ],
  "overall_style": "description of the overall look/outfit",
  "confidence": "high/medium/low"
}`;

/**
 * Analyze a clothing image and extract attributes.
 */
export async function analyzeClothingImage(imagePath, context = {}) {
  if (!visionProvider) return fallbackVision(context);

  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const contextHint = context.caption
    ? `\nContext from the original post caption: "${context.caption}"`
    : '';

  try {
    if (visionProvider === 'anthropic') {
      return await analyzeWithAnthropic(base64Image, mimeType, contextHint);
    } else {
      return await analyzeWithOpenAI(base64Image, mimeType, contextHint);
    }
  } catch (error) {
    console.error(`Vision error (${visionProvider}):`, error.message, error.status, error.error || '');
    return fallbackVision(context);
  }
}

async function analyzeWithAnthropic(base64Image, mimeType, contextHint) {
  const client = new Anthropic({ apiKey: anthropicKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Image },
          },
          {
            type: 'text',
            text: `${VISION_PROMPT}${contextHint}\n\nReturn ONLY valid JSON, no markdown.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0]?.text || '';
  return parseVisionResponse(text);
}

async function analyzeWithOpenAI(base64Image, mimeType, contextHint) {
  const client = new OpenAI({ apiKey: openaiKey });

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${VISION_PROMPT}${contextHint}`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0].message.content;
  return parseVisionResponse(text);
}

function parseVisionResponse(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('Vision JSON parse failed:', text?.slice(0, 300));
    return null;
  }
}

function fallbackVision(context) {
  const caption = context.caption || '';
  return {
    items: [
      {
        item_type: 'clothing',
        brand: null,
        color: null,
        pattern: null,
        material: null,
        style: null,
        distinguishing_features: null,
        search_query: caption.replace(/#\w+/g, '').trim() || 'clothing item',
        alt_search_query: 'fashion clothing',
      },
    ],
    overall_style: 'unknown',
    confidence: 'low',
  };
}
