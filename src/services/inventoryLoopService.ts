import type { Pool } from "pg";
import { DomainError } from "../domain/household.js";
import {
  applyPantryDeltas,
  computeDepletion,
  depleteDeltasFromGaps,
  restockDeltasFromCheckoffs,
  type LeftoverInput,
} from "../domain/inventory.js";
import type {
  ConfirmOutcome,
  Household,
  PantryItem,
  PlanConfirmation,
  ShoppingList,
  ShoppingListItem,
} from "../domain/types.js";
import { HouseholdRepository } from "../db/repositories/householdRepo.js";
import { PantryRepository } from "../db/repositories/pantryRepo.js";
import { PlanRepository } from "../db/repositories/planRepo.js";
import { RecipeProjectionRepository } from "../db/repositories/recipeProjectionRepo.js";

export class InventoryLoopService {
  private readonly households: HouseholdRepository;
  private readonly pantry: PantryRepository;
  private readonly plans: PlanRepository;
  private readonly projections: RecipeProjectionRepository;

  constructor(private readonly db: Pool) {
    this.households = new HouseholdRepository(db);
    this.pantry = new PantryRepository(db);
    this.plans = new PlanRepository(db);
    this.projections = new RecipeProjectionRepository(db);
  }

  async checkOff(
    householdId: string,
    ownerSub: string,
    listId: string,
    itemIds: string[],
  ): Promise<{
    newlyChecked: ShoppingListItem[];
    pantry: PantryItem[];
    shoppingList: ShoppingList;
    items: ShoppingListItem[];
  }> {
    await this.requireOwned(householdId, ownerSub);
    const list = await this.plans.findShoppingListById(listId);
    if (!list || list.householdId !== householdId) {
      throw new DomainError("Shopping list not found", "not_found", 404);
    }
    if (list.status !== "active") {
      throw new DomainError("Shopping list is not active", "list_inactive", 409);
    }
    if (itemIds.length === 0) {
      throw new DomainError("itemIds must not be empty", "invalid_body", 400);
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const newlyChecked = await this.plans.checkOffItems(client, listId, itemIds);
      const currentPantry = await this.pantry.listByHousehold(householdId);
      const next = applyPantryDeltas(currentPantry, restockDeltasFromCheckoffs(newlyChecked));
      const pantry = await this.pantry.replaceMergedState(client, householdId, next);
      await client.query("COMMIT");
      const items = await this.plans.listShoppingItems(listId);
      return { newlyChecked, pantry, shoppingList: list, items };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async confirmCooked(
    householdId: string,
    ownerSub: string,
    planId: string,
    input: {
      outcome: ConfirmOutcome;
      skippedMealIds?: string[];
      leftovers?: LeftoverInput[];
      notes?: string | null;
    },
  ): Promise<{
    confirmation: PlanConfirmation;
    pantry: PantryItem[];
  }> {
    await this.requireOwned(householdId, ownerSub);
    const plan = await this.plans.findPlanById(planId);
    if (!plan || plan.householdId !== householdId) {
      throw new DomainError("Plan not found", "not_found", 404);
    }
    if (plan.status === "superseded") {
      throw new DomainError("Plan was superseded", "plan_superseded", 409);
    }
    if (plan.status === "confirmed") {
      throw new DomainError("Plan already confirmed", "already_confirmed", 409);
    }

    const existing = await this.plans.findConfirmation(planId);
    if (existing) {
      throw new DomainError("Plan already confirmed", "already_confirmed", 409);
    }

    const skipped = new Set(input.skippedMealIds ?? []);
    if (input.outcome === "all" && skipped.size > 0) {
      throw new DomainError("outcome=all cannot include skippedMealIds", "invalid_skips", 400);
    }
    if (input.outcome === "no" && skipped.size > 0) {
      throw new DomainError("outcome=no ignores skips; omit skippedMealIds", "invalid_skips", 400);
    }
    if (input.outcome === "mostly" && skipped.size === 0) {
      throw new DomainError("outcome=mostly requires at least one skippedMealId", "invalid_skips", 400);
    }

    const meals = await this.plans.listMeals(planId);
    for (const id of skipped) {
      if (!meals.some((m) => m.id === id)) {
        throw new DomainError(`Unknown skipped meal id ${id}`, "invalid_skips", 400);
      }
    }

    const leftovers = (input.leftovers ?? []).map((l) => ({
      ingredientId: l.ingredientId,
      quantity: l.quantity,
      unit: l.unit,
      name: l.name,
    }));
    for (const l of leftovers) {
      if (!(l.quantity > 0)) {
        throw new DomainError("leftover quantity must be > 0", "invalid_leftover", 400);
      }
    }

    const recipes = await this.projections.listActive();
    const skipForDeplete =
      input.outcome === "all"
        ? new Set<string>()
        : input.outcome === "no"
          ? new Set(meals.map((m) => m.id))
          : skipped;

    const gaps =
      input.outcome === "no" ? [] : computeDepletion(meals, recipes, skipForDeplete);

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const currentPantry = await this.pantry.listByHousehold(householdId);
      const deltas = [
        ...depleteDeltasFromGaps(gaps),
        ...leftovers.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: l.quantity,
          unit: l.unit,
          name: l.name,
        })),
      ];
      const next = applyPantryDeltas(currentPantry, deltas);
      const pantry = await this.pantry.replaceMergedState(client, householdId, next);
      const confirmation = await this.plans.insertConfirmation(client, {
        planId,
        householdId,
        outcome: input.outcome,
        skippedMealIds: [...skipped],
        leftovers,
        notes: input.notes ?? null,
      });
      await this.plans.markPlanConfirmed(client, planId);
      await client.query("COMMIT");
      return { confirmation, pantry };
    } catch (err) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(err)) {
        throw new DomainError("Plan already confirmed", "already_confirmed", 409);
      }
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
