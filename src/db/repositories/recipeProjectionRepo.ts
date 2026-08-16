import type { Pool, PoolClient } from "pg";
import type {
  MealSlot,
  RecipeIngredientLine,
  RecipeProjection,
  Unit,
} from "../../domain/types.js";

type Row = {
  recipe_id: string;
  title: string;
  author: string | null;
  creator_id: string | null;
  meal_slots: string[];
  ingredients: RecipeIngredientLine[] | string;
  source_updated_at: Date;
  deleted_at: Date | null;
  projected_at: Date;
};

function parseIngredients(raw: RecipeIngredientLine[] | string): RecipeIngredientLine[] {
  const value = typeof raw === "string" ? (JSON.parse(raw) as RecipeIngredientLine[]) : raw;
  return value.map((i) => ({
    ingredientId: i.ingredientId,
    name: i.name,
    quantity: Number(i.quantity),
    unit: i.unit as Unit,
  }));
}

function mapRow(row: Row): RecipeProjection {
  return {
    recipeId: row.recipe_id,
    title: row.title,
    author: row.author,
    creatorId: row.creator_id,
    mealSlots: row.meal_slots as MealSlot[],
    ingredients: parseIngredients(row.ingredients),
    sourceUpdatedAt: row.source_updated_at,
    deletedAt: row.deleted_at,
    projectedAt: row.projected_at,
  };
}

export class RecipeProjectionRepository {
  constructor(private readonly db: Pool) {}

  async listActive(): Promise<RecipeProjection[]> {
    const result = await this.db.query<Row>(
      `SELECT * FROM recipe_projections WHERE deleted_at IS NULL ORDER BY title`,
    );
    return result.rows.map(mapRow);
  }

  async countActive(): Promise<number> {
    const result = await this.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recipe_projections WHERE deleted_at IS NULL`,
    );
    return Number(result.rows[0]?.c ?? 0);
  }

  async maxProjectedAt(): Promise<Date | null> {
    const result = await this.db.query<{ m: Date | null }>(
      `SELECT max(projected_at) AS m FROM recipe_projections`,
    );
    return result.rows[0]?.m ?? null;
  }

  async upsertSnapshot(
    client: PoolClient,
    projection: {
      recipeId: string;
      title: string;
      author: string | null;
      creatorId: string | null;
      mealSlots: string[];
      ingredients: RecipeIngredientLine[];
      sourceUpdatedAt: Date;
      eventId: string;
      eventType: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO recipe_projections (
         recipe_id, title, author, creator_id, meal_slots, ingredients,
         source_updated_at, deleted_at, projected_at, last_event_id, last_event_type
       ) VALUES ($1,$2,$3,$4,$5::text[],$6::jsonb,$7,NULL,now(),$8,$9)
       ON CONFLICT (recipe_id) DO UPDATE SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         creator_id = EXCLUDED.creator_id,
         meal_slots = EXCLUDED.meal_slots,
         ingredients = EXCLUDED.ingredients,
         source_updated_at = EXCLUDED.source_updated_at,
         deleted_at = NULL,
         projected_at = now(),
         last_event_id = EXCLUDED.last_event_id,
         last_event_type = EXCLUDED.last_event_type`,
      [
        projection.recipeId,
        projection.title,
        projection.author,
        projection.creatorId,
        projection.mealSlots,
        JSON.stringify(projection.ingredients),
        projection.sourceUpdatedAt,
        projection.eventId,
        projection.eventType,
      ],
    );
  }

  async softDelete(
    client: PoolClient,
    recipeId: string,
    deletedAt: Date,
    eventId: string,
    eventType: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO recipe_projections (
         recipe_id, title, author, creator_id, meal_slots, ingredients,
         source_updated_at, deleted_at, projected_at, last_event_id, last_event_type
       ) VALUES ($1, '(deleted)', NULL, NULL, '{}', '[]'::jsonb, $2, $2, now(), $3, $4)
       ON CONFLICT (recipe_id) DO UPDATE SET
         deleted_at = EXCLUDED.deleted_at,
         projected_at = now(),
         last_event_id = EXCLUDED.last_event_id,
         last_event_type = EXCLUDED.last_event_type`,
      [recipeId, deletedAt, eventId, eventType],
    );
  }
}
