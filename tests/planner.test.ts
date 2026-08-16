import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePlan, scoreRecipe, PLANNER_WEIGHTS } from "../src/planner/generatePlan.js";
import type { PantryItem, RecipeProjection } from "../src/domain/types.js";

const oats = "11111111-1111-1111-1111-111111110001";
const milk = "11111111-1111-1111-1111-111111110002";
const rice = "11111111-1111-1111-1111-111111110009";
const pasta = "11111111-1111-1111-1111-111111110017";

const oatmeal: RecipeProjection = {
  recipeId: "22222222-2222-2222-2222-222222220001",
  title: "Weekday oatmeal",
  author: "RecipeHub",
  creatorId: null,
  mealSlots: ["breakfast"],
  ingredients: [
    { ingredientId: oats, name: "Oats", quantity: 60, unit: "g" },
    { ingredientId: milk, name: "Milk", quantity: 250, unit: "ml" },
  ],
  sourceUpdatedAt: new Date(),
  deletedAt: null,
  projectedAt: new Date(),
};

const pastaDinner: RecipeProjection = {
  recipeId: "22222222-2222-2222-2222-222222220005",
  title: "Tomato garlic pasta",
  author: "RecipeHub",
  creatorId: null,
  mealSlots: ["dinner"],
  ingredients: [{ ingredientId: pasta, name: "Pasta", quantity: 200, unit: "g" }],
  sourceUpdatedAt: new Date(),
  deletedAt: null,
  projectedAt: new Date(),
};

const riceDinner: RecipeProjection = {
  recipeId: "22222222-2222-2222-2222-222222220006",
  title: "Chicken and rice bowl",
  author: "RecipeHub",
  creatorId: null,
  mealSlots: ["dinner"],
  ingredients: [{ ingredientId: rice, name: "Rice", quantity: 150, unit: "g" }],
  sourceUpdatedAt: new Date(),
  deletedAt: null,
  projectedAt: new Date(),
};

function pantry(items: Array<Partial<PantryItem> & { ingredientId: string; quantity: number; unit: "g" | "ml" | "pcs" | "pack" }>): PantryItem[] {
  return items.map((i, idx) => ({
    id: `p-${idx}`,
    householdId: "h1",
    ingredientId: i.ingredientId,
    quantity: i.quantity,
    unit: i.unit,
    expiryDate: i.expiryDate ?? null,
    updatedAt: new Date(),
  }));
}

test("weights are documented positive fractions", () => {
  assert.ok(PLANNER_WEIGHTS.pantryOverlap > 0);
  assert.ok(PLANNER_WEIGHTS.repeatPenalty > 0);
});

test("pantry overlap prefers fully stocked recipe", () => {
  const stock = new Map([
    [`${oats}:g`, { quantity: 500, expiryDate: null }],
    [`${milk}:ml`, { quantity: 1000, expiryDate: null }],
  ]);
  const full = scoreRecipe({
    recipe: oatmeal,
    slot: "breakfast",
    stock,
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  const empty = scoreRecipe({
    recipe: oatmeal,
    slot: "breakfast",
    stock: new Map(),
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  assert.ok(full.pantryOverlap > empty.pantryOverlap);
  assert.ok(full.total > empty.total);
});

test("repeat penalty lowers score for reused recipe", () => {
  const stock = new Map();
  const first = scoreRecipe({
    recipe: pastaDinner,
    slot: "dinner",
    stock,
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  const second = scoreRecipe({
    recipe: pastaDinner,
    slot: "dinner",
    stock,
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set([pastaDinner.recipeId]),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  assert.equal(second.repeatPenalty, 1);
  assert.ok(second.total < first.total);
});

test("wrong meal slot is rejected", () => {
  const score = scoreRecipe({
    recipe: oatmeal,
    slot: "dinner",
    stock: new Map(),
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  assert.equal(score.mealSlotFit, 0);
  assert.equal(score.total, Number.NEGATIVE_INFINITY);
});

test("generatePlan fills breakfast+dinner and emits shopping gaps when pantry empty", () => {
  const result = generatePlan({
    recipes: [oatmeal, pastaDinner, riceDinner],
    pantry: [],
    horizonStart: "2026-08-16",
    horizonDays: 2,
    householdSize: 2,
    budgetSoft: 50,
    slots: ["breakfast", "dinner"],
  });
  assert.equal(result.meals.length, 4);
  assert.ok(result.meals.every((m) => m.slot === "breakfast" || m.slot === "dinner"));
  assert.ok(result.shoppingGaps.length > 0);
  const dinnerIds = result.meals.filter((m) => m.slot === "dinner").map((m) => m.recipeId);
  assert.equal(new Set(dinnerIds).size, dinnerIds.length, "prefer variety across dinners");
});

test("expiry urgency boosts recipes using soon-to-expire stock", () => {
  const soon = scoreRecipe({
    recipe: oatmeal,
    slot: "breakfast",
    stock: new Map([
      [`${oats}:g`, { quantity: 500, expiryDate: "2026-08-17" }],
      [`${milk}:ml`, { quantity: 1000, expiryDate: null }],
    ]),
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  const later = scoreRecipe({
    recipe: oatmeal,
    slot: "breakfast",
    stock: new Map([
      [`${oats}:g`, { quantity: 500, expiryDate: "2026-09-30" }],
      [`${milk}:ml`, { quantity: 1000, expiryDate: null }],
    ]),
    portions: 2,
    budgetSoft: null,
    usedRecipeIds: new Set(),
    asOfDate: "2026-08-16",
    objective: "normal",
  });
  assert.ok(soon.expiryUrgency > later.expiryUrgency);
});

test("full pantry reduces shopping gaps", () => {
  const empty = generatePlan({
    recipes: [oatmeal],
    pantry: [],
    horizonStart: "2026-08-16",
    horizonDays: 1,
    householdSize: 2,
    budgetSoft: null,
    slots: ["breakfast"],
  });
  const stocked = generatePlan({
    recipes: [oatmeal],
    pantry: pantry([
      { ingredientId: oats, quantity: 500, unit: "g" },
      { ingredientId: milk, quantity: 2000, unit: "ml" },
    ]),
    horizonStart: "2026-08-16",
    horizonDays: 1,
    householdSize: 2,
    budgetSoft: null,
    slots: ["breakfast"],
  });
  assert.ok(stocked.shoppingGaps.length < empty.shoppingGaps.length);
});
