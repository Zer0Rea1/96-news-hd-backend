import express from 'express'
import {newPost} from '../controllers/post.controller.js'


const router = express.Router();


router.get('/newpost', newPost)

export default router