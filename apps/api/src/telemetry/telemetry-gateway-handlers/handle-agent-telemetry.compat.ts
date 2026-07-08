import { isTelemetryForCompletedStep } from '../telemetry-completed-step.helpers';
import { broadcastAgentTelemetry } from '../telemetry-event-broadcaster.helpers';
import { enrichAgentIdentityPayload } from '../telemetry-gateway-agent-identity.helpers';
import {
  maybeRecordRunHeartbeat,
  maybeRecordSubagentHeartbeat,
  type ExecutionHeartbeatParams,
} from '../telemetry-gateway-heartbeat.helpers';
import { getClientStreamId } from '../telemetry-gateway-runtime.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Per-event compat handler for `agent_telemetry` frames streamed by the
 * runner. Owns its own precondition checks (role/stream), heartbeat
 * recording, and identity enrichment before delegating the broadcast to the
 * broadcaster helper.
 */
export async function handleAgentTelemetryGatewayCompat(
  params: {
    client: AuthenticatedSocket;
    payload: GatewayEventPayload;
    processAndBroadcastEvent: BroadcastEvent;
  } & ExecutionHeartbeatParams,
): Promise<void> {
  const { client, payload, processAndBroadcastEvent } = params;

  const streamId = getClientStreamId(client);
  if (client.role !== 'agent' || !client.workflowRunId || !streamId) {
    return;
  }

  if (isTelemetryForCompletedStep(client)) {
    return;
  }

  maybeRecordSubagentHeartbeat(client, params.executionHeartbeat, 'telemetry');
  maybeRecordRunHeartbeat(client, params.runHeartbeat);

  const enrichedPayload = enrichAgentIdentityPayload(client, payload);

  await broadcastAgentTelemetry({
    client,
    payload,
    enrichedPayload,
    processAndBroadcastEvent,
    streamId,
  });
}
