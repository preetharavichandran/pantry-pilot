import assert from "node:assert/strict";
import { test } from "node:test";
import { assertHouseholdCreate, assertPantryUpsert, DomainError } from "../src/domain/household.js";

test("household create defaults meal toggles and horizon", () => {
  const h = assertHouseholdCreate({ size: 2 });
  assert.equal(h.planHorizonDays, 3);
  assert.equal(h.breakfastEnabled, true);
  assert.equal(h.lunchEnabled, false);
  assert.equal(h.dinnerEnabled, true);
});

test("pantry upsert rejects duplicate ingredient ids", () => {
  assert.throws(
    () =>
      assertPantryUpsert([
        {
          ingredientId: "11111111-1111-1111-1111-111111110001",
          quantity: 1,
          unit: "pcs",
        },
        {
          ingredientId: "11111111-1111-1111-1111-111111110001",
          quantity: 2,
          unit: "pcs",
        },
      ]),
    (err: unknown) => err instanceof DomainError && err.code === "duplicate_ingredient",
  );
});
