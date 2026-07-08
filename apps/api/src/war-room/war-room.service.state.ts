import type {
  GetWarRoomStateParams,
  GetWarRoomStateResult,
  ListWarRoomSessionsByRunParams,
  ListWarRoomSessionsByRunResult,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  requireString,
  resolveRequiredSignoffRoles,
} from './war-room.service.shared';

type WarRoomParticipantState = NonNullable<
  GetWarRoomStateResult['participants']
>[number];
type WarRoomMessageState = NonNullable<
  GetWarRoomStateResult['messages']
>[number];
type WarRoomBlackboardState = NonNullable<
  GetWarRoomStateResult['blackboard_versions']
>[number];
type WarRoomSignoffState = NonNullable<
  GetWarRoomStateResult['signoffs']
>[number];
type WarRoomParticipantSource = Omit<
  WarRoomParticipantState,
  'execution_id'
> & {
  execution_id?: string | null;
};
type WarRoomMessageSource = Omit<
  WarRoomMessageState,
  'sender_execution_id' | 'sender_profile' | 'metadata'
> & {
  sender_execution_id?: string | null;
  sender_profile?: string | null;
  metadata?: Record<string, unknown> | null;
};
type WarRoomBlackboardSource = Omit<
  WarRoomBlackboardState,
  | 'strategy_summary'
  | 'risks'
  | 'decision_log'
  | 'implementation_plan_ref'
  | 'updated_by_execution_id'
> & {
  strategy_summary?: string | null;
  risks?: unknown[] | null;
  decision_log?: unknown[] | null;
  implementation_plan_ref?: string | null;
  updated_by_execution_id?: string | null;
};
type WarRoomSignoffSource = Omit<
  WarRoomSignoffState,
  'rationale' | 'submitted_by_execution_id'
> & {
  rationale?: string | null;
  submitted_by_execution_id?: string | null;
};

export async function getWarRoomState(
  dependencies: WarRoomServiceDependencies,
  params: GetWarRoomStateParams,
): Promise<GetWarRoomStateResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  if (!session) {
    return {
      status: 'not_found',
      session_id: sessionId,
      workflow_run_id: workflowRunId,
    };
  }
  if (session.workflow_run_id !== workflowRunId) {
    return {
      status: 'denied',
      session_id: sessionId,
      workflow_run_id: workflowRunId,
      denial_reason: 'workflow_run_scope_mismatch',
    };
  }

  const [participants, messages, blackboardVersions, signoffs, requiredRoles] =
    await Promise.all([
      dependencies.participantRepository.findBySessionId(sessionId),
      dependencies.messageRepository.findBySessionId(sessionId),
      dependencies.blackboardRepository.findBySessionId(sessionId),
      dependencies.signoffRepository.findBySessionId(sessionId),
      resolveRequiredSignoffRoles(dependencies),
    ]);

  return {
    status: 'found',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    session_status: session.status,
    consensus_state: session.consensus_state,
    resolution_type: session.resolution_type ?? null,
    resolution_note: session.resolution_note ?? null,
    moderator_profile: session.moderator_profile,
    participants: participants.map(mapParticipantState),
    messages: messages.map(mapMessageState),
    blackboard_versions: blackboardVersions.map(mapBlackboardState),
    signoffs: signoffs.map(mapSignoffState),
    required_roles: requiredRoles,
  };
}

export async function listWarRoomSessionsByRun(
  dependencies: WarRoomServiceDependencies,
  params: ListWarRoomSessionsByRunParams,
): Promise<ListWarRoomSessionsByRunResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessions = await dependencies.sessionRepository.findByRun(
    workflowRunId,
    {
      activeOnly: params.active_only === true,
    },
  );

  return {
    workflow_run_id: workflowRunId,
    sessions: sessions.map((session) => ({
      session_id: session.session_id,
      session_status: session.status,
      consensus_state: session.consensus_state,
      moderator_profile: session.moderator_profile,
      opened_at: session.opened_at,
      closed_at: session.closed_at ?? null,
      resolution_type: session.resolution_type ?? null,
    })),
  };
}

function mapParticipantState(
  participant: WarRoomParticipantSource,
): WarRoomParticipantState {
  return {
    agent_profile: participant.agent_profile,
    role: participant.role,
    participation_status: participant.participation_status,
    execution_id: participant.execution_id ?? null,
  };
}

function mapMessageState(message: WarRoomMessageSource): WarRoomMessageState {
  return {
    id: message.id,
    message_kind: message.message_kind,
    body: message.body,
    sender_execution_id: message.sender_execution_id ?? null,
    sender_profile: message.sender_profile ?? null,
    metadata: message.metadata ?? null,
    created_at: message.created_at,
  };
}

function mapBlackboardState(
  entry: WarRoomBlackboardSource,
): WarRoomBlackboardState {
  return {
    version: entry.version,
    strategy_summary: entry.strategy_summary ?? null,
    risks: entry.risks ?? null,
    decision_log: entry.decision_log ?? null,
    implementation_plan_ref: entry.implementation_plan_ref ?? null,
    updated_by_execution_id: entry.updated_by_execution_id ?? null,
    created_at: entry.created_at,
  };
}

function mapSignoffState(signoff: WarRoomSignoffSource): WarRoomSignoffState {
  return {
    role: signoff.role,
    agent_profile: signoff.agent_profile,
    decision: signoff.decision,
    rationale: signoff.rationale ?? null,
    submitted_by_execution_id: signoff.submitted_by_execution_id ?? null,
    updated_at: signoff.updated_at,
  };
}
