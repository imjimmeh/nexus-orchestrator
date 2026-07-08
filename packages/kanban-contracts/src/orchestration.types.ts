import type { z } from "zod";

import type {
  OrchestrationModeSchema,
  OrchestrationStateSchema,
  OrchestrationStatusSchema,
  ProjectImportStrategySchema,
  ProjectOrchestrationActionRequestListItemSchema,
  ProjectOrchestrationActionRequestSchema,
  ProjectOrchestrationActionRequestStatusSchema,
  ProjectOrchestrationDecisionEntrySchema,
  ProjectOrchestrationModeSchema,
  ProjectOrchestrationSchema,
  ProjectOrchestrationStateSchema,
  ProjectOrchestrationStatusSchema,
  ProjectStateSnapshotSchema,
  ProjectStateWorkItemSchema,
  StartOrchestrationInputSchema,
  StartupRoutingSourceContextSchema,
  StartupRoutingReadinessContextSchema,
  StartupRoutingHintsSchema,
} from "./orchestration.schema";

export type OrchestrationMode = z.infer<typeof OrchestrationModeSchema>;
export type OrchestrationStatus = z.infer<typeof OrchestrationStatusSchema>;
export type OrchestrationState = z.infer<typeof OrchestrationStateSchema>;
export type StartupRoutingSourceContext = z.infer<
  typeof StartupRoutingSourceContextSchema
>;
export type StartupRoutingReadinessContext = z.infer<
  typeof StartupRoutingReadinessContextSchema
>;
export type StartupRoutingHints = z.infer<typeof StartupRoutingHintsSchema>;
export type StartOrchestrationInput = z.infer<
  typeof StartOrchestrationInputSchema
>;
export type ProjectOrchestrationStatus = z.infer<
  typeof ProjectOrchestrationStatusSchema
>;
export type ProjectOrchestrationMode = z.infer<
  typeof ProjectOrchestrationModeSchema
>;
export type ProjectImportStrategy = z.infer<typeof ProjectImportStrategySchema>;
export type ProjectOrchestrationDecisionEntry = z.infer<
  typeof ProjectOrchestrationDecisionEntrySchema
>;
export type ProjectOrchestrationActionRequestStatus = z.infer<
  typeof ProjectOrchestrationActionRequestStatusSchema
>;
export type ProjectOrchestrationActionRequest = z.infer<
  typeof ProjectOrchestrationActionRequestSchema
>;
export type ProjectOrchestrationActionRequestListItem = z.infer<
  typeof ProjectOrchestrationActionRequestListItemSchema
>;
export type ProjectOrchestration = z.infer<typeof ProjectOrchestrationSchema>;
export type ProjectStateWorkItem = z.infer<typeof ProjectStateWorkItemSchema>;
export type ProjectStateSnapshot = z.infer<typeof ProjectStateSnapshotSchema>;
export type ProjectOrchestrationState = z.infer<
  typeof ProjectOrchestrationStateSchema
>;
