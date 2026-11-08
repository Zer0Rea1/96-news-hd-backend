import { afterAll, beforeEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { createApp } from "../src/app";
const settings = { enabled: false, accounts: [], instructions: "", version: 1 };
import { applicationSchema, designationDetails, roleSchema, paymentSettingsSchema } from "../src/membership";
const owner = "11111111-1111-4111-8111-111111111111", uid = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const role = { id: "44444444-4444-4444-8444-444444444444", name: "رپورٹر", level: "city", fixed_province: null, fee: 4000, version: 1, active: true };
const input = { role_id: role.id, role_version: 1, name:"Applicant",father_name:"Applicant Father",phone:"03001234567",cnic:"3520212345671",address:"Private address",role:"رپورٹر",province:"Punjab",district:"Lahore",tehsil:"",city:"Lahore" };
let application: any = null, reporter: any = null, rpcError: any = null;
const calls: any[] = [];
const db = {
  auth: { admin: {
    listUsers: async (args: any) => { calls.push({listUsers:args}); return {data:{users:[{id:owner,email:"owner@example.test",email_confirmed_at:"2026-01-01",created_at:"2026-01-01",user_metadata:{secret:"never expose"}},{id:uid,email:"unfinished@example.test",created_at:"2026-01-02"}],total:2},error:null}; },
    deleteUser: async (id: string) => { calls.push({deleteUser:id}); return {error:null}; }
  }, getUser: async (token: string) => ({ data: { user: token === "invalid" ? null : { id: token === "owner" ? owner : uid, email:"member@example.test", email_confirmed_at: token === "unverified" ? null : "2026-01-01", user_metadata: { role:"admin" }, is_anonymous:token === "anonymous" } } }) },
  from(table: string) {
    const filters: Record<string,unknown> = {};
    const query: any = { select:()=>query, in:()=>query, single:()=>query.maybeSingle(), order:()=>query, then:(resolve: any)=>Promise.resolve({data:table === "membership_applications" ? (application ? [application] : []) : table === "reporters" ? (reporter ? [reporter] : []) : [role],error:null}).then(resolve), eq:(key: string,value: unknown)=>{filters[key]=value; return query;}, maybeSingle: async()=>({data: structuredClone(table === "membership_payment_settings" ? settings : table === "membership_roles" ? (filters.id && filters.id !== role.id ? null : role) : table === "reporters" ? reporter : application && (!filters.user_id || filters.user_id === application.user_id) ? application : null),error:null}) }; return query;
  },
  rpc: async (name: string,args: any) => { calls.push({name,args}); if(name === "save_membership_signup_form") return {data:{token:args.p_id,expires_at:"2099-01-01T00:00:00Z"},error:rpcError}; return {data: structuredClone({id,user_id:uid,details:input,status: name === "submit_membership_payment" ? "pending" : "awaiting_payment",fee:4000,photo_path:args.p_photo_path || null,proof_path:"private/path.webp",version:1}),error:rpcError}; },
  storage: { from:(name: string)=>({ upload:async(path: string)=>{calls.push({storage:name,path}); return {error:null};},remove:async(paths: string[])=>{calls.push({remove:paths}); return {error:null};},createSignedUrl:async(path: string,seconds: number)=>{calls.push({signed:path,seconds}); return {data:{signedUrl:"https://local.example.test/private?token=temporary"},error:null};} }) },
} as unknown as SupabaseClient;
const server=createApp({db,ownerId:owner,upload:async()=>"https://res.cloudinary.com/test/image/upload/a.webp"}).listen(0,"127.0.0.1");
await new Promise<void>(resolve=>server.listening?resolve():server.once("listening",resolve));
const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(()=>server.close());
beforeEach(()=>{application=null;reporter=null;rpcError=null;calls.length=0;settings.enabled=false;});
function request(path: string,token?: string,body?: unknown) { const form=body instanceof FormData; return fetch(origin+path,{method:body?"POST":"GET",headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body&&!form?{"Content-Type":"application/json"}: {})},body:body?(form?body:JSON.stringify(body)):undefined}); }
function saved(status="awaiting_payment") { return {id,user_id:uid,status,version:1,details:input,proof_path:"secret/receipt.webp",photo_path:"secret/portrait.webp"}; }
test("member identity requires verified Supabase Auth and never accepts the owner or anonymous identities",async()=>{
  for(const token of [undefined,"invalid"]) expect((await request("/api/member/application",token)).status).toBe(401);
  for(const token of ["unverified","owner","anonymous"]) expect((await request("/api/member/application",token)).status).toBe(403);
  expect((await request("/api/admin/applications","member")).status).toBe(403);
  expect(calls).toHaveLength(0);
});
test("members cannot choose price, approval, identity or access another applicant",async()=>{
  for(const field of [{fee:1},{status:"approved"},{user_id:owner},{reporter_id:id}]) expect((await request("/api/member/application","member",{...input,...field})).status).toBe(400);
  const created=await request("/api/member/application","member",input);expect(created.status).toBe(201);
  expect(calls[0].args).toMatchObject({p_role_id:role.id,p_role_version:1,p_user_id:uid,p_email:"member@example.test",p_details:{cnic:"35202-1234567-1",designation_area:"Lahore"}});
  expect(await created.json()).not.toHaveProperty("proof_path");
  application={...saved(),user_id:owner};expect(await (await request("/api/member/application?user_id="+owner,"member")).json()).toBeNull();
});
test("read responses omit private storage paths and unpaid members cannot read profile data",async()=>{
  application=saved();const body=await(await request("/api/member/application","member")).json();expect(body).not.toHaveProperty("proof_path");expect(body).not.toHaveProperty("photo_path");
  expect((await request("/api/member/profile","member")).status).toBe(403);
  expect((await request(`/api/admin/applications/${id}/proof`,"member")).status).toBe(403);
});
test("approved profile is selected by server mapping, never by a supplied reporter ID",async()=>{
  application={...saved("approved"),reporter_id:id};reporter={id,status:"active",issue_date:"2026-01-01",expiry_date:"2027-01-01"};
  const result=await(await request("/api/member/profile?id="+owner,"member")).json();expect(result.profile_url).toBe(`https://profile.96newshd.com/p/${id}`);
  reporter=null;expect((await request("/api/member/profile","member")).status).toBe(403);
});
test("closed payment collection refuses receipts without writing storage",async()=>{
  application=saved();const body=new FormData();body.set("version","1");expect((await request("/api/member/payment","member",body)).status).toBe(503);expect(calls).toHaveLength(0);
});
test("payment proof uses private storage and stale or duplicate uploads never write",async()=>{
  settings.enabled=true;application=saved();
  const image=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();
  function form(version="1") { const body=new FormData();body.set("version",version);body.set("proof",new Blob([image],{type:"image/png"}),"receipt.png");return body; }
  expect((await request("/api/member/payment","member",form("2"))).status).toBe(409);expect(calls).toHaveLength(0);
  const response=await request("/api/member/payment","member",form());expect(response.status).toBe(200);expect(calls[0].storage).toBe("membership-private");expect(calls[1].args).toMatchObject({p_user_id:uid,p_version:1});expect(await response.json()).not.toHaveProperty("proof_path");
  application=saved("pending");const count=calls.length;expect((await request("/api/member/payment","member",form())).status).toBe(409);expect(calls).toHaveLength(count);
});
test("failed payment save compensates only the new object",async()=>{
  settings.enabled=true;application=saved();rpcError={code:"40001"};const image=await sharp({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer();const body=new FormData();body.set("version","1");body.set("proof",new Blob([image],{type:"image/png"}),"proof.png");
  expect((await request("/api/member/payment","member",body)).status).toBe(409);expect(calls[2].remove).toEqual([calls[0].path]);expect(calls[0].path).not.toBe(application.proof_path);
});
test("owner receives only short-lived proof URLs and rejects client-controlled membership dates",async()=>{
  application=saved("pending");expect((await request(`/api/admin/applications/${id}/proof`,"owner")).status).toBe(200);expect(calls[0]).toEqual({signed:application.proof_path,seconds:60});
  expect((await request(`/api/admin/applications/${id}/decision`,"owner",{decision:"approve",version:1,father_name:"Father",expiry_date:"2099-01-01"})).status).toBe(400);
  expect((await request(`/api/admin/applications/${id}/decision`,"owner",{decision:"reject",version:1,reason:""})).status).toBe(400);
});
test("designation area follows the requested role and CNIC is normalized",()=>{
  expect(designationDetails(applicationSchema.parse(input),role)).toMatchObject({cnic:"35202-1234567-1",designation_area:"Lahore"});
  expect(()=>designationDetails(applicationSchema.parse({...input,tehsil:""}),{...role,level:"tehsil"})).toThrow();
  expect(designationDetails(applicationSchema.parse({...input,district:"",city:""}),{...role,level:"province",fixed_province:"Punjab"}).designation_area).toBe("پنجاب");
  expect(()=>designationDetails(applicationSchema.parse({...input,province:"Sindh"}),{...role,level:"province",fixed_province:"Punjab"})).toThrow();
});

test("owner role management rejects untrusted fields, invalid prices, unknown levels and member access",async()=>{
  const roleInput={name:"New role",level:"district",fee:5000,fixed_province:null,active:true};
  expect(roleSchema.safeParse(roleInput).success).toBe(true);
  for(const value of [{...roleInput,fee:-1},{...roleInput,fee:1.5},{...roleInput,level:"admin"},{...roleInput,is_admin:true}]) expect(roleSchema.safeParse(value).success).toBe(false);
  expect((await request("/api/admin/membership/roles","member",roleInput)).status).toBe(403);
  expect((await request("/api/admin/membership/roles","owner",roleInput)).status).toBe(201);
  expect(calls.at(-1).args.p_actor).toBe(owner);
  expect((await request("/api/member/application","member",{...input,role_version:2})).status).toBe(409);
});

test("claimed image MIME types cannot bypass content validation",async()=>{
 settings.enabled=true; application=saved();
 for(const content of ['not an image','<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>']) {
  const body=new FormData();body.set("version","1");body.set("proof",new Blob([content],{type:"image/png"}),"disguised.png");
  expect((await request("/api/member/payment","member",body)).status).toBe(400);
 }
 expect(calls).toHaveLength(0);
});

test("only owner may edit payment settings and enabled collection needs a receiving account",async()=>{
 const value={enabled:true,accounts:[{name:"Test bank",number:"TEST ONLY",title:"Test receiver"}],instructions:"Upload sample receipt",version:1};
 expect(paymentSettingsSchema.safeParse(value).success).toBe(true);
 expect(paymentSettingsSchema.safeParse({...value,accounts:[]}).success).toBe(false);
 expect(paymentSettingsSchema.safeParse({...value,accounts:[{...value.accounts[0],number:""}]}).success).toBe(false);
 expect((await request("/api/admin/membership/payment-settings","member")).status).toBe(403);
 const response=await fetch(origin+"/api/admin/membership/payment-settings",{method:"PUT",headers:{Authorization:"Bearer owner","Content-Type":"application/json"},body:JSON.stringify(value)});
 expect(response.status).toBe(200); expect(calls.at(-1).args).toMatchObject({p_actor:owner,p_input:value});
});

import { credentialStatus } from "../src/profiles/domain";
test("unpaid membership revokes a card at the exact deadline while legacy cards keep their own dates", () => {
 const r={status:"active" as const,issue_date:"2026-01-01",expiry_date:"2027-01-01",membership_expires_at:"2026-11-07T12:00:00Z"};
 expect(credentialStatus(r,"2026-11-07",Date.parse("2026-11-07T11:59:59Z"))).toBe("active");
 expect(credentialStatus(r,"2026-11-07",Date.parse(r.membership_expires_at))).toBe("revoked");
 expect(credentialStatus({...r,membership_expires_at:null},"2026-11-07")).toBe("active");
});

test("account directory includes incomplete users, excludes auth metadata and remains owner-only", async () => {
 expect((await request("/api/admin/accounts","member")).status).toBe(403);
 const response=await request("/api/admin/accounts?page=2","owner"); expect(response.status).toBe(200);
 const data=await response.json(); expect(data.total).toBe(2); expect(data.accounts[1]).toMatchObject({email:"unfinished@example.test",email_verified:false,application_status:null});
 expect(JSON.stringify(data)).not.toMatch(/never expose|user_metadata|identities/);
 expect(calls.at(-1)).toEqual({listUsers:{page:2,perPage:50}});
 expect((await request("/api/admin/accounts?page=bad","owner")).status).toBe(400);
});
test("only owner can delete a login and the owner account is protected", async () => {
 for (const [token,target,status] of [["member",uid,403],["owner",owner,403],["owner","bad",400],["owner",uid,204]] as const) {
  const response=await fetch(origin+"/api/admin/accounts/"+target,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}}); expect(response.status).toBe(status);
 }
 expect(calls).toEqual([{deleteUser:uid}]);
});
test("an existing CNIC is rejected before any application or upload is created",async()=>{
 reporter={id}; const response=await request("/api/member/application","member",input); expect(response.status).toBe(409); expect(calls).toHaveLength(0);
});

test("role change accepts only a versioned role selection, binds identity and cannot change area or price",async()=>{
 const payload={version:1,role_id:role.id,role_version:1};
 expect((await request("/api/member/designation-change","owner",payload)).status).toBe(403);
 for(const field of [{city:"Karachi"},{designation_area:"Karachi"},{fee:1},{user_id:owner},{expiry_date:"2099-01-01"}]) expect((await request("/api/member/designation-change","member",{...payload,...field})).status).toBe(400);
 expect((await request("/api/member/designation-change","member",payload)).status).toBe(200);
 expect(calls.at(-1)).toEqual({name:"request_member_designation",args:{p_user_id:uid,p_version:1,p_role_id:role.id,p_role_version:1}});
 rpcError={code:"40001"};expect((await request("/api/member/designation-change","member",payload)).status).toBe(409);
});
test("free renewal is owner-only, versioned and requires a reason without arbitrary dates",async()=>{
 const path=`/api/admin/applications/${id}/renew`, payload={version:1,reason:"Owner waiver"};
 expect((await request(path,"member",payload)).status).toBe(403);
 expect((await request(path,"owner",{...payload,expiry_date:"2099-01-01"})).status).toBe(400);
 expect((await request(path,"owner",{...payload,reason:""})).status).toBe(400);
 expect((await request(path,"owner",payload)).status).toBe(200);
 expect(calls.at(-1)).toMatchObject({name:"renew_membership_without_payment",args:{p_id:id,p_actor:owner,p_version:1,p_reason:"Owner waiver"}});
});

test("signup form is validated and stored privately before Auth with server fee and no passwords",async()=>{
 function form(details:any=input){const body=new FormData();body.set("details",JSON.stringify(details));body.set("email","NEW@example.test");return body;}
 for(const details of [{...input,father_name:""},{...input,fee:1},{...input,status:"approved"}])expect((await request("/api/membership/signup-form",undefined,form(details))).status).toBe(400);
 const response=await request("/api/membership/signup-form",undefined,form());expect(response.status).toBe(201);const data=await response.json();expect(data.token).toMatch(/^[0-9a-f-]{36}$/);expect(data).not.toHaveProperty("details");expect(data).not.toHaveProperty("photo_path");
 expect(calls.at(-1)).toMatchObject({name:"save_membership_signup_form",args:{p_email:"new@example.test",p_role_id:role.id,p_role_version:1,p_details:{name:"Applicant",phone:"03001234567",father_name:"Applicant Father"}}});
});
test("admin can see an unverified applicant's submitted phone before payment or profile creation",async()=>{
 application={user_id:uid,status:"awaiting_payment",details:{name:"Unverified applicant",phone:"03001234567"}};
 const data=await(await request("/api/admin/accounts","owner")).json();expect(data.accounts.find((a:any)=>a.id===uid)).toMatchObject({name:"Unverified applicant",phone:"03001234567",email_verified:false,application_status:"awaiting_payment",reporter_id:null});
});
