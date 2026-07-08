import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgentCommunicationMessage,
  AgentCommunicationMessageKind,
} from '../entities/agent-communication-message.entity';

@Injectable()
export class AgentCommunicationMessageRepository {
  constructor(
    @InjectRepository(AgentCommunicationMessage)
    private readonly repository: Repository<AgentCommunicationMessage>,
  ) {}

  async create(
    data: Partial<AgentCommunicationMessage>,
  ): Promise<AgentCommunicationMessage> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findByThreadIds(
    threadIds: string[],
  ): Promise<AgentCommunicationMessage[]> {
    if (threadIds.length === 0) {
      return [];
    }

    return this.repository.find({
      where: { thread_id: In(threadIds) },
      order: { created_at: 'ASC' },
    });
  }

  async countByRunAndKind(
    workflowRunId: string,
    messageKind: AgentCommunicationMessageKind,
  ): Promise<number> {
    return this.repository.count({
      where: {
        workflow_run_id: workflowRunId,
        message_kind: messageKind,
      },
    });
  }

  async countByThreadId(threadId: string): Promise<number> {
    return this.repository.count({ where: { thread_id: threadId } });
  }
}
