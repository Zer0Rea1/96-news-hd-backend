import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/user.model.js';

dotenv.config();

export const verifyToken = (req, res, next) => {
  try {
    const token = req.cookies.newsToken;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Add user info to request
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

export const isAdmin = async (req, res, next) => {
  try {
    // Get user ID from req.user (set by verifyToken middleware)
    const userId = req.user.id;
    
    // Find user in database to check role
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user has admin role
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    
    // User is admin, proceed to next middleware
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const isPaid = async (req, res, next) => {
  try {
    // Get user ID from req.user (set by verifyToken middleware)
    const userId = req.user.id;
    
    // Find user in database to check paid status
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user has paid status or is an admin (admins bypass paid check)
    if (!user.paid && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Paid subscription required.'
      });
    }
    
    // User has paid status or is admin, proceed to next middleware
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}; 