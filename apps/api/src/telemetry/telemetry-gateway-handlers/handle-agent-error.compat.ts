import type { AgentResponseStoreService } from '../../redis/agent-response-store.service';
import { AGENT_RESPONSE_ERROR_PREFIX } from '../../redis/agent-response-store.service';
import { broadcastAgentError } from '../telemetry-event-broadcaster.helpers';
import { storeAgentErrorResponseCompat } from '../telemetry-gateway-compat.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Per-event compat handler for `agent_error` frames. Emits the broadcast
 * and persists the error message to Redis (via
 * {@link storeAgentErrorResponseCompat}) so the chat surface can render it.
 */
export async function handleAgentErrorGatewayCompat(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  agentResponseStore: AgentResponseStoreService;
}): Promise<void> {
  const { client, payload, processAndBroadcastEvent, agentResponseStore } =
    params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }

  await broadcastAgentError({
    client,
    payload,
    processAndBroadcastEvent,
  });

  await storeAgentErrorResponseCompat({
    workflowRunId: client.workflowRunId,
    stepId: client.stepId,
    payload,
    agentResponseStore,
    errorPrefix: AGENT_RESPONSE_ERROR_PREFIX,
  });
}
