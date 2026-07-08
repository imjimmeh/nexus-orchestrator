import type { AgentCommunicationMessage } from '../../chat/database/entities/agent-communication-message.entity';
import type { AgentCommunicationMessageKind } from '../../chat/database/entities/agent-communication-message.entity.types';
import type { AgentCommunicationThread } from '../../chat/database/entities/agent-communication-thread.entity';
import type { AgentCommunicationThreadUrgency } from '../../chat/database/entities/agent-communication-thread.entity.types';

export interface AgentCommunicationUpsertThreadContext {
  threadId: string;
  workflowRunId: string;
  scopeId?: string | null;
  contextId?: string | null;
  requesterExecutionId: string | null;
  targetAgentProfile: string;
  urgency: AgentCommunicationThreadUrgency;
  correlationId: string;
  metadata: Record<string, unknown> | null;
  existingThread: {
    message_count: number;
  } | null;
  body: string;
}

export interface AgentCommunicationCreateMessageParams {
  threadId: string;
  workflowRunId: string;
  senderExecutionId: string | null;
  recipientProfile: string | null;
  messageKind: AgentCommunicationMessageKind;
  body: string;
  correlationId: string;
  metadata: Record<string, unknown> | null;
}

export interface AgentCommunicationPersistResolvedThreadParams {
  thread: AgentCommunicationThread;
  workflowRunId: string;
  threadId: string;
  requesterExecutionId: string | null;
  resolverExecutionId: string | null;
  resolutionNote: string | null;
  correlationId: string;
  metadata: Record<string, unknown> | null;
}

export interface IAgentCommunicationDomainPort {
  upsertMentionThread(
    context: AgentCommunicationUpsertThreadContext,
    normalizedContextId: string | null,
    scopeId: string | null,
  ): Promise<void>;
  createMentionMessages(
    context: AgentCommunicationUpsertThreadContext,
  ): Promise<void>;
  persistResolvedThread(
    params: AgentCommunicationPersistResolvedThreadParams,
  ): Promise<void>;
  findByRunAndRequester(
    workflowRunId: string,
    requesterExecutionId: string | null,
    threadId?: string,
  ): Promise<AgentCommunicationThread[]>;
  findByThreadId(threadId: string): Promise<AgentCommunicationThread | null>;
  countByRunAndKind(
    workflowRunId: string,
    messageKind: AgentCommunicationMessageKind,
  ): Promise<number>;
  countByThreadId(threadId: string): Promise<number>;
  updateByThreadId(
    threadId: string,
    data: Partial<AgentCommunicationThread>,
  ): Promise<AgentCommunicationThread | null>;
  findMessagesByThreadIds(
    threadIds: string[],
  ): Promise<AgentCommunicationMessage[]>;
}

// Re-export thread/message enums so adapters can reach them from one place.
export type {
  AgentCommunicationThread,
  AgentCommunicationThreadStatus,
  AgentCommunicationThreadUrgency,
} from '../../chat/database/entities/agent-communication-thread.entity';

export type {
  AgentCommunicationMessage,
  AgentCommunicationMessageKind,
} from '../../chat/database/entities/agent-communication-message.entity';
