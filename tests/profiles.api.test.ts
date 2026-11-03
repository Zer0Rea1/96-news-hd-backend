import { afterAll, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createApp } from "../src/app";
import { reporterFixtures } from "./fixtures";
const row = reporterFixtures[0]!;
const { id, card_number, created_at, updated_at, ...input } = row;
let queryResult: { data: unknown; error: unknown; count?: number } = {
  data: row,
  error: null,
};
let accessed = 0;
let processed: Buffer | undefined;
let previousPhoto = "";
let cleanupFails = false;
const cleaned: string[] = [];
const filters: [string, ...unknown[]][] = [];
const chain: Record<string, unknown> = {};
for (const method of [
  "select",
  "eq",
  "neq",
  "range",
  "order",
  "insert",
  "update",
  "delete",
])
  chain[method] = (...args: unknown[]) => {
    filters.push([method, ...args]);
    return chain;
  };
chain.maybeSingle = chain.single = async () => queryResult;
chain.then = (resolve: (value: typeof queryResult) => void) =>
  Promise.resolve(queryResult).then(resolve);
const db = {
  auth: {
    getUser: async (token: string) =>
      token === "admin"
        ? { data: { user: { id: "11111111-1111-4111-8111-111111111111", email: "admin@96news.test", app_metadata: { role: "admin" } } }, error: null }
        : token === "member"
          ? {
              data: {
                user: { app_metadata: {}, user_metadata: { role: "admin" } },
              },
              error: null,
            }
          : { data: { user: null }, error: new Error("invalid") },
  },
  from: () => {
    accessed++;
    return chain;
  },
  rpc: async (name: string, params: unknown) => {
    accessed++;
    filters.push(["rpc", name, params]);
    return { error: queryResult.error, data: queryResult.data
      ? { reporter: queryResult.data, previous_photo_url: previousPhoto } : null };
  },
} as unknown as SupabaseClient;
const server = createApp({
  db,
  ownerId: "11111111-1111-4111-8111-111111111111",
  upload: async (buffer) => {
    processed = buffer;
    return "https://res.cloudinary.com/news/image/upload/a.webp";
  },
  cleanupPhotos: async (url) => {
    if (url) cleaned.push(url);
    if (cleanupFails) throw new Error("Cloud unavailable");
    return { deleted: 1, failed: 0 };
  },
}).listen(0, "127.0.0.1");
const setupServer = createApp().listen(0, "127.0.0.1");
await new Promise<void>((resolve) =>
  server.listening ? resolve() : server.once("listening", resolve),
);
await new Promise<void>((resolve) =>
  setupServer.listening ? resolve() : setupServer.once("listening", resolve),
);
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const setupOrigin = `http://127.0.0.1:${(setupServer.address() as AddressInfo).port}`;
afterAll(() => {
  server.close();
  setupServer.close();
});
function api(path: string, token?: string, body?: unknown, method?: string) {
  return fetch(`${origin}/api${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
describe("API boundaries", () => {
  test("health exposes configuration without secrets", async () =>
    expect(await (await fetch(`${setupOrigin}/api/health`)).json()).toEqual({
      ready: false,
    }));
  test("unconfigured API fails closed", async () =>
    expect((await fetch(`${setupOrigin}/api/admin/reporters`)).status).toBe(
      503,
    ));
  test("unauthenticated users cannot list, change or upload", async () => {
    const before = accessed;
    for (const [path, method] of [
      ["/admin/reporters", "GET"],
      ["/admin/reporters", "POST"],
      [`/admin/reporters/${id}`, "PUT"],
      [`/admin/reporters/${id}`, "DELETE"],
      ["/admin/photos", "POST"],
      ["/admin/photos/cleanup", "POST"],
      ["/admin/activity", "GET"],
      [`/admin/reporters/${id}/renew`, "POST"],
    ])
      expect((await api(path!, undefined, undefined, method)).status).toBe(401);
    expect(accessed).toBe(before);
  });
  test("user-editable metadata never grants administration", async () =>
    expect((await api("/admin/reporters", "member")).status).toBe(403));
  test("invalid token is rejected", async () =>
    expect((await api("/admin/reporters", "bad")).status).toBe(401));
  test("photo cleanup requires admin access and protects the scheduled endpoint", async () => {
    expect((await api("/admin/photos/cleanup", "member", undefined, "POST")).status).toBe(403);
    expect(await (await api("/admin/photos/cleanup", "admin", undefined, "POST")).json()).toEqual({ deleted: 1, failed: 0 });
    const original = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await api("/cron/photos")).status).toBe(401);
      process.env.CRON_SECRET = "test-cron-secret";
      expect((await api("/cron/photos", "wrong-secret")).status).toBe(401);
      expect(await (await api("/cron/photos", "test-cron-secret")).json()).toEqual({ deleted: 1, failed: 0 });
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  });
  test("removed photo attachment conflicts do not expose database errors", async () => {
    queryResult = { data: null, error: { code: "55000", message: "private database details" } };
    const response = await api(`/admin/reporters/${id}`, "admin", input, "PUT");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This photo is no longer available. Upload it again.");
  });
  test("public response strips private fields and forbids caching", async () => {
    queryResult = { data: row, error: null };
    const response = await api(`/profiles/${id}`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.cnic).toBeUndefined();
    expect(data.address).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(filters).toContainEqual(["neq", "status", "draft"]);
  });
  test("missing and invalid profiles return 404", async () => {
    queryResult = { data: null, error: null };
    expect((await api(`/profiles/${id}`)).status).toBe(404);
    expect((await api("/profiles/not-an-id")).status).toBe(404);
  });
  test("contact link opens inline and exports only escaped contact details", async () => {
    queryResult = {
      data: { ...row, name: "علی, خان;\\\r\nTEL:injected", whatsapp: "03001234567", show_sensitive: true },
      error: null,
    };
    const response = await api(`/profiles/${id}/contact.vcf`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="96news-${id}.vcf"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const content = await response.text();
    expect(content).toContain("FN:علی\\, خان\\;\\\\\\nTEL:injected\r\n");
    expect(content).toContain(`TEL;TYPE=WORK:${row.contact}\r\n`);
    expect(content).toContain("TEL;TYPE=CELL:03001234567\r\n");
    expect(content).toContain(`ADR;TYPE=WORK:;;;${row.city};;;Pakistan\r\n`);
    expect(content).toEndWith("END:VCARD\r\n");
    expect(content).not.toContain("\r\nTEL:injected");
    expect(content).not.toContain(row.cnic);
    expect(content).not.toContain(row.address);
    expect(content).not.toContain(row.father_name);
  });
  test("contact export avoids duplicate numbers in different formats", async () => {
    queryResult = { data: { ...row, contact: "+92 300 1234567", whatsapp: "03001234567" }, error: null };
    const response = await api(`/profiles/${id}/contact.vcf`);
    expect((await response.text()).match(/^TEL;/gm)).toHaveLength(1);
  });
  test("contact links reject missing, invalid and inactive profiles", async () => {
    const before = accessed;
    expect((await api("/profiles/bad/contact.vcf")).status).toBe(404);
    expect(accessed).toBe(before);
    queryResult = { data: null, error: null };
    expect((await api(`/profiles/${id}/contact.vcf`)).status).toBe(404);
    for (const changes of [
      { status: "draft" },
      { status: "revoked" },
      { expiry_date: "2000-01-01" },
      { issue_date: "2999-01-01" },
    ]) {
      queryResult = { data: { ...row, ...changes }, error: null };
      expect((await api(`/profiles/${id}/contact.vcf`)).status).toBe(404);
    }
  });
  test("admin gets sensitive record and paginated query", async () => {
    queryResult = { data: [row], error: null, count: 1 };
    const response = await api("/admin/reporters?page=2", "admin");
    expect(response.status).toBe(200);
    expect((await response.json()).reporters[0].cnic).toBe(row.cnic);
    expect(filters).toContainEqual(["range", 100, 199]);
    expect((await api("/admin/reporters?page=0", "admin")).status).toBe(400);
  });
  test("create validates and returns inserted record", async () => {
    queryResult = { data: row, error: null };
    expect(
      (await api("/admin/reporters", "admin", { ...input, cnic: "bad" }))
        .status,
    ).toBe(400);
    expect((await api("/admin/reporters", "admin", input)).status).toBe(201);
    expect(filters).toContainEqual(["rpc", "mutate_reporter", {
      p_action: "create", p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_actor_email: "admin@96news.test", p_reporter_id: null, p_input: input,
    }]);
    expect(
      (await api("/admin/reporters", "admin", { ...input, id })).status,
    ).toBe(400);
  });
  test("activity history is admin-only and paginated", async () => {
    queryResult = { data: [{ id: "event", action: "created", changed_fields: ["name"] }], error: null, count: 51 };
    expect((await api("/admin/activity", "member")).status).toBe(403);
    const response = await api("/admin/activity?page=2", "admin");
    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(51);
    expect(filters).toContainEqual(["range", 50, 99]);
    expect((await api("/admin/activity?page=0", "admin")).status).toBe(400);
  });
  test("renewal validates dates, preserves identity and maps conflicts", async () => {
    const renewal = { issue_date: "2026-10-26", expiry_date: "2028-12-31" };
    queryResult = { data: { ...row, ...renewal }, error: null };
    const response = await api(`/admin/reporters/${id}/renew`, "admin", renewal);
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(id);
    expect(filters).toContainEqual(["rpc", "mutate_reporter", {
      p_action: "renew", p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_actor_email: "admin@96news.test", p_reporter_id: id, p_input: renewal,
    }]);
    expect((await api(`/admin/reporters/${id}/renew`, "admin", { ...renewal, issue_date: "2026-02-30" })).status).toBe(400);
    expect((await api(`/admin/reporters/${id}/renew`, "admin", { ...renewal, status: "active" })).status).toBe(400);
    queryResult = { data: null, error: { code: "P0001", message: "private database text" } };
    const rejected = await api(`/admin/reporters/${id}/renew`, "admin", renewal);
    expect(rejected.status).toBe(409);
    expect(await rejected.text()).not.toContain("private database text");
    queryResult = { data: null, error: null };
    expect((await api(`/admin/reporters/${id}/renew`, "admin", renewal)).status).toBe(404);
  });
  test("duplicate CNIC returns conflict", async () => {
    queryResult = { data: null, error: { code: "23505" } };
    expect((await api("/admin/reporters", "admin", input)).status).toBe(409);
  });
  test("updates existing record and handles missing records", async () => {
    queryResult = { data: row, error: null };
    expect(
      (await api(`/admin/reporters/${id}`, "admin", input, "PUT")).status,
    ).toBe(200);
    queryResult = { data: null, error: null };
    expect(
      (await api(`/admin/reporters/${id}`, "admin", input, "PUT")).status,
    ).toBe(404);
  });
  test("deletion uses a validated ID", async () => {
    queryResult = { data: { id }, error: null };
    expect(
      (await api(`/admin/reporters/${id}`, "admin", undefined, "DELETE"))
        .status,
    ).toBe(204);
    expect(
      (await api("/admin/reporters/bad", "admin", undefined, "DELETE")).status,
    ).toBe(400);
  });
  test("photo replacement and deletion defer cleanup failures without failing a saved mutation", async () => {
    const old = "https://res.cloudinary.com/news/image/upload/old.webp";
    previousPhoto = old;
    queryResult = { data: row, error: null };
    const before = cleaned.length;
    expect((await api(`/admin/reporters/${id}`, "admin", input, "PUT")).status).toBe(200);
    expect(cleaned.slice(before)).toEqual([old]);
    queryResult = { data: { ...row, photo_url: old }, error: null };
    expect((await api(`/admin/reporters/${id}`, "admin", { ...input, photo_url: old }, "PUT")).status).toBe(200);
    expect(cleaned.length).toBe(before + 1);
    cleanupFails = true;
    expect((await api(`/admin/reporters/${id}`, "admin", undefined, "DELETE")).status).toBe(204);
    expect(cleaned.length).toBe(before + 2);
    previousPhoto = "";
    cleanupFails = false;
  });
  test("database errors do not expose internals", async () => {
    queryResult = {
      data: null,
      error: { code: "XX000", message: "secret database connection" },
    };
    const response = await api(`/profiles/${id}`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
  test("invalid photos are rejected based on content", async () => {
    const body = new FormData();
    body.append(
      "photo",
      new Blob(["not an image"], { type: "image/jpeg" }),
      "fake.jpg",
    );
    const response = await fetch(`${origin}/api/admin/photos`, {
      method: "POST",
      headers: { Authorization: "Bearer admin" },
      body,
    });
    expect(response.status).toBe(400);
  });
  test("rejects uploads above the Vercel-compatible limit", async () => {
    const body = new FormData();
    body.append(
      "photo",
      new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
      "oversized.jpg",
    );
    const response = await fetch(`${origin}/api/admin/photos`, {
      method: "POST",
      headers: { Authorization: "Bearer admin" },
      body,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "Compressed images must be smaller than 4 MB.",
    );
  });
  test("photo pipeline resizes and produces WebP", async () => {
    const buffer = await sharp({
      create: { width: 1600, height: 2000, channels: 3, background: "#bd292c" },
    })
      .jpeg()
      .toBuffer();
    const body = new FormData();
    body.append(
      "photo",
      new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }),
      "portrait.jpg",
    );
    const response = await fetch(`${origin}/api/admin/photos`, {
      method: "POST",
      headers: { Authorization: "Bearer admin" },
      body,
    });
    expect(response.status).toBe(201);
    const metadata = await sharp(processed!).metadata();
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(1000);
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
  });
});
