import type { Pool } from "pg";
import type { RecipeIngredientLine, Unit } from "../domain/types.js";
import { RecipeProjectionRepository } from "../db/repositories/recipeProjectionRepo.js";

export const RECIPE_EVENT_CREATED = "lifeatlas.recipe.created";
export const RECIPE_EVENT_UPDATED = "lifeatlas.recipe.updated";
export const RECIPE_EVENT_DELETED = "lifeatlas.recipe.deleted";

export type CloudEventEnvelope = {
  specversion?: string;
  id: string;
  source?: string;
  type: string;
  time?: string;
  eventVersion?: string;
  data: unknown;
};

type SnapshotData = {
  recipeId: string;
  title: string;
  author?: string | null;
  creatorId?: string | null;
  mealSlots?: string[];
  ingredients?: Array<{
    ingredientId: string;
    name: string;
    quantity: number;
    unit: string;
  }>;
  updatedAt: string;
};

type DeletedData = {
  recipeId: string;
  deletedAt: string;
};

export type ApplyResult =
  | { status: "applied"; eventId: string; type: string }
  | { status: "duplicate"; eventId: string }
  | { status: "ignored"; reason: string };

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  return data as Record<string, unknown>;
}

/** Normalize .NET PascalCase or camelCase payloads. */
function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    if (obj[lower] !== undefined && obj[lower] !== null) return obj[lower] as T;
  }
  return undefined;
}

function normalizeSnapshot(data: unknown): SnapshotData {
  const o = asRecord(data);
  const recipeId = String(pick(o, "RecipeId", "recipeId") ?? "");
  const title = String(pick(o, "Title", "title") ?? "");
  const updatedAt = String(pick(o, "UpdatedAt", "updatedAt") ?? new Date().toISOString());
  const mealSlots = (pick<string[]>(o, "MealSlots", "mealSlots") ?? []).map((s) =>
    String(s).toLowerCase(),
  );
  const rawIngredients = pick<unknown[]>(o, "Ingredients", "ingredients") ?? [];
  const ingredients = rawIngredients.map((line) => {
    const l = asRecord(line);
    return {
      ingredientId: String(pick(l, "IngredientId", "ingredientId") ?? ""),
      name: String(pick(l, "Name", "name") ?? ""),
      quantity: Number(pick(l, "Quantity", "quantity") ?? 0),
      unit: String(pick(l, "Unit", "unit") ?? "pcs").toLowerCase(),
    };
  });
  return {
    recipeId,
    title,
    author: (pick<string | null>(o, "Author", "author") ?? null) as string | null,
    creatorId: (pick<string | null>(o, "CreatorId", "creatorId") ?? null) as string | null,
    mealSlots,
    ingredients,
    updatedAt,
  };
}

function normalizeDeleted(data: unknown): DeletedData {
  const o = asRecord(data);
  return {
    recipeId: String(pick(o, "RecipeId", "recipeId") ?? ""),
    deletedAt: String(pick(o, "DeletedAt", "deletedAt") ?? new Date().toISOString()),
  };
}

function toLines(
  ingredients: SnapshotData["ingredients"],
): RecipeIngredientLine[] {
  return (ingredients ?? [])
    .filter((i) => i.ingredientId)
    .map((i) => ({
      ingredientId: i.ingredientId,
      name: i.name || i.ingredientId,
      quantity: i.quantity,
      unit: (["pcs", "g", "ml", "pack"].includes(i.unit) ? i.unit : "pcs") as Unit,
    }));
}

export class RecipeEventIngestService {
  private readonly projections: RecipeProjectionRepository;

  constructor(private readonly db: Pool) {
    this.projections = new RecipeProjectionRepository(db);
  }

  async applyCloudEvent(raw: unknown): Promise<ApplyResult> {
    const event = raw as CloudEventEnvelope;
    if (!event?.id || !event?.type) {
      return { status: "ignored", reason: "missing id or type" };
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO processed_cloud_events (event_id, event_type, recipe_id)
         VALUES ($1, $2, NULL)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.id, event.type],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        await client.query("COMMIT");
        return { status: "duplicate", eventId: event.id };
      }

      if (event.type === RECIPE_EVENT_CREATED || event.type === RECIPE_EVENT_UPDATED) {
        const snap = normalizeSnapshot(event.data);
        if (!snap.recipeId || !snap.title) {
          await client.query("ROLLBACK");
          return { status: "ignored", reason: "invalid snapshot payload" };
        }
        await this.projections.upsertSnapshot(client, {
          recipeId: snap.recipeId,
          title: snap.title,
          author: snap.author ?? null,
          creatorId: snap.creatorId ?? null,
          mealSlots: snap.mealSlots ?? [],
          ingredients: toLines(snap.ingredients),
          sourceUpdatedAt: new Date(snap.updatedAt),
          eventId: event.id,
          eventType: event.type,
        });
        await client.query(
          `UPDATE processed_cloud_events SET recipe_id = $2 WHERE event_id = $1`,
          [event.id, snap.recipeId],
        );
      } else if (event.type === RECIPE_EVENT_DELETED) {
        const del = normalizeDeleted(event.data);
        if (!del.recipeId) {
          await client.query("ROLLBACK");
          return { status: "ignored", reason: "invalid deleted payload" };
        }
        await this.projections.softDelete(
          client,
          del.recipeId,
          new Date(del.deletedAt),
          event.id,
          event.type,
        );
        await client.query(
          `UPDATE processed_cloud_events SET recipe_id = $2 WHERE event_id = $1`,
          [event.id, del.recipeId],
        );
      } else {
        await client.query("COMMIT");
        return { status: "ignored", reason: `unknown type ${event.type}` };
      }

      await client.query("COMMIT");
      return { status: "applied", eventId: event.id, type: event.type };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
