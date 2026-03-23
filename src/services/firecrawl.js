const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v2';

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY?.trim() || null;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: 'invalid_json', message: text };
  }
}

export function hasFirecrawlKey() {
  return !!getFirecrawlApiKey();
}

export async function firecrawlScrape(url, options = {}) {
  const apiKey = getFirecrawlApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'missing_firecrawl_api_key',
        message: 'FIRECRAWL_API_KEY is not configured',
      },
    };
  }

  const response = await fetch(`${FIRECRAWL_API_BASE}/scrape`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: options.formats || ['markdown'],
      onlyMainContent: options.onlyMainContent ?? true,
      maxAge: options.maxAge ?? 0,
    }),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJsonSafely(text),
  };
}
