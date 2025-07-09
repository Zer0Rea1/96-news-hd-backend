import User from "../models/user.model.js";
import Payement from "../models/payement.model.js";
import { v2 as cloudinary } from 'cloudinary'

// payment verification for admin only route
export const payment = async (req, res) => {
    try {
        const userId = req.user.id;
        const {  amount, paymentMethod, proofImage, phoneNumber } = req.body;
        const uploadResponse = await cloudinary.uploader.upload(proofImage);
        console.log(userId,amount,paymentMethod,uploadResponse.secure_url,phoneNumber)
        const newPayment = new Payement({
            userId: userId,
            amount: amount,
            paymentStatus: "pending",
            paymentDate:new Date(),
            paymentMethod: paymentMethod,
            screenshot:uploadResponse.secure_url,
            userPaymentNo: phoneNumber
        })
        await newPayment.save();
        res.status(200).json({ message: "Payment verified" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
}

export const getPaymentVerificationData = async (req,res)=>{
    try {
        
        
        const payments = await Payement.find();
        
        if (!payments) {
          return res.status(404).json({
            success: false,
            message: 'Payments verification requests is empty'
          });
        }
        
        return res.status(200).json(payments);
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Internal server error ${error}'
        });
      }
}