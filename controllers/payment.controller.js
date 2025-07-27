import Payment from "../models/payment.model.js";
import User from "../models/user.model.js"
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
// User submits payment proof
export const submitPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, paymentMethod, proofImage, phoneNumber } = req.body;

    // Validate input
    if (!amount || !paymentMethod || !proofImage || !phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: "All fields are required" 
      });
    }

    // Upload image to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(proofImage, {
      folder: 'payment-proofs'
    });

    // Create new payment record
    const newPayment = new Payment({
      userId,
      amount,
      paymentStatus: "pending",
      paymentDate: new Date(),
      paymentMethod,
      screenshot: uploadResponse.secure_url,
      userPaymentNo: phoneNumber
    });

    await newPayment.save();

     async function updateUserPaidStatus(){
      try{
        const updateUser = await User.findByIdAndUpdate(
      userId,
      {
        paid: "pending"
      },
      { new: true }
    )
      }
      catch{
        console.log("user was not updated successfully")
      }
     } 
    updateUserPaidStatus()

    res.status(201).json({ 
      success: true,
      message: "Payment submitted for verification",
      payment: newPayment
    });

  } catch (error) {
    console.error("Payment submission error:", error);
    res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: error.message 
    });
  }
}

// Admin gets all payment verification requests
export const getPaymentVerificationData = async (req, res) => {
  try {
    const payments = await Payment.find().sort({ paymentDate: -1 });

    if (!payments || payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No payment verification requests found'
      });
    }

    return res.status(200).json({
      success: true,
      count: payments.length,
      payments
    });

  } catch (error) {
    console.error("Get payments error:", error);
    return res.status(500).json({
      success: false,
      message: `Internal server error: ${error.message}`
    });
  }
}

// Admin verifies a payment
export const verifyPayment = async (req, res) => {
  try {
    const { paymentId,userId } = req.body;
    
    if (!paymentId && !userId) {
      return res.status(400).json({ 
        success: false,
        message: "Payment ID and user id is required" 
      });
    }

    // Start a transaction to ensure both updates succeed or fail together
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Update the payment status
      const updatedPayment = await Payment.findOneAndUpdate(
        { 
          _id: paymentId, 
          paymentStatus: 'pending' 
        },
        { 
          $set: { 
            paymentStatus: 'verified', 
            verifiedAt: new Date(),
            verifiedBy: req.user.id
          } 
        },
        { new: true, session }
      );

      if (!updatedPayment) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ 
          success: false,
          message: "No pending payment found with this ID" 
        });
      }

      // 2. Update the user's paid status
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $set: { paid: "paid" } },
        { new: true, session }
      );

      if (!updatedUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      // Commit the transaction if both operations succeeded
      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({ 
        success: true,
        message: "Payment verified and user status updated",
        payment: updatedPayment,
        user: updatedUser
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
    
  } catch (error) {
    console.error("Payment verification error:", error);
    return res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: error.message 
    });
  }
}