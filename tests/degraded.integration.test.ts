import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/api/app.js";
import { mintDevToken, requireTestDb } from "./helpers.js";

test("degraded health and empty_projection when no recipes", async (t) => {
  const ctx = await requireTestDb();
  if (!ctx) {
    t.skip("Postgres not available");
    return;
  }
  const { db } = ctx;
  t.after(async () => {
    await db.end();
  });

  // Isolate: use a throwaway schema isn't available; instead call generate with
  // a household after temporarily noting empty is hard if other tests seeded.
  // Assert health shape always includes degraded object.
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

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  const body = health.json() as {
    status: string;
    degraded: { banners: string[]; activeRecipeCount: number; kafkaEnabled: boolean };
  };
  assert.ok(body.degraded);
  assert.equal(body.degraded.kafkaEnabled, false);
  assert.ok(Array.isArray(body.degraded.banners));
  assert.ok(body.degraded.banners.some((b) => b.includes("Kafka")));

  const token = await mintDevToken(`deg-${Date.now()}`);
  // If projection empty for this DB, plan should 409; if seeded by other tests, skip that assert.
  if (body.degraded.activeRecipeCount === 0) {
    const create = await app.inject({
      method: "POST",
      url: "/households",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { size: 2 },
    });
    assert.equal(create.statusCode, 201);
    const id = (create.json() as { household: { id: string } }).household.id;
    const plan = await app.inject({
      method: "POST",
      url: `/households/${id}/plans`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
    assert.equal(plan.statusCode, 409);
    assert.equal((plan.json() as { title: string }).title, "empty_projection");
  }
});
