import type {
  MealSlot,
  PantryItem,
  PlanObjective,
  PlannedMealDraft,
  RecipeProjection,
  ScoreBreakdown,
  ShoppingGap,
  Unit,
} from "../domain/types.js";

/** Documented in ADR-004 — keep stable unless ADR is revised. */
export const PLANNER_WEIGHTS = {
  pantryOverlap: 0.45,
  expiryUrgency: 0.2,
  budgetSoftFit: 0.15,
  mealSlotFit: 0.2,
  repeatPenalty: 0.35,
} as const;

/** Stub unit costs for soft budget fit (currency-agnostic). */
export const STUB_UNIT_COSTS: Record<Unit, number> = {
  pcs: 1.5,
  g: 0.008,
  ml: 0.004,
  pack: 3,
};

const EXPIRY_URGENT_DAYS = 3;

export type PlannerInput = {
  recipes: RecipeProjection[];
  pantry: PantryItem[];
  horizonStart: string; // YYYY-MM-DD
  horizonDays: number;
  householdSize: number;
  budgetSoft: number | null;
  slots: MealSlot[];
  objective?: PlanObjective;
  /** Optional as-of date for expiry (defaults to horizonStart). */
  asOfDate?: string;
};

export type PlannerResult = {
  meals: PlannedMealDraft[];
  shoppingGaps: ShoppingGap[];
  projectionStale: boolean;
};

type PantryKey = `${string}:${Unit}`;

function pantryKey(ingredientId: string, unit: Unit): PantryKey {
  return `${ingredientId}:${unit}`;
}

type MutableStock = Map<
  PantryKey,
  { quantity: number; expiryDate: string | null; nameHint?: string }
>;

function cloneStock(pantry: PantryItem[]): MutableStock {
  const map: MutableStock = new Map();
  for (const item of pantry) {
    map.set(pantryKey(item.ingredientId, item.unit), {
      quantity: item.quantity,
      expiryDate: item.expiryDate,
    });
  }
  return map;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(expiry: string | null, asOf: string): number | null {
  if (!expiry) return null;
  const a = new Date(`${asOf}T00:00:00.000Z`).getTime();
  const b = new Date(`${expiry}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function neededQty(lineQty: number, portions: number): number {
  // Recipe lines are authored for ~2 portions in starters; scale by household size / 2.
  return (lineQty * portions) / 2;
}

export function scoreRecipe(args: {
  recipe: RecipeProjection;
  slot: MealSlot;
  stock: MutableStock;
  portions: number;
  budgetSoft: number | null;
  usedRecipeIds: Set<string>;
  asOfDate: string;
  objective: PlanObjective;
}): ScoreBreakdown {
  const { recipe, slot, stock, portions, budgetSoft, usedRecipeIds, asOfDate, objective } =
    args;

  const mealSlotFit = recipe.mealSlots.includes(slot) ? 1 : 0;
  if (mealSlotFit === 0) {
    return {
      pantryOverlap: 0,
      expiryUrgency: 0,
      budgetSoftFit: 0,
      mealSlotFit: 0,
      repeatPenalty: 0,
      total: Number.NEGATIVE_INFINITY,
    };
  }

  const lines = recipe.ingredients;
  let covered = 0;
  let shopCost = 0;
  let expiryBoost = 0;

  for (const line of lines) {
    const need = neededQty(line.quantity, portions);
    const key = pantryKey(line.ingredientId, line.unit);
    const have = stock.get(key)?.quantity ?? 0;
    const ratio = need <= 0 ? 1 : Math.min(1, have / need);
    covered += ratio;

    const gap = Math.max(0, need - have);
    if (gap > 0) {
      shopCost += gap * STUB_UNIT_COSTS[line.unit];
    }

    const exp = stock.get(key)?.expiryDate ?? null;
    const days = daysUntil(exp, asOfDate);
    if (days != null && days >= 0 && days <= EXPIRY_URGENT_DAYS && have > 0 && ratio > 0) {
      expiryBoost = Math.max(expiryBoost, 1 - days / (EXPIRY_URGENT_DAYS + 1));
    }
  }

  const pantryOverlap = lines.length === 0 ? 0 : covered / lines.length;
  const expiryUrgency = expiryBoost;

  let budgetSoftFit = 1;
  if (budgetSoft != null && budgetSoft > 0) {
    budgetSoftFit = Math.max(0, 1 - shopCost / budgetSoft);
  }

  const repeatPenalty = usedRecipeIds.has(recipe.recipeId) ? 1 : 0;

  const w = PLANNER_WEIGHTS;
  let pantryW: number = w.pantryOverlap;
  let expiryW: number = w.expiryUrgency;
  if (objective === "use_stock") {
    pantryW = 0.55;
    expiryW = 0.3;
  }

  const total =
    pantryOverlap * pantryW +
    expiryUrgency * expiryW +
    budgetSoftFit * w.budgetSoftFit +
    mealSlotFit * w.mealSlotFit -
    repeatPenalty * w.repeatPenalty;

  return {
    pantryOverlap,
    expiryUrgency,
    budgetSoftFit,
    mealSlotFit,
    repeatPenalty,
    total,
  };
}

function depleteForRecipe(stock: MutableStock, recipe: RecipeProjection, portions: number): void {
  for (const line of recipe.ingredients) {
    const need = neededQty(line.quantity, portions);
    const key = pantryKey(line.ingredientId, line.unit);
    const cur = stock.get(key);
    if (!cur) continue;
    cur.quantity = Math.max(0, cur.quantity - need);
  }
}

function accumulateNeeds(
  needs: Map<PantryKey, { quantity: number; name: string; unit: Unit; ingredientId: string }>,
  recipe: RecipeProjection,
  portions: number,
): void {
  for (const line of recipe.ingredients) {
    const need = neededQty(line.quantity, portions);
    const key = pantryKey(line.ingredientId, line.unit);
    const existing = needs.get(key);
    if (existing) {
      existing.quantity += need;
    } else {
      needs.set(key, {
        quantity: need,
        name: line.name,
        unit: line.unit,
        ingredientId: line.ingredientId,
      });
    }
  }
}

/**
 * Greedy horizon planner: for each day×slot pick the best-scoring eligible recipe,
 * simulating pantry depletion so later slots see reduced stock.
 */
export function generatePlan(input: PlannerInput): PlannerResult {
  const objective = input.objective ?? "normal";
  const asOf = input.asOfDate ?? input.horizonStart;
  const active = input.recipes.filter((r) => r.deletedAt == null);
  const stock = cloneStock(input.pantry);
  const initial = cloneStock(input.pantry);
  const used = new Set<string>();
  const meals: PlannedMealDraft[] = [];
  const needs = new Map<
    PantryKey,
    { quantity: number; name: string; unit: Unit; ingredientId: string }
  >();

  for (let day = 0; day < input.horizonDays; day++) {
    const mealDate = addDays(input.horizonStart, day);
    for (const slot of input.slots) {
      const candidates = active.filter((r) => r.mealSlots.includes(slot));
      if (candidates.length === 0) {
        continue;
      }

      const portions = input.householdSize;
      let best: { recipe: RecipeProjection; breakdown: ScoreBreakdown } | null = null;

      for (const recipe of candidates) {
        const breakdown = scoreRecipe({
          recipe,
          slot,
          stock,
          portions,
          budgetSoft: input.budgetSoft,
          usedRecipeIds: used,
          asOfDate: asOf,
          objective,
        });
        if (!best || breakdown.total > best.breakdown.total) {
          best = { recipe, breakdown };
        }
      }

      if (!best || !Number.isFinite(best.breakdown.total)) {
        continue;
      }

      meals.push({
        mealDate,
        slot,
        recipeId: best.recipe.recipeId,
        recipeTitle: best.recipe.title,
        portions,
        score: best.breakdown.total,
        scoreBreakdown: best.breakdown,
      });

      accumulateNeeds(needs, best.recipe, portions);
      depleteForRecipe(stock, best.recipe, portions);
      used.add(best.recipe.recipeId);
    }
  }

  const shoppingGaps: ShoppingGap[] = [];
  for (const need of needs.values()) {
    const have = initial.get(pantryKey(need.ingredientId, need.unit))?.quantity ?? 0;
    const gap = need.quantity - have;
    if (gap > 1e-9) {
      shoppingGaps.push({
        ingredientId: need.ingredientId,
        ingredientName: need.name,
        quantity: Math.round(gap * 1000) / 1000,
        unit: need.unit,
      });
    }
  }

  shoppingGaps.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));

  return {
    meals,
    shoppingGaps,
    projectionStale: false,
  };
}

/** Next-best candidate for a slot, excluding a recipe id (swap/replace). */
export function nextBestForSlot(args: {
  recipes: RecipeProjection[];
  pantry: PantryItem[];
  slot: MealSlot;
  portions: number;
  budgetSoft: number | null;
  excludeRecipeId: string;
  usedRecipeIds: Set<string>;
  asOfDate: string;
  objective?: PlanObjective;
}): PlannedMealDraft | null {
  const objective = args.objective ?? "normal";
  const stock = cloneStock(args.pantry);
  const candidates = args.recipes.filter(
    (r) =>
      r.deletedAt == null &&
      r.mealSlots.includes(args.slot) &&
      r.recipeId !== args.excludeRecipeId,
  );
  let best: { recipe: RecipeProjection; breakdown: ScoreBreakdown } | null = null;
  for (const recipe of candidates) {
    const breakdown = scoreRecipe({
      recipe,
      slot: args.slot,
      stock,
      portions: args.portions,
      budgetSoft: args.budgetSoft,
      usedRecipeIds: args.usedRecipeIds,
      asOfDate: args.asOfDate,
      objective,
    });
    if (!best || breakdown.total > best.breakdown.total) {
      best = { recipe, breakdown };
    }
  }
  if (!best || !Number.isFinite(best.breakdown.total)) return null;
  return {
    mealDate: "",
    slot: args.slot,
    recipeId: best.recipe.recipeId,
    recipeTitle: best.recipe.title,
    portions: args.portions,
    score: best.breakdown.total,
    scoreBreakdown: best.breakdown,
  };
}
