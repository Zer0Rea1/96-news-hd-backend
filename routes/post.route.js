import express from 'express'
import {newPost, getPost} from '../controllers/post.controller.js'


const router = express.Router();


router.post('/newpost', newPost)
router.get('/getpost', getPost)
export default router