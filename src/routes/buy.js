import { Router } from 'express';
import {
  browserUseGetTask,
  browserUseGetTaskStatus,
  browserUseRunTask,
  extractBrowserTaskId,
  extractLocusApproval,
  hasLocusKey,
} from '../services/locus.js';

const router = Router();

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

function buildCheckoutTask({ url, title, price, marketplace, paymentMethod }) {
  const priceText = stringifyMaybe(price) || 'unknown price';
  const paymentLabel = paymentMethod === 'usdc' ? 'USDC' : 'card';

  return [
    `Open the product page at ${url}.`,
    `Verify it matches the product "${title}" from ${marketplace || 'the merchant'} priced around ${priceText}.`,
    'If it does not match, stop and explain the mismatch.',
    'If there are required product options like size or color and they are not obvious, stop and report that user input is required.',
    'Add exactly one item to cart if possible.',
    'Proceed through checkout until you reach the payment page, payment method selection, or a login/account wall.',
    `Prefer the ${paymentLabel} path if the merchant offers a choice, but do not enter or submit payment credentials.`,
    'Do not place the order.',
    'Return a concise summary of the furthest checkout step reached, the current page URL, and any blockers such as login, captcha, stock, or missing shipping details.'
  ].join(' ');
}

function extractTaskSnapshot(statusBody, taskBody) {
  const statusData = statusBody?.data || {};
  const taskData = taskBody?.data || {};
  const status = statusData.status || taskData.status || 'UNKNOWN';
  const pageUrl = taskData.currentUrl || taskData.url || taskData.pageUrl || taskData.finalUrl || null;
  const summary = truncateText(
    taskData.summary
      || taskData.output
      || taskData.result
      || taskData.message
      || statusData.message
      || statusData.summary
  );

  return {
    status,
    pageUrl,
    summary,
    rawStatus: statusData,
    rawTask: taskData,
  };
}

/**
 * POST /api/buy
 * Start checkout automation for a selected item
 */
router.post('/buy', async (req, res) => {
  try {
    const { url, title, price, marketplace, paymentMethod = 'card' } = req.body || {};

    if (!url || !title) {
      return res.status(400).json({
        error: 'missing_product',
        message: 'url and title are required to start checkout automation',
      });
    }

    if (!hasLocusKey()) {
      return res.status(400).json({
        error: 'missing_locus_api_key',
        message: 'LOCUS_API_KEY is required for checkout automation',
      });
    }

    const task = buildCheckoutTask({ url, title, price, marketplace, paymentMethod });
    const response = await browserUseRunTask(task, { maxSteps: 60 });
    const approvalUrl = extractLocusApproval(response.body);
    const taskId = extractBrowserTaskId(response.body);

    if (!response.ok && !taskId && !approvalUrl) {
      return res.status(response.status || 500).json({
        error: response.body?.error || 'checkout_automation_failed',
        message: response.body?.message || 'Browser automation could not be started',
      });
    }

    if (approvalUrl) {
      return res.status(202).json({
        status: 'pending_approval',
        taskId,
        approvalUrl,
        message: 'Checkout automation is waiting for human approval in Locus before it can start.',
      });
    }

    return res.status(202).json({
      status: 'started',
      taskId,
      message: 'GhostCart checkout automation started. Poll the task status for progress.',
    });
  } catch (error) {
    console.error('Buy automation error:', error);
    return res.status(500).json({
      error: 'checkout_automation_failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/buy/:taskId
 * Retrieve checkout automation task status
 */
router.get('/buy/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ error: 'missing_task_id', message: 'Task ID is required' });
    }

    const [statusResponse, taskResponse] = await Promise.all([
      browserUseGetTaskStatus(taskId),
      browserUseGetTask(taskId),
    ]);

    if (!statusResponse.ok && !taskResponse.ok) {
      return res.status(statusResponse.status || taskResponse.status || 500).json({
        error: statusResponse.body?.error || taskResponse.body?.error || 'checkout_status_failed',
        message: statusResponse.body?.message || taskResponse.body?.message || 'Could not retrieve checkout task status',
      });
    }

    const snapshot = extractTaskSnapshot(statusResponse.body, taskResponse.body);
    return res.json({
      taskId,
      ...snapshot,
    });
  } catch (error) {
    console.error('Buy status error:', error);
    return res.status(500).json({
      error: 'checkout_status_failed',
      message: error.message,
    });
  }
});

export { router as buyRouter };
