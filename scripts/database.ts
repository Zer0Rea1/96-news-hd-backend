import { Client } from "pg";
export function databaseClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const url = new URL(process.env.DATABASE_URL);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  url.searchParams.delete("sslmode");
  return new Client({ connectionString: url.href, connectionTimeoutMillis: 10000, statement_timeout: 30000, ssl: local ? false : { rejectUnauthorized: true } });
}
export function safeFailure(error: unknown) {
  const value = error as { name?: string; code?: string; message?: string } | null;
  let message = typeof value?.message === "string" ? value.message : "Operation failed";
  const source = process.env.DATABASE_URL;
  if (source) {
    message = message.replaceAll(source, "[database URL redacted]");
    try {
      const url = new URL(source);
      for (const secret of new Set([url.password, decodeURIComponent(url.password)])) {
        if (secret) message = message.replaceAll(secret, "[redacted]");
      }
    } catch { /* Invalid URLs are already replaced above. */ }
  }
  message = message.replace(/(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, "[database URL redacted]");
  return { error: value?.name || "MigrationError", code: value?.code || "failed", message: message.slice(0, 500) };
}
export function reportFailure(error: unknown) {
  console.error(safeFailure(error));
  process.exitCode = 1;
}
