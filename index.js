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
import Post from './models/post.model.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT;
dotenv.config();

// Security headers
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);


// Remove the existing CORS configuration and replace with:

const corsOptions = {
  origin: [
    'https://96newshd.vercel.app',
    'http://localhost:5173' // For local development
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Remove the app.options('*', cors()) line as it's now included in the main CORS config

// Middleware to parse JSON request bodies
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Enable CORS for all origins



cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ success: false, message: "Missing search query" });

  try {
    const results = await Post.find({
      title: { $regex: query, $options: 'i' },
    });

    res.json({ success: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


app.get('/post/:slug', async (req, res) => {
  const { slug } = req.params;

  // Fetch post using slug
  const post = await Post.findOne({ _id: slug });

  if (!post) {
    return res.status(404).send("Post not found");
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      <meta property="og:title" content="${post.title}" />
      <meta property="og:description" content="${post.article || 'Read more on our blog'}" />
      <meta property="og:image" content="${post.thumbnailImage}" />
      <meta property="og:url" content="https://96newshd.vercel.app/news/${slug}" />
      <meta property="og:type" content="article" />

      <meta name="twitter:card" content="summary_large_image" />
      <title>${post.title}</title>
    </head>
    <body>
      Redirecting...
      <script>
        window.location.href = "https://96newshd.vercel.app/news/${slug}";
      </script>
    </body>
    </html>
  `;
  res.setHeader("Content-Security-Policy", "script-src 'self' 'unsafe-inline';");

  res.send(html);
});


app.use('/api', postRoute);
app.use('/api/auth', authRoute);
app.use('/api/profile', profileRoute);
app.use('/api/payment', paymentVerificationRoute);

app.listen(port, () => {
  console.log(`api app listening on port ${port}`);
  connectMongoDB();
});

export default app;
