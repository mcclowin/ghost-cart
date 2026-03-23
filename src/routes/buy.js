import { Router } from 'express';
import { getCheckoutSnapshot, startCheckoutAutomation } from '../services/purchase.js';

const router = Router();

router.post('/buy', async (req, res) => {
  try {
    const result = await startCheckoutAutomation(req.body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Buy automation error:', error);
    return res.status(500).json({
      error: 'checkout_automation_failed',
      message: error.message,
    });
  }
});

router.get('/buy/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ error: 'missing_task_id', message: 'Task ID is required' });
    }

    const result = await getCheckoutSnapshot(taskId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Get buy status error:', error);
    return res.status(500).json({
      error: 'checkout_status_failed',
      message: error.message,
    });
  }
});

export { router as buyRouter };
