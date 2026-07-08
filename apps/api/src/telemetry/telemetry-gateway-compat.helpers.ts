import type { AgentResponseStoreService } from '../redis/agent-response-store.service';
import type { RedisPubSubService } from '../redis/redis-pubsub.service';
import type { RedisStreamService } from '../redis/redis-stream.service';
import type { EventLedgerService } from '../observability/event-ledger.service';

export async function processAndBroadcastEventCompat(params: {
  workflowRunId: string;
  event: { event_type: string; payload: Record<string, unknown> };
  streamService: RedisStreamService;
  pubsubService: RedisPubSubService;
}): Promise<void> {
  const fullEvent = { ...params.event, timestamp: new Date().toISOString() };
  await params.streamService.persistEvent(params.workflowRunId, fullEvent);
  await params.pubsubService.publishEvent(params.workflowRunId, fullEvent);
}

export async function storeAgentErrorResponseCompat(params: {
  workflowRunId: string;
  stepId?: string;
  payload: Record<string, unknown>;
  agentResponseStore: AgentResponseStoreService;
  errorPrefix: string;
}): Promise<void> {
  const message =
    typeof params.payload.message === 'string'
      ? params.payload.message.trim()
      : '';

  if (!message || !params.stepId) {
    return;
  }

  try {
    await params.agentResponseStore.store(
      params.workflowRunId,
      params.stepId,
      `${params.errorPrefix}${message}`,
    );
    await params.agentResponseStore.storeStepComplete(
      params.workflowRunId,
      params.stepId,
      `${params.errorPrefix}${message}`,
    );
  } catch {
    // best-effort response capture
  }
}

export async function storeStepCompleteResponseCompat(params: {
  workflowRunId: string;
  stepId?: string;
  payload: Record<string, unknown>;
  agentResponseStore: AgentResponseStoreService;
  emptySentinel: string;
}): Promise<void> {
  if (!params.stepId) {
    return;
  }

  const summary =
    typeof params.payload.summary === 'string'
      ? params.payload.summary.trim()
      : '';
  const responseToStore = summary || params.emptySentinel;

  try {
    await params.agentResponseStore.storeStepComplete(
      params.workflowRunId,
      params.stepId,
      responseToStore,
    );
  } catch {
    // best-effort response capture
  }
}

export async function emitToolExecutionLedgerCompat(params: {
  eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
  eventName: string;
  outcome: 'success' | 'failure' | 'denied' | 'in_progress';
  workflowRunId: string;
  sessionTreeId?: string;
  scopeId?: string;
  jobId?: string;
  stepId?: string;
  payload: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  const inferredScopeId = resolveScopeIdForToolLedger(
    params.scopeId,
    params.payload,
  );

  await params.eventLedger.emitBestEffort({
    domain: 'tool',
    eventName: params.eventName,
    outcome: params.outcome,
    source: 'gateway',
    workflowRunId: params.workflowRunId,
    context: {
      scopeId: inferredScopeId ?? null,
      contextId: null,
      contextType: null,
      scopeNodeId: null,
      scopePath: null,
    },
    jobId: params.jobId,
    stepId: params.stepId,
    sessionTreeId: params.sessionTreeId,
    actorType: 'agent',
    toolName:
      typeof params.payload.toolName === 'string'
        ? params.payload.toolName
        : undefined,
    payload: params.payload,
    errorMessage: params.errorMessage,
  });
}

function resolveScopeIdForToolLedger(
  explicitScopeId: string | undefined,
  payload: Record<string, unknown>,
): string | undefined {
  if (typeof explicitScopeId === 'string' && explicitScopeId.trim()) {
    return explicitScopeId.trim();
  }

  const payloadScopeId = payload['scope_id'];
  if (typeof payloadScopeId === 'string' && payloadScopeId.trim()) {
    return payloadScopeId.trim();
  }

  const args = payload['args'];
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const argsScopeId = (args as Record<string, unknown>)['scope_id'];
  if (typeof argsScopeId !== 'string') {
    return undefined;
  }

  const trimmed = argsScopeId.trim();
  return trimmed || undefined;
}
