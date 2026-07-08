import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { AgentResponseStoreService } from '../../redis/agent-response-store.service';
import {
  AGENT_RESPONSE_EMPTY_SENTINEL,
  AGENT_RESPONSE_ERROR_PREFIX,
} from '../../redis/agent-response-store.service';
import { isTelemetryForCompletedStep } from '../telemetry-completed-step.helpers';
import { broadcastTurnEnd } from '../telemetry-event-broadcaster.helpers';
import { enrichAgentIdentityPayload } from '../telemetry-gateway-agent-identity.helpers';
import {
  maybeRecordRunHeartbeat,
  maybeRecordSubagentHeartbeat,
  type ExecutionHeartbeatParams,
} from '../telemetry-gateway-heartbeat.helpers';
import { storeTelemetryAgentResponse } from '../telemetry-gateway-turn-end-storage.helpers';
import { recordTurnUsageFromGateway } from '../telemetry-gateway-turn-usage.helpers';
import type { TurnUsageRecorderDep } from '../telemetry-gateway-turn-usage.types';
import { getClientStreamId } from '../telemetry-gateway-runtime.helpers';
import {
  resolveSessionTreeId,
  withSessionTreeId,
  type SessionCheckpointRuntimeParams,
} from '../telemetry-session-tracker.helpers';
import { getTurnEndErrorMessage } from '../telemetry-gateway-outcome.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Per-event compat handler for `turn_end` frames. Records per-turn token
 * usage, resolves the session-tree-id, persists the agent response (or
 * failure sentinel) to Redis, and delegates the broadcast + ledger row to
 * {@link broadcastTurnEnd}. Also stashes the turn outcome on the socket so
 * a later `agent_end` can report the FINAL turn's failure rather than
 * masking a recovered run as a success.
 */
export async function handleTurnEndGatewayCompat(
  params: {
    client: AuthenticatedSocket;
    payload: GatewayEventPayload;
    processAndBroadcastEvent: BroadcastEvent;
    eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
    agentResponseStore: AgentResponseStoreService;
    turnUsageRecorder?: TurnUsageRecorderDep;
  } & SessionCheckpointRuntimeParams &
    ExecutionHeartbeatParams,
): Promise<void> {
  const {
    client,
    payload,
    processAndBroadcastEvent,
    eventLedger,
    agentResponseStore,
  } = params;

  const streamId = getClientStreamId(client);
  if (client.role !== 'agent' || !client.workflowRunId || !streamId) {
    return;
  }

  if (isTelemetryForCompletedStep(client)) {
    return;
  }

  await recordTurnUsageFromGateway(client, payload, params.turnUsageRecorder);

  maybeRecordSubagentHeartbeat(client, params.executionHeartbeat, 'telemetry');
  maybeRecordRunHeartbeat(client, params.runHeartbeat);

  const enrichedPayload = enrichAgentIdentityPayload(client, payload);
  if (client.isSubagent && client.subagentExecutionId) {
    enrichedPayload.isSubagent = true;
    enrichedPayload.subagentExecutionId = client.subagentExecutionId;
  }
  const sessionTreeId = await resolveSessionTreeId({
    client,
    payload: enrichedPayload,
    eventType: 'turn_end',
    persistSessionCheckpoint: params.persistSessionCheckpoint,
    resolveContainerContext: params.resolveContainerContext,
    shouldPersistSessionCheckpoint: params.shouldPersistSessionCheckpoint,
  });
  const payloadWithSessionTree = withSessionTreeId(
    enrichedPayload,
    sessionTreeId,
  );

  const errorMessage = getTurnEndErrorMessage(payloadWithSessionTree);
  const hasErrorMessage = typeof errorMessage === 'string';

  // Remember this turn's outcome so the agent-level event reflects the FINAL
  // turn. A later successful turn (e.g. after an in-session retry) overwrites a
  // prior failure, so a recovered run is not reported as failed.
  client.lastTurnFailed = hasErrorMessage;
  client.lastTurnFailureMessage = errorMessage;

  await broadcastTurnEnd({
    client,
    payloadWithSessionTree,
    sessionTreeId,
    streamId,
    processAndBroadcastEvent,
    eventLedger,
    errorMessage,
  });

  await storeTelemetryAgentResponse({
    client,
    payload: payloadWithSessionTree,
    failureMessage: errorMessage,
    errorPrefix: AGENT_RESPONSE_ERROR_PREFIX,
    emptySentinel: AGENT_RESPONSE_EMPTY_SENTINEL,
    storeResponse: agentResponseStore.store.bind(agentResponseStore),
    storeStepComplete: hasErrorMessage
      ? agentResponseStore.storeStepComplete.bind(agentResponseStore)
      : undefined,
  });
}
