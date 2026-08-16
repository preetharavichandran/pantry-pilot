import Fastify from "fastify";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import type { RecipeHubClient } from "../integrations/recipeHubClient.js";
import { RecipeEventIngestService } from "../integrations/recipeEvents.js";
import { HouseholdService } from "../services/householdService.js";
import { InventoryLoopService } from "../services/inventoryLoopService.js";
import { PlanService } from "../services/planService.js";
import { getDegradedSnapshot } from "../services/degradedMode.js";
import type { JobQueues } from "../workers/queues.js";
import { authHook, createAuthVerifier } from "./auth.js";
import { sendProblem } from "./errors.js";
import { registerHouseholdRoutes } from "./routes/households.js";
import { registerPlanRoutes } from "./routes/plans.js";

export type AppDeps = {
  config: AppConfig;
  db: Db;
  recipeHub: RecipeHubClient;
  queues: JobQueues | null;
};

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: true });
  const verify = createAuthVerifier(deps.config);
  const households = new HouseholdService(deps.db);
  const plans = new PlanService(deps.db, {
    projectionStaleAfterMs: deps.config.projectionStaleAfterMs,
  });
  const inventory = new InventoryLoopService(deps.db);
  const ingest = new RecipeEventIngestService(deps.db);

  app.get("/health", async (_request, reply) => {
    let dbOk = false;
    try {
      await deps.db.query("SELECT 1");
      dbOk = true;
    } catch (err) {
      app.log.error({ err }, "health db check failed");
    }

    if (!dbOk) {
      return reply.status(503).send({
        status: "unhealthy",
        service: "pantry-pilot",
        checks: { database: false },
      });
    }

    const degraded = await getDegradedSnapshot(deps.db, deps.config, {
      bullmqActive: !!deps.queues,
    });
    return {
      status: degraded.emptyProjection ? "degraded" : "ok",
      service: "pantry-pilot",
      checks: { database: true },
      recipeHubBaseUrl: deps.config.recipeHubBaseUrl,
      kafkaEnabled: deps.config.kafka.enabled,
      bullmqEnabled: deps.config.bullmqEnabled && !!deps.queues,
      activeRecipeProjections: degraded.activeRecipeCount,
      degraded,
    };
  });

  app.register(async (secured) => {
    secured.addHook("preHandler", authHook(verify));
    await registerHouseholdRoutes(secured, households);
    await registerPlanRoutes(secured, plans, inventory, deps.queues);

    secured.get("/integrations/recipe-hub/ping", async (_request, reply) => {
      try {
        const recipes = await deps.recipeHub.listRecipes({ take: 1 });
        return { ok: true, sampleCount: recipes.length };
      } catch (err) {
        return sendProblem(reply, {
          status: 503,
          title: "RecipeHub unavailable",
          detail: err instanceof Error ? err.message : "Unknown error",
          type: "https://lifeatlas.local/problems/recipehub_unavailable",
        });
      }
    });

    if (deps.config.auth.mode === "Development") {
      secured.post("/dev/recipe-events", async (request, reply) => {
        try {
          if (deps.queues) {
            const job = await deps.queues.recipeIngest.add(
              "event",
              { cloudEvent: request.body },
              { removeOnComplete: 100, removeOnFail: 50 },
            );
            return reply.status(202).send({ status: "queued", jobId: job.id });
          }
          const result = await ingest.applyCloudEvent(request.body);
          return reply.status(result.status === "applied" ? 202 : 200).send(result);
        } catch (err) {
          return sendProblem(reply, {
            status: 400,
            title: "Bad event",
            detail: err instanceof Error ? err.message : "Invalid CloudEvent",
            type: "https://lifeatlas.local/problems/bad_event",
          });
        }
      });
    }
  });

  app.setErrorHandler((err, _request, reply) => {
    app.log.error(err);
    if (reply.sent) return;
    return sendProblem(reply, {
      status: 500,
      title: "Internal Server Error",
      detail: "Unexpected error",
      type: "https://lifeatlas.local/problems/internal",
    });
  });

  return app;
}
