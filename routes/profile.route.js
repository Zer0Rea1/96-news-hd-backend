import express from 'express';
import { getAllProfiles, getProfile, updateProfile } from '../controllers/profile.controller.js';
import { verifyToken, isPaid, checkMembership, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Apply auth middleware to all profile routes
// router.use(verifyToken);

// Get user profile
router.get('/', verifyToken, isPaid, getProfile);

// Update user profile
router.put('/update', verifyToken, updateProfile);
router.get('/users', verifyToken, isAdmin, getAllProfiles)
export default router; 