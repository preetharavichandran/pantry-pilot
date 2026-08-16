import type {
  MealSlot,
  PlanObjective,
  PlannedMeal,
  PlannedMealDraft,
  ShoppingGap,
  ShoppingList,
  ShoppingListItem,
  MealPlan,
  PlanConfirmation,
  Unit,
} from "../../domain/types.js";
import type { Pool, PoolClient } from "pg";

type PlanRow = {
  id: string;
  household_id: string;
  horizon_start: string;
  horizon_end: string;
  objective: PlanObjective;
  status: "active" | "superseded" | "confirmed";
  projection_stale: boolean;
  created_at: Date;
};

type MealRow = {
  id: string;
  plan_id: string;
  meal_date: string;
  slot: MealSlot;
  recipe_id: string;
  recipe_title: string;
  portions: string;
  score: string;
  score_breakdown: PlannedMeal["scoreBreakdown"] | string;
};

type ListRow = {
  id: string;
  household_id: string;
  plan_id: string;
  status: "active" | "superseded";
  created_at: Date;
};

type ItemRow = {
  id: string;
  shopping_list_id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity: string;
  unit: Unit;
  checked: boolean;
  checked_at: Date | null;
};

type ConfirmationRow = {
  id: string;
  plan_id: string;
  household_id: string;
  outcome: "all" | "mostly" | "no";
  skipped_meal_ids: string[];
  leftovers: PlanConfirmation["leftovers"] | string;
  notes: string | null;
  created_at: Date;
};

function mapPlan(row: PlanRow): MealPlan {
  return {
    id: row.id,
    householdId: row.household_id,
    horizonStart: String(row.horizon_start).slice(0, 10),
    horizonEnd: String(row.horizon_end).slice(0, 10),
    objective: row.objective,
    status: row.status,
    projectionStale: row.projection_stale,
    createdAt: row.created_at,
  };
}

function mapMeal(row: MealRow): PlannedMeal {
  const breakdown =
    typeof row.score_breakdown === "string"
      ? (JSON.parse(row.score_breakdown) as PlannedMeal["scoreBreakdown"])
      : row.score_breakdown;
  return {
    id: row.id,
    planId: row.plan_id,
    mealDate: String(row.meal_date).slice(0, 10),
    slot: row.slot,
    recipeId: row.recipe_id,
    recipeTitle: row.recipe_title,
    portions: Number(row.portions),
    score: Number(row.score),
    scoreBreakdown: breakdown,
  };
}

function mapList(row: ListRow): ShoppingList {
  return {
    id: row.id,
    householdId: row.household_id,
    planId: row.plan_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapItem(row: ItemRow): ShoppingListItem {
  return {
    id: row.id,
    shoppingListId: row.shopping_list_id,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    quantity: Number(row.quantity),
    unit: row.unit,
    checked: row.checked,
    checkedAt: row.checked_at ? row.checked_at.toISOString() : null,
  };
}

function mapConfirmation(row: ConfirmationRow): PlanConfirmation {
  const leftovers =
    typeof row.leftovers === "string"
      ? (JSON.parse(row.leftovers) as PlanConfirmation["leftovers"])
      : row.leftovers;
  return {
    id: row.id,
    planId: row.plan_id,
    householdId: row.household_id,
    outcome: row.outcome,
    skippedMealIds: row.skipped_meal_ids ?? [],
    leftovers: leftovers ?? [],
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export class PlanRepository {
  constructor(private readonly db: Pool) {}

  async findActivePlan(householdId: string): Promise<MealPlan | null> {
    const result = await this.db.query<PlanRow>(
      `SELECT * FROM meal_plans WHERE household_id = $1 AND status = 'active'`,
      [householdId],
    );
    return result.rows[0] ? mapPlan(result.rows[0]) : null;
  }

  async findPlanById(planId: string): Promise<MealPlan | null> {
    const result = await this.db.query<PlanRow>(`SELECT * FROM meal_plans WHERE id = $1`, [
      planId,
    ]);
    return result.rows[0] ? mapPlan(result.rows[0]) : null;
  }

  async listMeals(planId: string): Promise<PlannedMeal[]> {
    const result = await this.db.query<MealRow>(
      `SELECT * FROM planned_meals WHERE plan_id = $1 ORDER BY meal_date, slot`,
      [planId],
    );
    return result.rows.map(mapMeal);
  }

  async findMeal(planId: string, mealId: string): Promise<PlannedMeal | null> {
    const result = await this.db.query<MealRow>(
      `SELECT * FROM planned_meals WHERE plan_id = $1 AND id = $2`,
      [planId, mealId],
    );
    return result.rows[0] ? mapMeal(result.rows[0]) : null;
  }

  async findActiveShoppingList(householdId: string): Promise<ShoppingList | null> {
    const result = await this.db.query<ListRow>(
      `SELECT * FROM shopping_lists WHERE household_id = $1 AND status = 'active'`,
      [householdId],
    );
    return result.rows[0] ? mapList(result.rows[0]) : null;
  }

  async listShoppingItems(listId: string): Promise<ShoppingListItem[]> {
    const result = await this.db.query<ItemRow>(
      `SELECT * FROM shopping_list_items WHERE shopping_list_id = $1 ORDER BY ingredient_name`,
      [listId],
    );
    return result.rows.map(mapItem);
  }

  async persistNewPlan(
    householdId: string,
    args: {
      horizonStart: string;
      horizonEnd: string;
      objective: PlanObjective;
      projectionStale: boolean;
      meals: PlannedMealDraft[];
      gaps: ShoppingGap[];
    },
  ): Promise<{ plan: MealPlan; meals: PlannedMeal[]; list: ShoppingList; items: ShoppingListItem[] }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE meal_plans SET status = 'superseded' WHERE household_id = $1 AND status = 'active'`,
        [householdId],
      );
      await client.query(
        `UPDATE shopping_lists SET status = 'superseded' WHERE household_id = $1 AND status = 'active'`,
        [householdId],
      );

      const planResult = await client.query<PlanRow>(
        `INSERT INTO meal_plans (
           household_id, horizon_start, horizon_end, objective, status, projection_stale
         ) VALUES ($1,$2,$3,$4,'active',$5)
         RETURNING *`,
        [
          householdId,
          args.horizonStart,
          args.horizonEnd,
          args.objective,
          args.projectionStale,
        ],
      );
      const plan = mapPlan(planResult.rows[0]!);

      const meals: PlannedMeal[] = [];
      for (const m of args.meals) {
        const mealResult = await client.query<MealRow>(
          `INSERT INTO planned_meals (
             plan_id, meal_date, slot, recipe_id, recipe_title, portions, score, score_breakdown
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           RETURNING *`,
          [
            plan.id,
            m.mealDate,
            m.slot,
            m.recipeId,
            m.recipeTitle,
            m.portions,
            m.score,
            JSON.stringify(m.scoreBreakdown),
          ],
        );
        meals.push(mapMeal(mealResult.rows[0]!));
      }

      const listResult = await client.query<ListRow>(
        `INSERT INTO shopping_lists (household_id, plan_id, status)
         VALUES ($1,$2,'active')
         RETURNING *`,
        [householdId, plan.id],
      );
      const list = mapList(listResult.rows[0]!);

      const items: ShoppingListItem[] = [];
      for (const g of args.gaps) {
        const itemResult = await client.query<ItemRow>(
          `INSERT INTO shopping_list_items (
             shopping_list_id, ingredient_id, ingredient_name, quantity, unit, checked
           ) VALUES ($1,$2,$3,$4,$5,false)
           RETURNING *`,
          [list.id, g.ingredientId, g.ingredientName, g.quantity, g.unit],
        );
        items.push(mapItem(itemResult.rows[0]!));
      }

      await client.query("COMMIT");
      return { plan, meals, list, items };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async updateMeal(
    client: PoolClient,
    mealId: string,
    draft: PlannedMealDraft,
  ): Promise<PlannedMeal> {
    const result = await client.query<MealRow>(
      `UPDATE planned_meals SET
         recipe_id = $2,
         recipe_title = $3,
         portions = $4,
         score = $5,
         score_breakdown = $6::jsonb
       WHERE id = $1
       RETURNING *`,
      [
        mealId,
        draft.recipeId,
        draft.recipeTitle,
        draft.portions,
        draft.score,
        JSON.stringify(draft.scoreBreakdown),
      ],
    );
    return mapMeal(result.rows[0]!);
  }

  async replaceShoppingItems(
    client: PoolClient,
    listId: string,
    gaps: ShoppingGap[],
  ): Promise<ShoppingListItem[]> {
    await client.query(`DELETE FROM shopping_list_items WHERE shopping_list_id = $1`, [listId]);
    const items: ShoppingListItem[] = [];
    for (const g of gaps) {
      const itemResult = await client.query<ItemRow>(
        `INSERT INTO shopping_list_items (
           shopping_list_id, ingredient_id, ingredient_name, quantity, unit, checked
         ) VALUES ($1,$2,$3,$4,$5,false)
         RETURNING *`,
        [listId, g.ingredientId, g.ingredientName, g.quantity, g.unit],
      );
      items.push(mapItem(itemResult.rows[0]!));
    }
    return items;
  }

  async findShoppingListById(listId: string): Promise<ShoppingList | null> {
    const result = await this.db.query<ListRow>(`SELECT * FROM shopping_lists WHERE id = $1`, [
      listId,
    ]);
    return result.rows[0] ? mapList(result.rows[0]) : null;
  }

  async findConfirmation(planId: string): Promise<PlanConfirmation | null> {
    const result = await this.db.query<ConfirmationRow>(
      `SELECT * FROM plan_confirmations WHERE plan_id = $1`,
      [planId],
    );
    return result.rows[0] ? mapConfirmation(result.rows[0]) : null;
  }

  /** Mark unchecked items as checked; returns newly checked items only. */
  async checkOffItems(
    client: PoolClient,
    listId: string,
    itemIds: string[],
  ): Promise<ShoppingListItem[]> {
    if (itemIds.length === 0) return [];
    const result = await client.query<ItemRow>(
      `UPDATE shopping_list_items
       SET checked = true, checked_at = now()
       WHERE shopping_list_id = $1
         AND id = ANY($2::uuid[])
         AND checked = false
       RETURNING *`,
      [listId, itemIds],
    );
    return result.rows.map(mapItem);
  }

  async insertConfirmation(
    client: PoolClient,
    args: {
      planId: string;
      householdId: string;
      outcome: PlanConfirmation["outcome"];
      skippedMealIds: string[];
      leftovers: PlanConfirmation["leftovers"];
      notes: string | null;
    },
  ): Promise<PlanConfirmation> {
    const result = await client.query<ConfirmationRow>(
      `INSERT INTO plan_confirmations (
         plan_id, household_id, outcome, skipped_meal_ids, leftovers, notes
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       RETURNING *`,
      [
        args.planId,
        args.householdId,
        args.outcome,
        args.skippedMealIds,
        JSON.stringify(args.leftovers),
        args.notes,
      ],
    );
    return mapConfirmation(result.rows[0]!);
  }

  async markPlanConfirmed(client: PoolClient, planId: string): Promise<MealPlan> {
    const result = await client.query<PlanRow>(
      `UPDATE meal_plans SET status = 'confirmed' WHERE id = $1 RETURNING *`,
      [planId],
    );
    return mapPlan(result.rows[0]!);
  }
}
