// Isolated local Postgres only: never reads DATABASE_URL or connects to a hosted project.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
const directory = await mkdtemp(join(tmpdir(), "96news-membership-"));
function command(name: string, args: string[], input?: string) {
  const result = spawnSync(name, args, { encoding: "utf8", input });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error}`);
  return result.stdout;
}
const socket = createServer(); await new Promise<void>(resolve => socket.listen(0,"127.0.0.1",resolve));
const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
let started = false;
try {
  command("initdb",["-D",join(directory,"db"),"-A","trust","--no-locale","-E","UTF8"]);
  command("pg_ctl",["-D",join(directory,"db"),"-l",join(directory,"postgres.log"),"-o",`-h 127.0.0.1 -p ${port} -k ${directory}`,"-w","start"]);
  started = true;
  const sql = (value: string) => command("psql",["-h","127.0.0.1","-p",String(port),"-d","postgres","-v","ON_ERROR_STOP=1"],value);
  sql(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    grant usage on schema auth to supabase_auth_admin; grant insert,select on auth.users to supabase_auth_admin;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant select,insert on storage.objects to authenticated;
    create policy legacy_broad_policy on storage.objects for all to authenticated using(true) with check(true);
    insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');`);
  for (const file of ["reporters.sql","activity_log.sql","photo_assets.sql","001_news.sql","002_membership.sql","003_membership_periods.sql","004_membership_changes.sql","005_reporter_serials.sql","006_signup_forms.sql","007_role_renewal_fees.sql","008_card_renewal_system.sql","009_editable_reporter_serials.sql","010_news_author_editing.sql"])
  {
    if(file === "005_reporter_serials.sql") sql(`insert into public.reporters(name,father_name,designation,city,cnic,contact,whatsapp,address,issue_date,expiry_date,serial_number) values('Legacy','Father','Reporter','Lahore','35202-1111111-1','03001234567','03001234567','Private','2026-01-01','2027-01-01','96N/900/2027'),('Unassigned','Father','Reporter','Lahore','35202-1111111-2','03001234567','03001234567','Private','2026-01-01','2027-01-01','');`);
    sql((file === "005_reporter_serials.sql" ? "begin;\n" : "") + "select set_config('news.owner_id','11111111-1111-4111-8111-111111111111',false);\n" + await readFile(new URL("../db/schema/" + file,import.meta.url),"utf8") + (file === "005_reporter_serials.sql" ? "\ncommit;" : ""));
    if(file === "005_reporter_serials.sql") sql(`do $$ begin assert (select serial_number='96N/900/2027' from public.reporters where cnic='35202-1111111-1'); assert (select serial_number='96N/901/2027' from public.reporters where cnic='35202-1111111-2'); end $$; delete from public.reporters where cnic in ('35202-1111111-1','35202-1111111-2');`);
  }
  for (const file of ["news.sql","membership.sql","membership_changes.sql","serials.sql","signup.sql"]) sql(await readFile(new URL("../tests/" + file,import.meta.url),"utf8"));
  console.log("Local Postgres: news, membership transactions, privacy, duplicate approval and existing-profile preservation passed.");
} finally {
  if (started) command("pg_ctl",["-D",join(directory,"db"),"-m","fast","-w","stop"]);
  await rm(directory,{ recursive:true,force:true });
}
