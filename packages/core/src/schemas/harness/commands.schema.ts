import { z } from "zod";

export const CanonicalCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), message: z.string() }).strict(),
  z.object({ type: z.literal("abort") }).strict(),
  z.object({ type: z.literal("dehydrate") }).strict(),
  z
    .object({
      type: z.literal("question_response"),
      answers: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("step_complete_result"),
      success: z.boolean(),
      ok: z.boolean(),
      error: z.string().optional(),
      missing_fields: z.array(z.string()).optional(),
      remediation_prompt: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("spawn_subagent_async_result"),
      success: z.boolean(),
      execution_id: z.string().optional(),
      error: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("wait_for_subagents_result"),
      success: z.boolean(),
      results: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("check_subagent_status_result"),
      success: z.boolean(),
      status: z.unknown().optional(),
    })
    .strict(),
]);

export type CanonicalCommand = z.infer<typeof CanonicalCommandSchema>;
