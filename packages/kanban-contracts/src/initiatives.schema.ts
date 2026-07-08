import { z } from "zod";

export const InitiativeHorizonSchema = z.enum(["now", "next", "later"]);
export const InitiativeStatusSchema = z.enum([
  "proposed",
  "active",
  "paused",
  "done",
  "dropped",
]);

export const InitiativeSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable(),
    horizon: InitiativeHorizonSchema,
    priority: z.number().int(),
    status: InitiativeStatusSchema,
    goalIds: z.array(z.string().min(1)),
    lastReviewedAt: z.string().nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const CreateInitiativeRequestSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    horizon: InitiativeHorizonSchema.optional().default("next"),
    priority: z.number().int().optional(),
    status: InitiativeStatusSchema.optional(),
    goalIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const UpdateInitiativeRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    horizon: InitiativeHorizonSchema.optional(),
    priority: z.number().int().optional(),
  })
  .strict();

export const UpdateInitiativeStatusRequestSchema = z
  .object({
    status: InitiativeStatusSchema,
  })
  .strict();
