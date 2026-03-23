import { Router } from 'express';
import {
  createOrUpdateReceipt,
  createPaymentRecord,
  getPaymentRecord,
  getReceiptForPayment,
  updatePaymentRecord,
} from '../services/payments-store.js';
import { getCheckoutSnapshot, startCheckoutAutomation } from '../services/purchase.js';
import { writeReceiptOnchain } from '../services/receipts-chain.js';
import {
  createStripeCheckoutSession,
  hasStripeKey,
  retrieveStripeCheckoutSession,
} from '../services/stripe.js';
import {
  createLocusCheckoutSession,
  getLocusCheckoutSession,
  hasLocusKey,
} from '../services/locus.js';
import { getPublicBaseUrl } from '../services/erc8004.js';

const router = Router();

function normalizeAmountString(amount) {
  if (typeof amount === 'string') {
    const match = amount.match(/(\d+(?:[.,]\d{1,2})?)/);
    if (match) {
      const numeric = Number(match[1].replace(',', '.'));
      if (Number.isFinite(numeric) && numeric > 0) {
        return String(Number(numeric.toFixed(2)));
      }
    }
  }

  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return String(Number(numeric.toFixed(2)));
}

function buildUrl(req, path) {
  const base = getPublicBaseUrl(req);
  return base ? `${base}${path}` : path;
}

function mapStripeStatus(session) {
  if (session.payment_status === 'paid') return 'PAID';
  if (session.status === 'expired') return 'EXPIRED';
  return 'PENDING';
}

async function maybeWriteReceiptOnchain(payment, receipt) {
  if (!payment || !receipt || receipt.onchain?.txHash) return receipt;

  try {
    const onchain = await writeReceiptOnchain(payment, receipt);
    if (!onchain) return receipt;
    return createOrUpdateReceipt(payment.id, {
      provider: receipt.provider,
      externalId: receipt.externalId,
      paymentTxHash: receipt.paymentTxHash,
      payerAddress: receipt.payerAddress,
      paidAt: receipt.paidAt,
      onchain,
      raw: receipt.raw,
    });
  } catch (error) {
    return createOrUpdateReceipt(payment.id, {
      provider: receipt.provider,
      externalId: receipt.externalId,
      paymentTxHash: receipt.paymentTxHash,
      payerAddress: receipt.payerAddress,
      paidAt: receipt.paidAt,
      onchain: {
        error: error.message,
      },
      raw: receipt.raw,
    });
  }
}

async function maybeStartBackgroundPurchase(payment) {
  const purchaseIntent = payment?.metadata?.purchaseIntent || null;
  if (!payment || payment.status !== 'PAID' || !purchaseIntent || payment.purchaseTaskId || payment.purchaseFailure) {
    return payment;
  }

  const result = await startCheckoutAutomation(purchaseIntent);
  if (!result.ok) {
    return updatePaymentRecord(payment.id, {
      purchaseStatus: 'FAILED',
      purchaseFailure: result.body?.message || result.body?.error || 'Could not start background purchase',
    });
  }

  return updatePaymentRecord(payment.id, {
    purchaseStatus: result.body?.status || 'started',
    purchaseTaskId: result.body?.taskId || null,
    purchaseApprovalUrl: result.body?.approvalUrl || null,
    purchaseMessage: result.body?.message || null,
    purchaseFailure: null,
  });
}

router.post('/payments/checkout', async (req, res) => {
  try {
    const {
      provider,
      amount,
      currency,
      description,
      metadata = {},
      receiptConfig,
    } = req.body || {};

    const normalizedAmount = normalizeAmountString(amount);
    if (!provider || !['stripe', 'locus', 'demo'].includes(provider)) {
      return res.status(400).json({
        error: 'invalid_provider',
        message: 'provider must be "stripe", "locus", or "demo"',
      });
    }

    if (!normalizedAmount) {
      return res.status(400).json({
        error: 'invalid_amount',
        message: 'amount must be a positive number',
      });
    }

    // Demo provider — auto-confirms instantly for agent testing
    if (provider === 'demo') {
      const payment = createPaymentRecord({
        provider: 'demo',
        amount: normalizedAmount,
        currency: 'DEMO',
        description: description || 'GhostCart demo checkout',
        metadata,
      });

      const next = updatePaymentRecord(payment.id, {
        externalId: `demo-${payment.id}`,
        status: 'PAID',
        providerStatus: 'PAID',
        paidAt: new Date().toISOString(),
      });

      createOrUpdateReceipt(next.id, {
        provider: 'demo',
        externalId: `demo-${payment.id}`,
        paymentTxHash: '0x' + 'demo'.repeat(16),
        payerAddress: '0x' + '0'.repeat(40),
      });

      // Trigger background purchase if purchaseIntent exists
      maybeStartBackgroundPurchase(next);

      return res.status(201).json({
        paymentId: next.id,
        provider: 'demo',
        status: 'PAID',
        providerStatus: 'PAID',
        paidAt: next.paidAt,
        note: 'Demo payment — auto-confirmed instantly. No real funds moved.',
      });
    }

    if (provider === 'stripe') {
      if (!hasStripeKey()) {
        return res.status(400).json({
          error: 'missing_stripe_secret_key',
          message: 'STRIPE_SECRET_KEY is required for Stripe Checkout',
        });
      }

      const payment = createPaymentRecord({
        provider: 'stripe',
        amount: normalizedAmount,
        currency: (currency || process.env.STRIPE_CHECKOUT_CURRENCY || 'gbp').toLowerCase(),
        description: description || 'GhostCart checkout',
        metadata,
      });

      const successUrl = buildUrl(req, `/payment-success.html?provider=stripe&paymentId=${payment.id}`);
      const cancelUrl = buildUrl(req, `/payment-cancelled.html?provider=stripe&paymentId=${payment.id}`);

      const session = await createStripeCheckoutSession({
        amount: normalizedAmount,
        currency: payment.currency,
        description: payment.description,
        successUrl,
        cancelUrl,
        metadata: {
          paymentId: payment.id,
          ...Object.fromEntries(
            Object.entries(metadata || {}).map(([key, value]) => [key, String(value)])
          ),
        },
      });

      const next = updatePaymentRecord(payment.id, {
        externalId: session.id,
        checkoutUrl: session.url,
        providerStatus: session.status || 'open',
      });

      return res.status(201).json({
        paymentId: next.id,
        provider: 'stripe',
        status: next.status,
        providerStatus: next.providerStatus,
        checkoutUrl: next.checkoutUrl,
        sessionId: session.id,
      });
    }

    if (!hasLocusKey()) {
      return res.status(400).json({
        error: 'missing_locus_api_key',
        message: 'LOCUS_API_KEY is required for Locus Checkout',
      });
    }

      const payment = createPaymentRecord({
        provider: 'locus',
        amount: normalizedAmount,
        currency: 'USDC',
        description: description || 'GhostCart checkout',
      metadata,
    });

    const webhookUrl = buildUrl(req, '/webhook/locus');
    const locusResponse = await createLocusCheckoutSession({
      amount: normalizedAmount,
      description: payment.description,
      metadata: {
        paymentId: payment.id,
        ...metadata,
      },
      webhookUrl,
      receiptConfig,
      instanceId: process.env.LOCUS_CHECKOUT_INSTANCE_ID?.trim() || undefined,
    });

    if (!locusResponse.ok) {
      return res.status(locusResponse.status || 500).json({
        error: locusResponse.body?.error || 'locus_checkout_failed',
        message: locusResponse.body?.message || 'Could not create Locus checkout session',
        details: locusResponse.body?.details || null,
      });
    }

    const session = locusResponse.body?.data || {};
    const next = updatePaymentRecord(payment.id, {
      externalId: session.id,
      checkoutUrl: session.checkoutUrl,
      providerStatus: session.status || 'PENDING',
      webhookSecret: session.webhookSecret || null,
    });

    return res.status(201).json({
      paymentId: next.id,
      provider: 'locus',
      status: next.status,
      providerStatus: next.providerStatus,
      checkoutUrl: next.checkoutUrl,
      sessionId: session.id,
      expiresAt: session.expiresAt || null,
      note: 'Humans can open checkoutUrl directly. Agents with Locus can also pay this session programmatically.',
    });
  } catch (error) {
    console.error('Create checkout session error:', error);
    return res.status(500).json({
      error: 'payment_session_failed',
      message: error.message,
    });
  }
});

router.get('/payments/:paymentId', async (req, res) => {
  try {
    const payment = getPaymentRecord(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({
        error: 'payment_not_found',
        message: 'Payment record not found',
      });
    }

    let next = payment;
    if (payment.provider === 'stripe' && payment.externalId && hasStripeKey()) {
      const session = await retrieveStripeCheckoutSession(payment.externalId);
      const mappedStatus = mapStripeStatus(session);
      next = updatePaymentRecord(payment.id, {
        providerStatus: session.status || payment.providerStatus,
        status: mappedStatus,
        paidAt: mappedStatus === 'PAID' ? (session.created ? new Date(session.created * 1000).toISOString() : payment.paidAt) : payment.paidAt,
      });

      if (mappedStatus === 'PAID') {
        const receipt = createOrUpdateReceipt(payment.id, {
          provider: 'stripe',
          externalId: session.id,
          paidAt: next.paidAt,
          raw: session,
        });
        await maybeWriteReceiptOnchain(next, receipt);
      }
    }

    if (payment.provider === 'locus' && payment.externalId && hasLocusKey()) {
      const locusResponse = await getLocusCheckoutSession(payment.externalId);
      if (locusResponse.ok) {
        const session = locusResponse.body?.data || {};
        const mappedStatus = session.status === 'PAID' ? 'PAID' : (session.status || payment.status);
        next = updatePaymentRecord(payment.id, {
          providerStatus: session.status || payment.providerStatus,
          status: mappedStatus,
          paidAt: session.paidAt || payment.paidAt,
          paymentTxHash: session.paymentTxHash || payment.paymentTxHash,
          payerAddress: session.payerAddress || payment.payerAddress,
        });

        if (mappedStatus === 'PAID') {
          const receipt = createOrUpdateReceipt(payment.id, {
            provider: 'locus',
            externalId: session.id,
            paymentTxHash: session.paymentTxHash || null,
            payerAddress: session.payerAddress || null,
            paidAt: session.paidAt || null,
            raw: session,
          });
          await maybeWriteReceiptOnchain(next, receipt);
        }
      }
    }

    next = await maybeStartBackgroundPurchase(next);

    let purchase = null;
    if (next.purchaseTaskId) {
      const purchaseResult = await getCheckoutSnapshot(next.purchaseTaskId);
      if (purchaseResult.ok) {
        purchase = purchaseResult.body;
        next = updatePaymentRecord(next.id, {
          purchaseStatus: purchase.status,
        });
      }
    } else if (next.purchaseStatus || next.purchaseFailure) {
      purchase = {
        status: next.purchaseStatus || 'FAILED',
        summary: next.purchaseFailure || next.purchaseMessage || null,
        approvalUrl: next.purchaseApprovalUrl || null,
      };
    }

    return res.json({
      payment: next,
      receipt: getReceiptForPayment(next.id),
      purchase,
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    return res.status(500).json({
      error: 'payment_status_failed',
      message: error.message,
    });
  }
});

router.get('/payments/:paymentId/receipt', (req, res) => {
  const payment = getPaymentRecord(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({
      error: 'payment_not_found',
      message: 'Payment record not found',
    });
  }

  const receipt = getReceiptForPayment(payment.id);
  if (!receipt) {
    return res.status(404).json({
      error: 'receipt_not_found',
      message: 'Receipt has not been issued for this payment yet',
    });
  }

  return res.json({ receipt });
});

export { router as paymentsRouter };
