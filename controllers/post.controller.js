import Post from '../models/post.model.js';
import formatedDate from '../utils/dateFormater.js'
const formatedate = formatedDate();
export const newPost = async (req, res) => {
    const { title, artical, thumbnailImage, category, author } = req.body;

    try {
        const newPost = new Post({
            title,
            artical,
            thumbnailImage,
            category,
            author,
            dateandtime: new Date(),
            formatedDate: formatedate // or use your date formatting function
        });

        await newPost.save();
        res.status(201).json({ message: 'Post created successfully', post: newPost });
    } catch (error) {
        res.status(500).json({ message: 'Error creating post', error: error.message });
    }
};
