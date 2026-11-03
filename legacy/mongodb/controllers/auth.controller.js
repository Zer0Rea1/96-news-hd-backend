import User from "../models/user.model.js";
import bcrypt from 'bcryptjs';
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// Helper function for error responses
const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

// Register a new user
export const signup = async (req, res) => {
  const { username, email, password, firstName, lastName, phoneNumber, dateOfBirth, city } = req.body;

  if (!username || !email || !password || !firstName || !lastName || !phoneNumber || !dateOfBirth || !city) {
    return errorResponse(res, 400, 'All fields are required');
  }

  try {
    const existingUser = await User.findOne({
      $or: [
        { email: { $regex: new RegExp(email, 'i') } },
        { username: { $regex: new RegExp(username, 'i') } }
      ]
    });

    if (existingUser) {
      return errorResponse(res, 400, 'Email or username already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      phoneNumber,
      dateOfBirth,
      city,
      createdAt: new Date()
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
    // console.error('Signup Error:', error);
    return errorResponse(res, 500, 'Internal server error');
  }
};


// Login user
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return errorResponse(res, 400, 'Email and password are required');
  }

  try {
    const user = await User.findOne({
      email: { $regex: new RegExp('^' + email + '$', 'i') }
    });

    if (!user) {
      return errorResponse(res, 400, 'Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return errorResponse(res, 400, 'Invalid credentials');
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.cookie("newsToken", token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
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
};

// Check authentication status
export const checkAuth = async (req, res) => {
  try {
    const token = req.cookies.newsToken;

    if (!token) {
      return res.status(400).json({
        isAuthenticated: false,
        message: "No token found"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        isAuthenticated: false,
        message: "User not found"
      });
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
    return res.status(200).json({
      isAuthenticated: false,
      message: "Invalid token"
    });
  }
};

// Logout user
export const logout = (req, res) => {
  res.clearCookie('newsToken', {
    httpOnly: true,
    secure: true, // Keep for production
    sameSite: 'none', // Required for cross-site cookies to be sent/cleared
  });
  res.status(200).json({ success: true });
};
