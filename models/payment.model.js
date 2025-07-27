import mongoose from "mongoose";


const paymentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    paymentDate: {
        type: Date,
        required: true  
    },
    paymentStatus: {
        type: String,
        required: true
    },
    paymentMethod: {
        type: String,
        required: true
    },
    screenshot: {
        type: String,
        required: true
    },
    userPaymentNo: {
        type: String,
        required: true
    },
    verifiedAt:{
        type:Date
    }
})

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
