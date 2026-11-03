import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
test("Netlify's Node adapter preserves the platform IP and protects owner routes", async () => {
  await mkdir(".netlify", { recursive: true });
  const directory = await mkdtemp(resolve(".netlify/adapter-test-"));
  try {
    const build = await Bun.build({ entrypoints: ["netlify/functions/index.js"], target: "node", format: "cjs", external: ["sharp"] });
    expect(build.success).toBe(true);
    const bundle = directory + "/index.cjs";
    await writeFile(bundle, Buffer.from(await build.outputs[0]!.arrayBuffer()));
    const result = spawnSync("node", ["-e", `
      const assert = require('node:assert/strict');
      const { handler } = require(${JSON.stringify(bundle)});
      (async () => {
        const event = {path:'/api/health',httpMethod:'GET',headers:{'x-nf-client-connection-ip':'203.0.113.5'},body:null,isBase64Encoded:false};
        const response = await handler(event, {});
        assert.equal(response.statusCode, 200);
        assert.equal(JSON.parse(response.body).ready, true);
        assert.equal(event.requestContext.identity.sourceIp, '203.0.113.5');
        const badIP = {...event,headers:{'x-nf-client-connection-ip':'not-an-ip'},requestContext:{identity:{sourceIp:'198.51.100.5'}}};
        assert.equal((await handler(badIP,{})).statusCode,200);
        assert.equal(badIP.requestContext.identity.sourceIp,'198.51.100.5');
        assert.equal((await handler({...event,path:'/api/admin/news/posts'},{})).statusCode,401);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { encoding: "utf8", env: { ...process.env, NETLIFY: "true", NODE_ENV: "production", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", OWNER_USER_ID: "11111111-1111-4111-8111-111111111111", CLOUDINARY_CLOUD_NAME: "test", CLOUDINARY_API_KEY: "test", CLOUDINARY_API_SECRET: "test" } });
    if (result.status !== 0) console.error(result.stderr);
    expect(result.status).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
