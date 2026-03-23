import {
  browserUseGetTask,
  browserUseGetTaskStatus,
  browserUseRunTask,
  extractBrowserTaskId,
  extractLocusApproval,
  hasLocusKey,
} from './locus.js';

function stringifyMaybe(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value, maxLength = 500) {
  const text = stringifyMaybe(value);
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function extractLocusFundingBlock(body) {
  const message = String(body?.message || '');
  const details = body?.details || body?.data?.details || {};
  if (!/insufficient usdc balance/i.test(message)) return null;

  return {
    walletBalance: details.walletBalance ?? null,
    proposedAmount: details.proposedAmount ?? null,
  };
}

function formatShippingAddress(address = {}) {
  const parts = [
    address.fullName,
    address.email,
    address.phone,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
  return parts.join(' | ');
}

function buildCheckoutTask({ url, title, price, marketplace, paymentMethod, shippingAddress }) {
  const priceText = stringifyMaybe(price) || 'unknown price';
  const paymentLabel = paymentMethod === 'usdc' ? 'USDC' : 'card';
  const shippingText = formatShippingAddress(shippingAddress);

  return [
    `Open the product page at ${url}.`,
    `Verify it matches the product "${title}" from ${marketplace || 'the merchant'} priced around ${priceText}.`,
    'If it does not match, stop and explain the mismatch.',
    'Try to handle obvious defaults automatically. If a required variant is not obvious, try at most two sensible options before stopping.',
    'Add exactly one item to cart if possible.',
    'Prefer guest checkout if the merchant offers it.',
    shippingText
      ? `Use this shipping information when the merchant checkout asks for it: ${shippingText}.`
      : 'If shipping information is required and not already available, stop and report that user input is required.',
    'Proceed through checkout until you reach the payment page, payment method selection, shipping step, or a login/account wall.',
    `Prefer the ${paymentLabel} path if the merchant offers a choice, but do not enter or submit payment credentials.`,
    'Do not place the order.',
    'Return JSON only in this shape: {"stage":"product|cart|shipping|payment|login_required|blocked|mismatch|input_required","pageUrl":"current url","summary":"short status summary","blockers":["..."],"paymentOptions":["..."],"requiresUserInput":true|false}.'
  ].join(' ');
}

function parseJsonSafely(value) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    return typeof value === 'object' ? value : null;
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string' && parsed.trim().startsWith('{')) {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function inferCheckoutStage(summary, status, taskData = {}) {
  const text = `${summary || ''} ${status || ''} ${taskData.currentUrl || ''}`.toLowerCase();
  if (/\bmismatch\b/.test(text)) return 'mismatch';
  if (/\b(payment|card number|cvv|paypal|apple pay|google pay)\b/.test(text)) return 'payment';
  if (/\b(shipping|delivery address|billing address)\b/.test(text)) return 'shipping';
  if (/\b(cart|basket|bag)\b/.test(text)) return 'cart';
  if (/\b(login|sign in|account wall)\b/.test(text)) return 'login_required';
  if (/\b(input required|select size|select colour|select color|variant)\b/.test(text)) return 'input_required';
  return 'product';
}

function parseBrowserAction(action) {
  const parsed = parseJsonSafely(action);
  if (!parsed || typeof parsed !== 'object') return null;
  const [kind, payload] = Object.entries(parsed)[0] || [];
  if (!kind) return null;

  if (kind === 'navigate') return `Navigate to ${payload?.url || 'page'}`;
  if (kind === 'click') return `Click element ${payload?.index ?? ''}`.trim();
  if (kind === 'wait') return `Wait ${payload?.seconds ?? ''}s`.trim();
  if (kind === 'evaluate') return 'Run page script';
  if (kind === 'input_text') return `Type into element ${payload?.index ?? ''}`.trim();
  return kind;
}

function summariseLatestStep(taskData = {}) {
  const steps = Array.isArray(taskData.steps) ? taskData.steps : [];
  const lastStep = steps.at(-1) || null;
  if (!lastStep) {
    return {
      stepCount: 0,
      checkpoint: null,
      lastAction: null,
      screenshotUrl: null,
      currentUrl: taskData.currentUrl || taskData.url || taskData.pageUrl || taskData.finalUrl || null,
    };
  }

  const actions = Array.isArray(lastStep.actions) ? lastStep.actions : [];
  const lastAction = parseBrowserAction(actions.at(-1)) || null;
  const checkpoint = truncateText(
    lastStep.memory
      || lastStep.evaluationPreviousGoal
      || lastStep.nextGoal
      || lastAction,
    700
  );

  return {
    stepCount: steps.length,
    checkpoint,
    lastAction,
    screenshotUrl: lastStep.screenshotUrl || null,
    currentUrl: lastStep.url || taskData.currentUrl || taskData.url || taskData.pageUrl || taskData.finalUrl || null,
  };
}

function extractTaskSnapshot(statusBody, taskBody) {
  const statusData = statusBody?.data || {};
  const taskData = taskBody?.data || {};
  const status = statusData.status || taskData.status || 'UNKNOWN';
  const stepInfo = summariseLatestStep(taskData);
  const pageUrl = stepInfo.currentUrl;
  const rawSummary = taskData.summary
    || taskData.output
    || taskData.result
    || taskData.message
    || statusData.message
    || statusData.summary;
  const structured = parseJsonSafely(rawSummary) || parseJsonSafely(taskData.output) || parseJsonSafely(taskData.result);
  const summary = truncateText(structured?.summary || rawSummary || stepInfo.checkpoint || stepInfo.lastAction);
  const blockers = Array.isArray(structured?.blockers) ? structured.blockers : [];
  const paymentOptions = Array.isArray(structured?.paymentOptions) ? structured.paymentOptions : [];
  const stage = structured?.stage || inferCheckoutStage(`${summary || ''} ${stepInfo.checkpoint || ''}`, status, taskData);

  return {
    status,
    stage,
    pageUrl,
    summary,
    blockers,
    paymentOptions,
    requiresUserInput: structured?.requiresUserInput === true,
    stepCount: stepInfo.stepCount,
    lastAction: stepInfo.lastAction,
    screenshotUrl: stepInfo.screenshotUrl,
    rawStatus: statusData,
    rawTask: taskData,
  };
}

export async function startCheckoutAutomation({ url, title, price, marketplace, paymentMethod = 'card', shippingAddress = null }) {
  if (!url || !title) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'missing_product',
        message: 'url and title are required to start checkout automation',
      },
    };
  }

  if (!hasLocusKey()) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'missing_locus_api_key',
        message: 'LOCUS_API_KEY is required for checkout automation',
      },
    };
  }

  const task = buildCheckoutTask({ url, title, price, marketplace, paymentMethod, shippingAddress });
  const response = await browserUseRunTask(task, { maxSteps: 20 });
  const approvalUrl = extractLocusApproval(response.body);
  const taskId = extractBrowserTaskId(response.body);
  const fundingBlock = extractLocusFundingBlock(response.body);

  if (fundingBlock) {
    return {
      ok: false,
      status: 402,
      body: {
        error: 'locus_insufficient_balance',
        message: 'Locus checkout automation is configured, but the wallet has no spendable USDC yet.',
        walletBalance: fundingBlock.walletBalance,
        requiredAmount: fundingBlock.proposedAmount,
        nextStep: 'Fund the Locus wallet or wait for beta credits approval, then retry checkout automation.',
      },
    };
  }

  if (!response.ok && !taskId && !approvalUrl) {
    return {
      ok: false,
      status: response.status || 500,
      body: {
        error: response.body?.error || 'checkout_automation_failed',
        message: response.body?.message || 'Browser automation could not be started',
      },
    };
  }

  if (approvalUrl) {
    return {
      ok: true,
      status: 202,
      body: {
        status: 'pending_approval',
        taskId,
        approvalUrl,
        message: 'Checkout automation is waiting for human approval in Locus before it can start.',
      },
    };
  }

  return {
    ok: true,
    status: 202,
    body: {
      status: 'started',
      taskId,
      message: 'GhostCart checkout automation started. Poll the task status for progress.',
    },
  };
}

export async function getCheckoutSnapshot(taskId) {
  const [statusResponse, taskResponse] = await Promise.all([
    browserUseGetTaskStatus(taskId),
    browserUseGetTask(taskId),
  ]);

  if (!statusResponse.ok && !taskResponse.ok) {
    return {
      ok: false,
      status: statusResponse.status || taskResponse.status || 500,
      body: {
        error: statusResponse.body?.error || taskResponse.body?.error || 'checkout_status_failed',
        message: statusResponse.body?.message || taskResponse.body?.message || 'Could not retrieve checkout task status',
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: extractTaskSnapshot(statusResponse.body, taskResponse.body),
  };
}
