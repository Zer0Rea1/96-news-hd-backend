import express from 'express';
import { getProfile, updateProfile } from '../controllers/profile.controller.js';
import { verifyToken,isPaid, checkMembership } from '../middleware/auth.middleware.js';

const router = express.Router();

// Apply auth middleware to all profile routes
// router.use(verifyToken);

// Get user profile
router.get('/',verifyToken,isPaid, getProfile);

// Update user profile
router.put('/update',verifyToken, isPaid,checkMembership, updateProfile);

export default router; 