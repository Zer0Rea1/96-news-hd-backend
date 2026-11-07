import { afterAll, beforeEach, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { createApp } from "../src/app";
const settings = { enabled: false, accounts: [], instructions: "", version: 1 };
import { applicationSchema, designationDetails, roleSchema, paymentSettingsSchema } from "../src/membership";
const owner = "11111111-1111-4111-8111-111111111111", uid = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const role = { id: "44444444-4444-4444-8444-444444444444", name: "رپورٹر", level: "city", fixed_province: null, fee: 4000, version: 1, active: true };
const input = { role_id: role.id, role_version: 1, name:"Applicant",phone:"03001234567",cnic:"3520212345671",address:"Private address",role:"رپورٹر",province:"Punjab",district:"Lahore",tehsil:"",city:"Lahore" };
let application: any = null, reporter: any = null, rpcError: any = null;
const calls: any[] = [];
const db = {
  auth: { getUser: async (token: string) => ({ data: { user: token === "invalid" ? null : { id: token === "owner" ? owner : uid, email:"member@example.test", email_confirmed_at: token === "unverified" ? null : "2026-01-01", user_metadata: { role:"admin" }, is_anonymous:token === "anonymous" } } }) },
  from(table: string) {
    const filters: Record<string,unknown> = {};
    const query: any = { select:()=>query, single:()=>query.maybeSingle(), order:()=>query, then:(resolve: any)=>Promise.resolve({data:[role],error:null}).then(resolve), eq:(key: string,value: unknown)=>{filters[key]=value; return query;}, maybeSingle: async()=>({data: structuredClone(table === "membership_payment_settings" ? settings : table === "membership_roles" ? (filters.id && filters.id !== role.id ? null : role) : table === "reporters" ? reporter : application && (!filters.user_id || filters.user_id === application.user_id) ? application : null),error:null}) }; return query;
  },
  rpc: async (name: string,args: any) => { calls.push({name,args}); return {data: structuredClone({id,user_id:uid,details:input,status: name === "submit_membership_payment" ? "pending" : "awaiting_payment",fee:4000,photo_path:args.p_photo_path || null,proof_path:"private/path.webp",version:1}),error:rpcError}; },
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
