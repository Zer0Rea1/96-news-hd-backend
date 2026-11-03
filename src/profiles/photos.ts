import type { SupabaseClient } from "@supabase/supabase-js";

interface UploadedPhoto { url: string; publicId: string }
interface PhotoServices {
  db: SupabaseClient;
  cloudName: string;
  upload: (buffer: Buffer) => Promise<UploadedPhoto>;
  destroy: (publicId: string) => Promise<{ result: string }>;
}

export function createPhotoManager({ db, cloudName, upload, destroy }: PhotoServices) {
  if (!/^[a-zA-Z0-9_-]+$/.test(cloudName)) throw new Error("Invalid image cloud configuration.");
  function managed(photo: UploadedPhoto) {
    if (!/^96news\/reporters\/[a-zA-Z0-9_-]+$/.test(photo.publicId)) return false;
    try {
      const url = new URL(photo.url);
      return url.origin === "https://res.cloudinary.com" && !url.search && !url.hash &&
        !url.username && !url.password &&
        new RegExp(`^/${cloudName}/image/upload/v[0-9]+/${photo.publicId}[.]webp$`).test(url.pathname);
    } catch { return false; }
  }
  return {
    async upload(buffer: Buffer) {
      const photo = await upload(buffer);
      if (!managed(photo)) throw new Error("The uploaded photo was not in the managed image folder.");
      const { error } = await db.from("photo_assets").insert({ public_id: photo.publicId, url: photo.url });
      if (error) {
        // Do not compensate a duplicate ID: it may already belong to an existing reporter.
        if (error.code !== "23505") {
          try {
            const result = await destroy(photo.publicId);
            if (!["ok", "not found"].includes(result.result)) throw new Error("Photo cleanup failed.");
          } catch {
            // shortcut: if registration and compensation both fail, inspect Cloudinary for this failed upload.
            throw new Error("The photo could not be registered or cleaned up.");
          }
        }
        throw error;
      }
      return photo.url;
    },
    async cleanup(priorUrl?: string) {
      const { data, error } = await db.rpc("claim_photo_cleanup", { p_prior_url: priorUrl || null, p_limit: 25 });
      if (error) throw error;
      let deleted = 0, failed = 0;
      for (const asset of (data ?? []).slice(0, 25) as { public_id: string; url: string }[]) {
        try {
          if (!managed({ publicId: asset.public_id, url: asset.url })) throw new Error("Unmanaged photo.");
          const result = await destroy(asset.public_id);
          if (!["ok", "not found"].includes(result.result)) throw new Error("Photo cleanup failed.");
          const { error } = await db.from("photo_assets").update({ status: "deleted" })
            .eq("public_id", asset.public_id).eq("status", "deleting");
          if (error) throw error;
          deleted++;
        } catch {
          // Keep the deleting tombstone: a timed-out Cloudinary request may already have removed the image.
          failed++;
        }
      }
      return { deleted, failed };
    },
  };
}
