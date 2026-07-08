import { maybePersistSessionCheckpoint } from './telemetry-gateway-session-checkpoint.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';
import type { SessionCheckpointRuntimeParams } from './telemetry-session-tracker.helpers.types';

export type { SessionCheckpointRuntimeParams };

export function withSessionTreeId(
  payload: GatewayEventPayload,
  sessionTreeId: string | undefined,
): GatewayEventPayload {
  return typeof sessionTreeId === 'string' && sessionTreeId.length > 0
    ? {
        ...payload,
        session_tree_id: sessionTreeId,
      }
    : payload;
}

export async function resolveSessionTreeId(
  params: {
    client: AuthenticatedSocket;
    payload: GatewayEventPayload;
    eventType: 'tool_execution_start' | 'tool_execution_end' | 'turn_end';
  } & SessionCheckpointRuntimeParams,
): Promise<string | undefined> {
  return maybePersistSessionCheckpoint({
    client: params.client,
    payload: params.payload,
    eventType: params.eventType,
    persistSessionCheckpoint: params.persistSessionCheckpoint,
    resolveContainerContext: params.resolveContainerContext,
    shouldPersistSessionCheckpoint: params.shouldPersistSessionCheckpoint,
  });
}
