import {expect,test} from "bun:test";
import {cleanupSignupForms} from "../src/signup-cleanup";
test("abandoned signup cleanup removes only claimed portrait paths and retains failed work for retry",async()=>{
 const removed:string[]=[];const deleted:string[]=[];
 const db:any={rpc:async()=>({data:[{id:"a",photo_path:"signup/a/photo.webp"},{id:"b",photo_path:"someone-elses/photo.webp"},{id:"c",photo_path:null}],error:null}),storage:{from:()=>({remove:async(paths:string[])=>{removed.push(...paths);return {error:null};}})},from:()=>({delete:()=>({eq:async(_key:string,id:string)=>{deleted.push(id);return {error:null};}})})};
 expect(await cleanupSignupForms(db)).toEqual({deleted:2,failed:1});expect(removed).toEqual(["signup/a/photo.webp"]);expect(deleted).toEqual(["a","c"]);
});
