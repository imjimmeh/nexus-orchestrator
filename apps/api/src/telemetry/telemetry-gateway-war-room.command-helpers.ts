import type { Logger } from '@nestjs/common';
import type {
  AuthenticatedSocket,
  SubmitWarRoomSignoffGatewayPayload,
} from './types';
import type {
  ProcessAndBroadcastEvent,
  WarRoomServiceLike,
} from './telemetry-gateway-war-room.command-helpers.types';

function hasAgentRunContext(
  client: AuthenticatedSocket,
): client is AuthenticatedSocket & { role: 'agent'; workflowRunId: string } {
  return client.role === 'agent' && typeof client.workflowRunId === 'string';
}

function isChatSessionScope(client: AuthenticatedSocket): boolean {
  return (
    typeof client.chatSessionId === 'string' &&
    client.chatSessionId.length > 0 &&
    client.workflowRunId === client.chatSessionId
  );
}

export function requireWarRoomRunContext(
  client: AuthenticatedSocket,
  logger: Logger,
  action: string,
  resultType: string,
): client is AuthenticatedSocket & { role: 'agent'; workflowRunId: string } {
  if (isChatSessionScope(client)) {
    const error = `${action}: requires workflow run scope; chat session scope is not supported`;
    logger.warn(error);
    emitCommandError(client, resultType, new Error(error));
    return false;
  }

  if (hasAgentRunContext(client)) {
    return true;
  }

  logger.warn(`${action}: missing workflow run context`);
  emitCommandError(
    client,
    resultType,
    new Error(`${action}: missing workflow run context`),
  );
  return false;
}

export function requireWarRoomService(
  warRoomService: WarRoomServiceLike | undefined,
  client: AuthenticatedSocket,
  logger: Logger,
  action: string,
  resultType: string,
): warRoomService is WarRoomServiceLike {
  if (warRoomService) {
    return true;
  }

  logger.warn(`${action}: missing required service injection`);
  emitCommandError(
    client,
    resultType,
    new Error(`${action}: missing required service injection`),
  );
  return false;
}

export function emitCommand(
  client: AuthenticatedSocket,
  type: string,
  payload: Record<string, unknown>,
): void {
  client.emit('command', { type, ...payload });
}

export function toCommandPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function emitCommandError(
  client: AuthenticatedSocket,
  type: string,
  error: unknown,
): void {
  emitCommand(client, type, {
    success: false,
    error: (error as Error).message,
  });
}

export function resolvePostingSenderProfile(
  client: AuthenticatedSocket,
): string {
  const socketProfile = client.agentProfileName?.trim();

  if (socketProfile) {
    return socketProfile;
  }

  throw new Error(
    'post_war_room_message: sender profile is unavailable on the authenticated socket',
  );
}

export function resolveSignoffAgentProfile(params: {
  client: AuthenticatedSocket;
  payload: SubmitWarRoomSignoffGatewayPayload;
}): string {
  const socketProfile = params.client.agentProfileName?.trim();
  const requestedProfile = params.payload.agent_profile?.trim();

  if (!socketProfile) {
    throw new Error(
      'submit_war_room_signoff: missing agent profile context on authenticated socket',
    );
  }

  if (requestedProfile && requestedProfile !== socketProfile) {
    throw new Error(
      'submit_war_room_signoff: agent_profile must match the authenticated agent profile',
    );
  }

  return socketProfile;
}

export async function publishLifecycleEvents(
  workflowRunId: string,
  result: Record<string, unknown>,
  processAndBroadcastEvent: ProcessAndBroadcastEvent,
): Promise<void> {
  const lifecycleEvents = Array.isArray(result.lifecycle_events)
    ? result.lifecycle_events
    : [];
  for (const lifecycleEvent of lifecycleEvents) {
    if (!lifecycleEvent || typeof lifecycleEvent !== 'object') {
      continue;
    }

    const event = lifecycleEvent as {
      event_type?: unknown;
      payload?: unknown;
    };
    if (
      typeof event.event_type !== 'string' ||
      !event.payload ||
      typeof event.payload !== 'object'
    ) {
      continue;
    }

    await processAndBroadcastEvent(workflowRunId, {
      event_type: event.event_type,
      payload: event.payload as Record<string, unknown>,
    });
  }
}
