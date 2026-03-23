import { randomUUID } from 'crypto';
import { loadErc8004Registration } from './erc8004.js';

const payments = new Map();
const paymentsByExternal = new Map();
const receiptsByPayment = new Map();

function now() {
  return new Date().toISOString();
}

function toAmountString(amount) {
  if (typeof amount === 'number') return String(amount);
  return String(amount ?? '').trim();
}

function makeExternalKey(provider, externalId) {
  if (!provider || !externalId) return null;
  return `${provider}:${externalId}`;
}

export function createPaymentRecord({
  provider,
  amount,
  currency,
  description,
  metadata = {},
  externalId = null,
  checkoutUrl = null,
  providerStatus = 'PENDING',
  webhookSecret = null,
}) {
  const registration = loadErc8004Registration();
  const id = randomUUID();
  const payment = {
    id,
    provider,
    amount: toAmountString(amount),
    currency,
    description: description || 'GhostCart payment',
    status: 'PENDING',
    providerStatus,
    externalId,
    checkoutUrl,
    metadata,
    webhookSecret,
    agentId: registration?.agentId ?? null,
    createdAt: now(),
    updatedAt: now(),
    paidAt: null,
    paymentTxHash: null,
    payerAddress: null,
  };

  payments.set(id, payment);
  const externalKey = makeExternalKey(provider, externalId);
  if (externalKey) paymentsByExternal.set(externalKey, id);
  return payment;
}

export function updatePaymentRecord(paymentId, patch = {}) {
  const existing = payments.get(paymentId);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    updatedAt: now(),
  };
  payments.set(paymentId, next);

  const externalKey = makeExternalKey(next.provider, next.externalId);
  if (externalKey) paymentsByExternal.set(externalKey, paymentId);
  return next;
}

export function getPaymentRecord(paymentId) {
  return payments.get(paymentId) || null;
}

export function findPaymentByExternal(provider, externalId) {
  const key = makeExternalKey(provider, externalId);
  if (!key) return null;
  const paymentId = paymentsByExternal.get(key);
  if (!paymentId) return null;
  return getPaymentRecord(paymentId);
}

export function createOrUpdateReceipt(paymentId, {
  provider,
  externalId,
  paymentTxHash = null,
  payerAddress = null,
  paidAt = null,
  raw = null,
}) {
  const payment = getPaymentRecord(paymentId);
  if (!payment) return null;

  const existing = receiptsByPayment.get(paymentId);
  const receipt = {
    id: existing?.id || randomUUID(),
    paymentId,
    provider,
    externalId,
    agentId: payment.agentId,
    amount: payment.amount,
    currency: payment.currency,
    description: payment.description,
    paymentTxHash,
    payerAddress,
    paidAt: paidAt || now(),
    metadata: payment.metadata || {},
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    raw,
  };

  receiptsByPayment.set(paymentId, receipt);
  return receipt;
}

export function getReceiptForPayment(paymentId) {
  return receiptsByPayment.get(paymentId) || null;
}
