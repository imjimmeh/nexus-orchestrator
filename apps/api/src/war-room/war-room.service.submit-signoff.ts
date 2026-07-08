import type {
  SubmitWarRoomSignoffParams,
  SubmitWarRoomSignoffResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  optionalString,
  requireRole,
  requireSignoffDecision,
  requireString,
  resolveActiveAgentProfileName,
  resolveConsensusState,
  resolveDeadlockThreshold,
  resolveRequiredSignoffRoles,
  resolveResolutionTypeForConsensus,
  validateMutatingSessionAccess,
} from './war-room.service.shared';

export async function submitWarRoomSignoff(
  dependencies: WarRoomServiceDependencies,
  params: SubmitWarRoomSignoffParams,
): Promise<SubmitWarRoomSignoffResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  const denialReason = validateMutatingSessionAccess(session, workflowRunId);
  if (denialReason) {
    return buildDeniedSignoffResult(
      sessionId,
      workflowRunId,
      denialReason,
      session?.consensus_state ?? null,
    );
  }
  if (!session) {
    return buildDeniedSignoffResult(
      sessionId,
      workflowRunId,
      'session_not_found',
      null,
    );
  }

  const actorResolution = await resolveSignoffActor({
    dependencies,
    params,
    sessionId,
  });
  if (actorResolution.denialReason) {
    return buildDeniedSignoffResult(
      sessionId,
      workflowRunId,
      actorResolution.denialReason,
      session.consensus_state,
    );
  }

  await upsertSignoffParticipant(
    dependencies,
    workflowRunId,
    sessionId,
    actorResolution.role,
    actorResolution.agentProfile,
    actorResolution.submitterExecutionId,
  );
  await upsertSignoffDecision(
    dependencies,
    workflowRunId,
    sessionId,
    actorResolution.role,
    actorResolution.agentProfile,
    actorResolution.decision,
    actorResolution.submitterExecutionId,
    optionalString(params.rationale),
    params.metadata ?? null,
  );

  const finalizeResult = await finalizeSignoffSubmission(
    dependencies,
    workflowRunId,
    sessionId,
    actorResolution.role,
    actorResolution.agentProfile,
    actorResolution.decision,
    actorResolution.submitterExecutionId,
    session.consensus_state,
    session.moderator_profile,
  );

  return {
    status: 'submitted',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    consensus_state: finalizeResult.nextConsensusState,
    required_roles: finalizeResult.requiredRoles,
    lifecycle_events: finalizeResult.lifecycleEvents,
  };
}

async function resolveSignoffActor(params: {
  dependencies: WarRoomServiceDependencies;
  params: SubmitWarRoomSignoffParams;
  sessionId: string;
}): Promise<{
  denialReason: string | null;
  role: SubmitWarRoomSignoffParams['role'];
  agentProfile: string;
  decision: SubmitWarRoomSignoffParams['decision'];
  submitterExecutionId: string | null;
}> {
  const role = requireRole(params.params.role, 'role');
  const agentProfile = await resolveActiveAgentProfileName(
    params.dependencies,
    params.params.agent_profile,
    'agent_profile',
  );
  const decision = requireSignoffDecision(params.params.decision, 'decision');
  const submitterExecutionId = optionalString(
    params.params.submitted_by_execution_id,
  );

  const participant =
    await params.dependencies.participantRepository.findBySessionAndAgentProfile(
      params.sessionId,
      agentProfile,
    );
  if (!participant) {
    return {
      denialReason: 'signoff_participant_not_invited',
      role,
      agentProfile,
      decision,
      submitterExecutionId,
    };
  }

  if (participant.role !== role) {
    return {
      denialReason: 'signoff_role_mismatch',
      role,
      agentProfile,
      decision,
      submitterExecutionId,
    };
  }

  if (
    ['declined', 'left', 'removed'].includes(participant.participation_status)
  ) {
    return {
      denialReason: 'signoff_participant_not_available',
      role,
      agentProfile,
      decision,
      submitterExecutionId,
    };
  }

  if (
    participant.execution_id &&
    submitterExecutionId &&
    participant.execution_id !== submitterExecutionId
  ) {
    return {
      denialReason: 'signoff_execution_mismatch',
      role,
      agentProfile,
      decision,
      submitterExecutionId,
    };
  }

  return {
    denialReason: null,
    role,
    agentProfile,
    decision,
    submitterExecutionId,
  };
}

function buildDeniedSignoffResult(
  sessionId: string,
  workflowRunId: string,
  denialReason: string,
  consensusState: SubmitWarRoomSignoffResult['consensus_state'],
): SubmitWarRoomSignoffResult {
  return {
    status: 'denied',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    consensus_state: consensusState,
    required_roles: [],
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}

async function upsertSignoffParticipant(
  dependencies: WarRoomServiceDependencies,
  workflowRunId: string,
  sessionId: string,
  role: SubmitWarRoomSignoffParams['role'],
  agentProfile: string,
  executionId: string | null,
): Promise<void> {
  await dependencies.participantRepository.upsertBySessionAndAgentProfile(
    sessionId,
    agentProfile,
    {
      session_id: sessionId,
      workflow_run_id: workflowRunId,
      agent_profile: agentProfile,
      role,
      execution_id: executionId,
      participation_status: 'active',
      joined_at: new Date(),
    },
  );
}

async function upsertSignoffDecision(
  dependencies: WarRoomServiceDependencies,
  workflowRunId: string,
  sessionId: string,
  role: SubmitWarRoomSignoffParams['role'],
  agentProfile: string,
  decision: SubmitWarRoomSignoffParams['decision'],
  submittedByExecutionId: string | null,
  rationale: string | null,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  await dependencies.signoffRepository.upsertBySessionRoleAndProfile(
    sessionId,
    role,
    agentProfile,
    {
      session_id: sessionId,
      workflow_run_id: workflowRunId,
      role,
      agent_profile: agentProfile,
      decision,
      rationale,
      submitted_by_execution_id: submittedByExecutionId,
      metadata,
    },
  );
}

async function buildSignoffLifecycleEvents(
  dependencies: WarRoomServiceDependencies,
  sessionId: string,
  role: SubmitWarRoomSignoffParams['role'],
  agentProfile: string,
  decision: SubmitWarRoomSignoffParams['decision'],
  initialConsensusState: NonNullable<
    SubmitWarRoomSignoffResult['consensus_state']
  >,
  moderatorProfile: string,
): Promise<{
  nextConsensusState: NonNullable<
    SubmitWarRoomSignoffResult['consensus_state']
  >;
  lifecycleEvents: WarRoomLifecycleEvent[];
}> {
  const lifecycleEvents: WarRoomLifecycleEvent[] = [
    {
      event_type: 'war_room_signoff_submitted',
      payload: {
        session_id: sessionId,
        role,
        agent_profile: agentProfile,
        decision,
      },
    },
  ];

  if (initialConsensusState === 'consensus_reached') {
    lifecycleEvents.push({
      event_type: 'war_room_consensus_reached',
      payload: { session_id: sessionId },
    });
    return { nextConsensusState: initialConsensusState, lifecycleEvents };
  }
  if (initialConsensusState !== 'deadlocked') {
    return { nextConsensusState: initialConsensusState, lifecycleEvents };
  }

  const autoTieBreak = await dependencies.systemSettings.get<boolean>(
    'agent_war_room_auto_ceo_tie_break',
    false,
  );
  if (!autoTieBreak) {
    lifecycleEvents.push({
      event_type: 'war_room_deadlocked',
      payload: { session_id: sessionId },
    });
    return { nextConsensusState: 'deadlocked', lifecycleEvents };
  }

  lifecycleEvents.push({
    event_type: 'war_room_tie_break_applied',
    payload: {
      session_id: sessionId,
      applied_by: moderatorProfile,
    },
  });
  return {
    nextConsensusState: 'ceo_tie_break_applied',
    lifecycleEvents,
  };
}

async function finalizeSignoffSubmission(
  dependencies: WarRoomServiceDependencies,
  workflowRunId: string,
  sessionId: string,
  role: SubmitWarRoomSignoffParams['role'],
  agentProfile: string,
  decision: SubmitWarRoomSignoffParams['decision'],
  actorExecutionId: string | null,
  currentConsensusState: NonNullable<
    SubmitWarRoomSignoffResult['consensus_state']
  >,
  moderatorProfile: string,
): Promise<{
  requiredRoles: SubmitWarRoomSignoffResult['required_roles'];
  nextConsensusState: NonNullable<
    SubmitWarRoomSignoffResult['consensus_state']
  >;
  lifecycleEvents: WarRoomLifecycleEvent[];
}> {
  const requiredRoles = await resolveRequiredSignoffRoles(dependencies);
  const signoffs =
    await dependencies.signoffRepository.findBySessionId(sessionId);
  const initialConsensusState = resolveConsensusState(
    currentConsensusState,
    requiredRoles,
    signoffs,
    await resolveDeadlockThreshold(dependencies, requiredRoles.length),
  );
  const { nextConsensusState, lifecycleEvents } =
    await buildSignoffLifecycleEvents(
      dependencies,
      sessionId,
      role,
      agentProfile,
      decision,
      initialConsensusState,
      moderatorProfile,
    );

  await dependencies.sessionRepository.updateBySessionId(sessionId, {
    consensus_state: nextConsensusState,
    resolution_type: resolveResolutionTypeForConsensus(nextConsensusState),
  });
  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    actorExecutionId,
    lifecycleEvents,
  );

  return { requiredRoles, nextConsensusState, lifecycleEvents };
}
