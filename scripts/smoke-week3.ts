/**
 * Week 3 closed loop smoke: seed → plan → check-off → confirm → re-plan.
 * Usage: npm run smoke:week3
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { FIXTURE_IDS, starterProjectionEvents } from "../src/fixtures/recipes.js";
import { mintDevToken, waitUntil } from "../tests/helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.SMOKE_PORT ?? "3123";
const base = `http://127.0.0.1:${port}`;

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await healthOk()) return null;
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: port,
      KAFKA_ENABLED: "false",
      BULLMQ_ENABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntil(healthOk, { timeoutMs: 45000, label: "API /health" });
  return child;
}

async function seedEvents(headers: Record<string, string>) {
  const prefix = `smoke3-${Date.now()}`;
  for (const event of starterProjectionEvents(prefix)) {
    const res = await fetch(`${base}/dev/recipe-events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`seed failed ${res.status}: ${await res.text()}`);
    }
  }
  await waitUntil(async () => {
    const h = await fetch(`${base}/health`);
    const body = (await h.json()) as { activeRecipeProjections: number };
    return body.activeRecipeProjections >= 5;
  }, { timeoutMs: 20000, label: "projections seeded" });
}

async function main() {
  const child = await ensureServer();
  const token = await mintDevToken(`smoke-w3-${Date.now()}`);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  await seedEvents(headers);

  const create = await fetch(`${base}/households`, {
    method: "POST",
    headers,
    body: JSON.stringify({ size: 2, planHorizonDays: 3 }),
  });
  const created = (await create.json()) as { household: { id: string } };
  if (!create.ok) throw new Error(JSON.stringify(created));
  const id = created.household.id;
  console.log("create", create.status);

  const planRes = await fetch(`${base}/households/${id}/plans`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const planBody = (await planRes.json()) as {
    plan: { id: string };
    meals: Array<{ id: string }>;
    shoppingList: { id: string };
    shoppingItems: Array<{ id: string }>;
  };
  console.log("plan", planRes.status, "items=", planBody.shoppingItems?.length);
  if (!planRes.ok) throw new Error(JSON.stringify(planBody));

  const checkIds = planBody.shoppingItems.map((i) => i.id);
  const check = await fetch(
    `${base}/households/${id}/shopping-lists/${planBody.shoppingList.id}/checkoffs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ itemIds: checkIds }),
    },
  );
  console.log("checkoff", check.status);
  if (!check.ok) throw new Error(await check.text());

  const confirm = await fetch(`${base}/households/${id}/plans/${planBody.plan.id}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      outcome: "all",
      leftovers: [{ ingredientId: FIXTURE_IDS.oats, quantity: 10, unit: "g" }],
    }),
  });
  console.log("confirm", confirm.status);
  if (!confirm.ok) throw new Error(await confirm.text());

  const replan = await fetch(`${base}/households/${id}/plans`, {
    method: "POST",
    headers,
    body: "{}",
  });
  console.log("replan", replan.status);
  if (!replan.ok) throw new Error(await replan.text());

  console.log("SMOKE_WEEK3_OK");
  if (child) {
    child.kill("SIGTERM");
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
