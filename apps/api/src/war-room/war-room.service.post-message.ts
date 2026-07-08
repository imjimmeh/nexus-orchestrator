import type {
  PostWarRoomMessageParams,
  PostWarRoomMessageResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  optionalString,
  requireMessageKind,
  requireString,
  resolveActiveAgentProfileName,
  validateMutatingSessionAccess,
} from './war-room.service.shared';

export async function postWarRoomMessage(
  dependencies: WarRoomServiceDependencies,
  params: PostWarRoomMessageParams,
): Promise<PostWarRoomMessageResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  const messageKind = requireMessageKind(params.message_kind, 'message_kind');
  const denialReason = validateMutatingSessionAccess(session, workflowRunId);
  if (denialReason) {
    return buildDeniedMessageResult(
      sessionId,
      workflowRunId,
      messageKind,
      denialReason,
      session?.consensus_state ?? null,
    );
  }
  if (!session) {
    return buildDeniedMessageResult(
      sessionId,
      workflowRunId,
      messageKind,
      'session_not_found',
      null,
    );
  }

  return postValidatedWarRoomMessage(
    dependencies,
    params,
    workflowRunId,
    sessionId,
    session.consensus_state,
    messageKind,
  );
}

async function postValidatedWarRoomMessage(
  dependencies: WarRoomServiceDependencies,
  params: PostWarRoomMessageParams,
  workflowRunId: string,
  sessionId: string,
  consensusState: NonNullable<PostWarRoomMessageResult['consensus_state']>,
  messageKind: PostWarRoomMessageResult['message_kind'],
): Promise<PostWarRoomMessageResult> {
  const body = requireString(params.body, 'body');
  const maxMessageChars = await dependencies.systemSettings.get<number>(
    'agent_war_room_max_message_chars',
    4000,
  );

  const actorValidation = await validateMessageActor({
    dependencies,
    params,
    sessionId,
  });
  if (actorValidation.denialReason) {
    return buildDeniedMessageResult(
      sessionId,
      workflowRunId,
      messageKind,
      actorValidation.denialReason,
      consensusState,
    );
  }

  if (body.length > maxMessageChars) {
    return buildDeniedMessageResult(
      sessionId,
      workflowRunId,
      messageKind,
      'message_too_large',
      consensusState,
    );
  }

  const message = await dependencies.messageRepository.create({
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    sender_execution_id: actorValidation.senderExecutionId,
    sender_profile: actorValidation.senderProfile,
    message_kind: messageKind,
    body,
    metadata: params.metadata ?? null,
  });

  const nextConsensusState = await advanceConsensusForMessage(
    dependencies,
    sessionId,
    consensusState,
    messageKind,
  );

  const lifecycleEvents: WarRoomLifecycleEvent[] = [
    {
      event_type: 'war_room_message_posted',
      payload: {
        session_id: sessionId,
        message_id: message.id,
        message_kind: message.message_kind,
        sender_profile: message.sender_profile,
      },
    },
  ];
  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    optionalString(params.sender_execution_id),
    lifecycleEvents,
  );

  return {
    status: 'posted',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    message_id: message.id,
    message_kind: message.message_kind,
    consensus_state: nextConsensusState,
    lifecycle_events: lifecycleEvents,
  };
}

async function validateMessageActor(params: {
  dependencies: WarRoomServiceDependencies;
  params: PostWarRoomMessageParams;
  sessionId: string;
}): Promise<{
  denialReason: string | null;
  senderProfile: string | null;
  senderExecutionId: string | null;
}> {
  const senderProfileInput = optionalString(params.params.sender_profile);
  if (!senderProfileInput) {
    return {
      denialReason: 'sender_profile_required',
      senderProfile: null,
      senderExecutionId: null,
    };
  }

  const senderProfile = await resolveActiveAgentProfileName(
    params.dependencies,
    senderProfileInput,
    'sender_profile',
  );
  const participant =
    await params.dependencies.participantRepository.findBySessionAndAgentProfile(
      params.sessionId,
      senderProfile,
    );
  if (!participant) {
    return {
      denialReason: 'sender_not_participant',
      senderProfile: null,
      senderExecutionId: null,
    };
  }

  if (
    ['declined', 'left', 'removed'].includes(participant.participation_status)
  ) {
    return {
      denialReason: 'sender_not_available',
      senderProfile: null,
      senderExecutionId: null,
    };
  }

  const senderExecutionId = optionalString(params.params.sender_execution_id);
  if (
    participant.execution_id &&
    senderExecutionId &&
    participant.execution_id !== senderExecutionId
  ) {
    return {
      denialReason: 'sender_execution_mismatch',
      senderProfile: null,
      senderExecutionId: null,
    };
  }

  return {
    denialReason: null,
    senderProfile,
    senderExecutionId,
  };
}

function buildDeniedMessageResult(
  sessionId: string,
  workflowRunId: string,
  messageKind: PostWarRoomMessageResult['message_kind'],
  denialReason: string,
  consensusState: PostWarRoomMessageResult['consensus_state'],
): PostWarRoomMessageResult {
  return {
    status: 'denied',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    message_id: null,
    message_kind: messageKind,
    consensus_state: consensusState,
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}

async function advanceConsensusForMessage(
  dependencies: WarRoomServiceDependencies,
  sessionId: string,
  currentConsensusState: NonNullable<
    PostWarRoomMessageResult['consensus_state']
  >,
  messageKind: PostWarRoomMessageResult['message_kind'],
): Promise<NonNullable<PostWarRoomMessageResult['consensus_state']>> {
  if (
    currentConsensusState !== 'collecting_input' ||
    (messageKind !== 'proposal' && messageKind !== 'response')
  ) {
    return currentConsensusState;
  }

  await dependencies.sessionRepository.updateBySessionId(sessionId, {
    consensus_state: 'draft_ready',
  });
  return 'draft_ready';
}
