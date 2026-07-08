import type { AuthenticatedSocket } from './types';

/**
 * Thin re-export barrel for telemetry-gateway runtime helpers.
 *
 * The per-event `handle*GatewayCompat` functions live in
 * `./telemetry-gateway-handlers/<event>.compat.ts` to keep this file under
 * 200 lines and to make each handler independently testable. The public
 * surface — every name imported from this path by `telemetry.gateway.ts`,
 * the runtime specs, and the subagent lifecycle regression spec — is
 * preserved verbatim.
 */
export { handleAgentTelemetryGatewayCompat } from './telemetry-gateway-handlers/handle-agent-telemetry.compat';
export { handleToolExecutionStartGatewayCompat } from './telemetry-gateway-handlers/handle-tool-execution-start.compat';
export { handleToolExecutionEndGatewayCompat } from './telemetry-gateway-handlers/handle-tool-execution-end.compat';
export { handleToolExecutionUpdateGatewayCompat } from './telemetry-gateway-handlers/handle-tool-execution-update.compat';
export { handleTurnEndGatewayCompat } from './telemetry-gateway-handlers/handle-turn-end.compat';
export { handleAgentEndGatewayCompat } from './telemetry-gateway-handlers/handle-agent-end.compat';
export { handleAgentErrorGatewayCompat } from './telemetry-gateway-handlers/handle-agent-error.compat';
export { handleUserQuestionsPosedGatewayCompat } from './telemetry-gateway-handlers/handle-user-questions-posed.compat';
export { handleStepCompleteGatewayCompat } from './telemetry-gateway-step-complete.helpers';

/**
 * Resolves the broadcast target for agent streams. A `streamId` (the
 * per-connection Redis stream) is preferred; falls back to the workflow
 * run id for older clients that don't mint one. The runtime gateway uses
 * this to choose between `processAndBroadcastEvent(streamId, ...)` and
 * `processAndBroadcastEvent(workflowRunId, ...)` for downstream
 * subscribers.
 */
export function getClientStreamId(
  client: AuthenticatedSocket,
): string | undefined {
  return client.streamId ?? client.workflowRunId;
}
