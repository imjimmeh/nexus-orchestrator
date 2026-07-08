import { z } from "zod";
import { JsonValueSchema } from "@nexus/core";

/**
 * Unwraps the XML-array serialization artifact some providers (notably
 * MiniMax via openai-completions) emit for array-typed tool arguments. A
 * multi-element array round-trips as `{ item: [...] }`; a single-element array
 * round-trips as `{ item: <element> }`. Both sole-key `item` forms are coerced
 * into a real array before the array schema validates.
 *
 * Driven by the declared array schema, so it is unambiguous: it only applies to
 * fields that are meant to be arrays and never touches legitimate single-key
 * objects whose schema is an object.
 */
export function xmlArrayArtifact<T extends z.ZodType>(element: T) {
  return z.preprocess((value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "item") {
        const inner = (value as Record<string, unknown>).item;
        return (Array.isArray(inner) ? inner : [inner]) as unknown[];
      }
    }
    return value;
  }, z.array(element));
}

export const ProjectIdSchema = z.object({
  project_id: z.string().min(1),
});

export const ProjectIdOptionalSchema = z.object({
  project_id: z.string().min(1).optional(),
});

const OptionalTrimmedProjectId = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

export const ContextualProjectIdSchema = z.object({
  project_id: OptionalTrimmedProjectId,
});

export const WorkItemIdSchema = z.object({
  project_id: z.string().min(1),
  workItemId: z.string().min(1),
});

export const ContextualWorkItemIdSchema = ContextualProjectIdSchema.extend({
  workItemId: z.string().min(1),
});

export const ReviewDecisionSchema = z.object({
  project_id: z.string().min(1),
  workItemId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  workflowId: z.string().min(1),
  requestedBy: z.string().optional(),
});

export const StatusSchema = z.object({
  project_id: z.string().min(1),
  workItemId: z.string().min(1),
  status: z.string().min(1),
});

const OptionalTrimmedNonBlankString = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

export const PublishSpecsSchema = z.object({
  project_id: OptionalTrimmedNonBlankString,
  scope_id: OptionalTrimmedNonBlankString,
  workspace_root: OptionalTrimmedNonBlankString,
  spec_directory: z.string().optional(),
  allow_missing_specs: z.boolean().optional(),
  allow_untracked_specs: z.boolean().optional(),
});

export const HydrateDiscoveryWorkItemsSchema = z.object({
  project_id: z.string().min(1).optional(),
  scope_id: z.string().min(1).optional(),
  spec_directory: z.string().optional(),
  allow_missing_specs: z.boolean().optional(),
});

export const SynthesizeDiscoveryWorkItemSpecsSchema = z.object({
  project_id: z.string().optional(),
  scope_id: z.string().optional(),
  workspace_root: z.string().min(1).optional(),
  output_directory: z.string().min(1).optional(),
  goals: z.array(z.string()).optional(),
});

export const WriteProbeResultSchema = z.object({
  project_id: z.string().min(1),
  scope_id: z.string().min(1),
  outcome: z.enum(["success", "failed", "cancelled", "timed_out"]),
  result: z.record(z.string(), z.unknown()),
  probe_type: z.string().min(1).optional(),
  expected_output_schema: z.string().min(1).optional(),
  evidence_refs: z.array(z.string()).optional(),
  narrative_summary: z.string().optional(),
});

export const WorkItemUpdateSchema = WorkItemIdSchema.extend({
  updates: z.record(z.string(), z.unknown()),
});

export const WorkItemPatchMetadataSchema = WorkItemIdSchema.extend({
  metadataPatch: z.record(z.string(), z.unknown()),
});

export const WorkItemAppendMetadataArraySchema = WorkItemIdSchema.extend({
  arrayPath: z.string().min(1),
  arrayValue: JsonValueSchema,
});

export const WorkItemPatchExecutionConfigSchema = WorkItemIdSchema.extend({
  executionConfigPatch: z.record(z.string(), z.unknown()),
});

export const WorkItemCreateSchema = ProjectIdSchema.extend({
  parentWorkItemId: z.string().min(1).optional(),
  workItem: z.record(z.string(), z.unknown()),
});

export const SubtaskBlueprintItemSchema = z.object({
  subtask_id: z.string().min(1),
  title: z.string().min(1),
  order_index: z.number().int(),
  depends_on_subtask_ids: z.array(z.string()),
});

export const WorkItemSubtaskValidateBlueprintSchema = WorkItemIdSchema.extend({
  blueprint: z.array(SubtaskBlueprintItemSchema),
});

export const WorkItemSubtaskUpsertSchema = WorkItemIdSchema.extend({
  subtask: z.record(z.string(), z.unknown()),
});

export const DispatchSelectedWorkItemsSchema = ContextualProjectIdSchema.extend(
  {
    context_ids: z.array(z.string().trim().min(1)).min(1),
    workflow_id: z.string().trim().min(1).optional(),
    requested_by: z.string().trim().min(1).optional(),
    max_concurrent_per_agent: z.number().int().positive().optional(),
    slots: z.number().int().positive().optional(),
  },
);

const JsonObjectOrJsonString = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      try {
        const parsed: unknown = JSON.parse(val);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // fall through - z.record will reject
      }
    }
    return val;
  },
  z.record(z.string(), z.unknown()),
);

export const OrchestrationRecordBlockedSchema =
  ContextualProjectIdSchema.extend({
    blocked_stage: z.literal("imported_repo_hydration"),
    blocked_reason: z.string().optional(),
    ready_for_cycle: z.literal(false),
    hydration_summary: JsonObjectOrJsonString.optional(),
    child_run_id: z.string().optional(),
    hydration_child_run_id: z.string().optional(),
  });

export const OrchestrationClearBlockedSchema = ContextualProjectIdSchema.extend(
  {
    cleared_stage: z.literal("imported_repo_hydration"),
    ready_for_cycle: z.literal(true),
  },
);

export const OrchestrationClearCycleDecisionSchema =
  ContextualProjectIdSchema.extend({
    reason: z.string().min(1),
  });

export const OrchestrationResetIntentsSchema = ContextualProjectIdSchema.extend(
  {},
);

export const ReconcileImportedRepositoryBacklogSchema =
  ContextualProjectIdSchema.extend({
    workspace_root: z.string().min(1),
    goals: z.array(z.string()).optional(),
    probe_artifact_directory: z.string().optional(),
    dry_run: z.boolean().optional(),
    orchestration_mode: z
      .enum(["autonomous", "supervised", "notifications_only"])
      .optional(),
    human_decision_policy: z
      .enum([
        "decide_without_approval",
        "ask_when_uncertain",
        "always_supervise",
      ])
      .optional(),
  });

const BlockedItemSchema = z.object({
  id: z.string().min(1),
  blockedReason: z.preprocess(
    (val) => (typeof val === "string" ? val.trim() : val),
    z.string().min(1),
  ),
});

export const OrchestrationRecordCycleDecisionSchema =
  ContextualProjectIdSchema.extend({
    decision: z.enum(["repeat", "pause", "complete", "blocked"]).optional(),
    reason: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1),
    ),
    idempotency_key: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1).optional(),
    ),
    autonomous_default: z.boolean().optional(),
    ready_work_remaining: z.boolean().optional(),
    blockedItems: z.array(BlockedItemSchema).optional(),
  })
    .refine(
      (data) => {
        if (data.decision !== undefined && data.autonomous_default === true) {
          return false;
        }
        return true;
      },
      {
        message:
          "autonomous_default must not be set when decision is provided explicitly",
      },
    )
    .refine(
      (data) => {
        if (data.decision === undefined) {
          return (
            data.autonomous_default === true &&
            data.ready_work_remaining === true
          );
        }
        return true;
      },
      {
        message:
          "Omitted decision requires autonomous_default: true and ready_work_remaining: true",
      },
    )
    .refine(
      (data) => {
        if (data.decision === "blocked") {
          return (
            data.blockedItems !== undefined &&
            data.blockedItems.length > 0 &&
            data.blockedItems.every(
              (item) => item.blockedReason.trim().length > 0,
            )
          );
        }
        return true;
      },
      {
        message:
          "When decision is 'blocked', blockedItems must contain at least one item with a non-empty blockedReason",
      },
    );

export const CompleteOrchestrationCycleDecisionSchema =
  OrchestrationRecordCycleDecisionSchema;

export const OrchestrationRequestWakeupSchema =
  ContextualProjectIdSchema.extend({
    reason: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1),
    ),
    source: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1).optional(),
    ),
    dedupe_key: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1).optional(),
    ),
  });

const ImportedRepositoryFindingStatusSchema = z.enum([
  "pending_investigation",
  "ready_for_work_item",
  "converted_to_work_item",
  "suppressed",
  "needs_human",
  "resolved_existing",
]);

export const ImportedRepositoryFindingsSchema =
  ContextualProjectIdSchema.extend({
    statuses: z.array(ImportedRepositoryFindingStatusSchema).optional(),
    limit: z.number().int().positive().max(100).optional(),
  });

export const ResolveImportedRepositoryFindingSchema =
  ContextualProjectIdSchema.extend({
    finding_id: z.string().min(1),
    disposition: z.enum([
      "create_work_item",
      "suppress",
      "needs_human",
      "resolved_existing",
    ]),
    rationale: z.string().trim().min(1),
    decided_by: z.string().trim().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

const WorkItemStatusValueSchema = z.enum([
  "backlog",
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "blocked",
  "done",
]);

export const ListWorkItemsSchema = ContextualProjectIdSchema.extend({
  status: z
    .union([WorkItemStatusValueSchema, z.array(WorkItemStatusValueSchema)])
    .optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const OrchestrationTimelineSchema = ContextualProjectIdSchema.extend({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).optional().default(0),
});

export const OrchestrationActivitySchema = ContextualProjectIdSchema.extend({
  limit: z.number().int().positive().max(50).optional(),
});
