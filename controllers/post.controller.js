import Post from '../models/post.model.js';
import formatedDate from '../utils/dateFormater.js'
const formatedate = formatedDate();


export const newPost = async (req, res) => {
    const { title, article, thumbnailImage, category, author } = req.body;
  
    try {
        const newPost = new Post({
            title,
            article,
            thumbnailImage,
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
        res.status(201).json(post)
    } catch {
        res.ststus(500).json({message:"Error getting post"})
    }
}