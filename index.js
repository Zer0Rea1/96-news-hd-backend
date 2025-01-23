import express from 'express';
import connectMongoDB from './db/connectMongoDB.js';
import dotenv from "dotenv";
import postRoute from './routes/post.route.js';
import cors from 'cors';

const app = express();
const port = process.env.PORT;
dotenv.config();

// Middleware to parse JSON request bodies
app.use(express.json());

// Enable CORS for all origins
app.use(cors());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api', postRoute);

app.listen(port, () => {
  console.log(`api app listening on port ${port}`);
  connectMongoDB();
});