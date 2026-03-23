import crypto from 'crypto';

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

async function callLocus(path, { method = 'GET', payload } = {}) {
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

  const response = await fetch(`${LOCUS_API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJsonSafely(text),
  };
}

export async function callLocusWrapped(path, payload) {
  return callLocus(`/wrapped/${path}`, {
    method: 'POST',
    payload,
  });
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

export async function createLocusCheckoutSession(payload) {
  return callLocus('/checkout/sessions', {
    method: 'POST',
    payload,
  });
}

export async function getLocusCheckoutSession(sessionId) {
  return callLocus(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export function verifyLocusWebhookSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
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
