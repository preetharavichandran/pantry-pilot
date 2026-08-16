/**
 * Week 2 HTTP smoke against a live API (starts one if PORT is free).
 * Seeds projections via Dev ingest endpoint (no Kafka required).
 * Usage: npm run smoke:week2
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { FIXTURE_IDS, starterProjectionEvents } from "../src/fixtures/recipes.js";
import { mintDevToken, waitUntil } from "../tests/helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.SMOKE_PORT ?? "3102";
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
    env: { ...process.env, PORT: port, KAFKA_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntil(healthOk, { timeoutMs: 30000, label: "API /health" });
  return child;
}

async function main() {
  const child = await ensureServer();
  const sub = `smoke-w2-${Date.now()}`;
  const token = await mintDevToken(sub);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const prefix = `smoke-${Date.now()}`;
  for (const event of starterProjectionEvents(prefix)) {
    const res = await fetch(`${base}/dev/recipe-events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`seed event failed ${res.status}: ${await res.text()}`);
    }
  }
  await waitUntil(async () => {
    const h = await fetch(`${base}/health`);
    const body = (await h.json()) as { activeRecipeProjections: number };
    return body.activeRecipeProjections >= 5;
  }, { timeoutMs: 20000, label: "projections available" });
  console.log("seeded projections via /dev/recipe-events");

  const create = await fetch(`${base}/households`, {
    method: "POST",
    headers,
    body: JSON.stringify({ size: 2, budgetSoft: 80, planHorizonDays: 3 }),
  });
  const created = (await create.json()) as { household: { id: string } };
  console.log("create", create.status);
  if (!create.ok) throw new Error(JSON.stringify(created));
  const id = created.household.id;

  const pantry = await fetch(`${base}/households/${id}/pantry`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      items: [{ ingredientId: FIXTURE_IDS.oats, quantity: 500, unit: "g" }],
    }),
  });
  console.log("pantry", pantry.status);
  if (!pantry.ok) throw new Error(await pantry.text());

  const planRes = await fetch(`${base}/households/${id}/plans`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const planBody = (await planRes.json()) as {
    plan: { id: string };
    meals: Array<{ id: string; mealDate: string }>;
    shoppingItems: unknown[];
  };
  console.log("plan", planRes.status, "meals=", planBody.meals?.length);
  if (!planRes.ok) throw new Error(JSON.stringify(planBody));
  if (planBody.meals.length !== 6) throw new Error("expected 6 meals");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planBody.meals[0]!.mealDate)) {
    throw new Error(`bad mealDate ${planBody.meals[0]!.mealDate}`);
  }

  const shop = await fetch(`${base}/households/${id}/shopping-lists/current`, { headers });
  console.log("shopping", shop.status);
  if (!shop.ok) throw new Error(await shop.text());

  const replace = await fetch(
    `${base}/households/${id}/plans/${planBody.plan.id}/meals/${planBody.meals[0]!.id}/replace`,
    { method: "POST", headers, body: "{}" },
  );
  console.log("replace", replace.status);
  if (!replace.ok) throw new Error(await replace.text());

  console.log("SMOKE_WEEK2_OK");
  if (child) {
    child.kill("SIGTERM");
    await sleep(400);
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
