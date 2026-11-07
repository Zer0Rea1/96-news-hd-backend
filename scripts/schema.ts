import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { databaseClient, reportFailure } from "./database.js";
async function main() {
  const owner = z.uuid().parse(process.env.OWNER_USER_ID);
  const migrations = await Promise.all(["001_news", "002_membership", "003_membership_periods", "004_membership_changes", "005_reporter_serials"].map(async version => {
    const sql = await readFile(new URL(`../db/schema/${version}.sql`, import.meta.url), "utf8");
    return { version, sql, hash: createHash("sha256").update(sql).digest("hex") };
  }));
  if (!process.argv.includes("--apply")) {
    console.log({ migrations: migrations.map(({ version, hash }) => ({ version, hash })), applied: false, next: "Run with --apply only after backup and review." });
    return;
  }
  const db = databaseClient(); await db.connect();
  try {
    await db.query("begin");
    await db.query("select pg_advisory_xact_lock(hashtext('96news-schema'))");
    await db.query("create table if not exists public.news_schema_migrations(version text primary key, hash text not null, applied_at timestamptz not null default now())");
    await db.query("alter table public.news_schema_migrations enable row level security; revoke all on public.news_schema_migrations from public,anon,authenticated,service_role");
    for (const { version, sql, hash } of migrations) {
      const prior = await db.query("select hash from public.news_schema_migrations where version=$1", [version]);
      if (prior.rows.length) {
        if (prior.rows[0].hash !== hash) throw new Error("Migration checksum changed");
        continue;
      }
      if (version === "001_news") {
        const profiles = await db.query("select to_regclass('public.reporters') as table_name");
        if (!profiles.rows[0].table_name) {
          for (const file of ["reporters.sql", "activity_log.sql", "photo_assets.sql"])
            await db.query(await readFile(new URL("../db/schema/" + file, import.meta.url), "utf8"));
        } else {
          const existing = await db.query("select to_regclass('public.activity_log') is not null and to_regclass('public.photo_assets') is not null as ready");
          if (!existing.rows[0].ready) throw new Error("Apply the existing profile schema upgrades first");
        }
      }
      await db.query("select set_config('news.owner_id',$1,true)", [owner]);
      await db.query(sql);
      await db.query("insert into public.news_schema_migrations(version,hash) values($1,$2)", [version, hash]);
    }
    await db.query("notify pgrst, 'reload schema'"); await db.query("commit");
    console.log({ migrations: migrations.map(m => m.version), applied: true, ownerBound: true });
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
main().catch(reportFailure);
