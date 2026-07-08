import { randomUUID } from 'node:crypto';
import type {
  OpenWarRoomParams,
  OpenWarRoomResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  normalizeParticipants,
  optionalString,
  resolveActiveAgentProfileName,
  requireString,
} from './war-room.service.shared';

interface OpenWarRoomContext {
  sessionId: string;
  moderatorProfile: string;
  participants: ReturnType<typeof normalizeParticipants>;
}

interface ExistingWarRoomSession {
  session_id: string;
  workflow_run_id: string;
  status: OpenWarRoomResult['session_status'];
  consensus_state: OpenWarRoomResult['consensus_state'];
}

export async function openWarRoomSession(
  dependencies: WarRoomServiceDependencies,
  params: OpenWarRoomParams,
): Promise<OpenWarRoomResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const run = await dependencies.workflowRunRepository.findById(workflowRunId);

  const openContextOrDenied = await resolveOpenSessionContext(
    dependencies,
    params,
    workflowRunId,
    run?.state_variables ?? null,
  );
  if ('status' in openContextOrDenied) {
    return openContextOrDenied;
  }

  const { sessionId, moderatorProfile, participants } = openContextOrDenied;
  const session = await dependencies.sessionRepository.create({
    session_id: openContextOrDenied.sessionId,
    workflow_run_id: workflowRunId,
    scope_id: optionalString(params.scope_id) ?? null,
    context_id: optionalString(params.context_id) ?? null,
    status: 'open',
    consensus_state: 'collecting_input',
    created_by_execution_id:
      optionalString(params.created_by_execution_id) ?? null,
    moderator_profile: openContextOrDenied.moderatorProfile,
    metadata: params.metadata ?? null,
    opened_at: new Date(),
  });

  await upsertSessionParticipants(dependencies, sessionId, participants);
  const lifecycleEvents = buildOpenedLifecycleEvents(
    sessionId,
    workflowRunId,
    openContextOrDenied.moderatorProfile,
    participants.length,
    optionalString(params.scope_id) ?? null,
    optionalString(params.context_id) ?? null,
  );
  const nextConsensusState = await appendInitialMessageLifecycle(
    dependencies,
    params,
    sessionId,
    workflowRunId,
    moderatorProfile,
    lifecycleEvents,
    session.consensus_state,
  );

  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    optionalString(params.created_by_execution_id),
    lifecycleEvents,
  );

  return {
    status: 'opened',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    session_status: session.status,
    consensus_state: nextConsensusState,
    lifecycle_events: lifecycleEvents,
  };
}

async function resolveOpenSessionContext(
  dependencies: WarRoomServiceDependencies,
  params: OpenWarRoomParams,
  workflowRunId: string,
  _runStateVariables: Record<string, unknown> | null,
): Promise<OpenWarRoomContext | OpenWarRoomResult> {
  const sessionId = optionalString(params.session_id) ?? randomUUID();

  const existingSession =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  const existingSessionResolution = resolveExistingSessionOpenResult(
    existingSession,
    workflowRunId,
  );
  if (existingSessionResolution) {
    return existingSessionResolution;
  }

  const moderatorProfile = await resolveActiveAgentProfileName(
    dependencies,
    params.moderator_profile,
    'moderator_profile',
  );
  const normalizedParticipants = normalizeParticipants(
    params.participants ?? [],
    workflowRunId,
    moderatorProfile,
  );
  const participants = await resolveCanonicalParticipants(
    dependencies,
    normalizedParticipants,
  );

  return {
    sessionId,
    moderatorProfile,
    participants,
  };
}

function resolveExistingSessionOpenResult(
  existingSession: ExistingWarRoomSession | null,
  workflowRunId: string,
): OpenWarRoomResult | null {
  if (!existingSession) {
    return null;
  }

  if (
    existingSession.workflow_run_id === workflowRunId &&
    existingSession.status === 'open'
  ) {
    return {
      status: 'opened',
      session_id: existingSession.session_id,
      workflow_run_id: workflowRunId,
      session_status: existingSession.status,
      consensus_state: existingSession.consensus_state,
      lifecycle_events: [],
    };
  }

  return buildDeniedOpenResult(
    existingSession.session_id,
    workflowRunId,
    'session_id_already_exists',
    existingSession.status,
    existingSession.consensus_state,
  );
}

async function resolveCanonicalParticipants(
  dependencies: WarRoomServiceDependencies,
  participants: ReturnType<typeof normalizeParticipants>,
): Promise<ReturnType<typeof normalizeParticipants>> {
  const canonicalByProfile = new Map<
    string,
    ReturnType<typeof normalizeParticipants>[number]
  >();

  for (const participant of participants) {
    const canonicalProfile = await resolveActiveAgentProfileName(
      dependencies,
      participant.agent_profile,
      'participants[].agent_profile',
    );

    canonicalByProfile.set(canonicalProfile.toLowerCase(), {
      ...participant,
      agent_profile: canonicalProfile,
    });
  }

  return [...canonicalByProfile.values()];
}

function buildDeniedOpenResult(
  sessionId: string,
  workflowRunId: string,
  denialReason: string,
  sessionStatus: OpenWarRoomResult['session_status'] = 'open',
  consensusState: OpenWarRoomResult['consensus_state'] = 'collecting_input',
): OpenWarRoomResult {
  return {
    status: 'denied',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    session_status: sessionStatus,
    consensus_state: consensusState,
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}

async function upsertSessionParticipants(
  dependencies: WarRoomServiceDependencies,
  sessionId: string,
  participants: ReturnType<typeof normalizeParticipants>,
): Promise<void> {
  for (const participant of participants) {
    await dependencies.participantRepository.upsertBySessionAndAgentProfile(
      sessionId,
      participant.agent_profile,
      participant,
    );
  }
}

function buildOpenedLifecycleEvents(
  sessionId: string,
  workflowRunId: string,
  moderatorProfile: string,
  participantCount: number,
  scopeId: string | null = null,
  contextId: string | null = null,
): WarRoomLifecycleEvent[] {
  return [
    {
      event_type: 'war_room_opened',
      payload: {
        session_id: sessionId,
        workflow_run_id: workflowRunId,
        scope_id: scopeId,
        context_id: contextId,
        moderator_profile: moderatorProfile,
        participant_count: participantCount,
      },
    },
  ];
}

async function appendInitialMessageLifecycle(
  dependencies: WarRoomServiceDependencies,
  params: OpenWarRoomParams,
  sessionId: string,
  workflowRunId: string,
  moderatorProfile: string,
  lifecycleEvents: WarRoomLifecycleEvent[],
  initialConsensusState: OpenWarRoomResult['consensus_state'],
): Promise<OpenWarRoomResult['consensus_state']> {
  const initialMessage = optionalString(params.initial_message);
  if (!initialMessage) {
    return initialConsensusState;
  }

  const message = await dependencies.messageRepository.create({
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    sender_execution_id: optionalString(params.created_by_execution_id) ?? null,
    sender_profile: moderatorProfile,
    message_kind: 'proposal',
    body: initialMessage,
    metadata: params.metadata ?? null,
  });
  lifecycleEvents.push({
    event_type: 'war_room_message_posted',
    payload: {
      session_id: sessionId,
      message_id: message.id,
      message_kind: message.message_kind,
      sender_profile: message.sender_profile ?? moderatorProfile,
    },
  });
  await dependencies.sessionRepository.updateBySessionId(sessionId, {
    consensus_state: 'draft_ready',
  });
  return 'draft_ready';
}
