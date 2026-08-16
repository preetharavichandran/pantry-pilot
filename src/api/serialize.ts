import type {
  Household,
  MealPlan,
  PantryItem,
  PlannedMeal,
  ShoppingList,
  ShoppingListItem,
} from "../domain/types.js";

export function serializeHousehold(h: Household) {
  return {
    id: h.id,
    ownerSub: h.ownerSub,
    size: h.size,
    budgetSoft: h.budgetSoft,
    planHorizonDays: h.planHorizonDays,
    breakfastEnabled: h.breakfastEnabled,
    lunchEnabled: h.lunchEnabled,
    dinnerEnabled: h.dinnerEnabled,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

export function serializePantryItem(p: PantryItem) {
  return {
    id: p.id,
    householdId: p.householdId,
    ingredientId: p.ingredientId,
    quantity: p.quantity,
    unit: p.unit,
    expiryDate: p.expiryDate,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeMealPlan(p: MealPlan) {
  return {
    id: p.id,
    householdId: p.householdId,
    horizonStart: p.horizonStart,
    horizonEnd: p.horizonEnd,
    objective: p.objective,
    status: p.status,
    projectionStale: p.projectionStale,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializePlannedMeal(m: PlannedMeal) {
  return {
    id: m.id,
    planId: m.planId,
    mealDate: m.mealDate,
    slot: m.slot,
    recipeId: m.recipeId,
    recipeTitle: m.recipeTitle,
    portions: m.portions,
    score: m.score,
    scoreBreakdown: m.scoreBreakdown,
  };
}

export function serializeShoppingList(l: ShoppingList) {
  return {
    id: l.id,
    householdId: l.householdId,
    planId: l.planId,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
  };
}

export function serializeShoppingItem(i: ShoppingListItem) {
  return {
    id: i.id,
    shoppingListId: i.shoppingListId,
    ingredientId: i.ingredientId,
    ingredientName: i.ingredientName,
    quantity: i.quantity,
    unit: i.unit,
    checked: i.checked,
    checkedAt: i.checkedAt ?? null,
  };
}
