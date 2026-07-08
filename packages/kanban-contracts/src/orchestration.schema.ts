import { z } from "zod";

export const OrchestrationModeSchema = z.enum(["supervised", "autonomous"]);

export const OrchestrationStatusSchema = z.enum([
  "initializing",
  "orchestrating",
  "paused",
  "completed",
]);

export const ProjectOrchestrationStatusSchema = z.enum([
  "idle",
  "initializing",
  "awaiting_approval",
  "bootstrapping",
  "orchestrating",
  "paused",
  "completed",
  "failed",
]);

export const ProjectOrchestrationModeSchema = z.enum([
  "autonomous",
  "supervised",
  "notifications_only",
]);

export const ProjectImportStrategySchema = z.enum([
  "assess_only",
  "assess_and_bootstrap",
]);

export const StartupRoutingSourceContextSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StartupRoutingReadinessContextSchema = z.object({
  isReady: z.boolean(),
  readinessReason: z.string().optional(),
  lastCheckedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StartupRoutingHintsSchema = z.object({
  preferredWorkflowId: z.string().optional(),
  preferredRouteId: z.string().optional(),
  skipRouteArbitration: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const OrchestrationStateSchema = z
  .object({
    project_id: z.string().min(1),
    goals: z.string(),
    mode: OrchestrationModeSchema,
    status: OrchestrationStatusSchema,
    linkedRunId: z.string().nullable(),
    updatedAt: z.string().min(1),
  })
  .strict();

export const StartOrchestrationInputSchema = z
  .object({
    goals: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    requestedBy: z.string().optional(),
    orchestrationMode: OrchestrationModeSchema.optional(),
    sourceContext: StartupRoutingSourceContextSchema.optional(),
    readinessContext: StartupRoutingReadinessContextSchema.optional(),
    startupHints: StartupRoutingHintsSchema.optional(),
  })
  .strict();

export const ProjectOrchestrationDecisionEntrySchema = z
  .object({
    timestamp: z.string().min(1),
    type: z.string().min(1),
    reasoning: z.string(),
    actions: z.array(z.string()),
    requestedAction: z
      .enum([
        "dispatch_start_work_items",
        "invoke_agent_workflow",
        "update_project_strategy",
        "create_agent_profile",
        "complete_orchestration",
      ])
      .optional(),
    modeEvaluation: z.enum(["allow", "deny", "require_approval"]).optional(),
    executionStatus: z
      .enum(["executed", "queued_for_approval", "denied", "failed"])
      .optional(),
    correlationId: z.string().optional(),
    recommendation: z.string().optional(),
    cycleDecision: z
      .enum(["repeat", "pause", "complete", "blocked"])
      .optional(),
    idempotencyKey: z.string().optional(),
    autonomousDefault: z.boolean().optional(),
    readyWorkRemaining: z.boolean().optional(),
  })
  .strict();

export const ProjectOrchestrationActionRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);

export const ProjectOrchestrationActionRequestSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    action: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).nullable(),
    workflowRunId: z.string().nullable(),
    modeAtRequest: ProjectOrchestrationModeSchema,
    requestedBy: z.string().nullable(),
    status: ProjectOrchestrationActionRequestStatusSchema,
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    rejectedBy: z.string().nullable(),
    rejectedAt: z.string().nullable(),
    rejectionReason: z.string().nullable(),
    executedAt: z.string().nullable(),
    errorMessage: z.string().nullable(),
    correlationId: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const ProjectOrchestrationActionRequestListItemSchema =
  ProjectOrchestrationActionRequestSchema.extend({
    projectName: z.string().nullable(),
    workflowId: z.string().nullable(),
  }).strict();

export const ProjectOrchestrationSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    status: ProjectOrchestrationStatusSchema,
    goals: z.string().nullable(),
    revisionFeedback: z.string().nullable(),
    orchestrationMode: ProjectOrchestrationModeSchema,
    strategySummary: z.string().nullable(),
    currentWorkflowRunId: z.string().nullable(),
    decisionLog: z.array(ProjectOrchestrationDecisionEntrySchema).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    probe_results: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const ProjectStateWorkItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    dependsOn: z.array(z.string()),
    blocks: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .strict();

export const ProjectStateSnapshotSchema = z
  .object({
    project_id: z.string().min(1),
    totalCount: z.number(),
    activeCount: z.number(),
    groupedByStatus: z.record(z.string(), z.array(ProjectStateWorkItemSchema)),
  })
  .strict();

export const ProjectOrchestrationStateSchema = z
  .object({
    orchestration: ProjectOrchestrationSchema.nullable(),
    projectState: ProjectStateSnapshotSchema,
    pendingActionRequests: z.array(ProjectOrchestrationActionRequestSchema),
  })
  .strict();
