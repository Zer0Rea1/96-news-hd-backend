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
        role: user.role,
        createdAt: user.createdAt, // MongoDB _id contains creation timestamp
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

export const updateProfile = async (req, res) => {
  try {
    // Extract user ID from the JWT token (added by middleware)
    const userId = req.user.id;
    const { username, email } = req.body;
    
    // Find user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if username or email is already taken
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ 
        username: { $regex: new RegExp('^' + username + '$', 'i') },
        _id: { $ne: userId }
      });
      
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }
      
      user.username = username;
    }
    
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ 
        email: { $regex: new RegExp('^' + email + '$', 'i') },
        _id: { $ne: userId }
      });
      
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already taken'
        });
      }
      
      user.email = email;
    }
    
    await user.save();
    
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user._id.getTimestamp()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}; 