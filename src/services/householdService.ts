import type { Pool } from "pg";
import { DomainError, assertHouseholdCreate, assertHouseholdPatch, assertPantryUpsert } from "../domain/household.js";
import type {
  Household,
  HouseholdCreateInput,
  HouseholdPatchInput,
  PantryItem,
  PantryItemInput,
} from "../domain/types.js";
import { HouseholdRepository } from "../db/repositories/householdRepo.js";
import { PantryRepository } from "../db/repositories/pantryRepo.js";

export class HouseholdService {
  private readonly households: HouseholdRepository;
  private readonly pantry: PantryRepository;

  constructor(private readonly db: Pool) {
    this.households = new HouseholdRepository(db);
    this.pantry = new PantryRepository(db);
  }

  async create(ownerSub: string, raw: HouseholdCreateInput): Promise<{
    household: Household;
    pantry: PantryItem[];
  }> {
    const input = assertHouseholdCreate(raw);
    const existing = await this.households.findByOwnerSub(ownerSub);
    if (existing) {
      throw new DomainError(
        "User already owns a household (v1: one household per user)",
        "household_exists",
        409,
      );
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const household = await this.households.createWithClient(client, ownerSub, input);
      if (input.pantrySeed && input.pantrySeed.length > 0) {
        await this.pantry.replaceAllWithClient(client, household.id, input.pantrySeed);
      }
      await client.query("COMMIT");
      const pantry = await this.pantry.listByHousehold(household.id);
      return { household, pantry };
    } catch (err) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "User already owns a household (v1: one household per user)",
          "household_exists",
          409,
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async getForOwner(id: string, ownerSub: string): Promise<Household> {
    const household = await this.requireOwned(id, ownerSub);
    return household;
  }

  async patch(id: string, ownerSub: string, raw: HouseholdPatchInput): Promise<Household> {
    await this.requireOwned(id, ownerSub);
    const input = assertHouseholdPatch(raw);
    const updated = await this.households.patch(id, input);
    if (!updated) {
      throw new DomainError("Household not found", "not_found", 404);
    }
    return updated;
  }

  async getPantry(id: string, ownerSub: string): Promise<PantryItem[]> {
    await this.requireOwned(id, ownerSub);
    return this.pantry.listByHousehold(id);
  }

  async putPantry(id: string, ownerSub: string, items: PantryItemInput[]): Promise<PantryItem[]> {
    await this.requireOwned(id, ownerSub);
    const validated = assertPantryUpsert(items);
    return this.pantry.replaceAll(id, validated);
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
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
