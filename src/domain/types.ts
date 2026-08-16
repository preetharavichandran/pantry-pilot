export type Unit = "pcs" | "g" | "ml" | "pack";

export const UNITS: readonly Unit[] = ["pcs", "g", "ml", "pack"] as const;

export type MealSlot = "breakfast" | "lunch" | "dinner";

export type PlanObjective = "normal" | "use_stock";

export type Household = {
  id: string;
  ownerSub: string;
  size: number;
  budgetSoft: number | null;
  planHorizonDays: number;
  breakfastEnabled: boolean;
  lunchEnabled: boolean;
  dinnerEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type HouseholdCreateInput = {
  size: number;
  budgetSoft?: number | null;
  planHorizonDays?: number;
  breakfastEnabled?: boolean;
  lunchEnabled?: boolean;
  dinnerEnabled?: boolean;
  /** Optional coarse pantry seed on create; omit or [] = skip seed (shop-heavy first list later). */
  pantrySeed?: PantryItemInput[];
};

export type HouseholdPatchInput = {
  size?: number;
  budgetSoft?: number | null;
  planHorizonDays?: number;
  breakfastEnabled?: boolean;
  lunchEnabled?: boolean;
  dinnerEnabled?: boolean;
};

export type PantryItem = {
  id: string;
  householdId: string;
  ingredientId: string;
  quantity: number;
  unit: Unit;
  expiryDate: string | null;
  updatedAt: Date;
};

export type PantryItemInput = {
  ingredientId: string;
  quantity: number;
  unit: Unit;
  expiryDate?: string | null;
};

export type RecipeIngredientLine = {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: Unit;
};

export type RecipeProjection = {
  recipeId: string;
  title: string;
  author: string | null;
  creatorId: string | null;
  mealSlots: MealSlot[];
  ingredients: RecipeIngredientLine[];
  sourceUpdatedAt: Date;
  deletedAt: Date | null;
  projectedAt: Date;
};

export type ScoreBreakdown = {
  pantryOverlap: number;
  expiryUrgency: number;
  budgetSoftFit: number;
  mealSlotFit: number;
  repeatPenalty: number;
  total: number;
};

export type PlannedMealDraft = {
  mealDate: string;
  slot: MealSlot;
  recipeId: string;
  recipeTitle: string;
  portions: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
};

export type ShoppingGap = {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: Unit;
};

export type MealPlan = {
  id: string;
  householdId: string;
  horizonStart: string;
  horizonEnd: string;
  objective: PlanObjective;
  status: "active" | "superseded" | "confirmed";
  projectionStale: boolean;
  createdAt: Date;
};

export type PlannedMeal = PlannedMealDraft & {
  id: string;
  planId: string;
};

export type ShoppingList = {
  id: string;
  householdId: string;
  planId: string;
  status: "active" | "superseded";
  createdAt: Date;
};

export type ShoppingListItem = {
  id: string;
  shoppingListId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: Unit;
  checked: boolean;
  checkedAt?: string | null;
};

export type ConfirmOutcome = "all" | "mostly" | "no";

export type PlanConfirmation = {
  id: string;
  planId: string;
  householdId: string;
  outcome: ConfirmOutcome;
  skippedMealIds: string[];
  leftovers: Array<{
    ingredientId: string;
    quantity: number;
    unit: Unit;
    name?: string;
  }>;
  notes: string | null;
  createdAt: Date;
};
