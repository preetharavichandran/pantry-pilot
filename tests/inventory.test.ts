import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPantryDeltas,
  computeDepletion,
  depleteDeltasFromGaps,
  restockDeltasFromCheckoffs,
} from "../src/domain/inventory.js";
import type { PantryItem, PlannedMeal, RecipeProjection, ShoppingListItem } from "../src/domain/types.js";

const oats = "11111111-1111-1111-1111-111111110001";
const milk = "11111111-1111-1111-1111-111111110002";

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

const meal = (id: string): PlannedMeal => ({
  id,
  planId: "p1",
  mealDate: "2026-08-16",
  slot: "breakfast",
  recipeId: oatmeal.recipeId,
  recipeTitle: oatmeal.title,
  portions: 2,
  score: 1,
  scoreBreakdown: {
    pantryOverlap: 1,
    expiryUrgency: 0,
    budgetSoftFit: 1,
    mealSlotFit: 1,
    repeatPenalty: 0,
    total: 1,
  },
});

test("computeDepletion scales recipe lines and honors skips", () => {
  const gaps = computeDepletion([meal("m1"), meal("m2")], [oatmeal], new Set(["m2"]));
  const oatsGap = gaps.find((g) => g.ingredientId === oats);
  assert.equal(oatsGap?.quantity, 60);
});

test("applyPantryDeltas restocks and depletes with floor at zero", () => {
  const pantry: PantryItem[] = [
    {
      id: "1",
      householdId: "h",
      ingredientId: oats,
      quantity: 100,
      unit: "g",
      expiryDate: null,
      updatedAt: new Date(),
    },
  ];
  const afterBuy = applyPantryDeltas(pantry, restockDeltasFromCheckoffs([
    {
      id: "i",
      shoppingListId: "s",
      ingredientId: oats,
      ingredientName: "Oats",
      quantity: 50,
      unit: "g",
      checked: true,
    } satisfies ShoppingListItem,
  ]));
  assert.equal(afterBuy.find((p) => p.ingredientId === oats)?.quantity, 150);

  const afterCook = applyPantryDeltas(
    afterBuy.map((p, idx) => ({
      id: String(idx),
      householdId: "h",
      ingredientId: p.ingredientId,
      quantity: p.quantity,
      unit: p.unit,
      expiryDate: p.expiryDate ?? null,
      updatedAt: new Date(),
    })),
    depleteDeltasFromGaps([{ ingredientId: oats, ingredientName: "Oats", quantity: 200, unit: "g" }]),
  );
  assert.equal(afterCook.find((p) => p.ingredientId === oats), undefined);
});
