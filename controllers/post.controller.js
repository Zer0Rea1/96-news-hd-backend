import Post from '../models/post.model.js';
import formatedDate from '../utils/dateFormater.js'
import { v2 as cloudinary } from 'cloudinary';
import User from '../models/user.model.js';
const formatedate = formatedDate();


export const newPost = async (req, res) => {
    const { title, article, thumbnailImage, category, authorid } = req.body;
  
    try {

        const uploadResponse = await cloudinary.uploader.upload(thumbnailImage, {
              folder: 'blog-images'
        });


        const newPost = new Post({
            title,
            article,
            thumbnailImage: uploadResponse.secure_url,
            category,
            authorid,
            dateandtime: new Date()
            // formatedDate: formatedate // or use your date formatting function
        });

        await newPost.save();
        res.status(201).json({ message: 'Post created successfully', post: newPost });
    } catch (error) {
        res.status(500).json({ message: 'Error creating post', error: error.message });
    }
};


export const getPost = async (req,res)=>{
    try{
        const post = await Post.find();
        res.status(200).json(post)
    } catch {
        res.status(500).json({message:"Error getting post"})
    }
}
export const getPostByUser = async (req,res)=>{
    try{
        const userId = req.user.id;
    
        const post = await Post.find({authorid: userId})
        res.status(200).json(post)
    } catch {
        res.status(500).json({message:"Error getting post"})
    }
}

export const getPostbyid = async (req,res)=>{
    try{
        const postId = req.params.id;
        const post = await Post.findById(postId)
        const user = await User.findById(post.authorid)
        const authorname = user.username
        res.status(200).json({post,authorname})
        
    }catch{
        res.status(500).json({message:"Error getting post"})
    }
}