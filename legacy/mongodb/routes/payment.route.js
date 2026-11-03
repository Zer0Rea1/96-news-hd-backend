import express from 'express';
import { 
  submitPayment,
  getPaymentVerificationData, 
  verifyPayment 
} from '../controllers/payment.controller.js';
import { verifyToken, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Payment submission by user
router.post('/', verifyToken, submitPayment);

// Get all payments (admin only)
router.get('/get', verifyToken, isAdmin, getPaymentVerificationData);

// Verify payment (admin only)
router.post('/verify', verifyToken, isAdmin, verifyPayment);
export default router;