import { z } from "zod";

export const TurnOutputSchema = z.object({
  ok: z.boolean(),
  response: z.string(),
  stopReason: z.string(),
  errorMessage: z.string().optional(),
  usage: z.unknown().optional(),
  /**
   * Set when the turn ended because the agent durably suspended (await /
   * delegate_*). The runtime server uses this to report a parked turn instead
   * of a normal/failed completion.
   */
  suspended: z.boolean().optional(),
});
export type TurnOutput = z.infer<typeof TurnOutputSchema>;

const base = {
  stepId: z.string().min(1),
  sessionTreeId: z.string().optional(),
  agentProfileName: z.string().optional(),
};

export const CanonicalSessionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn_start"), ...base }).strict(),
  z
    .object({
      type: z.literal("agent_telemetry"),
      ...base,
      telemetryType: z.enum([
        "text_start",
        "delta",
        "text_end",
        "thinking_end",
      ]),
      delta: z.string().optional(),
      content: z.string().optional(),
      messageId: z.string().optional(),
      responseId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_execution_start"),
      ...base,
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_execution_update"),
      ...base,
      toolCallId: z.string(),
      toolName: z.string(),
      partialResult: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_execution_end"),
      ...base,
      toolCallId: z.string(),
      toolName: z.string(),
      result: z.unknown(),
      isError: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("turn_end"), ...base, output: TurnOutputSchema })
    .strict(),
  z
    .object({ type: z.literal("agent_end"), ...base, output: TurnOutputSchema })
    .strict(),
  z
    .object({ type: z.literal("agent_error"), ...base, error: z.string() })
    .strict(),
]);

export type CanonicalSessionEvent = z.infer<typeof CanonicalSessionEventSchema>;
