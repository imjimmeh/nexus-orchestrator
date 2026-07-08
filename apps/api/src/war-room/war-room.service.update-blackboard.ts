import { BadRequestException } from '@nestjs/common';
import type {
  UpdateWarRoomBlackboardParams,
  UpdateWarRoomBlackboardResult,
  WarRoomLifecycleEvent,
} from './war-room.service.types';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import {
  appendLifecycleEvents,
  normalizeExpectedVersion,
  optionalString,
  requireString,
  validateMutatingSessionAccess,
} from './war-room.service.shared';

export async function updateWarRoomBlackboard(
  dependencies: WarRoomServiceDependencies,
  params: UpdateWarRoomBlackboardParams,
): Promise<UpdateWarRoomBlackboardResult> {
  const workflowRunId = requireString(
    params.workflow_run_id,
    'workflow_run_id',
  );
  const sessionId = requireString(params.session_id, 'session_id');
  const session =
    await dependencies.sessionRepository.findBySessionId(sessionId);
  const denialReason = validateMutatingSessionAccess(session, workflowRunId);
  if (denialReason) {
    return buildDeniedBlackboardResult(
      sessionId,
      workflowRunId,
      denialReason,
      session?.consensus_state ?? null,
    );
  }
  if (!session) {
    return buildDeniedBlackboardResult(
      sessionId,
      workflowRunId,
      'session_not_found',
      null,
    );
  }

  validateOptionalArray(params.risks, 'risks');
  validateOptionalArray(params.decision_log, 'decision_log');

  return updateBlackboardVersion(
    dependencies,
    params,
    workflowRunId,
    sessionId,
    session.consensus_state,
  );
}

async function updateBlackboardVersion(
  dependencies: WarRoomServiceDependencies,
  params: UpdateWarRoomBlackboardParams,
  workflowRunId: string,
  sessionId: string,
  sessionConsensusState: NonNullable<
    UpdateWarRoomBlackboardResult['consensus_state']
  >,
): Promise<UpdateWarRoomBlackboardResult> {
  const actorExecutionId = optionalString(params.updated_by_execution_id);

  const latest =
    await dependencies.blackboardRepository.findLatestBySessionId(sessionId);
  const currentVersion = latest?.version ?? 0;
  const expectedVersion = normalizeExpectedVersion(
    params.expected_version,
    currentVersion,
  );
  if (expectedVersion !== currentVersion) {
    return buildConflictBlackboardResult(
      sessionId,
      workflowRunId,
      currentVersion,
      sessionConsensusState,
    );
  }

  const nextVersion = currentVersion + 1;
  const blackboard = await dependencies.blackboardRepository.create({
    ...resolveBlackboardMutationPayload(params, latest),
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    version: nextVersion,
    updated_by_execution_id: actorExecutionId,
    metadata: params.metadata ?? null,
  });

  const nextConsensusState = await advanceConsensusForBlackboardUpdate(
    dependencies,
    sessionId,
    sessionConsensusState,
  );

  const lifecycleEvents: WarRoomLifecycleEvent[] = [
    {
      event_type: 'war_room_blackboard_updated',
      payload: {
        session_id: sessionId,
        version: blackboard.version,
        updated_by_execution_id: blackboard.updated_by_execution_id,
      },
    },
  ];
  await appendLifecycleEvents(
    dependencies,
    workflowRunId,
    actorExecutionId,
    lifecycleEvents,
  );

  return {
    status: 'updated',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    version: blackboard.version,
    current_version: blackboard.version,
    consensus_state: nextConsensusState,
    lifecycle_events: lifecycleEvents,
  };
}

function buildDeniedBlackboardResult(
  sessionId: string,
  workflowRunId: string,
  denialReason: string,
  consensusState: UpdateWarRoomBlackboardResult['consensus_state'],
): UpdateWarRoomBlackboardResult {
  return {
    status: 'denied',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    version: null,
    current_version: 0,
    consensus_state: consensusState,
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}

function buildConflictBlackboardResult(
  sessionId: string,
  workflowRunId: string,
  currentVersion: number,
  consensusState: NonNullable<UpdateWarRoomBlackboardResult['consensus_state']>,
): UpdateWarRoomBlackboardResult {
  return {
    status: 'conflict',
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    version: null,
    current_version: currentVersion,
    consensus_state: consensusState,
    lifecycle_events: [],
  };
}

function validateOptionalArray(
  value: unknown,
  field: 'risks' | 'decision_log',
): void {
  if (value === undefined || value === null || Array.isArray(value)) {
    return;
  }

  throw new BadRequestException(`${field} must be an array when provided`);
}

function resolveBlackboardMutationPayload(
  params: UpdateWarRoomBlackboardParams,
  latest: {
    strategy_summary?: string | null;
    risks?: unknown[] | null;
    decision_log?: unknown[] | null;
    implementation_plan_ref?: string | null;
  } | null,
): {
  strategy_summary: string | null;
  risks: unknown[] | null;
  decision_log: unknown[] | null;
  implementation_plan_ref: string | null;
} {
  return {
    strategy_summary: resolveOptionalStringOverride(
      params.strategy_summary,
      latest?.strategy_summary ?? null,
    ),
    risks: resolveOverride(params.risks, latest?.risks ?? null),
    decision_log: resolveOverride(
      params.decision_log,
      latest?.decision_log ?? null,
    ),
    implementation_plan_ref: resolveOptionalStringOverride(
      params.implementation_plan_ref,
      latest?.implementation_plan_ref ?? null,
    ),
  };
}

function resolveOverride<T>(value: T | undefined, fallback: T): T {
  return value !== undefined ? value : fallback;
}

function resolveOptionalStringOverride(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value === undefined) {
    return fallback;
  }

  return optionalString(value);
}

async function advanceConsensusForBlackboardUpdate(
  dependencies: WarRoomServiceDependencies,
  sessionId: string,
  currentConsensusState: NonNullable<
    UpdateWarRoomBlackboardResult['consensus_state']
  >,
): Promise<NonNullable<UpdateWarRoomBlackboardResult['consensus_state']>> {
  if (currentConsensusState !== 'collecting_input') {
    return currentConsensusState;
  }

  await dependencies.sessionRepository.updateBySessionId(sessionId, {
    consensus_state: 'draft_ready',
  });
  return 'draft_ready';
}
