/**
 * Local smoke: expects Postgres migrated and PORT free.
 * Usage: npm run smoke
 */
import { SignJWT } from "jose";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const key = new TextEncoder().encode(
  process.env.AUTH_DEV_SIGNING_KEY ?? "RecipeHub-Dev-Signing-Key-At-Least-32-Chars!",
);
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(`smoke-${Date.now()}`)
  .setIssuer(process.env.AUTH_DEV_ISSUER ?? "recipehub-dev")
  .setAudience(process.env.AUTH_DEV_AUDIENCE ?? "recipehub")
  .setExpirationTime("15m")
  .sign(key);

const port = process.env.PORT ?? "3102";
const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const onData = (b: Buffer) => {
  if (b.toString().includes(port)) ready = true;
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

for (let i = 0; i < 50 && !ready; i++) await sleep(200);
if (!ready) {
  console.error("Server did not become ready");
  child.kill("SIGTERM");
  process.exit(1);
}

const base = `http://127.0.0.1:${port}`;
const health = await fetch(`${base}/health`);
console.log("health", health.status);

const create = await fetch(`${base}/households`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ size: 2, budgetSoft: 80 }),
});
const created = (await create.json()) as {
  household: { id: string; size: number };
  seedSkipped: boolean;
};
console.log("create", create.status, "seedSkipped=", created.seedSkipped);

const id = created.household.id;
const put = await fetch(`${base}/households/${id}/pantry`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    items: [
      {
        ingredientId: "11111111-1111-1111-1111-111111110001",
        quantity: 500,
        unit: "g",
      },
    ],
  }),
});
console.log("put pantry", put.status);

const conflict = await fetch(`${base}/households`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ size: 3 }),
});
console.log("second create", conflict.status);

child.kill("SIGTERM");
await sleep(300);

const ok = create.ok && put.ok && conflict.status === 409;
process.exit(ok ? 0 : 1);
