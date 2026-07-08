import { z } from "zod";

export const StepCompleteSchema = z
  .object({
    action: z.literal("step_complete"),
    summary: z.string().trim().min(1).optional(),
    reasoning: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
  })
  .strict();

export * from "./misc.types";
