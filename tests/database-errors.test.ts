import { afterEach, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { databaseClient, safeFailure } from "../scripts/database";
const original = process.env.DATABASE_URL;
afterEach(() => { if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original; });
test("database failures retain the actionable cause without credentials", () => {
  process.env.DATABASE_URL = "postgresql://user:p%40ssword@db.example/postgres";
  expect(safeFailure(new Error("Connection terminated unexpectedly")).message).toBe("Connection terminated unexpectedly");
  const result = JSON.stringify(safeFailure(new Error("Failed postgresql://user:p%40ssword@db.example/postgres p@ssword p%40ssword")));
  expect(result).not.toContain("p@ssword");
  expect(result).not.toContain("p%40ssword");
  expect(result).not.toContain("postgresql://");
  expect(safeFailure({ code: "28P01", message: "password authentication failed" }).code).toBe("28P01");
  expect(safeFailure(null).message).toBe("Operation failed");
});

test("remote PostgreSQL verifies Supabase's CA while local test databases stay local", () => {
  process.env.DATABASE_URL = "postgresql://user:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
  const remote = databaseClient();
  const ssl = (remote as any).connectionParameters.ssl;
  expect(ssl.rejectUnauthorized).toBe(true);
  expect(new X509Certificate(ssl.ca).fingerprint256).toBe("80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  process.env.DATABASE_URL = "postgresql://user@127.0.0.1:5432/test";
  expect((databaseClient() as any).connectionParameters.ssl).toBe(false);
});
