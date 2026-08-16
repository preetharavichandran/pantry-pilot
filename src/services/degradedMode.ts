import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { RecipeProjectionRepository } from "../db/repositories/recipeProjectionRepo.js";

export type DegradedSnapshot = {
  emptyProjection: boolean;
  projectionStale: boolean;
  activeRecipeCount: number;
  newestProjectedAt: string | null;
  staleAfterMs: number;
  kafkaEnabled: boolean;
  bullmqEnabled: boolean;
  /** Human-readable reasons suitable for a UI banner. */
  banners: string[];
};

export async function getDegradedSnapshot(
  db: Pool,
  config: AppConfig,
  opts?: { bullmqActive?: boolean },
): Promise<DegradedSnapshot> {
  const projections = new RecipeProjectionRepository(db);
  const activeRecipeCount = await projections.countActive();
  const maxProjected = await projections.maxProjectedAt();
  const emptyProjection = activeRecipeCount === 0;
  const projectionStale =
    emptyProjection ||
    !maxProjected ||
    Date.now() - maxProjected.getTime() > config.projectionStaleAfterMs;

  const banners: string[] = [];
  if (emptyProjection) {
    banners.push(
      "No recipes in local projection. Enable Kafka (KAFKA_ENABLED=true) or run npm run seed:projections.",
    );
  } else if (projectionStale) {
    banners.push(
      "Recipe projection may be stale — last event older than freshness window. Planning still uses cached recipes.",
    );
  }
  if (!config.kafka.enabled) {
    banners.push("Kafka consumer is off (KAFKA_ENABLED!=true). Projection will not receive live RecipeHub events.");
  }

  return {
    emptyProjection,
    projectionStale,
    activeRecipeCount,
    newestProjectedAt: maxProjected ? maxProjected.toISOString() : null,
    staleAfterMs: config.projectionStaleAfterMs,
    kafkaEnabled: config.kafka.enabled,
    bullmqEnabled: opts?.bullmqActive ?? config.bullmqEnabled,
    banners,
  };
}
