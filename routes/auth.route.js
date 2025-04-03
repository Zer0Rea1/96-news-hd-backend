import express from 'express';
import { signup, login, checkAuth, logout } from '../controllers/auth.controller.js';

const router = express.Router();

// Auth routes
router.post('/signup', signup);
router.post('/login', login);
router.get('/check-cookie', checkAuth);
router.post('/logout', logout);

export default router;