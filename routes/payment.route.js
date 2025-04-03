import express from 'express';
import { payment } from '../controllers/payment.controller.js';
import { verifyToken, isPaid ,isAdmin} from '../middleware/auth.middleware.js';
const router = express.Router();
// payent verification  post route
router.post('/', verifyToken, payment);

export default router;