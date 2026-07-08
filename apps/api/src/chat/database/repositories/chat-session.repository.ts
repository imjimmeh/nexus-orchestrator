import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatSessionSource, ChatSessionStatus } from '@nexus/core';
import { In, Not, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatSession } from '../entities/chat-session.entity';
import { applySearch } from '../../../common/utils/query-helpers';

const TERMINAL_CHAT_STATUSES = new Set<ChatSessionStatus>([
  ChatSessionStatus.COMPLETED,
  ChatSessionStatus.FAILED,
  ChatSessionStatus.CANCELLED,
]);

const TERMINAL_EXECUTION_STATES = [
  'completed',
  'failed',
  'reaped',
  'cancelled',
] as const;

@Injectable()
export class ChatSessionRepository {
  private readonly logger = new Logger(ChatSessionRepository.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly repository: Repository<ChatSession>,
  ) {}

  async findById(id: string): Promise<ChatSession | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<ChatSession[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.repository.find({
      where: {
        id: In(ids),
      },
    });
  }

  async findAll(filters: {
    scopeId?: string;
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<ChatSession[]> {
    const qb = this.repository.createQueryBuilder('cs');

    if (filters.scopeId) {
      qb.andWhere('cs.scope_id = :scopeId', {
        scopeId: filters.scopeId,
      });
    }

    if (filters.status) {
      const statuses = filters.status.split(',');
      if (statuses.length === 1) {
        qb.andWhere('cs.status = :status', { status: filters.status });
      } else {
        qb.andWhere('cs.status IN (:...statuses)', { statuses });
      }
    }

    applySearch(qb, filters.search, ['display_name', 'initial_message']);

    qb.orderBy('cs.created_at', 'DESC')
      .limit(filters.limit)
      .offset(filters.offset);

    return qb.getMany();
  }

  async count(filters: {
    scopeId?: string;
    status?: string;
    search?: string;
  }): Promise<number> {
    const qb = this.repository.createQueryBuilder('cs');

    if (filters.scopeId) {
      qb.andWhere('cs.scope_id = :scopeId', {
        scopeId: filters.scopeId,
      });
    }

    if (filters.status) {
      const statuses = filters.status.split(',');
      if (statuses.length === 1) {
        qb.andWhere('cs.status = :status', { status: filters.status });
      } else {
        qb.andWhere('cs.status IN (:...statuses)', { statuses });
      }
    }

    applySearch(qb, filters.search, ['display_name', 'initial_message']);

    return qb.getCount();
  }

  async create(data: Partial<ChatSession>): Promise<ChatSession> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ChatSession>,
  ): Promise<ChatSession | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async findOrphanedSessions(): Promise<ChatSession[]> {
    return this.repository
      .createQueryBuilder('session')
      .leftJoin(
        'executions',
        'execution',
        [
          'execution.chat_session_id = session.id',
          'execution.state NOT IN (:...terminalExecutionStates)',
        ].join(' AND '),
        { terminalExecutionStates: TERMINAL_EXECUTION_STATES },
      )
      .where('session.status = :status', { status: ChatSessionStatus.RUNNING })
      .andWhere('session.container_id IS NULL')
      .andWhere('session.execution_state != :retryScheduledState', {
        retryScheduledState: 'retry_scheduled',
      })
      .andWhere('execution.id IS NULL')
      .getMany();
  }

  /**
   * Finds sessions stuck in STARTING that should have transitioned to RUNNING
   * by now. A session is considered stuck when it has been STARTING since
   * before {@link staleBefore} — typically because its queue job was lost
   * (e.g. Redis flush or process restart) and no consumer will ever pick it up.
   */
  async findStaleStartingSessions(staleBefore: Date): Promise<ChatSession[]> {
    return this.repository
      .createQueryBuilder('session')
      .where('session.status = :status', {
        status: ChatSessionStatus.STARTING,
      })
      .andWhere('session.updated_at < :staleBefore', { staleBefore })
      .getMany();
  }

  async findByWorkflowRunId(workflowRunId: string): Promise<ChatSession[]> {
    return this.repository.find({
      where: { workflow_run_id: workflowRunId },
    });
  }

  async findByWorkflowRunIdAndSource(
    workflowRunId: string,
    source: ChatSessionSource,
  ): Promise<ChatSession | null> {
    return this.repository.findOne({
      where: { workflow_run_id: workflowRunId, source },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
  }

  async findParentByWorkflowRunId(
    workflowRunId: string,
  ): Promise<ChatSession | null> {
    return this.repository.findOne({
      where: {
        workflow_run_id: workflowRunId,
        source: Not(ChatSessionSource.SUBAGENT),
      },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
  }

  async findBySubagentExecutionId(
    executionId: string,
  ): Promise<ChatSession | null> {
    return this.repository.findOne({
      where: { subagent_execution_id: executionId },
    });
  }

  async findByContainerId(containerId: string): Promise<ChatSession | null> {
    return this.repository.findOne({ where: { container_id: containerId } });
  }

  async findByParentChatSessionId(parentId: string): Promise<ChatSession[]> {
    return this.repository.find({
      where: { parent_chat_session_id: parentId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Marks a chat session FAILED only if it is not already terminal, and only
   * sets error_message when the row does not already carry one — so a later,
   * generic failure can never clobber an earlier, more specific reason. Returns
   * true if it wrote, false if it left an already-terminal/already-messaged row.
   */
  async failIfNotTerminal(
    id: string,
    params: { reason?: string | null; message: string },
  ): Promise<boolean> {
    const session = await this.repository.findOne({ where: { id } });

    if (!session) {
      this.logger.debug(
        `failIfNotTerminal: session ${id} not found — skipping`,
      );
      return false;
    }

    if (TERMINAL_CHAT_STATUSES.has(session.status)) {
      return false;
    }

    const errorMessage = session.error_message?.trim()
      ? session.error_message
      : params.message;

    await this.repository.update(id, {
      status: ChatSessionStatus.FAILED,
      execution_state: 'failed',
      completed_at: new Date(),
      error_message: errorMessage,
    });

    return true;
  }
}
