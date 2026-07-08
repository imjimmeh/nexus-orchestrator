import type {
  CloseWarRoomParams,
  CloseWarRoomResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  optionalString,
  requireResolutionType,
  requireString,
  resolveResolutionTypeForConsensus,
} from './war-room.service.shared';

export async function closeWarRoomSession(
  dependencies: WarRoomServiceDependencies,
  params: CloseWarRoomParams,
): Promise<CloseWarRoomResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  if (!session) {
    return buildDeniedCloseResult(
      sessionId,
      workflowRunId,
      'session_not_found',
      null,
    );
  }
  if (session.workflow_run_id !== workflowRunId) {
    return buildDeniedCloseResult(
      sessionId,
      workflowRunId,
      'workflow_run_scope_mismatch',
      session,
    );
  }

  const resolutionType = resolveCloseResolutionType(
    params,
    session.consensus_state,
  );
  const updated = await dependencies.sessionRepository.updateBySessionId(
    sessionId,
    {
      status: 'closed',
      closed_at: new Date(),
      resolution_type: resolutionType,
      resolution_note: optionalString(params.resolution_note) ?? null,
      metadata: params.metadata ?? session.metadata ?? null,
    },
  );
  const consensusState = updated?.consensus_state ?? session.consensus_state;

  const lifecycleEvents = buildCloseLifecycleEvents(
    sessionId,
    resolutionType,
    consensusState,
  );
  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    optionalString(params.closed_by_execution_id),
    lifecycleEvents,
  );

  return {
    status: 'closed',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    session_status: updated?.status ?? 'closed',
    consensus_state: consensusState,
    resolution_type: resolutionType,
    lifecycle_events: lifecycleEvents,
  };
}

function resolveCloseResolutionType(
  params: CloseWarRoomParams,
  consensusState: CloseWarRoomResult['consensus_state'],
): NonNullable<CloseWarRoomResult['resolution_type']> {
  return requireResolutionType(
    params.resolution_type ??
      (consensusState
        ? resolveResolutionTypeForConsensus(consensusState)
        : null) ??
      'manual',
  );
}

function buildDeniedCloseResult(
  sessionId: string,
  workflowRunId: string,
  denialReason: string,
  session: {
    status: CloseWarRoomResult['session_status'];
    consensus_state: CloseWarRoomResult['consensus_state'];
    resolution_type?: CloseWarRoomResult['resolution_type'];
  } | null,
): CloseWarRoomResult {
  return {
    status: 'denied',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    session_status: session?.status ?? null,
    consensus_state: session?.consensus_state ?? null,
    resolution_type: session?.resolution_type ?? null,
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}

function buildCloseLifecycleEvents(
  sessionId: string,
  resolutionType: NonNullable<CloseWarRoomResult['resolution_type']>,
  consensusState: NonNullable<CloseWarRoomResult['consensus_state']>,
): WarRoomLifecycleEvent[] {
  return [
    {
      event_type: 'war_room_closed',
      payload: {
        session_id: sessionId,
        resolution_type: resolutionType,
        consensus_state: consensusState,
      },
    },
  ];
}
