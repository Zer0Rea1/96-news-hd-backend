import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { localSettings } from "../scripts/local-setup";
test("local setup accepts only localhost project settings and keeps private keys out of frontend settings", () => {
  const status = { api: { url: "http://127.0.0.1:54321", publishable_key: "sb_publishable_test", secret_key: "sb_secret_test" }, db: { url: "postgresql://postgres:local@127.0.0.1:54322/postgres" } };
  expect(localSettings(status)).toMatchObject({url:status.api.url,database:status.db.url,publishable:"sb_publishable_test",secret:"sb_secret_test"});
  expect(()=>localSettings({...status,db:{url:"postgresql://postgres:private@production.example/postgres"}})).toThrow("not local");
  expect(()=>localSettings({...status,api:{...status.api,url:"https://production.supabase.co"}})).toThrow("not local");
});
test("local runtime refuses a hosted Auth URL before creating clients", () => {
  const result=spawnSync("bun",["-e","import('./src/runtime.ts')"],{encoding:"utf8",env:{...process.env,NODE_ENV:"development",LOCAL_ONLY:"true",SUPABASE_URL:"https://production.supabase.co",DATABASE_URL:"postgresql://local@127.0.0.1/local"},timeout:15000});
  expect(result.status).not.toBe(0);expect(result.stderr).toContain("SUPABASE_URL must point to localhost");
},20000);
