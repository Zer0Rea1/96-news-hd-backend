import express from 'express'
import {newPost, getPost, getPostByUser, getPostbyid,deletePost,editPost} from '../controllers/post.controller.js'
import { checkMembership, isPaid, verifyToken } from '../middleware/auth.middleware.js';


const router = express.Router();


router.post('/newpost',verifyToken,isPaid,newPost)
router.get('/getpost', getPost)
router.get('/getPostbyuser', verifyToken,checkMembership,isPaid,getPostByUser)
router.get('/getpostbyid/:id',getPostbyid)
router.delete('/posts/:id',verifyToken,isPaid, deletePost);
router.put('/posts/:id', verifyToken,isPaid,editPost);
export default router