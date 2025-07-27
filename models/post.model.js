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

    authorid: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    dateandtime: {
        type: Date,
    }

});
const Post = mongoose.model("Post", postSchema);
export default Post;
