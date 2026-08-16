import type {
  PantryItem,
  PantryItemInput,
  PlannedMeal,
  RecipeProjection,
  ShoppingGap,
  ShoppingListItem,
  Unit,
} from "./types.js";

export type LeftoverInput = {
  ingredientId: string;
  quantity: number;
  unit: Unit;
  name?: string;
};

/** Recipe lines are authored for ~2 portions; scale like the planner. */
export function scaledLineQty(lineQty: number, portions: number): number {
  return (lineQty * portions) / 2;
}

export function stockKey(ingredientId: string, unit: Unit): string {
  return `${ingredientId}:${unit}`;
}

/** Ingredients to subtract for cooked meals (skips excluded). */
export function computeDepletion(
  meals: PlannedMeal[],
  recipes: RecipeProjection[],
  skippedMealIds: Set<string>,
): ShoppingGap[] {
  const byId = new Map(recipes.map((r) => [r.recipeId, r]));
  const needs = new Map<string, ShoppingGap>();

  for (const meal of meals) {
    if (skippedMealIds.has(meal.id)) continue;
    const recipe = byId.get(meal.recipeId);
    if (!recipe) continue;
    for (const line of recipe.ingredients) {
      const qty = scaledLineQty(line.quantity, meal.portions);
      const key = stockKey(line.ingredientId, line.unit);
      const cur = needs.get(key);
      if (cur) cur.quantity += qty;
      else
        needs.set(key, {
          ingredientId: line.ingredientId,
          ingredientName: line.name,
          quantity: qty,
          unit: line.unit,
        });
    }
  }

  return [...needs.values()]
    .map((g) => ({ ...g, quantity: Math.round(g.quantity * 1000) / 1000 }))
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
}

/** Apply deltas to pantry (negative = deplete). Floor at 0; drop zero rows. */
export function applyPantryDeltas(
  pantry: PantryItem[],
  deltas: Array<{ ingredientId: string; quantity: number; unit: Unit; name?: string }>,
): PantryItemInput[] {
  const map = new Map<
    string,
    { ingredientId: string; quantity: number; unit: Unit; expiryDate: string | null }
  >();

  for (const p of pantry) {
    map.set(stockKey(p.ingredientId, p.unit), {
      ingredientId: p.ingredientId,
      quantity: p.quantity,
      unit: p.unit,
      expiryDate: p.expiryDate,
    });
  }

  for (const d of deltas) {
    if (d.quantity === 0) continue;
    const key = stockKey(d.ingredientId, d.unit);
    const cur = map.get(key) ?? {
      ingredientId: d.ingredientId,
      quantity: 0,
      unit: d.unit,
      expiryDate: null,
    };
    cur.quantity = Math.round((cur.quantity + d.quantity) * 1000) / 1000;
    if (cur.quantity < 0) cur.quantity = 0;
    map.set(key, cur);
  }

  return [...map.values()]
    .filter((p) => p.quantity > 1e-9)
    .map((p) => ({
      ingredientId: p.ingredientId,
      quantity: p.quantity,
      unit: p.unit,
      expiryDate: p.expiryDate,
    }));
}

export function restockDeltasFromCheckoffs(items: ShoppingListItem[]): Array<{
  ingredientId: string;
  quantity: number;
  unit: Unit;
  name?: string;
}> {
  return items.map((i) => ({
    ingredientId: i.ingredientId,
    quantity: i.quantity,
    unit: i.unit,
    name: i.ingredientName,
  }));
}

export function depleteDeltasFromGaps(gaps: ShoppingGap[]): Array<{
  ingredientId: string;
  quantity: number;
  unit: Unit;
  name?: string;
}> {
  return gaps.map((g) => ({
    ingredientId: g.ingredientId,
    quantity: -g.quantity,
    unit: g.unit,
    name: g.ingredientName,
  }));
}
