/**
 * Project domain types — project entity, orchestration surface, learning /
 * memory / memory-candidate request and response shapes, automation hooks,
 * heartbeat profiles, standing orders, project-agents file, and project
 * request/response DTOs.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7. The project / orchestration / goal entities themselves remain
 * owned by `@nexus/kanban-contracts`; this module aliases them for the web
 * API client surface.
 */

import type {
  CreateProjectRequest as KanbanCreateProjectRequest,
  Project as KanbanProject,
  ProjectImportStrategy as KanbanProjectImportStrategy,
  ProjectOrchestration as KanbanProjectOrchestration,
  ProjectOrchestrationActionRequest as KanbanProjectOrchestrationActionRequest,
  ProjectOrchestrationActionRequestListItem as KanbanProjectOrchestrationActionRequestListItem,
  ProjectOrchestrationActionRequestStatus as KanbanProjectOrchestrationActionRequestStatus,
  ProjectOrchestrationDecisionEntry as KanbanProjectOrchestrationDecisionEntry,
  ProjectOrchestrationMode as KanbanProjectOrchestrationMode,
  ProjectOrchestrationState as KanbanProjectOrchestrationState,
  ProjectOrchestrationStatus as KanbanProjectOrchestrationStatus,
  ProjectStateSnapshot as KanbanProjectStateSnapshot,
  ProjectStateWorkItem as KanbanProjectStateWorkItem,
  UpdateProjectRequest as KanbanUpdateProjectRequest,
} from "@nexus/kanban-contracts";
import type { Timestamps } from "./common.types";
import type { MemorySegmentType } from "./chat-sessions.types";

// ── Project entity + request DTOs ──

export type Project = KanbanProject;
export type CreateProjectRequest = KanbanCreateProjectRequest;
export type UpdateProjectRequest = KanbanUpdateProjectRequest;

export interface ProjectAgentsDocument {
  projectId: string;
  path: string;
  exists: boolean;
  content: string;
  etag: string | null;
  updatedAt: string | null;
}

export interface UpdateProjectAgentsFileRequest {
  content: string;
  expectedEtag?: string | null;
}

// ── Project memory ──

export interface ListProjectMemorySegmentsRequest {
  memory_type?: MemorySegmentType;
  query?: string;
  limit?: number;
  offset?: number;
}

// ── Orchestration surface ──

export type ProjectOrchestrationStatus = KanbanProjectOrchestrationStatus;
export type ProjectOrchestrationMode = KanbanProjectOrchestrationMode;
export type ProjectImportStrategy = KanbanProjectImportStrategy;
export type ProjectOrchestrationDecisionEntry =
  KanbanProjectOrchestrationDecisionEntry;
export type ProjectOrchestrationActionRequestStatus =
  KanbanProjectOrchestrationActionRequestStatus;
export type ProjectOrchestrationActionRequest =
  KanbanProjectOrchestrationActionRequest;
export type ProjectOrchestrationActionRequestListItem =
  KanbanProjectOrchestrationActionRequestListItem;
export type ProjectOrchestration = KanbanProjectOrchestration;
export type ProjectStateWorkItem = KanbanProjectStateWorkItem;
export type ProjectStateSnapshot = KanbanProjectStateSnapshot;
export type ProjectOrchestrationState = KanbanProjectOrchestrationState;

// ── Learning candidate surface ──

export type LearningCandidateStatus =
  | "pending"
  | "promoted"
  | "rejected"
  | "archived";

export interface LearningSweepRunSummary {
  runId: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  scannedScopes: number;
  scannedObservations: number;
  rankedCandidates: number;
  promotedCandidates: number;
  createdSkillProposals: number;
}

export interface LearningSweepStatus {
  enabled: boolean;
  intervalSeconds: number;
  promotionThreshold: number;
  proposalThreshold: number;
  sweepRunning: boolean;
  candidateTotals: {
    pending: number;
    promoted: number;
  };
  proposalTotals: {
    pending: number;
    approved: number;
    rejected: number;
    failed: number;
  };
  lastRun: LearningSweepRunSummary | null;
}

export interface LearningCandidateRankingSignals {
  recurrence_frequency: number;
  stage_diversity: number;
  failure_reduction_relevance: number;
  recency_decay: number;
  source_quality_confidence: number;
}

export interface LearningCandidateDiagnostics {
  source_observation_count?: number;
  source_scope_ids?: string[];
  latest_observed_at?: string;
  ranking_signals?: LearningCandidateRankingSignals;
}

export interface LearningCandidate extends Timestamps {
  id: string;
  scope_type: string;
  scope_id: string | null;
  candidate_type: string;
  title: string;
  summary: string;
  fingerprint: string;
  score: number;
  confidence: number;
  recurrence_count: number;
  signals_json: Record<string, unknown>;
  status: LearningCandidateStatus;
  promoted_at: string | null;
  human_approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LearningCandidateListResponse {
  data: LearningCandidate[];
  meta: {
    pagination: PaginationMeta;
    suppressedCount: number;
  };
}

export interface ListLearningCandidatesRequest {
  status?: string[];
  candidate_type?: string[];
  scope_type?: string;
  scope_id?: string;
  search?: string;
  min_score?: number;
  created_from?: string;
  created_to?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface RejectLearningCandidateRequest {
  reason: string;
  rejected_by?: string;
}

export interface ArchiveLearningCandidateRequest {
  reason?: string;
  archived_by?: string;
}

export interface BulkRejectLearningCandidatesRequest {
  candidate_ids: string[];
  reason: string;
  rejected_by?: string;
}

export interface BulkArchiveLearningCandidatesRequest {
  candidate_ids: string[];
  reason?: string;
  archived_by?: string;
}

export interface BulkPromoteLearningCandidatesRequest {
  candidate_ids: string[];
  requested_by?: string;
}

export interface BulkPromoteLearningCandidatesResult {
  candidateId: string;
  result?: { candidate_id: string; memory_segment_id: string; status: string };
  error?: string;
}

export interface PromoteLearningCandidateRequest {
  candidate_id: string;
  requested_by?: string;
}

export interface PromoteLearningCandidateResponse {
  candidate_id: string;
  memory_segment_id: string | null;
  status: LearningCandidateStatus;
  policy_decision: string;
}

// ── Automation hooks ──

export type AutomationHookTriggerType =
  | "workflow.run.started"
  | "workflow.run.failed"
  | "work_item.status.changed"
  | "project.orchestration.completed";

export type AutomationHookActionType =
  | "invoke_workflow"
  | "emit_event"
  | "record_metadata";

export interface AutomationHook extends Timestamps {
  id: string;
  project_id: string;
  enabled: boolean;
  trigger_type: AutomationHookTriggerType;
  trigger_filter: Record<string, unknown> | null;
  priority: number;
  action_type: AutomationHookActionType;
  action_payload: Record<string, unknown>;
  cooldown_window_seconds: number;
  last_fired_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface AutomationHookListResponse {
  items: AutomationHook[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateAutomationHookRequest {
  project_id: string;
  enabled?: boolean;
  trigger_type: AutomationHookTriggerType;
  trigger_filter?: Record<string, unknown>;
  priority?: number;
  action_type: AutomationHookActionType;
  action_payload: Record<string, unknown>;
  cooldown_window_seconds?: number;
  created_by?: string;
}

export interface UpdateAutomationHookRequest {
  enabled?: boolean;
  trigger_type?: AutomationHookTriggerType;
  trigger_filter?: Record<string, unknown>;
  priority?: number;
  action_type?: AutomationHookActionType;
  action_payload?: Record<string, unknown>;
  cooldown_window_seconds?: number;
  updated_by?: string;
}

// ── Heartbeat profiles ──

export type HeartbeatRunStatus =
  | "triggered"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export interface HeartbeatRun extends Timestamps {
  id: string;
  heartbeat_profile_id: string;
  status: HeartbeatRunStatus;
  due_at: string;
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  workflow_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  diagnostics_json: Record<string, unknown> | null;
}

export interface HeartbeatProfile extends Timestamps {
  id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  interval_seconds: number;
  workflow_id: string;
  payload_json: Record<string, unknown>;
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_run: HeartbeatRun | null;
}

export interface HeartbeatProfileListResponse {
  items: HeartbeatProfile[];
  total: number;
  limit: number;
  offset: number;
}

export interface HeartbeatRunsListResponse {
  items: HeartbeatRun[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateHeartbeatProfileRequest {
  project_id: string;
  name: string;
  enabled?: boolean;
  interval_seconds: number;
  workflow_id: string;
  payload_json?: Record<string, unknown>;
  created_by?: string;
}

export interface UpdateHeartbeatProfileRequest {
  name?: string;
  enabled?: boolean;
  interval_seconds?: number;
  workflow_id?: string;
  payload_json?: Record<string, unknown>;
  updated_by?: string;
}

// ── Standing orders ──

export type StandingOrderOverridePolicy =
  | "advisory"
  | "allow_override"
  | "deny_override";

export interface StandingOrder extends Timestamps {
  id: string;
  project_id: string;
  title: string;
  instruction: string;
  profile_name: string | null;
  enabled: boolean;
  priority: number;
  override_policy: StandingOrderOverridePolicy;
  created_by: string | null;
  updated_by: string | null;
}

export interface StandingOrderListResponse {
  items: StandingOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateStandingOrderRequest {
  project_id: string;
  title: string;
  instruction: string;
  profile_name?: string;
  enabled?: boolean;
  priority?: number;
  override_policy?: StandingOrderOverridePolicy;
  created_by?: string;
}

export interface UpdateStandingOrderRequest {
  title?: string;
  instruction?: string;
  profile_name?: string;
  enabled?: boolean;
  priority?: number;
  override_policy?: StandingOrderOverridePolicy;
  updated_by?: string;
}