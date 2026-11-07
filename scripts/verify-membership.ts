import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { AddressInfo } from "node:net";
import { databaseClient } from "./database.js";
if (process.env.LOCAL_ONLY !== "true" || !["localhost","127.0.0.1"].includes(new URL(process.env.SUPABASE_URL || "https://invalid").hostname)) throw new Error("Local settings are required; hosted verification is forbidden.");
const { services } = await import("../src/runtime.js");
const { createApp } = await import("../src/app.js");
assert(services, "Run local:setup first");
const db = databaseClient(); await db.connect();
const before = await db.query("select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') as rows from public.reporters r");
const frontendEnv = await readFile(new URL("../../96-news-hd-frontend/main/.env.local",import.meta.url),"utf8");
const publicKey = frontendEnv.match(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1]; assert(publicKey);
const client = () => createClient(process.env.SUPABASE_URL!,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
const applicant=client(), ownerAuth=client();
const owner=JSON.parse(await readFile(new URL("../.netlify/local-owner.json",import.meta.url),"utf8"));
const server=createApp(services).listen(0,"127.0.0.1");
await new Promise<void>(resolve=>server.listening?resolve():server.once("listening",resolve));
const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let userId: string | undefined, applicationId: string | undefined, reporterId: string | undefined;
let paths: string[]=[];
async function request(path: string,token: string,body?: unknown) {
  const form=body instanceof FormData;
  return fetch(origin+path,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${token}`,...(body&&!form?{"Content-Type":"application/json"}:{})},body:body?(form?body:JSON.stringify(body)):undefined});
}
try {
  const email=`local-smoke-${randomUUID()}@96newshd.test`,password=randomBytes(24).toString("base64url");
  const signup=await applicant.auth.signUp({email,password}); assert.equal(signup.error,null); assert(signup.data.user); userId=signup.data.user.id;
  assert.equal(signup.data.session,null,"Local signup must require email confirmation");
  assert((await applicant.auth.signInWithPassword({email,password})).error,"Unconfirmed signup must not sign in");
  // This fixture confirms the test email; the browser flow uses the local Mailpit link.
  assert.equal((await services.db.auth.admin.updateUserById(userId,{email_confirm:true})).error,null);
  const signed=await applicant.auth.signInWithPassword({email,password}); assert.equal(signed.error,null); const token=signed.data.session!.access_token;
  const ownerSigned=await ownerAuth.auth.signInWithPassword({email:owner.email,password:owner.password});assert.equal(ownerSigned.error,null); const ownerToken=ownerSigned.data.session!.access_token;
  const catalog=await(await fetch(origin+"/api/membership/options")).json();assert(catalog.roles.length > 0);
  const role=catalog.roles.find((r: any)=>r.level==="city" && !r.fixed_province);assert(role,"Keep a city-level role available for this smoke test");
  const details={name:"Local smoke applicant",phone:"03001234567",cnic:`99999-${String(Date.now()).slice(-7)}-9`,address:"Test-only private address",role:role.name,role_id:role.id,role_version:role.version,province:"Punjab",district:"Lahore",tehsil:"",city:"Lahore"};
  assert.equal((await request("/api/member/application",token,{...details,fee:1})).status,400);
  const image=await sharp({create:{width:10,height:10,channels:3,background:"white"}}).png().toBuffer();
  const form=new FormData();form.set("details",JSON.stringify(details));form.set("photo",new Blob([image],{type:"image/png"}),"portrait.png");
  const created=await request("/api/member/application",token,form);assert.equal(created.status,201,await created.clone().text());let a=await created.json();applicationId=a.id;assert.equal(a.fee,role.fee);assert(!a.proof_path&&!a.photo_path);
  assert.equal((await request("/api/member/profile",token)).status,403);assert.equal((await request("/api/admin/membership/roles",token)).status,403);
  const raw=await applicant.from("membership_applications").select("*");assert(raw.error,"Members must not read tables directly");
  async function receipt(version: number) {const body=new FormData();body.set("version",String(version));body.set("proof",new Blob([image],{type:"image/png"}),"sample-receipt.png");return request("/api/member/payment",token,body);}
  let paid=await receipt(a.version);assert.equal(paid.status,200,await paid.clone().text());a=await paid.json();assert.equal(a.status,"pending");
  const privateRow=await services.db.from("membership_applications").select("proof_path,photo_path").eq("id",applicationId).single();assert.equal(privateRow.error,null);paths.push(privateRow.data!.proof_path,privateRow.data!.photo_path);
  const publicUrl=services.db.storage.from("membership-private").getPublicUrl(privateRow.data!.proof_path).data.publicUrl;assert.notEqual((await fetch(publicUrl)).status,200,"Receipt must not have a public URL");
  const proofResponse=await request(`/api/admin/applications/${a.id}/proof`,ownerToken);assert.equal(proofResponse.status,200);const proof=await proofResponse.json();assert.equal((await fetch(proof.url)).status,200);
  const rejected=await request(`/api/admin/applications/${a.id}/decision`,ownerToken,{decision:"reject",version:a.version,reason:"Local test rejection"});assert.equal(rejected.status,200,await rejected.clone().text());a=await rejected.json();
  paid=await receipt(a.version);assert.equal(paid.status,200,await paid.clone().text());a=await paid.json();
  const approved=await request(`/api/admin/applications/${a.id}/decision`,ownerToken,{decision:"approve",version:a.version,father_name:"Test Father"});assert.equal(approved.status,200,await approved.clone().text());const approvedBody=await approved.json();reporterId=approvedBody.reporter_id;assert(reporterId);
  assert.equal((await request(`/api/admin/applications/${a.id}/decision`,ownerToken,{decision:"approve",version:a.version,father_name:"Test Father"})).status,409);
  const profile=await request("/api/member/profile",token);assert.equal(profile.status,200);const account=await profile.json();assert.equal(account.reporter.id,reporterId);assert.equal((Date.parse(account.membership.expiry_date)-Date.parse(account.membership.issue_date))/86400000,30);assert.equal(account.profile_url,`https://profile.96newshd.com/p/${reporterId}`);
  const publicProfile=await(await fetch(origin+`/api/profiles/${reporterId}`)).json();assert(!publicProfile.cnic&&!publicProfile.address,"Public profile must omit private identity data");
  console.log("PASS: real local Supabase signup/confirmation, role quote, private uploads, owner rejection/resubmission/approval, permanent profile, member access and public privacy.");
} finally {
  if (applicationId) {
    const row=await db.query("select proof_path,photo_path from public.membership_applications where id=$1",[applicationId]);
    paths.push(...row.rows.flatMap(r=>[r.proof_path,r.photo_path]).filter(Boolean));
    await db.query("delete from public.membership_reviews where application_id=$1",[applicationId]);
    await db.query("delete from public.membership_applications where id=$1",[applicationId]);
  }
  if(reporterId){
    const row=await db.query("select photo_url from public.reporters where id=$1",[reporterId]);
    const url=row.rows[0]?.photo_url;if(url) await services.db.storage.from("local-reporter-portraits").remove([new URL(url).pathname.split("/").pop()!]);
    await db.query("delete from public.activity_log where reporter_id=$1",[reporterId]);await db.query("delete from public.reporters where id=$1",[reporterId]);
  }
  if(paths.length)await services.db.storage.from("membership-private").remove([...new Set(paths)]);
  if(userId)await services.db.auth.admin.deleteUser(userId);
  const after=await db.query("select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') as rows from public.reporters r");assert.deepEqual(after.rows,before.rows,"Existing reporter data must be identical after the test");
  await applicant.auth.signOut();await ownerAuth.auth.signOut();await db.end();await new Promise<void>(resolve=>server.close(()=>resolve()));
}
