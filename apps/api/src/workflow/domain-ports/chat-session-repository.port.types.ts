import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';

export interface IChatSessionRepositoryPort {
  findById(id: string): Promise<ChatSession | null>;
  findBySubagentExecutionId(executionId: string): Promise<ChatSession | null>;
  findByContainerId(containerId: string): Promise<ChatSession | null>;
  findByWorkflowRunId(workflowRunId: string): Promise<ChatSession[]>;
  findParentByWorkflowRunId(workflowRunId: string): Promise<ChatSession | null>;
  update(
    id: string,
    data: QueryDeepPartialEntity<ChatSession>,
  ): Promise<ChatSession | null>;
  create(data: Partial<ChatSession>): Promise<ChatSession>;
}
