import { z } from "zod";

import {
  WorkItemTypeSchema,
  StoryPointsSchema,
} from "./schemas/work-item-type";

export const WorkItemStatusSchema = z.enum([
  "backlog",
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "awaiting-pr-merge",
  "blocked",
  "done",
]);

export const WORK_ITEM_STATUS_GROUPS = {
  active: ["refinement", "in-progress", "in-review"],
  completed: ["ready-to-merge", "awaiting-pr-merge", "done"],
  blocked: ["blocked"],
} as const;

export function isWorkItemStatusInGroup(
  status: z.infer<typeof WorkItemStatusSchema>,
  group: keyof typeof WORK_ITEM_STATUS_GROUPS,
): boolean {
  const groupStatuses = WORK_ITEM_STATUS_GROUPS[group];
  return (groupStatuses as readonly string[]).includes(status);
}

export const WorkItemFailedDeliverableSchema = z
  .object({
    deliverable_id: z.string().min(1),
    failure_type: z.enum([
      "not_implemented",
      "incorrect",
      "incomplete",
      "integration_issue",
      "test_failure",
    ]),
    details: z.string().min(1),
    affected_files: z.array(z.string()).optional(),
  })
  .strict();

export const WorkItemRejectionFeedbackSchema = z
  .object({
    feedback: z.string().optional(),
    reviewerAgentId: z.string().optional(),
    failedDeliverables: z.array(WorkItemFailedDeliverableSchema).optional(),
    failed_deliverables: z.array(WorkItemFailedDeliverableSchema).optional(),
  })
  .strict();

/** The maximum number of CEO-mediated re-plan attempts before an escalated
 * item is left blocked for human attention. Prevents escalate->replan->fail
 * loops. */
export const MAX_ESCALATION_REPLAN_ATTEMPTS = 2;

export const ESCALATION_RECOMMENDATIONS = ["fresh_architect_pass"] as const;

export const WorkItemEscalationSchema = z
  .object({
    reason: z.string().min(1),
    escalatedAt: z.string().min(1),
    recommendation: z.enum(ESCALATION_RECOMMENDATIONS),
    repeated_acs: z.union([z.array(z.string()), z.string()]).optional(),
    replanAttempts: z.number().int().min(0).default(0),
  })
  .loose();

export const WorkItemExecutionConfigSchema = z
  .object({
    agentProfileId: z.string().optional(),
    baseBranch: z.string().min(1),
    targetBranch: z.string().min(1),
    contextFiles: z.array(z.string()),
    documentationUrls: z.array(z.string()),
    maxTokens: z.number().optional(),
    maxLoops: z.number().optional(),
    model: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    forceModelForSubagents: z.boolean().optional(),
    implementationPlan: z.record(z.string(), z.unknown()).optional(),
    rejectionFeedback: z
      .union([WorkItemRejectionFeedbackSchema, z.string()])
      .optional(),
    rejectionCount: z.number().optional(),
  })
  .loose();

export const WorkItemSubtaskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "done",
  "blocked",
]);

export const WorkItemSubtaskSchema = z
  .object({
    id: z.string().min(1),
    subtaskId: z.string().min(1),
    workItemId: z.string().min(1),
    title: z.string().min(1),
    status: WorkItemSubtaskStatusSchema,
    orderIndex: z.number(),
    dependsOnSubtaskIds: z.array(z.string()),
    sourcePath: z.string(),
    updatedAt: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const WorkItemRecordSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: WorkItemStatusSchema,
    type: WorkItemTypeSchema,
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    hasChildren: z.boolean().optional(),
    rolledUpPoints: z.number().nullable().optional(),
    priority: z.string().optional(),
    assignedAgentId: z.string().nullable().optional(),
    tokenSpend: z.number().optional(),
    costCents: z.number().optional(),
    currentExecutionId: z.string().nullable().optional(),
    waitingForInput: z.boolean().optional(),
    executionConfig: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    lastExecutionStatus: z.string().nullable().optional(),
    dependsOn: z.array(z.string()).optional(),
    blockedBy: z.array(z.string()).optional(),
    blocks: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    subtasks: z.array(WorkItemSubtaskSchema).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    linkedRunId: z.string().nullable(),
  })
  .strict();

export const WorkItemSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: WorkItemStatusSchema,
    type: WorkItemTypeSchema,
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    hasChildren: z.boolean().optional(),
    rolledUpPoints: z.number().nullable().optional(),
    priority: z.string(),
    assignedAgentId: z.string().nullable().optional(),
    tokenSpend: z.number().optional(),
    costCents: z.number().optional(),
    currentExecutionId: z.string().nullable().optional(),
    waitingForInput: z.boolean().optional(),
    executionConfig: WorkItemExecutionConfigSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    lastExecutionStatus: z.string().nullable().optional(),
    dependsOn: z.array(z.string()).optional(),
    blocks: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    subtasks: z.array(WorkItemSubtaskSchema).optional(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const CreateWorkItemInputSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    type: WorkItemTypeSchema.optional(),
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    priority: z.string().optional(),
    dependencyIds: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
    executionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    subtasks: z
      .array(
        z
          .object({
            subtaskId: z.string().min(1),
            title: z.string().min(1),
            status: WorkItemSubtaskStatusSchema.optional(),
            orderIndex: z.number().optional(),
            dependsOnSubtaskIds: z.array(z.string()).optional(),
            sourcePath: z.string().optional(),
            metadata: z.record(z.string(), z.unknown()).nullable().optional(),
          })
          .strict(),
      )
      .optional(),
    status: WorkItemStatusSchema.optional(),
  })
  .strict();

export const CreateWorkItemRequestSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    type: WorkItemTypeSchema.optional(),
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    priority: z.string().min(1),
    dependencyIds: z.array(z.string()).optional(),
    status: WorkItemStatusSchema.optional(),
  })
  .strict();

export const UpdateWorkItemRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    type: WorkItemTypeSchema.optional(),
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    priority: z.string().optional(),
    dependencyIds: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
    executionConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    subtasks: CreateWorkItemInputSchema.shape.subtasks,
  })
  .strict();

export const DispatchWorkItemInputSchema = z
  .object({
    workflowId: z.string().min(1),
    requestedBy: z.string().optional(),
  })
  .strict();

export const MergeWorkItemInputSchema = DispatchWorkItemInputSchema;

export const WorkItemRunRequestResultSchema = z
  .object({
    workItem: WorkItemRecordSchema,
    run_id: z.string().min(1),
    workflow_id: z.string().min(1),
  })
  .strict();
