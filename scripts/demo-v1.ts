/**
 * PantryPilot v1 demo — PLAN.md demo script (steps 1–5 fully automated).
 * Step 6 (RecipeHub create → event → projection) is attempted when RecipeHub
 * is reachable; otherwise printed as a manual handoff.
 *
 * Usage: npm run demo
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "../src/config.js";
import { starterProjectionEvents } from "../src/fixtures/recipes.js";
import { mintDevToken, waitUntil } from "../tests/helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.DEMO_PORT ?? "3130";
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
      KAFKA_ENABLED: process.env.KAFKA_ENABLED ?? "false",
      BULLMQ_ENABLED: process.env.BULLMQ_ENABLED ?? "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntil(healthOk, { timeoutMs: 45000, label: "demo API" });
  return child;
}

async function seedProjection(headers: Record<string, string>) {
  const prefix = `demo-${Date.now()}`;
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
    const h = await (await fetch(`${base}/health`)).json() as {
      activeRecipeProjections: number;
    };
    return h.activeRecipeProjections >= 5;
  }, { timeoutMs: 20000, label: "demo projections" });
}

function logStep(n: number, title: string, detail?: unknown) {
  console.log(`\n=== ${n}. ${title} ===`);
  if (detail !== undefined) console.log(detail);
}

async function main() {
  const child = await ensureServer();
  const token = await mintDevToken(`demo-${Date.now()}`);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  await seedProjection(headers);

  // 1. Create household (skip pantry seed)
  logStep(1, "Create household (size 2, budget, horizon 3) — skip pantry seed");
  const create = await fetch(`${base}/households`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      size: 2,
      budgetSoft: 80,
      planHorizonDays: 3,
    }),
  });
  const created = (await create.json()) as {
    household: { id: string };
    seedSkipped: boolean;
    pantry: unknown[];
  };
  if (!create.ok) throw new Error(JSON.stringify(created));
  const householdId = created.household.id;
  console.log({ householdId, seedSkipped: created.seedSkipped, pantryItems: created.pantry.length });

  // 2. Generate plan → shop-heavy list
  logStep(2, "Generate plan → shop-heavy list (empty pantry)");
  const planRes = await fetch(`${base}/households/${householdId}/plans`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const plan1 = (await planRes.json()) as {
    plan: { id: string; projectionStale: boolean };
    meals: Array<{ mealDate: string; slot: string; recipeTitle: string }>;
    shoppingList: { id: string };
    shoppingItems: Array<{ id: string; ingredientName: string; quantity: number; unit: string }>;
    degraded: { banners: string[]; activeRecipeCount: number };
  };
  if (!planRes.ok) throw new Error(JSON.stringify(plan1));
  console.log({
    meals: plan1.meals.length,
    shoppingLines: plan1.shoppingItems.length,
    sampleMeals: plan1.meals.slice(0, 2),
    sampleShop: plan1.shoppingItems.slice(0, 3),
    degraded: plan1.degraded,
  });

  // 3. Check off purchases → pantry filled
  logStep(3, "Check off purchases → pantry restocked");
  const check = await fetch(
    `${base}/households/${householdId}/shopping-lists/${plan1.shoppingList.id}/checkoffs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ itemIds: plan1.shoppingItems.map((i) => i.id) }),
    },
  );
  const checked = (await check.json()) as {
    pantry: Array<{ ingredientName?: string; ingredientId: string; quantity: number }>;
    newlyChecked: unknown[];
  };
  if (!check.ok) throw new Error(JSON.stringify(checked));
  console.log({
    newlyChecked: checked.newlyChecked.length,
    pantryCount: checked.pantry.length,
  });

  // 4. Confirm cooked → pantry reduced
  logStep(4, "Confirm cooked (all) → pantry depleted");
  const confirm = await fetch(
    `${base}/households/${householdId}/plans/${plan1.plan.id}/confirm`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ outcome: "all" }),
    },
  );
  const confirmed = (await confirm.json()) as {
    confirmation: { outcome: string };
    pantry: unknown[];
  };
  if (!confirm.ok) throw new Error(JSON.stringify(confirmed));
  console.log({
    outcome: confirmed.confirmation.outcome,
    pantryAfterConfirm: confirmed.pantry.length,
  });

  // 5. Next plan → pantry-aware
  logStep(5, "Generate next plan → pantry-aware choices");
  const plan2Res = await fetch(`${base}/households/${householdId}/plans`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const plan2 = (await plan2Res.json()) as {
    meals: Array<{ recipeTitle: string; score: number }>;
    shoppingItems: unknown[];
  };
  if (!plan2Res.ok) throw new Error(JSON.stringify(plan2));
  console.log({
    meals: plan2.meals.map((m) => ({ title: m.recipeTitle, score: m.score })),
    shoppingLines: plan2.shoppingItems.length,
  });

  // 6. RecipeHub handoff (no write proxy in PantryPilot)
  logStep(6, "Add custom recipe via RecipeHub (not PantryPilot)");
  const config = loadConfig();
  try {
    const ping = await fetch(`${config.recipeHubBaseUrl}/recipes?take=1`);
    if (ping.ok) {
      console.log(
        "RecipeHub is reachable at",
        config.recipeHubBaseUrl,
        "— create a recipe with JWT + Idempotency-Key there;",
        "with KAFKA_ENABLED=true the event lands in recipe_projections for the next plan.",
      );
      console.log(
        "See ../recipe-hub/README.md and docs/integration.md. PantryPilot does not publish recipe.* events.",
      );
    } else {
      console.log("RecipeHub HTTP not healthy; skip live create. Documented in docs/integration.md.");
    }
  } catch {
    console.log(
      "RecipeHub not running — step 6 is manual: POST to RecipeHub, consume lifeatlas.recipe.created.",
    );
  }

  console.log("\nDEMO_V1_OK");
  if (child) {
    child.kill("SIGTERM");
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
