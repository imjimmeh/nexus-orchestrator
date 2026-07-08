import type { Logger } from '@nestjs/common';
import type {
  AuthenticatedSocket,
  SubmitWarRoomSignoffGatewayPayload,
  UpdateWarRoomBlackboardGatewayPayload,
} from './types';
import {
  emitCommand,
  emitCommandError,
  publishLifecycleEvents,
  requireWarRoomRunContext,
  requireWarRoomService,
  resolveSignoffAgentProfile,
  toCommandPayload,
} from './telemetry-gateway-war-room.command-helpers';
import type {
  ProcessAndBroadcastEvent,
  WarRoomServiceLike,
} from './telemetry-gateway-war-room.command-helpers.types';
import {
  recordWarRoomCommandToolCall,
  recordWarRoomLifecycleToolCalls,
} from './telemetry-gateway-war-room.tool-tracking';
import { normalizeOptionalJsonArray } from './telemetry-gateway-war-room-payload.helpers';

type WarRoomMutatingHandlerParams<TPayload> = {
  client: AuthenticatedSocket;
  payload: TPayload;
  logger: Logger;
  warRoomService?: WarRoomServiceLike;
  processAndBroadcastEvent: ProcessAndBroadcastEvent;
};

export async function handleUpdateWarRoomBlackboardCompat(
  params: WarRoomMutatingHandlerParams<UpdateWarRoomBlackboardGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'update_war_room_blackboard',
      'update_war_room_blackboard_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'update_war_room_blackboard',
      'update_war_room_blackboard_result',
    )
  ) {
    return;
  }

  try {
    const result = await warRoomService.updateBlackboard({
      ...payload,
      risks: normalizeOptionalJsonArray(payload.risks, 'risks'),
      decision_log: normalizeOptionalJsonArray(
        payload.decision_log,
        'decision_log',
      ),
      workflow_run_id: client.workflowRunId,
      updated_by_execution_id: client.stepId,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'update_war_room_blackboard_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'update_war_room_blackboard',
    });
    await publishLifecycleEvents(
      client.workflowRunId,
      resultPayload,
      processAndBroadcastEvent,
    );
    await recordWarRoomLifecycleToolCalls({
      workflowRunId: client.workflowRunId,
      client,
      resultPayload,
    });
  } catch (error) {
    emitCommandError(client, 'update_war_room_blackboard_result', error);
  }
}

export async function handleSubmitWarRoomSignoffCompat(
  params: WarRoomMutatingHandlerParams<SubmitWarRoomSignoffGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'submit_war_room_signoff',
      'submit_war_room_signoff_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'submit_war_room_signoff',
      'submit_war_room_signoff_result',
    )
  ) {
    return;
  }

  try {
    const agentProfile = resolveSignoffAgentProfile({ client, payload });
    const result = await warRoomService.submitSignoff({
      ...payload,
      agent_profile: agentProfile,
      workflow_run_id: client.workflowRunId,
      submitted_by_execution_id: client.stepId,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'submit_war_room_signoff_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'submit_war_room_signoff',
    });
    await publishLifecycleEvents(
      client.workflowRunId,
      resultPayload,
      processAndBroadcastEvent,
    );
    await recordWarRoomLifecycleToolCalls({
      workflowRunId: client.workflowRunId,
      client,
      resultPayload,
    });
  } catch (error) {
    emitCommandError(client, 'submit_war_room_signoff_result', error);
  }
}
