import { z } from "zod";

export const OrchestrationWakePolicySchema = z.enum([
  "slot_freed",
  "every_terminal",
]);

export const ProjectOrchestrationSettingsSchema = z
  .object({
    wakePolicy: OrchestrationWakePolicySchema.optional(),
  })
  .strict();

/**
 * Parse a persisted orchestration-settings blob, returning an empty object when
 * the value is missing or fails validation so callers can fall back to the
 * global setting.
 */
export function resolveProjectOrchestrationSettings(
  raw: unknown,
): z.infer<typeof ProjectOrchestrationSettingsSchema> {
  const result = ProjectOrchestrationSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}
