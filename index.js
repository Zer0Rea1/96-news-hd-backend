import express from 'express';
import connectMongoDB from './db/connectMongoDB.js';
import dotenv from "dotenv";
import postRoute from './routes/post.route.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoute from './routes/auth.route.js'
import profileRoute from './routes/profile.route.js';
import paymentVerificationRoute from './routes/payment.route.js';
import { v2 as cloudinary } from "cloudinary";
const app = express();
const port = process.env.PORT;
dotenv.config();

// Middleware to parse JSON request bodies
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Enable CORS for all origins
app.use(cors({
  origin: ['http://localhost:5173',"http://192.168.8.106:5173"], // Allow requests from your frontend
  credentials: true, // Allow cookies (if needed)
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api', postRoute);
app.use('/api/auth', authRoute);
app.use('/api/profile', profileRoute);
app.use('/api/payment', paymentVerificationRoute);

app.listen(port,"0.0.0.0", () => {
  console.log(`api app listening on port ${port}`);
  connectMongoDB();
});