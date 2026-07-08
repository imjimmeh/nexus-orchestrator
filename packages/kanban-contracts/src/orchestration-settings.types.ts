import type { z } from "zod";
import type {
  OrchestrationWakePolicySchema,
  ProjectOrchestrationSettingsSchema,
} from "./orchestration-settings.schema";

export type OrchestrationWakePolicy = z.infer<
  typeof OrchestrationWakePolicySchema
>;

export type ProjectOrchestrationSettings = z.infer<
  typeof ProjectOrchestrationSettingsSchema
>;
