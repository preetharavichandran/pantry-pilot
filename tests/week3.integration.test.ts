import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/api/app.js";
import { starterProjectionEvents, FIXTURE_IDS } from "../src/fixtures/recipes.js";
import { RecipeEventIngestService } from "../src/integrations/recipeEvents.js";
import { mintDevToken, requireTestDb } from "./helpers.js";

test("Week 3 loop: check-off restock then confirm-cooked deplete", async (t) => {
  const ctx = await requireTestDb();
  if (!ctx) {
    t.skip("Postgres not available on DATABASE_URL");
    return;
  }
  const { db } = ctx;
  t.after(async () => {
    await db.end();
  });

  const ingest = new RecipeEventIngestService(db);
  for (const event of starterProjectionEvents(`w3-${Date.now()}`)) {
    await ingest.applyCloudEvent(event);
  }

  const config = loadConfig();
  config.kafka.enabled = false;
  config.bullmqEnabled = false;
  const app = await buildApp({
    config,
    db,
    recipeHub: {
      listIngredients: async () => [],
      listRecipes: async () => [],
      getRecipe: async () => null,
    },
    queues: null,
  });
  t.after(async () => {
    await app.close();
  });

  const token = await mintDevToken(`w3-${Date.now()}`);
  const auth = { authorization: `Bearer ${token}` };

  const create = await app.inject({
    method: "POST",
    url: "/households",
    headers: { ...auth, "content-type": "application/json" },
    payload: { size: 2, planHorizonDays: 3 },
  });
  assert.equal(create.statusCode, 201, create.body);
  const householdId = (create.json() as { household: { id: string } }).household.id;

  const plan = await app.inject({
    method: "POST",
    url: `/households/${householdId}/plans`,
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(plan.statusCode, 201, plan.body);
  const planBody = plan.json() as {
    plan: { id: string };
    meals: Array<{ id: string }>;
    shoppingList: { id: string };
    shoppingItems: Array<{ id: string; ingredientId: string; quantity: number }>;
  };

  const checkIds = planBody.shoppingItems.slice(0, 3).map((i) => i.id);
  const checkoff = await app.inject({
    method: "POST",
    url: `/households/${householdId}/shopping-lists/${planBody.shoppingList.id}/checkoffs`,
    headers: { ...auth, "content-type": "application/json" },
    payload: { itemIds: checkIds },
  });
  assert.equal(checkoff.statusCode, 200, checkoff.body);
  const checked = checkoff.json() as {
    newlyChecked: unknown[];
    pantry: Array<{ ingredientId: string; quantity: number }>;
  };
  assert.equal(checked.newlyChecked.length, checkIds.length);
  assert.ok(checked.pantry.length >= 1);

  const confirm = await app.inject({
    method: "POST",
    url: `/households/${householdId}/plans/${planBody.plan.id}/confirm`,
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      outcome: "mostly",
      skippedMealIds: [planBody.meals[0]!.id],
      leftovers: [
        {
          ingredientId: FIXTURE_IDS.oats,
          quantity: 20,
          unit: "g",
          name: "Oats leftover",
        },
      ],
    },
  });
  assert.equal(confirm.statusCode, 200, confirm.body);
  const confirmed = confirm.json() as {
    confirmation: { outcome: string };
    pantry: unknown[];
  };
  assert.equal(confirmed.confirmation.outcome, "mostly");

  const again = await app.inject({
    method: "POST",
    url: `/households/${householdId}/plans/${planBody.plan.id}/confirm`,
    headers: { ...auth, "content-type": "application/json" },
    payload: { outcome: "all" },
  });
  assert.equal(again.statusCode, 409);
});
