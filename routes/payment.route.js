import express from 'express';
import { payment,getPaymentVerificationData } from '../controllers/payment.controller.js';
import { verifyToken, isPaid ,isAdmin} from '../middleware/auth.middleware.js';
const router = express.Router();
// payent verification  post route
router.post('/', verifyToken, payment);
router.get('/get',verifyToken,isAdmin,getPaymentVerificationData)
export default router;