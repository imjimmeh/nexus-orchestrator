/**
 * Workflow lifecycle, autonomy diagnostics, and retrospective-trace
 * types — moved out of `./types.ts` so the rest of the web API client
 * can consume a stable surface while the legacy `./types.ts` is
 * incrementally depopulated by child-7.
 *
 * Foundational types (`Timestamps`) come from `./common.types`. The
 * lifecycle / autonomy / retrospective shapes are colocated here because
 * they share the same per-run diagnostic scope and reference each other
 * (e.g. autonomy evidence points at workflow runs, retrospective traces
 * summarise autonomy findings). Keep them together — do not split further
 * without a coordinated API contract change.
 */

import type { Timestamps } from "./common.types";

export interface WorkflowLifecycleWorkflowResult {
  workflowId: string;
  workflowDefinitionId?: string;
  workflowName: string;
  phase: string;
  hook: string;
  blocking: boolean;
  status: string;
  runId?: string;
  error?: string;
}

export interface WorkflowLifecycleResult extends Timestamps {
  id: string;
  scope_id: string;
  context_id: string | null;
  phase: string;
  hook: string;
  blocking_only: boolean;
  aggregate_status: string;
  results: WorkflowLifecycleWorkflowResult[];
  repository_ref: string | null;
}

export interface WorkflowLifecycleResultsQuery {
  scopeId: string;
  contextId?: string;
  phase?: string;
  hook?: string;
}

export interface RefreshRepositoryWorkflowsRequest {
  scopeId: string;
  rootPath: string;
  sourceRef?: string;
}

export interface RefreshRepositoryWorkflowsResult {
  discovered: number;
  upserted: number;
  removed: number;
}

export type AutonomyEvidenceReferenceKind =
  | "event_ledger"
  | "workflow_event"
  | "learning_candidate"
  | "skill_proposal"
  | "session_tree"
  | "workflow_run"
  | "job_output"
  | "runtime_diagnostic"
  | "doctor_repair_history"
  | "work_item";

export interface AutonomyEvidenceReference {
  kind: AutonomyEvidenceReferenceKind;
  id?: string;
  summary: string;
}

export interface AutonomyNextStep {
  label: string;
  severity: "info" | "warning" | "error";
  href?: string;
}

export interface AutonomySummaryItem {
  category: "learning" | "review" | "failure_classification" | "repair";
  title: string;
  status: "in_progress" | "succeeded" | "denied" | "failed" | "needs_review";
  occurredAt?: string;
  summary: string;
  evidence: AutonomyEvidenceReference[];
  nextSteps: AutonomyNextStep[];
}

export interface WorkflowRunAutonomyDiagnostics {
  items: AutonomySummaryItem[];
}

export interface WorkflowRunRetrospectiveTraceFinding {
  index: number;
  originalRunId: string | null;
  outcome: string | null;
  reasonCode: string | null;
  candidateId: string | null;
  skillProposalId: string | null;
}

export interface WorkflowRunRetrospectiveTrace {
  workflowRunId: string;
  findingsTotal: number;
  outcomes: Record<string, number>;
  findings: WorkflowRunRetrospectiveTraceFinding[];
}
