import type { Logger } from '@nestjs/common';
import type {
  AuthenticatedSocket,
  CloseWarRoomGatewayPayload,
  GetWarRoomStateGatewayPayload,
  InviteWarRoomParticipantGatewayPayload,
  OpenWarRoomGatewayPayload,
  PostWarRoomMessageGatewayPayload,
} from './types';
import {
  emitCommand,
  emitCommandError,
  publishLifecycleEvents,
  resolvePostingSenderProfile,
  requireWarRoomRunContext,
  requireWarRoomService,
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
export {
  handleSubmitWarRoomSignoffCompat,
  handleUpdateWarRoomBlackboardCompat,
} from './telemetry-gateway-war-room-moderation.helpers';

type WarRoomMutatingHandlerParams<TPayload> = {
  client: AuthenticatedSocket;
  payload: TPayload;
  logger: Logger;
  warRoomService?: WarRoomServiceLike;
  processAndBroadcastEvent: ProcessAndBroadcastEvent;
};

type WarRoomReadHandlerParams<TPayload> = {
  client: AuthenticatedSocket;
  payload: TPayload;
  logger: Logger;
  warRoomService?: WarRoomServiceLike;
};

export async function handleOpenWarRoomCompat(
  params: WarRoomMutatingHandlerParams<OpenWarRoomGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'open_war_room',
      'open_war_room_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'open_war_room',
      'open_war_room_result',
    )
  ) {
    return;
  }

  try {
    const moderatorProfile = resolvePostingSenderProfile(client);
    const openPayload = {
      session_id: payload.session_id,
      scope_id: payload.scope_id,
      context_id: payload.context_id,
      moderator_profile: moderatorProfile,
      participants: normalizeOptionalJsonArray(
        payload.participants,
        'participants',
      ),
      initial_message: payload.initial_message,
    };
    const result = await warRoomService.openSession({
      ...openPayload,
      workflow_run_id: client.workflowRunId,
      created_by_execution_id: client.stepId,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'open_war_room_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'open_war_room',
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
    emitCommandError(client, 'open_war_room_result', error);
  }
}

export async function handleInviteWarRoomParticipantCompat(
  params: WarRoomMutatingHandlerParams<InviteWarRoomParticipantGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'invite_war_room_participant',
      'invite_war_room_participant_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'invite_war_room_participant',
      'invite_war_room_participant_result',
    )
  ) {
    return;
  }

  try {
    const agentProfile = payload.agent_profile ?? payload.target_agent_profile;
    if (!agentProfile) {
      throw new Error('Missing agent_profile');
    }

    const result = await warRoomService.inviteParticipant({
      ...payload,
      agent_profile: agentProfile,
      workflow_run_id: client.workflowRunId,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'invite_war_room_participant_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'invite_war_room_participant',
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
    emitCommandError(client, 'invite_war_room_participant_result', error);
  }
}

export async function handlePostWarRoomMessageCompat(
  params: WarRoomMutatingHandlerParams<PostWarRoomMessageGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'post_war_room_message',
      'post_war_room_message_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'post_war_room_message',
      'post_war_room_message_result',
    )
  ) {
    return;
  }

  try {
    const senderProfile = resolvePostingSenderProfile(client);
    const result = await warRoomService.postMessage({
      ...payload,
      workflow_run_id: client.workflowRunId,
      sender_execution_id: client.stepId,
      sender_profile: senderProfile,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'post_war_room_message_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'post_war_room_message',
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
    emitCommandError(client, 'post_war_room_message_result', error);
  }
}

export async function handleGetWarRoomStateCompat(
  params: WarRoomReadHandlerParams<GetWarRoomStateGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService } = params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'get_war_room_state',
      'get_war_room_state_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'get_war_room_state',
      'get_war_room_state_result',
    )
  ) {
    return;
  }

  try {
    const result = await warRoomService.getState({
      ...payload,
      workflow_run_id: client.workflowRunId,
    });
    emitCommand(client, 'get_war_room_state_result', toCommandPayload(result));
  } catch (error) {
    emitCommandError(client, 'get_war_room_state_result', error);
  }
}

export async function handleCloseWarRoomCompat(
  params: WarRoomMutatingHandlerParams<CloseWarRoomGatewayPayload>,
): Promise<void> {
  const { client, payload, logger, warRoomService, processAndBroadcastEvent } =
    params;
  if (
    !requireWarRoomRunContext(
      client,
      logger,
      'close_war_room',
      'close_war_room_result',
    )
  ) {
    return;
  }
  if (
    !requireWarRoomService(
      warRoomService,
      client,
      logger,
      'close_war_room',
      'close_war_room_result',
    )
  ) {
    return;
  }

  try {
    const result = await warRoomService.closeSession({
      ...payload,
      workflow_run_id: client.workflowRunId,
      closed_by_execution_id: client.stepId,
    });
    const resultPayload = toCommandPayload(result);
    emitCommand(client, 'close_war_room_result', resultPayload);
    await recordWarRoomCommandToolCall({
      workflowRunId: client.workflowRunId,
      client,
      action: 'close_war_room',
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
    emitCommandError(client, 'close_war_room_result', error);
  }
}
