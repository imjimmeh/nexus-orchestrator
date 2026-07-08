import type { EventLedgerService } from '../../observability/event-ledger.service';
import { isTelemetryForCompletedStep } from '../telemetry-completed-step.helpers';
import { broadcastToolExecutionLifecycle } from '../telemetry-event-broadcaster.helpers';
import {
  maybeRecordRunHeartbeat,
  maybeRecordSubagentHeartbeat,
  type ExecutionHeartbeatParams,
} from '../telemetry-gateway-heartbeat.helpers';
import { type PersistSessionCheckpoint } from '../telemetry-gateway-session-checkpoint.helpers';
import { hasToolExecutionFailure } from '../telemetry-gateway-tool-execution.helpers';
import { getToolExecutionErrorMessage } from '../telemetry-gateway-tool-error.helpers';
import { getClientStreamId } from '../telemetry-gateway-runtime.helpers';
import {
  resolveSessionTreeId,
  withSessionTreeId,
  type SessionCheckpointRuntimeParams,
} from '../telemetry-session-tracker.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Per-event compat handler for `tool_execution_end` frames. Determines the
 * outcome (failure vs. success), resolves the session-tree-id, and
 * delegates the broadcast + ledger row to {@link broadcastToolExecutionLifecycle}.
 */
export async function handleToolExecutionEndGatewayCompat(
  params: {
    client: AuthenticatedSocket;
    payload: GatewayEventPayload;
    processAndBroadcastEvent: BroadcastEvent;
    eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
    persistSessionCheckpoint?: PersistSessionCheckpoint;
  } & SessionCheckpointRuntimeParams &
    ExecutionHeartbeatParams,
): Promise<void> {
  const {
    client,
    payload,
    processAndBroadcastEvent,
    eventLedger,
    persistSessionCheckpoint,
    resolveContainerContext,
  } = params;

  const streamId = getClientStreamId(client);
  if (client.role !== 'agent' || !client.workflowRunId || !streamId) {
    return;
  }

  if (isTelemetryForCompletedStep(client)) {
    return;
  }

  maybeRecordSubagentHeartbeat(client, params.executionHeartbeat, 'telemetry');
  maybeRecordRunHeartbeat(client, params.runHeartbeat);

  const hasFailure = hasToolExecutionFailure(payload);
  const sessionTreeId = await resolveSessionTreeId({
    client,
    payload,
    eventType: 'tool_execution_end',
    persistSessionCheckpoint,
    resolveContainerContext,
    shouldPersistSessionCheckpoint: params.shouldPersistSessionCheckpoint,
  });
  const payloadWithSessionTree = withSessionTreeId(payload, sessionTreeId);

  await broadcastToolExecutionLifecycle({
    client,
    payload,
    payloadWithSessionTree,
    sessionTreeId,
    eventType: 'tool_execution_end',
    streamId,
    processAndBroadcastEvent,
    eventLedger,
    hasFailure,
    errorMessage: hasFailure
      ? getToolExecutionErrorMessage(payload)
      : undefined,
  });
}
