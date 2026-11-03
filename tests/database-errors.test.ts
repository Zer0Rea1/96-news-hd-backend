import { afterEach, expect, test } from "bun:test";
import { safeFailure } from "../scripts/database";
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
