import type { Pool, PoolClient } from "pg";
import type { PantryItem, PantryItemInput, Unit } from "../../domain/types.js";

type PantryRow = {
  id: string;
  household_id: string;
  ingredient_id: string;
  quantity: string;
  unit: Unit;
  expiry_date: string | null;
  updated_at: Date;
};

function mapPantry(row: PantryRow): PantryItem {
  return {
    id: row.id,
    householdId: row.household_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    unit: row.unit,
    expiryDate: row.expiry_date,
    updatedAt: row.updated_at,
  };
}

export class PantryRepository {
  constructor(private readonly db: Pool) {}

  async listByHousehold(householdId: string): Promise<PantryItem[]> {
    const result = await this.db.query<PantryRow>(
      `SELECT * FROM pantry_items WHERE household_id = $1 ORDER BY ingredient_id`,
      [householdId],
    );
    return result.rows.map(mapPantry);
  }

  /** Replace-all upsert: deletes rows not in payload, upserts the rest. */
  async replaceAll(householdId: string, items: PantryItemInput[]): Promise<PantryItem[]> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.replaceAllWithClient(client, householdId, items);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return this.listByHousehold(householdId);
  }

  async replaceAllWithClient(
    client: PoolClient,
    householdId: string,
    items: PantryItemInput[],
  ): Promise<void> {
    if (items.length === 0) {
      await client.query("DELETE FROM pantry_items WHERE household_id = $1", [householdId]);
      return;
    }

    const ids = items.map((i) => i.ingredientId);
    await client.query(
      `DELETE FROM pantry_items
       WHERE household_id = $1
         AND ingredient_id <> ALL($2::uuid[])`,
      [householdId, ids],
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO pantry_items (household_id, ingredient_id, quantity, unit, expiry_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (household_id, ingredient_id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           unit = EXCLUDED.unit,
           expiry_date = EXCLUDED.expiry_date,
           updated_at = now()`,
        [
          householdId,
          item.ingredientId,
          item.quantity,
          item.unit,
          item.expiryDate ?? null,
        ],
      );
    }
  }

  /**
   * Merge absolute pantry state from delta application.
   * Note: unique is per ingredient_id (not unit); last write wins on unit.
   */
  async replaceMergedState(
    client: PoolClient,
    householdId: string,
    items: PantryItemInput[],
  ): Promise<PantryItem[]> {
    await this.replaceAllWithClient(client, householdId, items);
    const result = await client.query<PantryRow>(
      `SELECT * FROM pantry_items WHERE household_id = $1 ORDER BY ingredient_id`,
      [householdId],
    );
    return result.rows.map(mapPantry);
  }
}
