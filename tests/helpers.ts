import { SignJWT } from "jose";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";

export async function requireTestDb(): Promise<{ db: Db; databaseUrl: string } | null> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://pantrypilot:pantrypilot@localhost:5434/pantrypilot";
  const probe = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await probe.connect();
    await probe.end();
  } catch {
    return null;
  }
  await migrate(databaseUrl);
  const db = createPool(databaseUrl);
  return { db, databaseUrl };
}

export async function mintDevToken(sub: string): Promise<string> {
  const config = loadConfig();
  const key = new TextEncoder().encode(config.auth.devSigningKey);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(config.auth.devIssuer)
    .setAudience(config.auth.devAudience)
    .setExpirationTime("30m")
    .sign(key);
}

export async function waitUntil(
  predicate: () => Promise<boolean>,
  opts?: { timeoutMs?: number; intervalMs?: number; label?: string },
): Promise<void> {
  const timeoutMs = Math.max(1, opts?.timeoutMs ?? 20000);
  const intervalMs = Math.max(50, opts?.intervalMs ?? 250);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${opts?.label ?? "condition"}`);
}
