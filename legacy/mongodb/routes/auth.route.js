import express from 'express';
import { signup, login, checkAuth, logout } from '../controllers/auth.controller.js';
import { verifyToken, isAdmin, checkMembership } from '../middleware/auth.middleware.js';
const router = express.Router();

// Auth routes
router.post('/signup', signup);
router.post('/login', login);
router.get('/check-cookie', verifyToken, checkMembership, checkAuth);
router.post('/logout', verifyToken, logout);

export default router;