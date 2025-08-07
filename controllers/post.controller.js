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
            cloudinaryPublicId: uploadResponse.public_id,
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


// /api/getpost
export const getPost = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const skip = parseInt(req.query.skip) || 0;

  try {
    const posts = await Post.find()
      .sort({ dateandtime: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Post.countDocuments(); // to check if more posts exist
    res.status(200).json({ posts, totalCount });
  } catch {
    res.status(500).json({ message: "Error getting posts" });
  }
};

export const getPostByUser = async (req,res)=>{
    try{
        const userId = req.user.id;
    
        const post = await Post.find({authorid: userId}).sort({ dateandtime: -1 })
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


export const deletePost = async (req, res) => {
    try {
        const { id } = req.params;

        // Find the post first
        const post = await Post.findById(id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

      
        // Delete image from Cloudinary
        await cloudinary.uploader.destroy(post.cloudinaryPublicId);

        // Delete post from database
        await Post.findByIdAndDelete(id);

        res.status(200).json({ message: 'Post and associated image deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ 
            message: 'Error deleting post', 
            error: error.message 
        });
    }
};

export const editPost = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, article, thumbnailImage, category } = req.body;
        // console.log(title, article, thumbnailImage, category, id)
        // Find the existing post
        const post = await Post.findById(id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        let updateData = {
            title,
            article,
            category
           
        };

        // Only process image if a new one was provided
        if (thumbnailImage && thumbnailImage !== post.thumbnailImage) {
            // Delete old image from Cloudinary
           
            await cloudinary.uploader.destroy(post.cloudinaryPublicId);

            // Upload new image
            const uploadResponse = await cloudinary.uploader.upload(thumbnailImage, {
                folder: 'blog-images'
            });

            updateData.thumbnailImage = uploadResponse.secure_url;
            updateData.cloudinaryPublicId = uploadResponse.public_id;
        }

        // Update the post
        const updatedPost = await Post.findByIdAndUpdate(
            id,
            updateData,
            { new: true } // Return the updated document
        );

        res.status(200).json({ 
            message: 'Post updated successfully', 
            post: updatedPost 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Error updating post', 
            error: error.message 
        });
    }
};