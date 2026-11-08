import type { SupabaseClient } from "@supabase/supabase-js";
export async function cleanupSignupForms(db: SupabaseClient) {
  const { data, error } = await db.rpc("claim_signup_form_cleanup");
  if (error) throw error;
  let deleted = 0, failed = 0;
  for (const form of data || []) {
    try {
      if (form.photo_path) {
        if (!form.photo_path.startsWith(`signup/${form.id}/`)) throw new Error("Invalid signup portrait path");
        const { error } = await db.storage.from("membership-private").remove([form.photo_path]);
        if (error) throw error;
      }
      const { error } = await db.from("membership_signup_forms").delete().eq("id", form.id);
      if (error) throw error;
      deleted++;
    } catch { failed++; }
  }
  return { deleted, failed };
}
