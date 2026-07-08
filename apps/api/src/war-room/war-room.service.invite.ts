import type {
  InviteWarRoomParticipantParams,
  InviteWarRoomParticipantResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  optionalString,
  resolveActiveAgentProfileName,
  requireRole,
  requireString,
  validateMutatingSessionAccess,
} from './war-room.service.shared';

export async function inviteWarRoomParticipant(
  dependencies: WarRoomServiceDependencies,
  params: InviteWarRoomParticipantParams,
): Promise<InviteWarRoomParticipantResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  const denialReason = validateMutatingSessionAccess(session, workflowRunId);
  if (denialReason) {
    return {
      status: 'denied',
      session_id: sessionId,
      workflow_run_id: workflowRunId,
      participant: null,
      denial_reason: denialReason,
      lifecycle_events: [],
    };
  }

  const agentProfile = await resolveActiveAgentProfileName(
    dependencies,
    params.agent_profile,
    'agent_profile',
  );
  const role = requireRole(params.role, 'role');

  const participant =
    await dependencies.participantRepository.upsertBySessionAndAgentProfile(
      sessionId,
      agentProfile,
      {
        session_id: sessionId,
        workflow_run_id: workflowRunId,
        agent_profile: agentProfile,
        role,
        execution_id: optionalString(params.execution_id) ?? null,
        participation_status: 'invited',
        metadata: params.metadata ?? null,
      },
    );

  const lifecycleEvents: WarRoomLifecycleEvent[] = [
    {
      event_type: 'war_room_participant_invited',
      payload: {
        session_id: sessionId,
        agent_profile: participant.agent_profile,
        role: participant.role,
        participation_status: participant.participation_status,
      },
    },
  ];

  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    optionalString(params.execution_id),
    lifecycleEvents,
  );

  return {
    status: 'invited',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    participant: {
      agent_profile: participant.agent_profile,
      role: participant.role,
      participation_status: participant.participation_status,
      execution_id: participant.execution_id ?? null,
    },
    lifecycle_events: lifecycleEvents,
  };
}
