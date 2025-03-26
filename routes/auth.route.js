import express from 'express';
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import bcrypt from 'bcryptjs';

import dotenv from "dotenv";
const router = express.Router();
dotenv.config();  
// Helper function for error responses
const errorResponse = (res, status, message) => {
  console.log(message);
  return res.status(status).json({ success: false, message });
};

// Signup
router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  // Validate input
  if (!username || !email || !password) {
    return errorResponse(res, 400, 'All fields are required');
  }

  try {
    // Check if user already exists (case insensitive)
    const existingUser = await User.findOne({ 
      $or: [
        { email: { $regex: new RegExp(email, 'i') } },
        { username: { $regex: new RegExp(username, 'i') } }
      ]
    });

    if (existingUser) {
      return errorResponse(res, 400, 'Email or username already exists');
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({ 
      username, 
      email, 
      password: hashedPassword 
    });

    await newUser.save();

    return res.status(201).json({ 
      success: true,
      message: "User created successfully",
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });

  } catch (error) {
    return errorResponse(res, 500, 'Internal server error');
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return errorResponse(res, 400, 'Email and password are required');
  }

  try {
    // Find user (case insensitive email)
    const user = await User.findOne({ 
      email: { $regex: new RegExp(email, 'i') } 
    });

    if (!user) {
      return errorResponse(res, 400, 'Invalid credentials');
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return errorResponse(res, 400, 'Invalid credentials');
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.TOKEN_SECRET,
      { expiresIn: "30d" }
    );

    // Set secure cookie
    res.cookie("newsToken", token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? 'None' : 'Lax',
      path: "/"
    });

    return res.status(200).json({
      success: true,
      message: "Logged in successfully",
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    return errorResponse(res, 500, 'Internal server error');
  }
});

// Check cookie
router.get('/check-cookie', async (req, res) => {
  try {
    const token = req.cookies.newsToken;
    
    if (!token) {
      return res.status(200).json({ isAuthenticated: false });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
    
    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(200).json({ isAuthenticated: false });
    }

    return res.status(200).json({ 
      isAuthenticated: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(200).json({ isAuthenticated: false });
    }
    return errorResponse(res, 500, `Internal server errorjyryuf86d ${error}`);
  }
});

export default router;