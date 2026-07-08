import type { EventLedgerService } from '../observability/event-ledger.service';
import { emitToolExecutionLedgerCompat } from './telemetry-gateway-compat.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';

/**
 * Function signature for the gateway-level broadcast sink. The runtime gateway
 * binds this to {@link processAndBroadcastEventCompat}; tests inject a vi.fn().
 * Local to this module — mirroring `telemetry-gateway-connection.helpers.ts`,
 * `telemetry-gateway-step-complete.helpers.ts`, and
 * `telemetry-gateway-runtime.helpers.ts`. Each module owns a narrow contract
 * without leaking through a shared types barrel.
 */
type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

type PickEventLedger = Pick<EventLedgerService, 'emitBestEffort'>;

/**
 * Emits the agent_telemetry broadcast frame. Preconditions (role/stream
 * checks, heartbeat recording, identity enrichment) are owned by the runtime
 * handler — by the time we get here `streamId` is guaranteed defined.
 */
export async function broadcastAgentTelemetry(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  enrichedPayload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  streamId: string;
}): Promise<void> {
  const {
    processAndBroadcastEvent,
    streamId,
    enrichedPayload,
    payload: _payload,
  } = params;

  await processAndBroadcastEvent(streamId, {
    event_type: 'agent_telemetry',
    payload: enrichedPayload,
  });
}

/**
 * Emits the tool execution start / end / update broadcast and the matching
 * ledger row. Session-tree-id enrichment is performed by the caller
 * (`resolveSessionTreeId`) before this helper sees the payload.
 *
 * - `tool_execution_start` always emits `tool.execution.started` with
 *   `outcome: 'in_progress'`.
 * - `tool_execution_end` emits `tool.execution.completed` with
 *   `outcome` driven by `hasFailure` and the supplied `errorMessage`.
 * - `tool_execution_update` emits `tool.execution.updated` with
 *   `outcome: 'in_progress'` regardless of `hasFailure`.
 */
export async function broadcastToolExecutionLifecycle(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  payloadWithSessionTree: GatewayEventPayload;
  sessionTreeId: string | undefined;
  eventType:
    | 'tool_execution_start'
    | 'tool_execution_end'
    | 'tool_execution_update';
  streamId: string;
  processAndBroadcastEvent: BroadcastEvent;
  eventLedger: PickEventLedger;
  hasFailure?: boolean;
  errorMessage?: string;
}): Promise<void> {
  const {
    client,
    payload: _payload,
    payloadWithSessionTree,
    sessionTreeId,
    eventType,
    streamId,
    processAndBroadcastEvent,
    eventLedger,
    hasFailure,
    errorMessage,
  } = params;

  await processAndBroadcastEvent(streamId, {
    event_type: eventType,
    payload: payloadWithSessionTree,
  });

  if (eventType === 'tool_execution_start') {
    await emitToolExecutionLedgerCompat({
      eventLedger,
      eventName: 'tool.execution.started',
      outcome: 'in_progress',
      workflowRunId: client.workflowRunId ?? '',
      sessionTreeId,
      jobId: client.jobId,
      stepId: client.stepId,
      payload: payloadWithSessionTree,
    });
    return;
  }

  if (eventType === 'tool_execution_end') {
    await emitToolExecutionLedgerCompat({
      eventLedger,
      eventName: 'tool.execution.completed',
      outcome: hasFailure ? 'failure' : 'success',
      workflowRunId: client.workflowRunId ?? '',
      sessionTreeId,
      jobId: client.jobId,
      stepId: client.stepId,
      payload: payloadWithSessionTree,
      errorMessage: hasFailure ? errorMessage : undefined,
    });
    return;
  }

  // 'tool_execution_update' — updates are observations, not terminal state,
  // so the outcome is always in_progress regardless of `hasFailure`.
  await emitToolExecutionLedgerCompat({
    eventLedger,
    eventName: 'tool.execution.updated',
    outcome: 'in_progress',
    workflowRunId: client.workflowRunId ?? '',
    sessionTreeId,
    jobId: client.jobId,
    stepId: client.stepId,
    payload: payloadWithSessionTree,
  });
}

/**
 * Emits the turn_end broadcast and the matching workflow.turn.completed
 * ledger row. Session-tree-id enrichment is performed by the caller.
 *
 * `outcome: 'failure'` when `errorMessage` is a non-null string, otherwise
 * `'success'`. The error message is forwarded verbatim to the ledger row.
 */
export async function broadcastTurnEnd(params: {
  client: AuthenticatedSocket;
  payloadWithSessionTree: GatewayEventPayload;
  sessionTreeId: string | undefined;
  streamId: string;
  processAndBroadcastEvent: BroadcastEvent;
  eventLedger: PickEventLedger;
  errorMessage: string | undefined;
}): Promise<void> {
  const {
    client,
    payloadWithSessionTree,
    sessionTreeId,
    streamId,
    processAndBroadcastEvent,
    eventLedger,
    errorMessage,
  } = params;

  const hasErrorMessage = typeof errorMessage === 'string';

  await processAndBroadcastEvent(streamId, {
    event_type: 'turn_end',
    payload: payloadWithSessionTree,
  });

  await eventLedger.emitBestEffort({
    domain: 'workflow',
    eventName: 'workflow.turn.completed',
    outcome: hasErrorMessage ? 'failure' : 'success',
    source: 'gateway',
    workflowRunId: client.workflowRunId,
    sessionTreeId,
    stepId: client.stepId,
    actorType: 'agent',
    payload: payloadWithSessionTree,
    errorMessage,
  });
}

/**
 * Emits the agent_end broadcast and the matching workflow.agent.completed
 * ledger row. `failureContext` is only persisted when `hasFailure` is true.
 */
export async function broadcastAgentEnd(params: {
  client: AuthenticatedSocket;
  enrichedPayload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  eventLedger: PickEventLedger;
  hasFailure: boolean;
  failureContext: string | undefined;
}): Promise<void> {
  const {
    client,
    enrichedPayload,
    processAndBroadcastEvent,
    eventLedger,
    hasFailure,
    failureContext,
  } = params;

  await processAndBroadcastEvent(client.workflowRunId as string, {
    event_type: 'agent_end',
    payload: enrichedPayload,
  });

  await eventLedger.emitBestEffort({
    domain: 'workflow',
    eventName: 'workflow.agent.completed',
    outcome: hasFailure ? 'failure' : 'success',
    source: 'gateway',
    workflowRunId: client.workflowRunId,
    stepId: client.stepId,
    actorType: 'agent',
    payload: enrichedPayload,
    errorMessage: hasFailure ? (failureContext ?? undefined) : undefined,
  });
}

/**
 * Emits the agent_error broadcast. No ledger row at the gateway layer —
 * downstream reconciliation owns the persisted failure record.
 */
export async function broadcastAgentError(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
}): Promise<void> {
  const { client, payload, processAndBroadcastEvent } = params;

  await processAndBroadcastEvent(client.workflowRunId as string, {
    event_type: 'agent_error',
    payload,
  });
}

/**
 * Emits the user_questions_posed broadcast. No ledger row.
 */
export async function broadcastUserQuestionsPosed(params: {
  client: AuthenticatedSocket;
  payload: { questions: Array<Record<string, unknown>> };
  processAndBroadcastEvent: BroadcastEvent;
}): Promise<void> {
  const { client, payload, processAndBroadcastEvent } = params;

  await processAndBroadcastEvent(client.workflowRunId as string, {
    event_type: 'user_questions_posed',
    payload,
  });
}
