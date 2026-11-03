import { isIP } from "node:net";
import serverless from "serverless-http";
import app from "../../src/runtime.ts";
const api = serverless(app);
export function handler(event, context) {
  const ip = event.headers?.["x-nf-client-connection-ip"];
  if (isIP(ip || "")) {
    event.requestContext = { ...event.requestContext, identity: { ...event.requestContext?.identity, sourceIp: ip } };
  }
  return api(event, context);
}
