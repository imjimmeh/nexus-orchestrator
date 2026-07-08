export type RuntimeOrchestrationMode =
  | "autonomous"
  | "supervised"
  | "notifications_only";

export type RuntimeWorkflowRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface RuntimeCapabilityDeniedTool {
  toolName: string;
  reasonCode: "policy_denied" | "mode_denied" | "tool_not_registered";
  reason: string;
  remediation?: string;
}

export interface RuntimeCapabilitiesSnapshot {
  workflow_run_id: string;
  job_id: string;
  project_id: string | null;
  orchestration_mode: RuntimeOrchestrationMode | null;
  callable_tools: string[];
  denied_tools: RuntimeCapabilityDeniedTool[];
  approval_required_tools: string[];
  required_next_action: "approval_required" | "review_policy_or_mode" | "none";
}

export interface ProjectOrchestrationDiagnosticReason {
  code:
    | "orchestration_missing"
    | "orchestration_awaiting_approval"
    | "orchestration_paused"
    | "pending_action_approval"
    | "import_hydration_blocked"
    | "run_failed";
  message: string;
  remediation?: string;
}

export interface ProjectOrchestrationDiagnostics {
  project_id: string;
  blocked: boolean;
  reasons: ProjectOrchestrationDiagnosticReason[];
  completion_readiness?: {
    ok: boolean;
    phase: string;
    checked_at: string;
    blocking_reasons: Array<{
      code: string;
      message: string;
      remediation?: string;
      details?: Record<string, unknown>;
    }>;
    metrics?: Record<string, unknown>;
  } | null;
  latest_run: {
    id: string;
    workflow_id: string;
    status: RuntimeWorkflowRunStatus;
    current_step_id: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  latest_failure_event: {
    event_type: string;
    timestamp: string;
    payload: Record<string, unknown>;
  } | null;
  dispatch_polling?: {
    enabled: boolean;
    last_tick: {
      source: "poll";
      tickBucket: number;
      intervalSeconds: number;
      batchSize: number;
      scannedProjectCount: number;
      enqueuedProjectCount: number;
      skippedProjectCount: number;
      durationMs: number;
      createdAt: string;
    } | null;
    last_project_outcome: {
      projectId: string;
      reason: string;
      tickBucket: number;
      polledAt: string;
    } | null;
  };
  dispatch_capacity?: {
    maxActive: number;
    activeCount: number;
    availableSlots: number;
    projectAvailableSlots: number;
    agentCapacityEnabled: boolean;
    configuredAgentCount: number;
    idleAgentCount: number;
    agentAvailableSlots: number;
  };
  retrospective?: ProjectRetrospectiveDiagnostics;
}

export type ProjectRetrospectiveStatus =
  | "not_started"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped_duplicate";

export type ProjectRetrospectiveTrigger =
  | "completion_event"
  | "manual"
  | "specs_ready"
  | "bootstrap_completed"
  | "phase_promoted_to_nearing_completion";

export type ProjectRetrospectiveSkipReason =
  | "duplicate_trigger"
  | "cooldown_active"
  | "insufficient_delta"
  | "autorun_disabled";

export interface ProjectRetrospectiveDeltaSnapshot {
  total_work_items: number;
  done_work_items: number;
  blocked_work_items: number;
  total_workflow_runs: number;
  failed_workflow_runs: number;
  qa_reject_feedback_count: number;
  qa_repeated_rejections: number;
  captured_at: string;
}

export interface ProjectRetrospectiveCheckpointHistoryItem {
  trigger_type: ProjectRetrospectiveTrigger;
  status: ProjectRetrospectiveStatus;
  lesson_count: number;
  triggered_at: string;
  completed_at: string | null;
  skip_reason: ProjectRetrospectiveSkipReason | null;
}

export interface ProjectRetrospectiveDiagnostics {
  status: ProjectRetrospectiveStatus;
  latest_orchestration_id: string | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  lesson_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  last_trigger_type: ProjectRetrospectiveTrigger | null;
  last_triggered_at: string | null;
  last_skip_reason: ProjectRetrospectiveSkipReason | null;
  last_delta_snapshot: ProjectRetrospectiveDeltaSnapshot | null;
  checkpoint_history_summary: ProjectRetrospectiveCheckpointHistoryItem[];
  remediation: string | null;
}

export type ProjectWarRoomParticipantRole =
  | "architect"
  | "dev"
  | "qa"
  | "pm"
  | "moderator";

export type ProjectWarRoomParticipantStatus =
  | "invited"
  | "active"
  | "left"
  | "declined";

export type ProjectWarRoomMessageKind =
  | "proposal"
  | "question"
  | "response"
  | "system";

export type ProjectWarRoomSignoffDecision =
  | "approved"
  | "changes_requested"
  | "blocked";

export type ProjectWarRoomResolutionType =
  | "consensus"
  | "deadlock"
  | "ceo_tie_break"
  | "manual";

export type ProjectWarRoomSessionStatus = "open" | "closed";

export type ProjectWarRoomConsensusState =
  | "collecting_input"
  | "draft_ready"
  | "partial_signoff"
  | "consensus_reached"
  | "deadlocked"
  | "ceo_tie_break_applied";

export interface ProjectWarRoomLifecycleEvent {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface OpenProjectWarRoomSessionRequest {
  workflow_run_id: string;
  session_id?: string;
  work_item_id?: string;
  moderator_profile?: string;
  participants?: Array<{
    agent_profile: string;
    role: ProjectWarRoomParticipantRole;
    execution_id?: string;
    participation_status?: ProjectWarRoomParticipantStatus;
    metadata?: Record<string, unknown>;
  }>;
  initial_message?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenProjectWarRoomSessionResponse {
  status: "opened" | "denied";
  session_id: string;
  workflow_run_id: string;
  project_id: string;
  work_item_id: string | null;
  session_status: ProjectWarRoomSessionStatus;
  consensus_state: ProjectWarRoomConsensusState;
  denial_reason?: string;
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
}

export interface ProjectWarRoomSessionSummary {
  session_id: string;
  project_id: string;
  work_item_id: string | null;
  session_status: ProjectWarRoomSessionStatus;
  consensus_state: ProjectWarRoomConsensusState;
  moderator_profile: string;
  opened_at: string;
  closed_at: string | null;
  resolution_type: ProjectWarRoomResolutionType | null;
}

export interface ListProjectWarRoomSessionsResponse {
  workflow_run_id: string;
  sessions: ProjectWarRoomSessionSummary[];
}

export interface ProjectWarRoomStateResponse {
  status: "found" | "not_found" | "denied";
  session_id: string;
  workflow_run_id: string;
  project_id?: string;
  work_item_id?: string | null;
  session_status?: ProjectWarRoomSessionStatus;
  consensus_state?: ProjectWarRoomConsensusState;
  resolution_type?: ProjectWarRoomResolutionType | null;
  resolution_note?: string | null;
  moderator_profile?: string;
  participants?: Array<{
    agent_profile: string;
    role: ProjectWarRoomParticipantRole;
    participation_status: ProjectWarRoomParticipantStatus;
    execution_id: string | null;
  }>;
  messages?: Array<{
    id: string;
    message_kind: ProjectWarRoomMessageKind;
    body: string;
    sender_execution_id: string | null;
    sender_profile: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  blackboard_versions?: Array<{
    version: number;
    strategy_summary: string | null;
    risks: unknown[] | null;
    decision_log: unknown[] | null;
    implementation_plan_ref: string | null;
    updated_by_execution_id: string | null;
    created_at: string;
  }>;
  signoffs?: Array<{
    role: ProjectWarRoomParticipantRole;
    agent_profile: string;
    decision: ProjectWarRoomSignoffDecision;
    rationale: string | null;
    submitted_by_execution_id: string | null;
    updated_at: string;
  }>;
  required_roles?: ProjectWarRoomParticipantRole[];
  denial_reason?: string;
}

export interface InviteProjectWarRoomParticipantRequest {
  workflow_run_id: string;
  agent_profile: string;
  role: ProjectWarRoomParticipantRole;
  execution_id?: string;
  metadata?: Record<string, unknown>;
}

export interface InviteProjectWarRoomParticipantResponse {
  status: "invited" | "denied";
  session_id: string;
  workflow_run_id: string;
  participant: {
    agent_profile: string;
    role: ProjectWarRoomParticipantRole;
    participation_status: ProjectWarRoomParticipantStatus;
    execution_id: string | null;
  } | null;
  denial_reason?: string;
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
}

export interface PostProjectWarRoomMessageRequest {
  workflow_run_id: string;
  message_kind: ProjectWarRoomMessageKind;
  body: string;
  sender_profile?: string;
  metadata?: Record<string, unknown>;
}

export interface PostProjectWarRoomMessageResponse {
  status: "posted" | "denied";
  session_id: string;
  workflow_run_id: string;
  message_id: string | null;
  message_kind: ProjectWarRoomMessageKind;
  consensus_state: ProjectWarRoomConsensusState | null;
  denial_reason?: string;
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
}

export interface UpdateProjectWarRoomBlackboardRequest {
  workflow_run_id: string;
  expected_version?: number;
  strategy_summary?: string | null;
  risks?: unknown[] | null;
  decision_log?: unknown[] | null;
  implementation_plan_ref?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectWarRoomBlackboardResponse {
  status: "updated" | "conflict" | "denied";
  session_id: string;
  workflow_run_id: string;
  version: number | null;
  current_version: number;
  consensus_state: ProjectWarRoomConsensusState | null;
  denial_reason?: string;
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
}

export interface SubmitProjectWarRoomSignoffRequest {
  workflow_run_id: string;
  role: ProjectWarRoomParticipantRole;
  agent_profile: string;
  decision: ProjectWarRoomSignoffDecision;
  rationale?: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitProjectWarRoomSignoffResponse {
  status: "submitted" | "denied";
  session_id: string;
  workflow_run_id: string;
  consensus_state: ProjectWarRoomConsensusState | null;
  required_roles: ProjectWarRoomParticipantRole[];
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
  denial_reason?: string;
}

export interface CloseProjectWarRoomSessionRequest {
  workflow_run_id: string;
  resolution_type?: ProjectWarRoomResolutionType;
  resolution_note?: string;
  metadata?: Record<string, unknown>;
}

export interface CloseProjectWarRoomSessionResponse {
  status: "closed" | "denied";
  session_id: string;
  workflow_run_id: string;
  session_status: ProjectWarRoomSessionStatus | null;
  consensus_state: ProjectWarRoomConsensusState | null;
  resolution_type: ProjectWarRoomResolutionType | null;
  denial_reason?: string;
  lifecycle_events: ProjectWarRoomLifecycleEvent[];
}

export interface ReplayProjectRetrospectiveRequest {
  mode?: "append" | "replace";
}

export interface ReplayProjectRetrospectiveResponse {
  status: "succeeded" | "failed" | "skipped_duplicate";
  lessonCount: number;
}

export interface StartupRoutingSourceContext {
  sourceType: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingReadinessContext {
  isReady: boolean;
  readinessReason?: string;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingHints {
  preferredWorkflowId?: string;
  preferredRouteId?: string;
  skipRouteArbitration?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingContext {
  scopeId: string;
  goals: string;
  sourceContext?: StartupRoutingSourceContext;
  readinessContext?: StartupRoutingReadinessContext;
  startupHints?: StartupRoutingHints;
}

export interface StartupRoutingDecision {
  routeId: string;
  ruleId: string;
  workflowId: string;
  reasoning?: string;
  inputs?: Record<string, unknown>;
}
