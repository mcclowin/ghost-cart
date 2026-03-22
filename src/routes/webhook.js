import { Router } from 'express';

const router = Router();

/**
 * POST /webhook/stripe
 * Handle Stripe payment events
 */
router.post('/stripe', async (req, res) => {
  // TODO: Implement Stripe webhook handler
  res.json({ received: true });
});

export { router as webhookRouter };
