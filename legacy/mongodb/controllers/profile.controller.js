import User from '../models/user.model.js';

export const getProfile = async (req, res) => {
  try {
    // Extract user ID from the JWT token (added by middleware)
    const userId = req.user.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      profile: {
        userId: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        dateOfBirth: user.dateOfBirth,
        city: user.city,
        role: user.role,
        createdAt: user.createdAt,
        avatar: user.avatar,
        paid: user.paid,
        expiresAt: user.expiresAt,
        lastPayment: user.lastPayment
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

import { v2 as cloudinary } from 'cloudinary';

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, email, firstName, lastName, phoneNumber, dateOfBirth, city, avatar } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check uniqueness for username and email
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({
        username: { $regex: new RegExp('^' + username + '$', 'i') },
        _id: { $ne: userId }
      });
      if (existingUsername) return res.status(400).json({ success: false, message: 'Username already taken' });
      user.username = username;
    }

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({
        email: { $regex: new RegExp('^' + email + '$', 'i') },
        _id: { $ne: userId }
      });
      if (existingEmail) return res.status(400).json({ success: false, message: 'Email already taken' });
      user.email = email;
    }

    // Update other fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (city) user.city = city;

    // Handle Avatar Upload
    if (avatar && avatar.startsWith('data:image')) {
      try {
        // Delete old avatar if it exists and is not the default one
        if (user.avatar && !user.avatar.includes('gray-photo-placeholder')) {
          const publicId = user.avatar.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`avatars/${publicId}`);
        }

        const uploadResponse = await cloudinary.uploader.upload(avatar, {
          folder: 'avatars',
          transformation: [{ width: 500, height: 500, crop: 'fill' }]
        });
        user.avatar = uploadResponse.secure_url;
      } catch (uploadError) {
        console.error('Avatar upload error:', uploadError);
        return res.status(500).json({ success: false, message: 'Error uploading avatar' });
      }
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        userId: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        dateOfBirth: user.dateOfBirth,
        city: user.city,
        avatar: user.avatar,
        role: user.role,
        paid: user.paid,
        createdAt: user.createdAt,
        expiresAt: user.expiresAt,
        lastPayment: user.lastPayment
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ success: false, message: messages.join(', ') });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



export const getAllProfiles = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;

    const users = await User.find().skip(skip).limit(limit);
    const totalCount = await User.countDocuments();

    res.status(200).json({
      message: "all user fetched successfully",
      users,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: Math.floor(skip / limit) + 1
    })
  } catch {
    res.status(500).json({ message: "Error fetching users" })
  }
}