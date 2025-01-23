import express from 'express'
import connectMongoDB from './db/connectMongoDB.js'
import dotenv from "dotenv";
import postRoute from './routes/post.route.js'
const app = express()
const port = process.env.PORT
dotenv.config();

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.use('/api/newpost', postRoute)

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
    
  // connectMongoDB();
})
