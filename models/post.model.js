import mongoose from "mongoose";
import date from '../utils/dateFormater.js';

const formateDate = date();
const postSchema = new mongoose.Schema({

    title: {
        type: String,
        required: true
    },

    article: {
        type: String,
        required: true
    },

    thumbnailImage: {
        type: String,
        required: true
    },

    category: {
        type: String,
        required: true
    },

    author: {
        type: String,
        required: true,
    },

    dateandtime: {
        type: Date,
    },

    formatedDate: {
        type: String
    }

});
const Post = mongoose.model("Post", postSchema);
export default Post;
