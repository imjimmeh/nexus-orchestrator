import { z } from "zod";

function parseOptionalBooleanQuery(
  value: unknown,
): boolean | string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }

    return value;
  }

  return undefined;
}

export const createWorkflowSchema = z.object({
  name: z.string().optional(),
  yaml_definition: z.string(),
  is_active: z.boolean().optional(),
});

export const executeWorkflowSchema = z.object({
  trigger_data: z.record(z.string(), z.unknown()).optional(),
  scopeId: z.string().optional(),
  contextId: z.string().optional(),
  contextType: z.string().optional(),
  scope_id: z.string().optional(),
  context_id: z.string().optional(),
  preset_id: z.string().optional(),
  launch_source: z
    .enum(["manual", "project_scoped", "rerun_with_edits", "preset"])
    .optional(),
  dry_run: z.boolean().optional(),
});

export const workflowLaunchContextQuerySchema = z.object({
  scopeId: z.string().optional(),
  contextId: z.string().optional(),
  contextType: z.string().optional(),
});

export const createWorkflowLaunchPresetSchema = z.object({
  name: z.string(),
  scope_id: z.string().optional(),
  trigger_data: z.record(z.string(), z.unknown()).optional(),
});

export const updateWorkflowLaunchPresetSchema = z.object({
  name: z.string().optional(),
  trigger_data: z.record(z.string(), z.unknown()).optional(),
});

export const WORKFLOW_SORT_COLUMNS = [
  "name",
  "created_at",
  "is_active",
] as const;

export type WorkflowSortColumn = (typeof WORKFLOW_SORT_COLUMNS)[number];

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  workflowId: z.string().optional(),
  includeInactive: z
    .preprocess((value) => parseOptionalBooleanQuery(value), z.boolean())
    .optional(),
  isActive: z
    .preprocess((value) => parseOptionalBooleanQuery(value), z.boolean())
    .optional(),
  search: z.string().min(1).max(200).optional(),
  sortBy: z.enum(WORKFLOW_SORT_COLUMNS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional().default("asc"),
  // Confines the listing to workflows visible at this scope node (see
  // ScopeAccessService#restrictToAccessibleScopes).
  scopeNodeId: z.string().optional(),
});

export const WORKFLOW_RUNS_SORT_COLUMNS = ["created_at", "status"] as const;

export type WorkflowRunsSortColumn =
  (typeof WORKFLOW_RUNS_SORT_COLUMNS)[number];

export const WORKFLOW_EVENT_SORT_COLUMNS = [
  "timestamp",
  "event_type",
  "workflow_run_id",
] as const;

export type WorkflowEventSortColumn =
  (typeof WORKFLOW_EVENT_SORT_COLUMNS)[number];

export const workflowRunsQuerySchema = paginationQuerySchema.extend({
  scopeId: z.string().optional(),
  contextId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  sourceType: z.string().optional(),
  sortBy: z.enum(WORKFLOW_RUNS_SORT_COLUMNS).optional(),
});

export const lifecycleResultsQuerySchema = z.object({
  scopeId: z.string().min(1),
  contextId: z.string().optional(),
  phase: z.string().optional(),
  hook: z.string().optional(),
});

export const workflowEventsQuerySchema = paginationQuerySchema.extend({
  scopeId: z.string().optional(),
  sortBy: z.enum(WORKFLOW_EVENT_SORT_COLUMNS).optional(),
});

export const createAdHocSessionSchema = z.object({
  agentProfileName: z.string().min(1),
  scopeId: z.uuid().optional(),
  initialMessage: z.string().min(1),
});

function toBoundedInt(
  value: unknown,
  options: { defaultValue: number; min: number; max: number },
): number {
  const fallback = options.defaultValue;

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(options.max, Math.max(options.min, Math.trunc(value)));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(options.max, Math.max(options.min, parsed));
    }
  }

  return fallback;
}

export const listAdHocSessionsQuerySchema = z.object({
  scopeId: z.string().optional(),
  status: z.string().optional(),
  limit: z
    .preprocess(
      (value) => toBoundedInt(value, { defaultValue: 50, min: 1, max: 100 }),
      z.number().int().min(1).max(100),
    )
    .optional()
    .default(50),
  offset: z
    .preprocess(
      (value) =>
        toBoundedInt(value, {
          defaultValue: 0,
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        }),
      z.number().int().min(0),
    )
    .optional()
    .default(0),
});

export const workflowEventLogQuerySchema = z.object({
  limit: z
    .preprocess(
      (value) => toBoundedInt(value, { defaultValue: 100, min: 1, max: 1000 }),
      z.number().int().min(1).max(1000),
    )
    .optional()
    .default(100),
  offset: z
    .preprocess(
      (value) =>
        toBoundedInt(value, {
          defaultValue: 0,
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        }),
      z.number().int().min(0),
    )
    .optional()
    .default(0),
});

export const injectMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

export const questionAnswerSchema = z.object({
  questionIndex: z.number().int().min(0),
  selectedOption: z.string().nullable(),
  freeTextAnswer: z.string().nullable(),
});

export const submitQuestionAnswersSchema = z.object({
  answers: z.array(questionAnswerSchema).min(1),
});

export type CreateWorkflowRequest = z.infer<typeof createWorkflowSchema>;

export type ExecuteWorkflowRequest = z.infer<typeof executeWorkflowSchema>;

export type WorkflowLaunchContextQueryRequest = z.infer<
  typeof workflowLaunchContextQuerySchema
>;

export type CreateWorkflowLaunchPresetRequest = z.infer<
  typeof createWorkflowLaunchPresetSchema
>;

export type UpdateWorkflowLaunchPresetRequest = z.infer<
  typeof updateWorkflowLaunchPresetSchema
>;

export type PaginationQueryRequest = z.infer<typeof paginationQuerySchema>;

export type WorkflowRunsQueryRequest = z.infer<typeof workflowRunsQuerySchema>;

export type LifecycleResultsQueryRequest = z.infer<
  typeof lifecycleResultsQuerySchema
>;

export type WorkflowEventsQueryRequest = z.infer<
  typeof workflowEventsQuerySchema
>;

export type CreateAdHocSessionRequest = z.infer<
  typeof createAdHocSessionSchema
>;

export type ListAdHocSessionsQueryRequest = z.infer<
  typeof listAdHocSessionsQuerySchema
>;

export type WorkflowEventLogQueryRequest = z.infer<
  typeof workflowEventLogQuerySchema
>;

export type InjectMessageRequest = z.infer<typeof injectMessageSchema>;

export type QuestionAnswerRequest = z.infer<typeof questionAnswerSchema>;

export type SubmitQuestionAnswersRequest = z.infer<
  typeof submitQuestionAnswersSchema
>;
