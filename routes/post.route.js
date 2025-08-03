import express from 'express'
import {newPost, getPost, getPostByUser, getPostbyid} from '../controllers/post.controller.js'
import { checkMembership, isPaid, verifyToken } from '../middleware/auth.middleware.js';


const router = express.Router();


router.post('/newpost',isPaid,verifyToken,checkMembership,newPost)
router.get('/getpost', getPost)
router.get('/getPostbyuser', verifyToken,checkMembership,isPaid,getPostByUser)
router.get('/getpostbyid/:id',getPostbyid)
export default router