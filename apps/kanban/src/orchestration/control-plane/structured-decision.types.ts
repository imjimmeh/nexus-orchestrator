import { createHash } from "node:crypto";
import { z } from "zod";
import { ORCHESTRATION_LANES } from "./control-plane.types";
import type {
  CreateOrchestrationIntentInput,
  OrchestrationConflictKey,
} from "./control-plane.types";

const orchestrationLaneSchema = z.enum(ORCHESTRATION_LANES);

const orchestrationIntentTypeSchema = z.enum([
  "discover_unknowns",
  "reanalyze_upstream_change",
  "refine_spec",
  "generate_work_items",
  "dispatch_candidates",
  "implement_work_item",
  "review_work_item",
  "merge_work_item",
  "repair_failed_run",
  "reconcile_stale_links",
  "validate_project_health",
]);

const orchestrationEvidenceKindSchema = z.enum([
  "tool_result",
  "domain_event",
  "workflow_run",
  "work_item",
  "commit",
  "human_note",
  "external",
]);

export const structuredDecisionActionSchema = z.enum([
  "request_wakeup",
  "dispatch_work_items",
  "transition_work_item_status",
  "record_only",
]);

export const structuredDecisionSchema = z.object({
  action: structuredDecisionActionSchema,
  lane: orchestrationLaneSchema,
  intent_type: orchestrationIntentTypeSchema,
  reason: z.string().min(1),
  priority: z.number().int().default(0),
  work_item_ids: z.array(z.uuid()).default([]),
  target_status: z.string().optional(),
  target_branch: z.string().optional(),
  workflow_id: z.string().optional(),
  workflow_scope: z.string().optional(),
  evidence: z
    .array(
      z.object({
        kind: orchestrationEvidenceKindSchema,
        id: z.string().min(1),
        summary: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type StructuredOrchestrationDecision = z.infer<
  typeof structuredDecisionSchema
>;

export function structuredDecisionToIntentInput(
  projectId: string,
  decision: StructuredOrchestrationDecision,
  requester: string,
): CreateOrchestrationIntentInput {
  const idempotencyFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        action: decision.action,
        intentType: decision.intent_type,
        lane: decision.lane,
        reason: decision.reason,
        workItemIds: decision.work_item_ids,
        targetStatus: decision.target_status,
        targetBranch: decision.target_branch,
        workflowId: decision.workflow_id,
        workflowScope: decision.workflow_scope,
      }),
    )
    .digest("hex")
    .slice(0, 24);

  return {
    projectId,
    lane: decision.lane,
    type: decision.intent_type,
    requester,
    reason: decision.reason,
    priority: decision.priority,
    evidence: decision.evidence.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    })),
    resources: decision.work_item_ids.map((id) => ({ kind: "work_item", id })),
    conflictKeys: buildDecisionConflictKeys(decision),
    workflow:
      decision.workflow_id === undefined
        ? undefined
        : { workflowId: decision.workflow_id, scope: decision.workflow_scope },
    idempotencyKey: `ceo-decision:${projectId}:${idempotencyFingerprint}`,
    metadata: decision.metadata,
  };
}

function buildDecisionConflictKeys(
  decision: StructuredOrchestrationDecision,
): OrchestrationConflictKey[] {
  return [
    ...decision.work_item_ids.map((value) => ({
      kind: "work_item" as const,
      value,
    })),
    ...(decision.target_branch
      ? [{ kind: "target_branch" as const, value: decision.target_branch }]
      : []),
    ...(decision.workflow_id
      ? [
          {
            kind: "workflow_scope" as const,
            value: `${decision.workflow_id}:${decision.workflow_scope ?? "global"}`,
          },
        ]
      : []),
  ];
}
