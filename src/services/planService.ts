import type { Pool } from "pg";
import { DomainError } from "../domain/household.js";
import type {
  Household,
  MealSlot,
  PlanObjective,
  PlannedMeal,
  ShoppingList,
  ShoppingListItem,
  MealPlan,
} from "../domain/types.js";
import { HouseholdRepository } from "../db/repositories/householdRepo.js";
import { PantryRepository } from "../db/repositories/pantryRepo.js";
import { PlanRepository } from "../db/repositories/planRepo.js";
import { RecipeProjectionRepository } from "../db/repositories/recipeProjectionRepo.js";
import { generatePlan, nextBestForSlot } from "../planner/generatePlan.js";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function enabledSlots(h: Household): MealSlot[] {
  const slots: MealSlot[] = [];
  if (h.breakfastEnabled) slots.push("breakfast");
  if (h.lunchEnabled) slots.push("lunch");
  if (h.dinnerEnabled) slots.push("dinner");
  return slots;
}

export class PlanService {
  private readonly households: HouseholdRepository;
  private readonly pantry: PantryRepository;
  private readonly projections: RecipeProjectionRepository;
  private readonly plans: PlanRepository;
  private readonly staleAfterMs: number;

  constructor(
    private readonly db: Pool,
    opts?: { projectionStaleAfterMs?: number },
  ) {
    this.households = new HouseholdRepository(db);
    this.pantry = new PantryRepository(db);
    this.projections = new RecipeProjectionRepository(db);
    this.plans = new PlanRepository(db);
    this.staleAfterMs = opts?.projectionStaleAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async generate(
    householdId: string,
    ownerSub: string,
    opts?: { objective?: PlanObjective; horizonStart?: string },
  ): Promise<{
    plan: MealPlan;
    meals: PlannedMeal[];
    shoppingList: ShoppingList;
    shoppingItems: ShoppingListItem[];
    degraded: {
      projectionStale: boolean;
      activeRecipeCount: number;
      newestProjectedAt: string | null;
      banners: string[];
    };
  }> {
    const household = await this.requireOwned(householdId, ownerSub);
    const recipes = await this.projections.listActive();
    if (recipes.length === 0) {
      throw new DomainError(
        "No recipes in local projection yet. Start the Kafka consumer or seed fixtures (npm run seed:projections).",
        "empty_projection",
        409,
      );
    }

    const slots = enabledSlots(household);
    if (slots.length === 0) {
      throw new DomainError("No meal slots enabled", "no_slots", 400);
    }

    const horizonStart = opts?.horizonStart ?? todayUtc();
    const horizonDays = household.planHorizonDays;
    const horizonEnd = addDays(horizonStart, horizonDays - 1);
    const pantry = await this.pantry.listByHousehold(householdId);
    const maxProjected = await this.projections.maxProjectedAt();
    const projectionStale =
      !maxProjected || Date.now() - maxProjected.getTime() > this.staleAfterMs;

    const banners: string[] = [];
    if (projectionStale) {
      banners.push(
        "Recipe projection may be stale — planning from last known recipes. Check Kafka / RecipeHub publish.",
      );
    }

    const result = generatePlan({
      recipes,
      pantry,
      horizonStart,
      horizonDays,
      householdSize: household.size,
      budgetSoft: household.budgetSoft,
      slots,
      objective: opts?.objective ?? "normal",
    });

    if (result.meals.length === 0) {
      throw new DomainError(
        "Planner produced no meals — check meal slots vs projected recipe mealSlots",
        "empty_plan",
        409,
      );
    }

    const persisted = await this.plans.persistNewPlan(householdId, {
      horizonStart,
      horizonEnd,
      objective: opts?.objective ?? "normal",
      projectionStale,
      meals: result.meals,
      gaps: result.shoppingGaps,
    });

    return {
      plan: { ...persisted.plan, projectionStale },
      meals: persisted.meals,
      shoppingList: persisted.list,
      shoppingItems: persisted.items,
      degraded: {
        projectionStale,
        activeRecipeCount: recipes.length,
        newestProjectedAt: maxProjected ? maxProjected.toISOString() : null,
        banners,
      },
    };
  }

  async getCurrent(
    householdId: string,
    ownerSub: string,
  ): Promise<{
    plan: MealPlan;
    meals: PlannedMeal[];
  } | null> {
    await this.requireOwned(householdId, ownerSub);
    const plan = await this.plans.findActivePlan(householdId);
    if (!plan) return null;
    const meals = await this.plans.listMeals(plan.id);
    return { plan, meals };
  }

  async getCurrentShoppingList(
    householdId: string,
    ownerSub: string,
  ): Promise<{ list: ShoppingList; items: ShoppingListItem[] } | null> {
    await this.requireOwned(householdId, ownerSub);
    const list = await this.plans.findActiveShoppingList(householdId);
    if (!list) return null;
    const items = await this.plans.listShoppingItems(list.id);
    return { list, items };
  }

  async replaceMeal(
    householdId: string,
    ownerSub: string,
    planId: string,
    mealId: string,
  ): Promise<{ meal: PlannedMeal; shoppingList: ShoppingList; shoppingItems: ShoppingListItem[] }> {
    const household = await this.requireOwned(householdId, ownerSub);
    const plan = await this.plans.findPlanById(planId);
    if (!plan || plan.householdId !== householdId || plan.status !== "active") {
      throw new DomainError("Plan not found", "not_found", 404);
    }
    const meal = await this.plans.findMeal(planId, mealId);
    if (!meal) {
      throw new DomainError("Meal not found", "not_found", 404);
    }

    const recipes = await this.projections.listActive();
    const pantry = await this.pantry.listByHousehold(householdId);
    const allMeals = await this.plans.listMeals(planId);
    const used = new Set(
      allMeals.filter((m) => m.id !== mealId).map((m) => m.recipeId),
    );

    const next = nextBestForSlot({
      recipes,
      pantry,
      slot: meal.slot,
      portions: meal.portions,
      budgetSoft: household.budgetSoft,
      excludeRecipeId: meal.recipeId,
      usedRecipeIds: used,
      asOfDate: plan.horizonStart,
      objective: plan.objective,
    });
    if (!next) {
      throw new DomainError("No alternative recipe for this slot", "no_alternative", 409);
    }
    next.mealDate = meal.mealDate;

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const updated = await this.plans.updateMeal(client, mealId, next);
      const mealsAfter = allMeals.map((m) =>
        m.id === mealId
          ? {
              ...m,
              recipeId: next.recipeId,
              recipeTitle: next.recipeTitle,
              score: next.score,
              scoreBreakdown: next.scoreBreakdown,
            }
          : m,
      );
      const list = await this.plans.findActiveShoppingList(householdId);
      if (!list) {
        throw new DomainError("Shopping list not found", "not_found", 404);
      }
      const gaps = recomputeGapsFromMeals(mealsAfter, recipes, pantry);
      const items = await this.plans.replaceShoppingItems(client, list.id, gaps);
      await client.query("COMMIT");
      return { meal: updated, shoppingList: list, shoppingItems: items };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async requireOwned(id: string, ownerSub: string): Promise<Household> {
    const household = await this.households.findById(id);
    if (!household) {
      throw new DomainError("Household not found", "not_found", 404);
    }
    if (household.ownerSub !== ownerSub) {
      throw new DomainError("Forbidden", "forbidden", 403);
    }
    return household;
  }
}

function recomputeGapsFromMeals(
  meals: PlannedMeal[],
  recipes: Awaited<ReturnType<RecipeProjectionRepository["listActive"]>>,
  pantry: Awaited<ReturnType<PantryRepository["listByHousehold"]>>,
): import("../domain/types.js").ShoppingGap[] {
  const byId = new Map(recipes.map((r) => [r.recipeId, r]));
  const needs = new Map<
    string,
    {
      ingredientId: string;
      ingredientName: string;
      quantity: number;
      unit: import("../domain/types.js").Unit;
    }
  >();

  for (const meal of meals) {
    const recipe = byId.get(meal.recipeId);
    if (!recipe) continue;
    for (const line of recipe.ingredients) {
      const need = (line.quantity * meal.portions) / 2;
      const key = `${line.ingredientId}:${line.unit}`;
      const cur = needs.get(key);
      if (cur) cur.quantity += need;
      else
        needs.set(key, {
          ingredientId: line.ingredientId,
          ingredientName: line.name,
          quantity: need,
          unit: line.unit,
        });
    }
  }

  const stock = new Map(
    pantry.map((p) => [`${p.ingredientId}:${p.unit}`, p.quantity] as const),
  );
  const gaps: import("../domain/types.js").ShoppingGap[] = [];
  for (const n of needs.values()) {
    const have = stock.get(`${n.ingredientId}:${n.unit}`) ?? 0;
    const gap = n.quantity - have;
    if (gap > 1e-9) {
      gaps.push({
        ingredientId: n.ingredientId,
        ingredientName: n.ingredientName,
        quantity: Math.round(gap * 1000) / 1000,
        unit: n.unit,
      });
    }
  }
  return gaps.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
}
