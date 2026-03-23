import Stripe from 'stripe';

let stripeClient = null;
let stripeSecretFingerprint = null;

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

export function hasStripeKey() {
  return !!getStripeSecretKey();
}

export function hasStripeWebhookSecret() {
  return !!process.env.STRIPE_WEBHOOK_SECRET?.trim();
}

export function getStripeClient() {
  const apiKey = getStripeSecretKey();
  if (!apiKey) return null;

  if (!stripeClient || stripeSecretFingerprint !== apiKey) {
    stripeClient = new Stripe(apiKey);
    stripeSecretFingerprint = apiKey;
  }

  return stripeClient;
}

function normalizeAmountToMinorUnits(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Amount must be a positive number');
  }
  return Math.round(numeric * 100);
}

export async function createStripeCheckoutSession({
  amount,
  currency = 'gbp',
  description,
  successUrl,
  cancelUrl,
  metadata = {},
}) {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: normalizeAmountToMinorUnits(amount),
          product_data: {
            name: description || 'GhostCart payment',
          },
        },
      },
    ],
    metadata,
  });
}

export async function retrieveStripeCheckoutSession(sessionId) {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return stripe.checkout.sessions.retrieve(sessionId);
}

export function constructStripeEvent(rawBody, signature) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!stripe || !webhookSecret) {
    throw new Error('Stripe webhook secret is not configured');
  }

  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}
