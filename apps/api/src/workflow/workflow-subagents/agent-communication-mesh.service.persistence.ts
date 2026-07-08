import type { MentionValidationContext } from './agent-communication-mesh.service.types';
import type {
  AgentCommunicationThread,
  IAgentCommunicationDomainPort,
} from '../domain-ports';

interface PersistenceDependencies {
  agentCommunication: IAgentCommunicationDomainPort;
}

function buildUpsertContext(
  context: MentionValidationContext,
  normalizedContextId: string | null,
  scopeId: string | null,
): import('../domain-ports').AgentCommunicationUpsertThreadContext {
  return {
    threadId: context.threadId,
    workflowRunId: context.workflowRunId,
    scopeId: scopeId ?? null,
    contextId: normalizedContextId,
    requesterExecutionId: context.requesterExecutionId,
    targetAgentProfile: context.targetAgentProfile,
    urgency: context.urgency,
    correlationId: context.correlationId,
    metadata: context.metadata,
    existingThread: context.existingThread
      ? { message_count: context.existingThread.message_count }
      : null,
    body: context.body,
  };
}

export async function upsertMentionThread(
  dependencies: PersistenceDependencies,
  context: MentionValidationContext,
  normalizedContextId: string | null,
  scopeId: string | null,
): Promise<void> {
  await dependencies.agentCommunication.upsertMentionThread(
    buildUpsertContext(context, normalizedContextId, scopeId),
    normalizedContextId,
    scopeId,
  );
}

export async function createMentionMessages(
  dependencies: PersistenceDependencies,
  context: MentionValidationContext,
): Promise<void> {
  await dependencies.agentCommunication.createMentionMessages(
    buildUpsertContext(context, context.scopeContextId, context.scopeId),
  );
}

export async function persistResolvedThread(
  dependencies: PersistenceDependencies,
  params: {
    thread: AgentCommunicationThread;
    workflowRunId: string;
    threadId: string;
    requesterExecutionId: string | null;
    resolverExecutionId: string | null;
    resolutionNote: string | null;
    correlationId: string;
    metadata: Record<string, unknown> | null;
  },
): Promise<void> {
  await dependencies.agentCommunication.persistResolvedThread({
    thread: params.thread,
    workflowRunId: params.workflowRunId,
    threadId: params.threadId,
    requesterExecutionId: params.requesterExecutionId,
    resolverExecutionId: params.resolverExecutionId,
    resolutionNote: params.resolutionNote,
    correlationId: params.correlationId,
    metadata: params.metadata,
  });
}
