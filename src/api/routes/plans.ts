import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DomainError } from "../../domain/household.js";
import type { InventoryLoopService } from "../../services/inventoryLoopService.js";
import type { PlanService } from "../../services/planService.js";
import type { JobQueues } from "../../workers/queues.js";
import { sendProblem } from "../errors.js";
import {
  serializeMealPlan,
  serializePantryItem,
  serializePlannedMeal,
  serializeShoppingList,
  serializeShoppingItem,
} from "../serialize.js";

const generateBodySchema = z.object({
  objective: z.enum(["normal", "use_stock"]).optional(),
  horizonStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** When true, enqueue BullMQ plan job and return 202. */
  async: z.boolean().optional(),
});

const checkoffBodySchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

const confirmBodySchema = z.object({
  outcome: z.enum(["all", "mostly", "no"]),
  skippedMealIds: z.array(z.string().uuid()).optional(),
  leftovers: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        quantity: z.number().positive(),
        unit: z.enum(["pcs", "g", "ml", "pack"]),
        name: z.string().optional(),
      }),
    )
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function registerPlanRoutes(
  app: FastifyInstance,
  plans: PlanService,
  inventory: InventoryLoopService,
  queues: JobQueues | null,
): Promise<void> {
  app.post<{ Params: { id: string } }>("/households/:id/plans", async (request, reply) => {
    const parsed = generateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendProblem(reply, {
        status: 400,
        title: "Bad Request",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
        type: "https://lifeatlas.local/problems/validation",
      });
    }
    try {
      if (parsed.data.async) {
        if (!queues) {
          return sendProblem(reply, {
            status: 503,
            title: "Jobs unavailable",
            detail: "BullMQ/Redis not enabled (BULLMQ_ENABLED!=true)",
            type: "https://lifeatlas.local/problems/jobs_unavailable",
          });
        }
        const job = await queues.planGenerate.add(
          "generate",
          {
            householdId: request.params.id,
            ownerSub: request.user!.sub,
            objective: parsed.data.objective,
            horizonStart: parsed.data.horizonStart,
          },
          { removeOnComplete: 100, removeOnFail: 50 },
        );
        return reply.status(202).send({
          jobId: job.id,
          status: "queued",
          queue: "plan.generate",
        });
      }

      const result = await plans.generate(request.params.id, request.user!.sub, parsed.data);
      if (queues) {
        await queues.deferredConfirm.add(
          "nudge",
          {
            householdId: request.params.id,
            planId: result.plan.id,
            horizonEnd: result.plan.horizonEnd,
          },
          {
            delay: Math.max(0, Date.parse(`${result.plan.horizonEnd}T23:59:59Z`) - Date.now()),
            removeOnComplete: 100,
            removeOnFail: 50,
            jobId: `confirm-nudge-${result.plan.id}`,
          },
        );
      }
      return reply.status(201).send({
        plan: serializeMealPlan(result.plan),
        meals: result.meals.map(serializePlannedMeal),
        shoppingList: serializeShoppingList(result.shoppingList),
        shoppingItems: result.shoppingItems.map(serializeShoppingItem),
        degraded: result.degraded,
      });
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/households/:id/plans/current",
    async (request, reply) => {
      try {
        const current = await plans.getCurrent(request.params.id, request.user!.sub);
        if (!current) {
          return sendProblem(reply, {
            status: 404,
            title: "Not Found",
            detail: "No active plan",
            type: "https://lifeatlas.local/problems/not_found",
          });
        }
        return {
          plan: serializeMealPlan(current.plan),
          meals: current.meals.map(serializePlannedMeal),
        };
      } catch (err) {
        return mapDomainError(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/households/:id/shopping-lists/current",
    async (request, reply) => {
      try {
        const current = await plans.getCurrentShoppingList(request.params.id, request.user!.sub);
        if (!current) {
          return sendProblem(reply, {
            status: 404,
            title: "Not Found",
            detail: "No active shopping list",
            type: "https://lifeatlas.local/problems/not_found",
          });
        }
        return {
          shoppingList: serializeShoppingList(current.list),
          items: current.items.map(serializeShoppingItem),
        };
      } catch (err) {
        return mapDomainError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string; planId: string; mealId: string } }>(
    "/households/:id/plans/:planId/meals/:mealId/replace",
    async (request, reply) => {
      try {
        const result = await plans.replaceMeal(
          request.params.id,
          request.user!.sub,
          request.params.planId,
          request.params.mealId,
        );
        return {
          meal: serializePlannedMeal(result.meal),
          shoppingList: serializeShoppingList(result.shoppingList),
          shoppingItems: result.shoppingItems.map(serializeShoppingItem),
        };
      } catch (err) {
        return mapDomainError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string; listId: string } }>(
    "/households/:id/shopping-lists/:listId/checkoffs",
    async (request, reply) => {
      const parsed = checkoffBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(reply, {
          status: 400,
          title: "Bad Request",
          detail: parsed.error.issues.map((i) => i.message).join("; "),
          type: "https://lifeatlas.local/problems/validation",
        });
      }
      try {
        const result = await inventory.checkOff(
          request.params.id,
          request.user!.sub,
          request.params.listId,
          parsed.data.itemIds,
        );
        return {
          newlyChecked: result.newlyChecked.map(serializeShoppingItem),
          shoppingList: serializeShoppingList(result.shoppingList),
          items: result.items.map(serializeShoppingItem),
          pantry: result.pantry.map(serializePantryItem),
        };
      } catch (err) {
        return mapDomainError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string; planId: string } }>(
    "/households/:id/plans/:planId/confirm",
    async (request, reply) => {
      const parsed = confirmBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(reply, {
          status: 400,
          title: "Bad Request",
          detail: parsed.error.issues.map((i) => i.message).join("; "),
          type: "https://lifeatlas.local/problems/validation",
        });
      }
      try {
        const result = await inventory.confirmCooked(
          request.params.id,
          request.user!.sub,
          request.params.planId,
          parsed.data,
        );
        return {
          confirmation: {
            id: result.confirmation.id,
            planId: result.confirmation.planId,
            outcome: result.confirmation.outcome,
            skippedMealIds: result.confirmation.skippedMealIds,
            leftovers: result.confirmation.leftovers,
            notes: result.confirmation.notes,
            createdAt: result.confirmation.createdAt.toISOString(),
          },
          pantry: result.pantry.map(serializePantryItem),
        };
      } catch (err) {
        return mapDomainError(reply, err);
      }
    },
  );
}

function mapDomainError(reply: FastifyReply, err: unknown) {
  if (err instanceof DomainError) {
    return sendProblem(reply, {
      status: err.status,
      title: err.code,
      detail: err.message,
      type: `https://lifeatlas.local/problems/${err.code}`,
    });
  }
  throw err;
}
