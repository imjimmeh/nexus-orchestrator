import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentCommunicationThread } from '../entities/agent-communication-thread.entity';

@Injectable()
export class AgentCommunicationThreadRepository {
  constructor(
    @InjectRepository(AgentCommunicationThread)
    private readonly repository: Repository<AgentCommunicationThread>,
  ) {}

  async create(
    data: Partial<AgentCommunicationThread>,
  ): Promise<AgentCommunicationThread> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findByThreadId(
    threadId: string,
  ): Promise<AgentCommunicationThread | null> {
    return this.repository.findOne({ where: { thread_id: threadId } });
  }

  async updateByThreadId(
    threadId: string,
    data: Partial<AgentCommunicationThread>,
  ): Promise<AgentCommunicationThread | null> {
    const thread = await this.findByThreadId(threadId);
    if (!thread) {
      return null;
    }

    Object.assign(thread, data);
    return this.repository.save(thread);
  }

  async findByRunAndRequester(
    workflowRunId: string,
    requesterExecutionId: string | null,
    threadId?: string,
  ): Promise<AgentCommunicationThread[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('thread')
      .where('thread.workflow_run_id = :workflowRunId', { workflowRunId });

    if (requesterExecutionId === null) {
      queryBuilder.andWhere('thread.requester_execution_id IS NULL');
    } else {
      queryBuilder.andWhere(
        'thread.requester_execution_id = :requesterExecutionId',
        {
          requesterExecutionId,
        },
      );
    }

    if (threadId) {
      queryBuilder.andWhere('thread.thread_id = :threadId', { threadId });
    }

    return queryBuilder.orderBy('thread.created_at', 'ASC').getMany();
  }
}
