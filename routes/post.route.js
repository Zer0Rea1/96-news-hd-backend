import express from 'express'
import {newPost, getPost} from '../controllers/post.controller.js'
import { checkMembership, isPaid, verifyToken } from '../middleware/auth.middleware.js';


const router = express.Router();


router.post('/newpost', newPost,isPaid,verifyToken,checkMembership)
router.get('/getpost', getPost)
export default router