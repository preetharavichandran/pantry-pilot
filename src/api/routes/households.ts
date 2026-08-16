import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DomainError } from "../../domain/household.js";
import type { Unit } from "../../domain/types.js";
import type { HouseholdService } from "../../services/householdService.js";
import { sendProblem } from "../errors.js";
import { serializeHousehold, serializePantryItem } from "../serialize.js";

const pantryItemSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: z.number().nonnegative(),
  unit: z.enum(["pcs", "g", "ml", "pack"]),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const createBodySchema = z.object({
  size: z.number().int().min(1).max(20),
  budgetSoft: z.number().nonnegative().nullable().optional(),
  planHorizonDays: z.number().int().min(1).max(14).optional(),
  breakfastEnabled: z.boolean().optional(),
  lunchEnabled: z.boolean().optional(),
  dinnerEnabled: z.boolean().optional(),
  pantrySeed: z.array(pantryItemSchema).optional(),
});

const patchBodySchema = z.object({
  size: z.number().int().min(1).max(20).optional(),
  budgetSoft: z.number().nonnegative().nullable().optional(),
  planHorizonDays: z.number().int().min(1).max(14).optional(),
  breakfastEnabled: z.boolean().optional(),
  lunchEnabled: z.boolean().optional(),
  dinnerEnabled: z.boolean().optional(),
});

const putPantrySchema = z.object({
  items: z.array(pantryItemSchema),
});

function toPantryInputs(items: z.infer<typeof pantryItemSchema>[]) {
  return items.map((i) => ({
    ingredientId: i.ingredientId,
    quantity: i.quantity,
    unit: i.unit as Unit,
    expiryDate: i.expiryDate ?? null,
  }));
}

export async function registerHouseholdRoutes(
  app: FastifyInstance,
  service: HouseholdService,
): Promise<void> {
  app.post("/households", async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(reply, {
        status: 400,
        title: "Bad Request",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
        type: "https://lifeatlas.local/problems/validation",
      });
    }
    try {
      const { pantrySeed, ...prefs } = parsed.data;
      const result = await service.create(request.user!.sub, {
        ...prefs,
        pantrySeed: pantrySeed ? toPantryInputs(pantrySeed) : undefined,
      });
      return reply.status(201).send({
        household: serializeHousehold(result.household),
        pantry: result.pantry.map(serializePantryItem),
        seedSkipped: !pantrySeed || pantrySeed.length === 0,
      });
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/households/:id", async (request, reply) => {
    try {
      const household = await service.getForOwner(request.params.id, request.user!.sub);
      return { household: serializeHousehold(household) };
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });

  app.patch<{ Params: { id: string } }>("/households/:id", async (request, reply) => {
    const parsed = patchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(reply, {
        status: 400,
        title: "Bad Request",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
        type: "https://lifeatlas.local/problems/validation",
      });
    }
    try {
      const household = await service.patch(request.params.id, request.user!.sub, parsed.data);
      return { household: serializeHousehold(household) };
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>("/households/:id/pantry", async (request, reply) => {
    try {
      const pantry = await service.getPantry(request.params.id, request.user!.sub);
      return { items: pantry.map(serializePantryItem) };
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>("/households/:id/pantry", async (request, reply) => {
    const parsed = putPantrySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(reply, {
        status: 400,
        title: "Bad Request",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
        type: "https://lifeatlas.local/problems/validation",
      });
    }
    try {
      const pantry = await service.putPantry(
        request.params.id,
        request.user!.sub,
        toPantryInputs(parsed.data.items),
      );
      return { items: pantry.map(serializePantryItem) };
    } catch (err) {
      return mapDomainError(reply, err);
    }
  });
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
