const LOCUS_API_BASE = (process.env.LOCUS_API_BASE || 'https://api.paywithlocus.com/api').replace(/\/$/, '');

function getLocusApiKey() {
  return process.env.LOCUS_API_KEY?.trim() || null;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: 'invalid_json', message: text };
  }
}

export function hasLocusKey() {
  return !!getLocusApiKey();
}

export async function callLocusWrapped(path, payload) {
  const apiKey = getLocusApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'missing_locus_api_key',
        message: 'LOCUS_API_KEY is not configured',
      },
    };
  }

  const response = await fetch(`${LOCUS_API_BASE}/wrapped/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJsonSafely(text),
  };
}

export async function firecrawlScrape(url) {
  return callLocusWrapped('firecrawl/scrape', {
    url,
    formats: ['markdown'],
  });
}

export async function browserUseRunTask(task, options = {}) {
  return callLocusWrapped('browser-use/run-task', {
    task,
    llm: options.llm || 'browser-use-2.0',
    maxSteps: options.maxSteps || 40,
  });
}

export async function browserUseGetTaskStatus(taskId) {
  return callLocusWrapped('browser-use/get-task-status', { taskId });
}

export async function browserUseGetTask(taskId) {
  return callLocusWrapped('browser-use/get-task', { taskId });
}

export function extractLocusApproval(body) {
  return body?.data?.approval_url || body?.approval_url || null;
}

export function extractBrowserTaskId(body) {
  return body?.data?.taskId
    || body?.data?.id
    || body?.taskId
    || body?.id
    || null;
}
