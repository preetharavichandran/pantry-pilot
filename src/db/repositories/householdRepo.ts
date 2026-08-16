import type { Pool, PoolClient } from "pg";
import type { Household, HouseholdCreateInput, HouseholdPatchInput } from "../../domain/types.js";

type HouseholdRow = {
  id: string;
  owner_sub: string;
  size: number;
  budget_soft: string | null;
  plan_horizon_days: number;
  breakfast_enabled: boolean;
  lunch_enabled: boolean;
  dinner_enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

function mapHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    ownerSub: row.owner_sub,
    size: row.size,
    budgetSoft: row.budget_soft == null ? null : Number(row.budget_soft),
    planHorizonDays: row.plan_horizon_days,
    breakfastEnabled: row.breakfast_enabled,
    lunchEnabled: row.lunch_enabled,
    dinnerEnabled: row.dinner_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class HouseholdRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string): Promise<Household | null> {
    const result = await this.db.query<HouseholdRow>("SELECT * FROM households WHERE id = $1", [
      id,
    ]);
    return result.rows[0] ? mapHousehold(result.rows[0]) : null;
  }

  async findByOwnerSub(ownerSub: string): Promise<Household | null> {
    const result = await this.db.query<HouseholdRow>(
      "SELECT * FROM households WHERE owner_sub = $1",
      [ownerSub],
    );
    return result.rows[0] ? mapHousehold(result.rows[0]) : null;
  }

  async create(ownerSub: string, input: HouseholdCreateInput): Promise<Household> {
    const result = await this.db.query<HouseholdRow>(
      `INSERT INTO households (
         owner_sub, size, budget_soft, plan_horizon_days,
         breakfast_enabled, lunch_enabled, dinner_enabled
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        ownerSub,
        input.size,
        input.budgetSoft ?? null,
        input.planHorizonDays ?? 3,
        input.breakfastEnabled ?? true,
        input.lunchEnabled ?? false,
        input.dinnerEnabled ?? true,
      ],
    );
    return mapHousehold(result.rows[0]!);
  }

  async createWithClient(
    client: PoolClient,
    ownerSub: string,
    input: HouseholdCreateInput,
  ): Promise<Household> {
    const result = await client.query<HouseholdRow>(
      `INSERT INTO households (
         owner_sub, size, budget_soft, plan_horizon_days,
         breakfast_enabled, lunch_enabled, dinner_enabled
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        ownerSub,
        input.size,
        input.budgetSoft ?? null,
        input.planHorizonDays ?? 3,
        input.breakfastEnabled ?? true,
        input.lunchEnabled ?? false,
        input.dinnerEnabled ?? true,
      ],
    );
    return mapHousehold(result.rows[0]!);
  }

  async patch(id: string, input: HouseholdPatchInput): Promise<Household | null> {
    const result = await this.db.query<HouseholdRow>(
      `UPDATE households SET
         size = COALESCE($2, size),
         budget_soft = CASE WHEN $3::boolean THEN $4 ELSE budget_soft END,
         plan_horizon_days = COALESCE($5, plan_horizon_days),
         breakfast_enabled = COALESCE($6, breakfast_enabled),
         lunch_enabled = COALESCE($7, lunch_enabled),
         dinner_enabled = COALESCE($8, dinner_enabled),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.size ?? null,
        input.budgetSoft !== undefined,
        input.budgetSoft === undefined ? null : input.budgetSoft,
        input.planHorizonDays ?? null,
        input.breakfastEnabled ?? null,
        input.lunchEnabled ?? null,
        input.dinnerEnabled ?? null,
      ],
    );
    return result.rows[0] ? mapHousehold(result.rows[0]) : null;
  }
}
