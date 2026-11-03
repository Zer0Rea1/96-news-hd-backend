import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPhotoManager } from "../src/profiles/photos";

const photo = { publicId: "96news/reporters/example", url: "https://res.cloudinary.com/news/image/upload/v123/96news/reporters/example.webp" };
function setup(options: {
  uploaded?: typeof photo;
  assets?: { public_id: string; url: string }[];
  insertError?: { code: string };
  rpcError?: { code: string };
  updateError?: { code: string };
  destroyResult?: string;
  destroyFails?: boolean;
} = {}) {
  const inserted: unknown[] = [], updated: unknown[] = [], removed: string[] = [], claims: unknown[] = [], filters: unknown[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("photo_assets");
      return {
        insert: async (row: unknown) => { inserted.push(row); return { error: options.insertError ?? null }; },
        update: (row: unknown) => {
          updated.push(row);
          const chain = {
            eq: (key: string, value: string) => { filters.push([key, value]); return chain; },
            then: (resolve: (result: unknown) => void) => resolve({ error: options.updateError ?? null }),
          };
          return chain;
        },
      };
    },
    rpc: async (name: string, args: unknown) => {
      expect(name).toBe("claim_photo_cleanup"); claims.push(args);
      return { data: options.assets ?? [], error: options.rpcError ?? null };
    },
  } as unknown as SupabaseClient;
  const manager = createPhotoManager({
    db, cloudName: "news",
    upload: async () => options.uploaded ?? photo,
    destroy: async id => {
      removed.push(id);
      if (options.destroyFails) throw new Error("Cloudinary timed out");
      return { result: options.destroyResult ?? "ok" };
    },
  });
  return { manager, inserted, updated, removed, claims, filters };
}

describe("managed reporter photos", () => {
  test("registers trusted newly uploaded assets before returning their URL", async () => {
    const { manager, inserted, removed } = setup();
    expect(await manager.upload(Buffer.from("image"))).toBe(photo.url);
    expect(inserted).toEqual([{ public_id: photo.publicId, url: photo.url }]);
    expect(removed).toEqual([]);
  });
  test.each([
    { ...photo, publicId: "other-folder/example" },
    { ...photo, url: photo.url.replace("/news/", "/someone-else/") },
    { ...photo, url: photo.url.replace("res.cloudinary.com", "res.cloudinary.com.evil.test") },
    { ...photo, url: photo.url + "?redirect=elsewhere" },
  ])("does not track or delete images outside the configured upload boundary", async uploaded => {
    const { manager, inserted, removed } = setup({ uploaded });
    await expect(manager.upload(Buffer.from("image"))).rejects.toThrow("managed image folder");
    expect(inserted).toEqual([]); expect(removed).toEqual([]);
  });
  test("failed registration compensates the new upload, but duplicate IDs are never deleted", async () => {
    const error = { code: "XX000" };
    const failed = setup({ insertError: error });
    await expect(failed.manager.upload(Buffer.from("image"))).rejects.toEqual(error);
    expect(failed.removed).toEqual([photo.publicId]);
    const duplicate = setup({ insertError: { code: "23505" } });
    await expect(duplicate.manager.upload(Buffer.from("image"))).rejects.toEqual({ code: "23505" });
    expect(duplicate.removed).toEqual([]);
  });
  test("reports when both registration and compensation fail", async () => {
    const { manager } = setup({ insertError: { code: "XX000" }, destroyFails: true });
    await expect(manager.upload(Buffer.from("image"))).rejects.toThrow("could not be registered or cleaned up");
  });
  test("deletes claimed assets and retains a tombstone to block stale form references", async () => {
    const { manager, removed, updated, claims, filters } = setup({ assets: [{ public_id: photo.publicId, url: photo.url }] });
    expect(await manager.cleanup(photo.url)).toEqual({ deleted: 1, failed: 0 });
    expect(removed).toEqual([photo.publicId]);
    expect(updated).toEqual([{ status: "deleted" }]);
    expect(filters).toEqual([["public_id", photo.publicId], ["status", "deleting"]]);
    expect(claims).toEqual([{ p_prior_url: photo.url, p_limit: 25 }]);
  });
  test("a previously deleted Cloudinary asset can finish an interrupted cleanup", async () => {
    const { manager, updated } = setup({ assets: [{ public_id: photo.publicId, url: photo.url }], destroyResult: "not found" });
    expect(await manager.cleanup()).toEqual({ deleted: 1, failed: 0 });
    expect(updated).toEqual([{ status: "deleted" }]);
  });
  test("a deletion timeout never reopens the asset for attachment", async () => {
    const { manager, updated } = setup({ assets: [{ public_id: photo.publicId, url: photo.url }], destroyFails: true });
    expect(await manager.cleanup()).toEqual({ deleted: 0, failed: 1 });
    expect(updated).toEqual([]);
  });
  test("untrusted or unknown cleanup results are left untouched", async () => {
    const outside = { public_id: "another-app/example", url: photo.url };
    const wrongCloud = { public_id: photo.publicId, url: photo.url.replace("/news/", "/other/") };
    const { manager, removed } = setup({ assets: [outside, wrongCloud] });
    expect(await manager.cleanup()).toEqual({ deleted: 0, failed: 2 });
    expect(removed).toEqual([]);
  });
  test("failed finalization keeps the claim for retry instead of releasing a deleted URL", async () => {
    const { manager, updated } = setup({ assets: [{ public_id: photo.publicId, url: photo.url }], updateError: { code: "XX000" } });
    expect(await manager.cleanup()).toEqual({ deleted: 0, failed: 1 });
    expect(updated).toEqual([{ status: "deleted" }]);
  });
  test("claim failures do not call Cloudinary and all batches are capped at 25", async () => {
    const failed = setup({ rpcError: { code: "XX000" } });
    await expect(failed.manager.cleanup()).rejects.toEqual({ code: "XX000" });
    expect(failed.removed).toEqual([]);
    const assets = Array.from({ length: 26 }, (_, i) => ({ public_id: `96news/reporters/id${i}`, url: `https://res.cloudinary.com/news/image/upload/v123/96news/reporters/id${i}.webp` }));
    const capped = setup({ assets });
    expect(await capped.manager.cleanup()).toEqual({ deleted: 25, failed: 0 });
    expect(capped.removed).toHaveLength(25);
  });
});
