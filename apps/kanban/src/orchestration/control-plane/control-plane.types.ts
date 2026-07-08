/**
 * Canonical list of orchestration lanes — the single source of truth. Both the
 * `OrchestrationLane` type and the `orchestrationLaneSchema` Zod enum derive
 * from this tuple, so a new lane is added in exactly one place.
 */
export const ORCHESTRATION_LANES = [
  "discovery",
  "specification",
  "work_item_generation",
  "dispatch",
  "implementation",
  "review",
  "merge",
  "repair",
  "upstream_analysis",
  "strategy",
  "work_item_transition",
  "project_health",
] as const;

export type OrchestrationLane = (typeof ORCHESTRATION_LANES)[number];

export type OrchestrationIntentType =
  | "discover_unknowns"
  | "reanalyze_upstream_change"
  | "refine_spec"
  | "generate_work_items"
  | "dispatch_candidates"
  | "implement_work_item"
  | "review_work_item"
  | "merge_work_item"
  | "repair_failed_run"
  | "reconcile_stale_links"
  | "validate_project_health";

export type OrchestrationIntentStatus =
  | "pending"
  | "launchable"
  | "running"
  | "completed"
  | "blocked"
  | "suppressed"
  | "failed"
  | "cancelled"
  | "superseded";

export type OrchestrationConflictKeyKind =
  | "work_item"
  | "target_branch"
  | "file_path"
  | "module_path"
  | "workflow_scope"
  | "workflow_run";

export interface OrchestrationConflictKey {
  readonly kind: OrchestrationConflictKeyKind;
  readonly value: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OrchestrationEvidenceRef {
  readonly kind:
    | "tool_result"
    | "domain_event"
    | "workflow_run"
    | "work_item"
    | "commit"
    | "human_note"
    | "external";
  readonly id: string;
  readonly summary?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OrchestrationResourceRef {
  readonly kind:
    | "project"
    | "work_item"
    | "workflow_run"
    | "branch"
    | "file"
    | "module"
    | "commit"
    | "external_event";
  readonly id: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OrchestrationWorkflowTarget {
  readonly workflowId: string;
  readonly scope?: string;
}

export interface CreateOrchestrationIntentInput {
  readonly projectId: string;
  readonly lane: OrchestrationLane;
  readonly type: OrchestrationIntentType;
  readonly requester: string;
  readonly reason: string;
  readonly priority?: number;
  readonly evidence?: OrchestrationEvidenceRef[];
  readonly resources?: OrchestrationResourceRef[];
  readonly conflictKeys?: OrchestrationConflictKey[];
  readonly workflow?: OrchestrationWorkflowTarget;
  readonly idempotencyKey?: string;
  readonly supersedesIntentId?: string;
  readonly freshnessRequirements?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export type OrchestrationFactFreshnessStatus =
  | "fresh"
  | "stale"
  | "expired"
  | "invalidated";

export interface PublishOrchestrationFactInput {
  readonly projectId: string;
  readonly factType: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly confidence: number;
  readonly payload: Record<string, unknown>;
  readonly evidence?: OrchestrationEvidenceRef[];
  readonly observedAt?: Date;
  readonly expiresAt?: Date | null;
  readonly metadata?: Record<string, unknown>;
}

export type SchedulerOutcomeStatus =
  | "launchable"
  | "blocked"
  | "suppressed"
  | "deferred"
  | "completed"
  | "failed";

export type SchedulerOutcomeReason =
  | "no_conflicts"
  | "conflict_key_active"
  | "lane_capacity_reached"
  | "missing_fresh_fact"
  | "stale_fact"
  | "superseded_intent"
  | "manual_suppression"
  | "workflow_scope_active"
  | "workflow_launched"
  | "direct_mutation_completed"
  | "direct_mutation_failed"
  | "direct_mutation_started"
  | "stale_direct_mutation_conflict";

export interface FreshFactRequirement {
  readonly factType: string;
  readonly subjectKind: string;
  readonly subjectIds: string[];
}

export interface SchedulerPolicyInput {
  readonly maxActivePerLane?: number;
  readonly now?: Date;
  readonly requireFreshFactTypes?: string[];
  readonly requireFreshFacts?: FreshFactRequirement[];
  readonly metadata?: Record<string, unknown>;
}

export interface SchedulerDecision {
  readonly intentId: string;
  readonly outcomeId: string;
  readonly status: SchedulerOutcomeStatus;
  readonly reason: SchedulerOutcomeReason;
  readonly conflictKeys: OrchestrationConflictKey[];
  readonly activeConflicts: OrchestrationConflictKey[];
  readonly metadata?: Record<string, unknown> | null;
}

export type LaunchAttemptStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "failed";

export interface RecordLaunchAttemptInput {
  readonly intentId: string;
  readonly outcomeId?: string | null;
  readonly projectId: string;
  readonly workflowId: string;
  readonly workflowScope?: string | null;
  readonly workflowRunId?: string | null;
  readonly idempotencyKey: string;
  readonly status: LaunchAttemptStatus;
  readonly requestedAt?: Date;
  readonly completedAt?: Date | null;
  readonly failureReason?: string | null;
  readonly responsePayload?: Record<string, unknown> | null;
  readonly metadata?: Record<string, unknown> | null;
}

export const LANE_CAPACITY_CONFLICT_PREFIX = "lane_capacity:";

export type OrchestrationLeaseStatus = "active" | "released" | "expired";

export type OrchestrationLeaseOwnerKind =
  | "cycle_request"
  | "workflow_run"
  | "direct_mutation"
  | "work_item_run_request";

export interface OrchestrationLeaseOwner {
  readonly kind: OrchestrationLeaseOwnerKind;
  readonly id: string;
}

export interface AcquireLeaseInput {
  readonly projectId: string;
  readonly lane: OrchestrationLane;
  readonly owner: OrchestrationLeaseOwner;
  readonly conflictKeys: OrchestrationConflictKey[];
  readonly ttlMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface LeaseConflict {
  readonly conflictKey: OrchestrationConflictKey;
  readonly heldByOwnerKind: OrchestrationLeaseOwnerKind;
  readonly heldByOwnerId: string;
  readonly expiresAt: string;
}

export type AcquireLeaseResult =
  | { readonly acquired: true; readonly leaseIds: string[] }
  | { readonly acquired: false; readonly conflicts: LeaseConflict[] };

/**
 * Default TTL for the per-work-item orchestration lease used by
 * `WorkItemService.requestWorkItemRun`. Picked to be larger than the
 * expected Core `requestWorkflowRun` round-trip (which includes workflow
 * launch + queue enqueue) but short enough that a crashed process cannot
 * strand a work item for long; the existing `OrchestrationLeaseSweeperService`
 * reclaims overdue leases on a 30s tick.
 */
export const WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS = 30_000;

/**
 * Work-item conflict-key kind for orchestration leases. The kind is
 * declared here as a single source of truth so the lease repository and
 * the work-item service agree on the encoded conflict-key value. The
 * value MUST be of the form `${projectId}:${workItemId}` so that
 * multi-key acquirers sort deterministically and the existing
 * `(project_id, conflict_key_kind, conflict_key_value, status)` UNIQUE
 * constraint is the sole race-safety mechanism.
 */
export function workItemConflictKeyValue(
  projectId: string,
  workItemId: string,
): string {
  return `${projectId}:${workItemId}`;
}

export interface AcquireWorkItemRunLeaseInput {
  readonly projectId: string;
  readonly workItemId: string;
  readonly requestId: string;
  readonly ttlMs?: number;
  readonly metadata?: Record<string, unknown>;
}
