import { Queue, type ConnectionOptions } from "bullmq";
import type { AppConfig } from "../config.js";

export const QUEUE_PLAN_GENERATE = "plan.generate";
export const QUEUE_RECIPE_INGEST = "recipe.ingest";
export const QUEUE_DEFERRED_CONFIRM = "plan.confirm.deferred";

export type PlanGenerateJob = {
  householdId: string;
  ownerSub: string;
  objective?: "normal" | "use_stock";
  horizonStart?: string;
};

export type RecipeIngestJob = {
  cloudEvent: unknown;
};

export type DeferredConfirmJob = {
  householdId: string;
  planId: string;
  horizonEnd: string;
};

export type JobQueues = {
  planGenerate: Queue<PlanGenerateJob>;
  recipeIngest: Queue<RecipeIngestJob>;
  deferredConfirm: Queue<DeferredConfirmJob>;
  connection: ConnectionOptions;
};

export function redisConnection(config: AppConfig): ConnectionOptions {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export function createQueues(config: AppConfig): JobQueues {
  const connection = redisConnection(config);
  return {
    connection,
    planGenerate: new Queue<PlanGenerateJob>(QUEUE_PLAN_GENERATE, { connection }),
    recipeIngest: new Queue<RecipeIngestJob>(QUEUE_RECIPE_INGEST, { connection }),
    deferredConfirm: new Queue<DeferredConfirmJob>(QUEUE_DEFERRED_CONFIRM, { connection }),
  };
}

export async function closeQueues(queues: JobQueues): Promise<void> {
  await Promise.all([
    queues.planGenerate.close(),
    queues.recipeIngest.close(),
    queues.deferredConfirm.close(),
  ]);
}
