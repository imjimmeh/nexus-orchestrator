import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { AgentResponseStoreService } from '../../redis/agent-response-store.service';
import {
  AGENT_RESPONSE_EMPTY_SENTINEL,
  AGENT_RESPONSE_ERROR_PREFIX,
} from '../../redis/agent-response-store.service';
import { broadcastAgentEnd } from '../telemetry-event-broadcaster.helpers';
import { tryFinalizeParentStep } from '../telemetry-gateway-agent-end-finalizer.helpers';
import { enrichAgentIdentityPayload } from '../telemetry-gateway-agent-identity.helpers';
import { signalAsyncDispatchIfPending } from '../telemetry-gateway-async-dispatch-signaller.helpers';
import {
  AGENT_REPORTED_FAILURE_MESSAGE,
  getTerminalFailureContext,
  hasTerminalAgentFailure,
} from '../telemetry-gateway-outcome.helpers';
import { storeTelemetryAgentResponse } from '../telemetry-gateway-turn-end-storage.helpers';
import { recordTurnUsageFromGateway } from '../telemetry-gateway-turn-usage.helpers';
import type { TurnUsageRecorderDep } from '../telemetry-gateway-turn-usage.types';
import type { QuestionIdleTrackerService } from '../../workflow/workflow-run-operations/question-idle-tracker.service';
import type { SubagentOrchestratorService } from '../../workflow/workflow-subagents/subagent-orchestrator.service';
import type { StepCompletionFinalizerDep } from '../types';
import type { AuthenticatedSocket, GatewayEventPayload } from '../types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

/**
 * Per-event compat handler for `agent_end` frames. Determines the terminal
 * outcome (trusting the last turn's failure signal over a clean `ok:true`),
 * persists the agent response, fires subagent completion / parent-step
 * finalization, and resolves any pending async-dispatch promise keyed by
 * this `(workflowRunId, stepId)`.
 */
export async function handleAgentEndGatewayCompat(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
  agentResponseStore: AgentResponseStoreService;
  subagentOrchestrator: Pick<SubagentOrchestratorService, 'handleCompletion'>;
  stepCompletionFinalizer?: StepCompletionFinalizerDep;
  turnUsageRecorder?: TurnUsageRecorderDep;
  questionIdleTracker?: Pick<QuestionIdleTrackerService, 'clearTracking'>;
}): Promise<void> {
  const {
    client,
    payload,
    processAndBroadcastEvent,
    eventLedger,
    agentResponseStore,
    subagentOrchestrator,
  } = params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }

  await recordTurnUsageFromGateway(client, payload, params.turnUsageRecorder);

  const enrichedPayload = enrichAgentIdentityPayload(client, payload);
  if (client.isSubagent && client.subagentExecutionId) {
    enrichedPayload.isSubagent = true;
    enrichedPayload.subagentExecutionId = client.subagentExecutionId;
  }
  // An engine may report a clean agent_end (ok:true / end_turn) even though its
  // final turn errored (e.g. a provider 402). Trust the last turn's outcome so
  // a failed run is not masked as a success.
  const turnFailed = client.lastTurnFailed === true;
  const hasFailure = hasTerminalAgentFailure(enrichedPayload) || turnFailed;
  const failureContext =
    getTerminalFailureContext(enrichedPayload) ??
    (turnFailed
      ? (client.lastTurnFailureMessage ?? AGENT_REPORTED_FAILURE_MESSAGE)
      : undefined);

  await broadcastAgentEnd({
    client,
    enrichedPayload,
    processAndBroadcastEvent,
    eventLedger,
    hasFailure,
    failureContext,
  });

  await storeTelemetryAgentResponse({
    client,
    payload: enrichedPayload,
    failureMessage: failureContext,
    errorPrefix: AGENT_RESPONSE_ERROR_PREFIX,
    emptySentinel: AGENT_RESPONSE_EMPTY_SENTINEL,
    storeResponse: agentResponseStore.store.bind(agentResponseStore),
    storeStepComplete: hasFailure
      ? agentResponseStore.storeStepComplete.bind(agentResponseStore)
      : undefined,
  });

  if (client.isSubagent && client.subagentExecutionId) {
    params.questionIdleTracker?.clearTracking(client.subagentExecutionId);
    await subagentOrchestrator.handleCompletion(
      client.subagentExecutionId,
      enrichedPayload,
      client.workflowRunId,
    );
  } else if (!client.isSubagent) {
    await tryFinalizeParentStep({
      client,
      hasFailure,
      failureMessage: failureContext,
      finalizer: params.stepCompletionFinalizer,
    });
  }

  signalAsyncDispatchIfPending(client, hasFailure, failureContext);
}
