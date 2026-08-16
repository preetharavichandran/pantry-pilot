import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/api/app.js";
import { starterProjectionEvents, FIXTURE_IDS } from "../src/fixtures/recipes.js";
import { RecipeEventIngestService } from "../src/integrations/recipeEvents.js";
import { mintDevToken, requireTestDb } from "./helpers.js";

test("API integration: household → plan → shopping → replace", async (t) => {
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
  for (const event of starterProjectionEvents(`api-${Date.now()}`)) {
    await ingest.applyCloudEvent(event);
  }

  const config = loadConfig();
  config.kafka.enabled = false;
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

  const sub = `api-itest-${Date.now()}`;
  const token = await mintDevToken(sub);
  const auth = { authorization: `Bearer ${token}` };

  const create = await app.inject({
    method: "POST",
    url: "/households",
    headers: { ...auth, "content-type": "application/json" },
    payload: { size: 2, budgetSoft: 80, planHorizonDays: 3 },
  });
  assert.equal(create.statusCode, 201, create.body);
  const created = create.json() as {
    household: { id: string };
    seedSkipped: boolean;
  };
  assert.equal(created.seedSkipped, true);
  const householdId = created.household.id;

  const pantry = await app.inject({
    method: "PUT",
    url: `/households/${householdId}/pantry`,
    headers: { ...auth, "content-type": "application/json" },
    payload: {
      items: [
        {
          ingredientId: FIXTURE_IDS.oats,
          quantity: 500,
          unit: "g",
        },
      ],
    },
  });
  assert.equal(pantry.statusCode, 200, pantry.body);

  const plan = await app.inject({
    method: "POST",
    url: `/households/${householdId}/plans`,
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(plan.statusCode, 201, plan.body);
  const planBody = plan.json() as {
    plan: { id: string; horizonStart: string; projectionStale: boolean };
    meals: Array<{ id: string; mealDate: string; slot: string }>;
    shoppingItems: unknown[];
  };
  assert.equal(planBody.meals.length, 6);
  assert.match(planBody.meals[0]!.mealDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(planBody.shoppingItems.length > 0);

  const current = await app.inject({
    method: "GET",
    url: `/households/${householdId}/plans/current`,
    headers: auth,
  });
  assert.equal(current.statusCode, 200, current.body);

  const shop = await app.inject({
    method: "GET",
    url: `/households/${householdId}/shopping-lists/current`,
    headers: auth,
  });
  assert.equal(shop.statusCode, 200, shop.body);

  const meal = planBody.meals[0]!;
  const replace = await app.inject({
    method: "POST",
    url: `/households/${householdId}/plans/${planBody.plan.id}/meals/${meal.id}/replace`,
    headers: { ...auth, "content-type": "application/json" },
    payload: {},
  });
  assert.equal(replace.statusCode, 200, replace.body);

  const conflict = await app.inject({
    method: "POST",
    url: "/households",
    headers: { ...auth, "content-type": "application/json" },
    payload: { size: 3 },
  });
  assert.equal(conflict.statusCode, 409);
});
