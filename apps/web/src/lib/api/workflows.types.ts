/**
 * Workflow domain types — moved out of `./types.ts` so the rest of the web
 * API client can consume a stable surface while the legacy `./types.ts` is
 * incrementally depopulated by child-7.
 *
 * Foundational types (`Timestamps`, `WorkflowRunStatus`) come from
 * `./common.types`. `ChatSessionUsageLimit` is intentionally still defined
 * in `./types.ts` (it owns the chat-session family); re-exporting it
 * through `./types.ts` keeps this file's downstream import surface
 * stable.
 */

import type {
  WorkflowEventsQueryRequest,
  WorkflowRunsQueryRequest,
} from "@nexus/core";
import type { Timestamps, WorkflowRunStatus } from "./common.types";
import type { ChatSessionUsageLimit } from "./chat-sessions.types";

export interface Workflow extends Timestamps {
  id: string;
  name: string;
  yaml_definition: string;
  is_active: boolean;
}

export interface LatestBudgetDecision {
  decision: "allow" | "warn" | "approval_required" | "throttle" | "deny";
  reasonCode: string;
  estimatedCostCents: number | null;
  remainingBudgetCents: number | null;
}

export interface WorkflowRun extends Timestamps {
  id: string;
  workflow_id: string;
  display_name?: string;
  workflow_name?: string | null;
  source_type?: "seed" | "user" | "repository";
  status: WorkflowRunStatus;
  current_step_id?: string | null;
  state_variables: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  latestBudgetDecision?: LatestBudgetDecision | null;
}

export type WorkflowRunsQuery = Partial<WorkflowRunsQueryRequest> & {
  projectId?: string;
  refetchIntervalMs?: number;
};

export interface WorkflowTelemetryEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface WorkflowRunRetryMetadata {
  jobId?: string;
  stepId?: string;
  reason?: string;
  message?: string;
  reasonCode?: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  retryQueueJobId?: string;
  nextRetryAt?: string;
  resetAt?: string;
  rateLimitResetAt?: string;
  providerTier?: string;
  usageLimit?: ChatSessionUsageLimit;
}

export interface WorkflowRunErrorSummary {
  eventType: string;
  message: string;
  occurredAt?: string;
  jobId?: string;
  stepId?: string;
  reasonCode?: string;
  retryable?: boolean;
}

export type WorkflowRunRuntimeNoticeKind =
  | "provider_rate_limit_retry"
  | "provider_overload_retry"
  | "retry_scheduled"
  | "error"
  | "warning";

export interface WorkflowRunRuntimeNotice {
  kind: WorkflowRunRuntimeNoticeKind;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  retryMetadata?: WorkflowRunRetryMetadata;
  errorSummary?: WorkflowRunErrorSummary;
  isWaitingOnRetry: boolean;
}

export interface WorkflowEventRecord {
  id: string;
  workflow_run_id: string;
  event_type: string;
  step_id?: string | null;
  job_id?: string | null;
  actor_id?: string | null;
  correlation_id?: string | null;
  payload?: Record<string, unknown> | null;
  timestamp: string;
}

export type WorkflowEventsQuery = Partial<WorkflowEventsQueryRequest> & {
  projectId?: string;
};

export interface WorkflowEventsPage {
  data: WorkflowEventRecord[];
  total: number;
  limit: number;
  offset: number;
}

export type WorkflowNodeRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "blocked"
  | "waiting_input"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type WorkflowGraphNodeKind = "job" | "step";

export type WorkflowGraphEdgeKind =
  | "depends_on"
  | "transition"
  | "contains"
  | "sequence";

export interface WorkflowGraphNode {
  id: string;
  label: string;
  kind: WorkflowGraphNodeKind;
  status: WorkflowNodeRuntimeStatus;
  jobId?: string;
  stepId?: string;
  parentJobId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkflowGraphEdgeKind;
}

export interface WorkflowGraphCursor {
  latestEventAt: string | null;
  totalEvents: number;
}

export interface WorkflowRunGraph {
  workflowId: string;
  workflowRunId: string | null;
  runStatus: WorkflowRunStatus | null;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  activeNodeIds: string[];
  queuedNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  cursor: WorkflowGraphCursor;
}

export type ExecutionSummary = {
  id: string;
  kind: string;
  state: string;
  provider: string | null;
  model: string | null;
  harnessId: string | null;
  agentProfileName: string | null;
  providerSource: string | null;
  workflowRunId: string | null;
  chatSessionId: string | null;
  contextId: string | null;
  createdAt: string;
  terminalAt: string | null;
};

export interface WorkflowTelemetryAuth {
  token: string;
  wsUrl: string;
}

export interface WorkflowWorkspaceTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkflowWorkspaceTreeNode[];
}
