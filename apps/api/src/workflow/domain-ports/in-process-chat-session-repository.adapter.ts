import { Injectable } from '@nestjs/common';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatSessionRepository } from '../../chat/database/repositories/chat-session.repository';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type { IChatSessionRepositoryPort } from './chat-session-repository.port.types';

@Injectable()
export class InProcessChatSessionRepositoryAdapter implements IChatSessionRepositoryPort {
  constructor(private readonly repo: ChatSessionRepository) {}

  findById(id: string): Promise<ChatSession | null> {
    return this.repo.findById(id);
  }

  findBySubagentExecutionId(executionId: string): Promise<ChatSession | null> {
    return this.repo.findBySubagentExecutionId(executionId);
  }

  findByContainerId(containerId: string): Promise<ChatSession | null> {
    return this.repo.findByContainerId(containerId);
  }

  findByWorkflowRunId(workflowRunId: string): Promise<ChatSession[]> {
    return this.repo.findByWorkflowRunId(workflowRunId);
  }

  findParentByWorkflowRunId(
    workflowRunId: string,
  ): Promise<ChatSession | null> {
    return this.repo.findParentByWorkflowRunId(workflowRunId);
  }

  update(
    id: string,
    data: QueryDeepPartialEntity<ChatSession>,
  ): Promise<ChatSession | null> {
    return this.repo.update(id, data);
  }

  create(data: Partial<ChatSession>): Promise<ChatSession> {
    return this.repo.create(data);
  }
}
