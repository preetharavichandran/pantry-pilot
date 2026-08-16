import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECIPE_EVENT_DELETED,
  RecipeEventIngestService,
} from "../src/integrations/recipeEvents.js";
import { RecipeProjectionRepository } from "../src/db/repositories/recipeProjectionRepo.js";
import { FIXTURE_IDS, recipeCreatedEvent } from "../src/fixtures/recipes.js";
import { requireTestDb } from "./helpers.js";

test("recipe event ingest upserts, is idempotent, and soft-deletes", async (t) => {
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
  const projections = new RecipeProjectionRepository(db);
  const recipeId = "33333333-3333-3333-3333-333333330099";
  const eventId = `itest-created-${Date.now()}`;

  const created = recipeCreatedEvent(
    recipeId,
    "Integration oatmeal",
    ["breakfast"],
    [
      {
        ingredientId: FIXTURE_IDS.oats,
        name: "Oats",
        quantity: 50,
        unit: "g",
      },
    ],
    eventId,
  );

  const first = await ingest.applyCloudEvent(created);
  assert.equal(first.status, "applied");

  const dup = await ingest.applyCloudEvent(created);
  assert.equal(dup.status, "duplicate");

  const listed = await projections.listActive();
  assert.ok(listed.some((r) => r.recipeId === recipeId && r.title === "Integration oatmeal"));

  const deleted = await ingest.applyCloudEvent({
    specversion: "1.0",
    id: `itest-deleted-${Date.now()}`,
    source: "urn:lifeatlas:test",
    type: RECIPE_EVENT_DELETED,
    time: new Date().toISOString(),
    eventVersion: "1.0",
    data: { recipeId, deletedAt: new Date().toISOString() },
  });
  assert.equal(deleted.status, "applied");

  const after = await projections.listActive();
  assert.ok(!after.some((r) => r.recipeId === recipeId));
});
