import express from 'express';
import connectMongoDB from './db/connectMongoDB.js';
import dotenv from "dotenv";
import postRoute from './routes/post.route.js';
import cors from 'cors';
import authRoute from './routes/auth.route.js'
const app = express();
const port = process.env.PORT;
dotenv.config();

// Middleware to parse JSON request bodies
app.use(express.json());

// Enable CORS for all origins
app.use(cors({
  origin: 'http://localhost:5173', // Allow requests from your frontend
  credentials: true, // Allow cookies (if needed)
}));
app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api', postRoute);
app.use('/api/auth', authRoute);


app.listen(port, () => {
  console.log(`api app listening on port ${port}`);
  connectMongoDB();
});