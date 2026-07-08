import type { EventLedgerService } from '../../observability/event-ledger.service';
import { isTelemetryForCompletedStep } from '../telemetry-completed-step.helpers';
import { broadcastToolExecutionLifecycle } from '../telemetry-event-broadcaster.helpers';
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
 * Per-event compat handler for `tool_execution_update` frames. Updates are
 * observations only — no session-tree-id resolution, no failure flagging —
 * and are forwarded to {@link broadcastToolExecutionLifecycle} which always
 * emits `outcome: 'in_progress'`.
 */
export async function handleToolExecutionUpdateGatewayCompat(
  params: {
    client: AuthenticatedSocket;
    payload: GatewayEventPayload;
    processAndBroadcastEvent: BroadcastEvent;
    eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
  } & ExecutionHeartbeatParams,
): Promise<void> {
  const { client, payload, processAndBroadcastEvent, eventLedger } = params;

  const streamId = getClientStreamId(client);
  if (client.role !== 'agent' || !client.workflowRunId || !streamId) {
    return;
  }

  if (isTelemetryForCompletedStep(client)) {
    return;
  }

  maybeRecordSubagentHeartbeat(client, params.executionHeartbeat, 'telemetry');
  maybeRecordRunHeartbeat(client, params.runHeartbeat);

  await broadcastToolExecutionLifecycle({
    client,
    payload,
    payloadWithSessionTree: payload,
    sessionTreeId: undefined,
    eventType: 'tool_execution_update',
    streamId,
    processAndBroadcastEvent,
    eventLedger,
    hasFailure: undefined,
    errorMessage: undefined,
  });
}
