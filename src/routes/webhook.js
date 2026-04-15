import express, { Router } from 'express';
import {
  createOrUpdateReceipt,
  findPaymentByExternal,
  getReceiptForPayment,
  updatePaymentRecord,
} from '../services/payments-store.js';
import { startCheckoutAutomation } from '../services/purchase.js';
import { writeReceiptOnchain } from '../services/receipts-chain.js';
import { verifyLocusWebhookSignature } from '../services/locus.js';

const router = Router();

async function maybeStartBackgroundPurchase(payment) {
  const purchaseIntent = payment?.metadata?.purchaseIntent || null;
  if (!payment || !purchaseIntent || payment.purchaseTaskId || payment.purchaseFailure) {
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

async function maybeWriteReceiptOnchain(payment) {
  const receipt = getReceiptForPayment(payment.id);
  if (!receipt || receipt.onchain?.txHash) return receipt;

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
    console.error('Onchain receipt write failed:', error);
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

router.post('/locus', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawPayload = req.body.toString('utf8');
    const signature = req.headers['x-signature-256'];
    const payload = JSON.parse(rawPayload);
    const sessionId = req.headers['x-session-id'] || payload?.data?.sessionId || null;
    const payment = sessionId ? findPaymentByExternal('locus', sessionId) : null;
    const secret = payment?.webhookSecret || process.env.LOCUS_WEBHOOK_SECRET?.trim() || null;

    if (secret && !verifyLocusWebhookSignature(rawPayload, signature, secret)) {
      return res.status(400).json({
        error: 'locus_webhook_invalid_signature',
        message: 'Locus webhook signature verification failed',
      });
    }

    if (payment && payload?.event === 'checkout.session.paid') {
      const next = updatePaymentRecord(payment.id, {
        status: 'PAID',
        providerStatus: 'PAID',
        paidAt: payload.data?.paidAt || new Date().toISOString(),
        paymentTxHash: payload.data?.paymentTxHash || null,
        payerAddress: payload.data?.payerAddress || null,
      });

      createOrUpdateReceipt(payment.id, {
        provider: 'locus',
        externalId: sessionId,
        paymentTxHash: payload.data?.paymentTxHash || null,
        payerAddress: payload.data?.payerAddress || null,
        paidAt: payload.data?.paidAt || null,
        raw: payload,
      });
      await maybeWriteReceiptOnchain(next);
      await maybeStartBackgroundPurchase(next);
    }

    if (payment && payload?.event === 'checkout.session.expired') {
      updatePaymentRecord(payment.id, {
        status: 'EXPIRED',
        providerStatus: 'EXPIRED',
      });
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Locus webhook error:', error);
    return res.status(400).json({
      error: 'locus_webhook_invalid',
      message: error.message,
    });
  }
});

export { router as webhookRouter };
