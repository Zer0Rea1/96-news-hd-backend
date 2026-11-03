import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { databaseClient, reportFailure } from "./database.js";
async function main() {
  const owner = z.uuid().parse(process.env.OWNER_USER_ID);
  const sql = await readFile(new URL("../db/schema/001_news.sql", import.meta.url), "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  if (!process.argv.includes("--apply")) { console.log({ migration: "001_news", hash, applied: false, next: "Run with --apply after backup and review." }); return; }
  const db = databaseClient();
  await db.connect();
  try {
    await db.query("begin");
    await db.query("select pg_advisory_xact_lock(hashtext('96news-schema'))");
    await db.query("create table if not exists public.news_schema_migrations(version text primary key, hash text not null, applied_at timestamptz not null default now())");
    await db.query("alter table public.news_schema_migrations enable row level security; revoke all on public.news_schema_migrations from public,anon,authenticated,service_role");
    const prior = await db.query("select hash from public.news_schema_migrations where version=$1", ["001_news"]);
    if (prior.rows.length) {
      if (prior.rows[0].hash !== hash) throw new Error("Migration checksum changed");
    } else {
      const profiles = await db.query("select to_regclass('public.reporters') as table_name");
      if (!profiles.rows[0].table_name) {
        for (const file of ["reporters.sql", "activity_log.sql", "photo_assets.sql"]) await db.query(await readFile(new URL("../db/schema/" + file, import.meta.url), "utf8"));
      } else {
        const existing = await db.query("select to_regclass('public.activity_log') is not null and to_regclass('public.photo_assets') is not null as ready");
        if (!existing.rows[0].ready) throw new Error("Apply the existing profile schema upgrades first");
      }
      await db.query("select set_config('news.owner_id',$1,true)", [owner]);
      await db.query(sql);
      await db.query("insert into public.news_schema_migrations(version,hash) values($1,$2)", ["001_news", hash]);
    }
    await db.query("notify pgrst, 'reload schema'");
    await db.query("commit");
    console.log({ migration: "001_news", applied: true, ownerBound: true });
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
main().catch(reportFailure);
