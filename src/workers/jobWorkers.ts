import { Worker, type Processor } from "bullmq";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { RecipeEventIngestService } from "../integrations/recipeEvents.js";
import { PlanService } from "../services/planService.js";
import {
  QUEUE_DEFERRED_CONFIRM,
  QUEUE_PLAN_GENERATE,
  QUEUE_RECIPE_INGEST,
  redisConnection,
  type DeferredConfirmJob,
  type PlanGenerateJob,
  type RecipeIngestJob,
} from "./queues.js";

export type WorkerHandles = {
  close: () => Promise<void>;
};

type Log = {
  info: (o: unknown, msg?: string) => void;
  error: (o: unknown, msg?: string) => void;
  warn: (o: unknown, msg?: string) => void;
};

export function startJobWorkers(
  config: AppConfig,
  db: Pool,
  log: Log,
): WorkerHandles {
  const connection = redisConnection(config);
  const plans = new PlanService(db, {
    projectionStaleAfterMs: config.projectionStaleAfterMs,
  });
  const ingest = new RecipeEventIngestService(db);

  const planProcessor: Processor<PlanGenerateJob> = async (job) => {
    const result = await plans.generate(job.data.householdId, job.data.ownerSub, {
      objective: job.data.objective,
      horizonStart: job.data.horizonStart,
    });
    return { planId: result.plan.id, mealCount: result.meals.length };
  };

  const ingestProcessor: Processor<RecipeIngestJob> = async (job) => {
    return ingest.applyCloudEvent(job.data.cloudEvent);
  };

  const deferredProcessor: Processor<DeferredConfirmJob> = async (job) => {
    // Soft nudge job: records that the horizon ended and confirmation is due.
    // Domain mutations stay on the sync confirm API (human-in-the-loop).
    log.info(
      {
        householdId: job.data.householdId,
        planId: job.data.planId,
        horizonEnd: job.data.horizonEnd,
      },
      "deferred confirm nudge — ask cooked-as-planned?",
    );
    return { nudged: true };
  };

  const workers = [
    new Worker(QUEUE_PLAN_GENERATE, planProcessor, { connection, concurrency: 2 }),
    new Worker(QUEUE_RECIPE_INGEST, ingestProcessor, { connection, concurrency: 4 }),
    new Worker(QUEUE_DEFERRED_CONFIRM, deferredProcessor, { connection, concurrency: 2 }),
  ];

  for (const w of workers) {
    w.on("failed", (job, err) => {
      log.error({ err, jobId: job?.id, queue: w.name }, "BullMQ job failed");
    });
    w.on("completed", (job) => {
      log.info({ jobId: job.id, queue: w.name }, "BullMQ job completed");
    });
  }

  log.info(
    {
      queues: [QUEUE_PLAN_GENERATE, QUEUE_RECIPE_INGEST, QUEUE_DEFERRED_CONFIRM],
    },
    "BullMQ workers started",
  );

  return {
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
