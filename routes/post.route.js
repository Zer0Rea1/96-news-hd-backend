import express from 'express'
import {newPost} from '../controllers/post.controller.js'


const router = express.Router();


router.post('/newpost', newPost)

export default router