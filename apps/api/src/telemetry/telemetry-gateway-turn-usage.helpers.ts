import type { AuthenticatedSocket, GatewayEventPayload } from './types';
import type { TurnUsageRecorderDep } from './telemetry-gateway-turn-usage.types';

function getTurnUsage(payload: GatewayEventPayload): unknown {
  const output =
    payload.output && typeof payload.output === 'object'
      ? (payload.output as Record<string, unknown>)
      : undefined;

  // Some harnesses (e.g. pi-runner) send usage at the top level of the payload
  // rather than nested under output. Check both locations.
  return output?.['usage'] ?? (payload as Record<string, unknown>)['usage'];
}

/**
 * Records the token usage carried on a turn_end / agent_end payload as a
 * per-turn budget event. Provider/model are taken from the socket (resolved
 * from the runner config at connect). Best-effort: turns without a usage object
 * (e.g. a terminal turn that reports no usage) are skipped.
 */
export async function recordTurnUsageFromGateway(
  client: AuthenticatedSocket,
  payload: GatewayEventPayload,
  turnUsageRecorder: TurnUsageRecorderDep | undefined,
): Promise<void> {
  if (!turnUsageRecorder || !client.workflowRunId) {
    return;
  }

  const usage = getTurnUsage(payload);
  if (usage === undefined || usage === null) {
    return;
  }

  await turnUsageRecorder.recordTurnUsage({
    contextType: client.chatSessionId ? 'chat' : 'workflow_run',
    contextId: client.workflowRunId,
    scopeId: client.scopeId ?? null,
    providerName: client.providerName ?? null,
    modelName: client.modelName ?? null,
    stepId: client.stepId ?? null,
    usage,
  });
}
