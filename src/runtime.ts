import { createClient } from "@supabase/supabase-js";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { createApp, type Services } from "./app.js";
import { createPhotoManager } from "./profiles/photos.js";
const keys = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "OWNER_USER_ID", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const ready = keys.every(key => Boolean(process.env[key])) && z.uuid().safeParse(process.env.OWNER_USER_ID).success;
if (!ready && (process.env.NODE_ENV === "production" || Boolean(process.env.NETLIFY))) throw new Error("Missing or invalid API configuration: " + keys.filter(key => !process.env[key]).join(", "));
let services: Services | undefined;
if (ready) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
  function uploadImage(buffer: Buffer, folder: string): Promise<{url: string; publicId: string}> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "image", format: "webp", overwrite: false }, (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve({ url: result.secure_url, publicId: result.public_id });
      });
      stream.end(buffer);
    });
  }
  const photos = createPhotoManager({ db, cloudName: process.env.CLOUDINARY_CLOUD_NAME!, upload: buffer => uploadImage(buffer, "96news/reporters"), destroy: id => cloudinary.uploader.destroy(id, { invalidate: true }) });
  services = { db, ownerId: process.env.OWNER_USER_ID!, cloudName: process.env.CLOUDINARY_CLOUD_NAME!, upload: photos.upload, cleanupPhotos: photos.cleanup,
    // shortcut: news thumbnails are retained after replacement/deletion; add tracked cleanup when storage volume warrants it.
    uploadNews: async buffer => (await uploadImage(buffer, "96news/posts")).url };
}
export default createApp(services);

export { services };
