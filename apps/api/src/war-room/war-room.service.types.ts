import type {
  AgentWarRoomConsensusState,
  AgentWarRoomResolutionType,
  AgentWarRoomSessionStatus,
} from './database/entities/agent-war-room-session.entity';
import type {
  AgentWarRoomParticipantRole,
  AgentWarRoomParticipationStatus,
} from './database/entities/agent-war-room-participant.entity';
import type { AgentWarRoomMessageKind } from './database/entities/agent-war-room-message.entity';
import type { AgentWarRoomSignoffDecision } from './database/entities/agent-war-room-signoff.entity';

export interface WarRoomLifecycleEvent {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface WarRoomParticipantInput {
  agent_profile: string;
  role: AgentWarRoomParticipantRole;
  execution_id?: string | null;
  participation_status?: AgentWarRoomParticipationStatus;
  metadata?: Record<string, unknown> | null;
}

export interface OpenWarRoomParams {
  workflow_run_id: string;
  session_id?: string | null;
  scope_id?: string | null;
  context_id?: string | null;
  created_by_execution_id?: string | null;
  moderator_profile: string;
  participants?: WarRoomParticipantInput[];
  initial_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OpenWarRoomResult {
  status: 'opened' | 'denied';
  session_id: string;
  workflow_run_id: string;
  session_status: AgentWarRoomSessionStatus;
  consensus_state: AgentWarRoomConsensusState;
  denial_reason?: string;
  lifecycle_events: WarRoomLifecycleEvent[];
}

export interface InviteWarRoomParticipantParams {
  workflow_run_id: string;
  session_id: string;
  agent_profile: string;
  role: AgentWarRoomParticipantRole;
  execution_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface InviteWarRoomParticipantResult {
  status: 'invited' | 'denied';
  session_id: string;
  workflow_run_id: string;
  participant: {
    agent_profile: string;
    role: AgentWarRoomParticipantRole;
    participation_status: AgentWarRoomParticipationStatus;
    execution_id: string | null;
  } | null;
  denial_reason?: string;
  lifecycle_events: WarRoomLifecycleEvent[];
}

export interface PostWarRoomMessageParams {
  workflow_run_id: string;
  session_id: string;
  message_kind: AgentWarRoomMessageKind;
  body: string;
  sender_execution_id?: string | null;
  sender_profile?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PostWarRoomMessageResult {
  status: 'posted' | 'denied';
  session_id: string;
  workflow_run_id: string;
  message_id: string | null;
  message_kind: AgentWarRoomMessageKind;
  consensus_state: AgentWarRoomConsensusState | null;
  denial_reason?: string;
  lifecycle_events: WarRoomLifecycleEvent[];
}

export interface UpdateWarRoomBlackboardParams {
  workflow_run_id: string;
  session_id: string;
  expected_version?: number | null;
  strategy_summary?: string | null;
  risks?: unknown[] | null;
  decision_log?: unknown[] | null;
  implementation_plan_ref?: string | null;
  updated_by_execution_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateWarRoomBlackboardResult {
  status: 'updated' | 'conflict' | 'denied';
  session_id: string;
  workflow_run_id: string;
  version: number | null;
  current_version: number;
  consensus_state: AgentWarRoomConsensusState | null;
  denial_reason?: string;
  lifecycle_events: WarRoomLifecycleEvent[];
}

export interface SubmitWarRoomSignoffParams {
  workflow_run_id: string;
  session_id: string;
  role: AgentWarRoomParticipantRole;
  agent_profile: string;
  decision: AgentWarRoomSignoffDecision;
  rationale?: string | null;
  submitted_by_execution_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SubmitWarRoomSignoffResult {
  status: 'submitted' | 'denied';
  session_id: string;
  workflow_run_id: string;
  consensus_state: AgentWarRoomConsensusState | null;
  required_roles: AgentWarRoomParticipantRole[];
  lifecycle_events: WarRoomLifecycleEvent[];
  denial_reason?: string;
}

export interface GetWarRoomStateParams {
  workflow_run_id: string;
  session_id: string;
}

export interface GetWarRoomStateResult {
  status: 'found' | 'not_found' | 'denied';
  session_id: string;
  workflow_run_id: string;
  session_status?: AgentWarRoomSessionStatus;
  consensus_state?: AgentWarRoomConsensusState;
  resolution_type?: AgentWarRoomResolutionType | null;
  resolution_note?: string | null;
  moderator_profile?: string;
  participants?: Array<{
    agent_profile: string;
    role: AgentWarRoomParticipantRole;
    participation_status: AgentWarRoomParticipationStatus;
    execution_id: string | null;
  }>;
  messages?: Array<{
    id: string;
    message_kind: AgentWarRoomMessageKind;
    body: string;
    sender_execution_id: string | null;
    sender_profile: string | null;
    metadata: Record<string, unknown> | null;
    created_at: Date;
  }>;
  blackboard_versions?: Array<{
    version: number;
    strategy_summary: string | null;
    risks: unknown[] | null;
    decision_log: unknown[] | null;
    implementation_plan_ref: string | null;
    updated_by_execution_id: string | null;
    created_at: Date;
  }>;
  signoffs?: Array<{
    role: AgentWarRoomParticipantRole;
    agent_profile: string;
    decision: AgentWarRoomSignoffDecision;
    rationale: string | null;
    submitted_by_execution_id: string | null;
    updated_at: Date;
  }>;
  required_roles?: AgentWarRoomParticipantRole[];
  denial_reason?: string;
}

export interface CloseWarRoomParams {
  workflow_run_id: string;
  session_id: string;
  closed_by_execution_id?: string | null;
  resolution_type?: AgentWarRoomResolutionType | null;
  resolution_note?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CloseWarRoomResult {
  status: 'closed' | 'denied';
  session_id: string;
  workflow_run_id: string;
  session_status: AgentWarRoomSessionStatus | null;
  consensus_state: AgentWarRoomConsensusState | null;
  resolution_type: AgentWarRoomResolutionType | null;
  denial_reason?: string;
  lifecycle_events: WarRoomLifecycleEvent[];
}

export interface ListWarRoomSessionsByRunParams {
  workflow_run_id: string;
  active_only?: boolean;
}

export interface ListWarRoomSessionsByRunResult {
  workflow_run_id: string;
  sessions: Array<{
    session_id: string;
    session_status: AgentWarRoomSessionStatus;
    consensus_state: AgentWarRoomConsensusState;
    moderator_profile: string;
    opened_at: Date;
    closed_at: Date | null;
    resolution_type: AgentWarRoomResolutionType | null;
  }>;
}
