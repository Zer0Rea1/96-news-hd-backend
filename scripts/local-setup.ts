import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export function localSettings(status: unknown) {
const entries: { path: string; value: string }[] = [];
function collect(value: unknown, path = "") {
  if (typeof value === "string") entries.push({ path, value });
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) collect(child, `${path}.${key}`);
}
collect(status);
const url = entries.find(item => /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/.test(item.value))?.value;
const database = entries.find(item => /^postgres(?:ql)?:\/\//.test(item.value))?.value;
const publishable = entries.find(item => item.value.startsWith("sb_publishable_"))?.value || entries.find(item => /anon.?key/i.test(item.path))?.value;
const secret = entries.find(item => item.value.startsWith("sb_secret_"))?.value || entries.find(item => /service.?role.?key/i.test(item.path))?.value;
if (!url || !database || !publishable || !secret || !["127.0.0.1", "localhost"].includes(new URL(database).hostname)) throw new Error("Local CLI settings are incomplete or are not local. No changes made.");
return { url, database, publishable, secret };
}
async function main() {
const root = fileURLToPath(new URL("../", import.meta.url));
const status = spawnSync("bunx", ["--bun", "supabase", "status", "--output", "json"], { cwd: root, encoding: "utf8" });
if (status.status !== 0) throw new Error("Start local Supabase with bun run local:start first.");
const { url, database, publishable, secret } = localSettings(JSON.parse(status.stdout));
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const ownerFile = root + ".netlify/local-owner.json";
await mkdir(root + ".netlify", { recursive: true });
let owner: { id: string; email: string; password: string };
try { owner = JSON.parse(await readFile(ownerFile, "utf8")); }
catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await db.auth.admin.createUser({ email: "local-owner@96newshd.test", password, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create the isolated local owner account. No remote account was used.");
  owner = { id: data.user.id, email: "local-owner@96newshd.test", password };
  await writeFile(ownerFile, JSON.stringify(owner, null, 2) + "\n", { mode: 0o600 });
}
const check = await db.auth.admin.getUserById(owner.id);
if (check.error || check.data.user?.email !== owner.email) throw new Error("The stored local owner does not match local Auth.");
async function envFile(file: string, values: Record<string,string>) {
  try { await copyFile(file, file + ".before-local.local", 1); } catch (e) { if (!["ENOENT","EEXIST"].includes((e as NodeJS.ErrnoException).code || "")) throw e; }
  await writeFile(file, Object.entries(values).map(([key,value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
}
await envFile(root + ".env.local", { LOCAL_ONLY: "true", NODE_ENV: "development", PORT: "3001", SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, OWNER_USER_ID: owner.id, DATABASE_URL: database });
for (const app of ["main", "admin", "profile"]) {
  const prefix = app === "main" ? "NEXT_PUBLIC_" : "VITE_";
  await envFile(root + `../96-news-hd-frontend/${app}/.env.local`, { API_URL: "http://127.0.0.1:3001", [prefix + "SUPABASE_URL"]: url, [prefix + "SUPABASE_PUBLISHABLE_KEY"]: publishable, ...(app === "main" ? { NEXT_PUBLIC_PROFILE_ORIGIN: "http://localhost:5175", NEXT_PUBLIC_ANALYTICS_ENABLED: "false" } : { VITE_WEBSITE_ORIGIN: "http://localhost:3000" }) });
}
process.env.LOCAL_ONLY = "true"; process.env.DATABASE_URL = database;
process.env.OWNER_USER_ID = owner.id;
const migration = spawnSync("bun", ["--env-file=.env.local", "scripts/schema.ts", "--apply"], { cwd: root, encoding: "utf8", env: { ...process.env, SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret } });
if (migration.status !== 0) throw new Error("Local schema setup failed. See bun run db:local for the safe diagnostic.");
const { error: bucketError } = await db.storage.createBucket("local-reporter-portraits", { public: true, allowedMimeTypes: ["image/webp"], fileSizeLimit: 4194304 });
if (bucketError && !/already exists/i.test(bucketError.message)) throw new Error("Could not create local approved portrait storage.");
const configured = await db.from("membership_payment_settings").select("version,accounts").eq("singleton", true).single();
if (configured.error) throw new Error("Local payment settings are unavailable");
if (!(configured.data.accounts as { number: string }[]).some(account => account.number === "TEST ONLY")) {
  const saved = await db.rpc("save_membership_payment_settings", { p_actor: owner.id, p_input: { version: configured.data.version, enabled: true, accounts: [{ name: "Local test — do not send money", number: "TEST ONLY", title: "Upload a sample receipt; no transfer is required." }], instructions: "Local testing only. Do not send money." } });
  if (saved.error) throw new Error("Could not configure local sample payments");
}
console.log("Local setup ready. API: http://localhost:3001; email inbox: http://localhost:54324. Local owner login is in .netlify/local-owner.json. No production data was accessed.");

}
if (import.meta.main) main().catch(error => { console.error({ error: error.name, message: error.message.replace(/(?:postgres(?:ql)?):\/\/[^\s]+/g, "[database URL redacted]") }); process.exitCode = 1; });
