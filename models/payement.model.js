import mongoose from "mongoose";


const payementSchema = new mongoose.Schema({
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
    }
})

const Payement = mongoose.model("Payement", payementSchema);

export default Payement;
