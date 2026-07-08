import { z } from "zod";

const optionalNonEmptyStringSchema = z.string().trim().min(1).optional();

export const runRetrospectiveSchema = z.object({
  project_id: z.string().trim().min(1, "project_id is required"),
  orchestration_id: optionalNonEmptyStringSchema,
  trigger_revision_marker: optionalNonEmptyStringSchema,
  replay_of_run_id: optionalNonEmptyStringSchema,
  manual_override: z.boolean().optional(),
});
