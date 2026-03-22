import { Router } from 'express';

const router = Router();

/**
 * POST /api/buy
 * Initiate purchase of a selected item
 */
router.post('/buy', async (req, res) => {
  // TODO: Implement with Stripe Checkout + Bond.Credit
  res.json({ 
    status: 'coming_soon',
    message: 'Purchase flow will be implemented with Stripe + Locus + Bond.Credit' 
  });
});

export { router as buyRouter };
