import type { HouseholdCreateInput, HouseholdPatchInput, PantryItemInput } from "./types.js";
import { UNITS } from "./types.js";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertHouseholdCreate(input: HouseholdCreateInput): HouseholdCreateInput {
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > 20) {
    throw new DomainError("size must be an integer between 1 and 20", "invalid_size");
  }
  const planHorizonDays = input.planHorizonDays ?? 3;
  if (!Number.isInteger(planHorizonDays) || planHorizonDays < 1 || planHorizonDays > 14) {
    throw new DomainError("planHorizonDays must be an integer between 1 and 14", "invalid_horizon");
  }
  if (input.budgetSoft != null && !(input.budgetSoft >= 0)) {
    throw new DomainError("budgetSoft must be >= 0 when set", "invalid_budget");
  }
  if (input.pantrySeed) {
    for (const item of input.pantrySeed) {
      assertPantryItemInput(item);
    }
  }
  return {
    size: input.size,
    budgetSoft: input.budgetSoft ?? null,
    planHorizonDays,
    breakfastEnabled: input.breakfastEnabled ?? true,
    lunchEnabled: input.lunchEnabled ?? false,
    dinnerEnabled: input.dinnerEnabled ?? true,
    pantrySeed: input.pantrySeed,
  };
}

export function assertHouseholdPatch(input: HouseholdPatchInput): HouseholdPatchInput {
  if (input.size !== undefined) {
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > 20) {
      throw new DomainError("size must be an integer between 1 and 20", "invalid_size");
    }
  }
  if (input.planHorizonDays !== undefined) {
    if (
      !Number.isInteger(input.planHorizonDays) ||
      input.planHorizonDays < 1 ||
      input.planHorizonDays > 14
    ) {
      throw new DomainError("planHorizonDays must be an integer between 1 and 14", "invalid_horizon");
    }
  }
  if (input.budgetSoft !== undefined && input.budgetSoft != null && !(input.budgetSoft >= 0)) {
    throw new DomainError("budgetSoft must be >= 0 when set", "invalid_budget");
  }
  return input;
}

export function assertPantryItemInput(item: PantryItemInput): PantryItemInput {
  if (!item.ingredientId || typeof item.ingredientId !== "string") {
    throw new DomainError("ingredientId is required", "invalid_ingredient");
  }
  if (typeof item.quantity !== "number" || !(item.quantity >= 0) || Number.isNaN(item.quantity)) {
    throw new DomainError("quantity must be a number >= 0", "invalid_quantity");
  }
  if (!UNITS.includes(item.unit)) {
    throw new DomainError(`unit must be one of: ${UNITS.join(", ")}`, "invalid_unit");
  }
  if (item.expiryDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(item.expiryDate)) {
    throw new DomainError("expiryDate must be YYYY-MM-DD or null", "invalid_expiry");
  }
  return item;
}

export function assertPantryUpsert(items: PantryItemInput[]): PantryItemInput[] {
  if (!Array.isArray(items)) {
    throw new DomainError("body must be { items: PantryItemInput[] }", "invalid_body");
  }
  const seen = new Set<string>();
  for (const item of items) {
    assertPantryItemInput(item);
    if (seen.has(item.ingredientId)) {
      throw new DomainError(
        `duplicate ingredientId in upsert: ${item.ingredientId}`,
        "duplicate_ingredient",
      );
    }
    seen.add(item.ingredientId);
  }
  return items;
}
