import { Injectable } from '@nestjs/common';
import { AgentCommunicationMessageRepository } from '../../chat/database/repositories/agent-communication-message.repository';
import { AgentCommunicationThreadRepository } from '../../chat/database/repositories/agent-communication-thread.repository';
import type {
  AgentCommunicationMessage,
  AgentCommunicationMessageKind,
} from '../../chat/database/entities/agent-communication-message.entity';
import type { AgentCommunicationThread } from '../../chat/database/entities/agent-communication-thread.entity';
import type {
  AgentCommunicationCreateMessageParams,
  AgentCommunicationPersistResolvedThreadParams,
  AgentCommunicationUpsertThreadContext,
  IAgentCommunicationDomainPort,
} from './agent-communication-domain.port.types';

@Injectable()
export class InProcessAgentCommunicationDomainAdapter implements IAgentCommunicationDomainPort {
  constructor(
    private readonly threadRepository: AgentCommunicationThreadRepository,
    private readonly messageRepository: AgentCommunicationMessageRepository,
  ) {}

  async upsertMentionThread(
    context: AgentCommunicationUpsertThreadContext,
    normalizedContextId: string | null,
    scopeId: string | null,
  ): Promise<void> {
    const now = new Date();
    if (context.existingThread) {
      await this.threadRepository.updateByThreadId(context.threadId, {
        scopeId: scopeId ?? null,
        contextId: normalizedContextId,
        requester_execution_id: context.requesterExecutionId,
        target_agent_profile: context.targetAgentProfile,
        urgency: context.urgency,
        status: 'open',
        message_count: context.existingThread.message_count + 2,
        correlation_id: context.correlationId,
        metadata: context.metadata,
        resolution_note: null,
        last_message_at: now,
        resolved_at: null,
      });
      return;
    }

    await this.threadRepository.create({
      thread_id: context.threadId,
      workflow_run_id: context.workflowRunId,
      scopeId: scopeId ?? null,
      contextId: normalizedContextId,
      requester_execution_id: context.requesterExecutionId,
      target_agent_profile: context.targetAgentProfile,
      urgency: context.urgency,
      status: 'open',
      message_count: 2,
      correlation_id: context.correlationId,
      metadata: context.metadata,
      last_message_at: now,
    });
  }

  async createMentionMessages(
    context: AgentCommunicationUpsertThreadContext,
  ): Promise<void> {
    const requestParams: AgentCommunicationCreateMessageParams = {
      threadId: context.threadId,
      workflowRunId: context.workflowRunId,
      senderExecutionId: context.requesterExecutionId,
      recipientProfile: context.targetAgentProfile,
      messageKind: 'request',
      body: context.body,
      correlationId: context.correlationId,
      metadata: context.metadata,
    };
    await this.createMessage(requestParams);
    await this.createMessage({
      ...requestParams,
      messageKind: 'system',
      body: `Mention routed to ${context.targetAgentProfile}`,
    });
  }

  async persistResolvedThread(
    params: AgentCommunicationPersistResolvedThreadParams,
  ): Promise<void> {
    const now = new Date();
    await this.threadRepository.updateByThreadId(params.threadId, {
      status: 'resolved',
      resolution_note: params.resolutionNote ?? null,
      resolved_at: now,
      last_message_at: now,
      correlation_id: params.correlationId,
      message_count: params.thread.message_count + 1,
    });
    await this.messageRepository.create({
      thread_id: params.threadId,
      workflow_run_id: params.workflowRunId,
      sender_execution_id:
        params.resolverExecutionId ?? params.requesterExecutionId,
      recipient_profile: params.thread.target_agent_profile,
      message_kind: 'system',
      body:
        params.resolutionNote && params.resolutionNote.length > 0
          ? `Thread resolved: ${params.resolutionNote}`
          : 'Thread resolved',
      correlation_id: params.correlationId,
      metadata: params.metadata,
    });
  }

  findByRunAndRequester(
    workflowRunId: string,
    requesterExecutionId: string | null,
    threadId?: string,
  ): Promise<AgentCommunicationThread[]> {
    return this.threadRepository.findByRunAndRequester(
      workflowRunId,
      requesterExecutionId,
      threadId,
    );
  }

  findByThreadId(threadId: string): Promise<AgentCommunicationThread | null> {
    return this.threadRepository.findByThreadId(threadId);
  }

  countByRunAndKind(
    workflowRunId: string,
    messageKind: AgentCommunicationMessageKind,
  ): Promise<number> {
    return this.messageRepository.countByRunAndKind(workflowRunId, messageKind);
  }

  countByThreadId(threadId: string): Promise<number> {
    return this.messageRepository.countByThreadId(threadId);
  }

  updateByThreadId(
    threadId: string,
    data: Partial<AgentCommunicationThread>,
  ): Promise<AgentCommunicationThread | null> {
    return this.threadRepository.updateByThreadId(threadId, data);
  }

  findMessagesByThreadIds(
    threadIds: string[],
  ): Promise<AgentCommunicationMessage[]> {
    return this.messageRepository.findByThreadIds(threadIds);
  }

  private createMessage(
    params: AgentCommunicationCreateMessageParams,
  ): Promise<AgentCommunicationMessage> {
    return this.messageRepository.create({
      thread_id: params.threadId,
      workflow_run_id: params.workflowRunId,
      sender_execution_id: params.senderExecutionId,
      recipient_profile: params.recipientProfile,
      message_kind: params.messageKind,
      body: params.body,
      correlation_id: params.correlationId,
      metadata: params.metadata,
    });
  }
}
