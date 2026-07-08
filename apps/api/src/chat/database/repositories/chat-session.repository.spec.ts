import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { ChatSessionStatus } from '@nexus/core';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatSession } from '../entities/chat-session.entity';

type MockTypeormRepository = Pick<
  Repository<ChatSession>,
  'createQueryBuilder'
>;

describe('ChatSessionRepository', () => {
  let repo: ChatSessionRepository;
  let typeormRepo: MockTypeormRepository;
  let queryBuilder: {
    alias: string;
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    offset: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
    getCount: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queryBuilder = {
      alias: 'cs',
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getCount: vi.fn().mockResolvedValue(0),
    };

    typeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    repo = new ChatSessionRepository(typeormRepo as Repository<ChatSession>);
  });

  it('excludes scheduled retry sessions from orphan cleanup candidates', async () => {
    await repo.findOrphanedSessions();

    expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('session');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'session.status = :status',
      { status: ChatSessionStatus.RUNNING },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'session.container_id IS NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'session.execution_state != :retryScheduledState',
      { retryScheduledState: 'retry_scheduled' },
    );
    expect(queryBuilder.getMany).toHaveBeenCalled();
  });

  it('excludes sessions with active executions from orphan cleanup candidates', async () => {
    await repo.findOrphanedSessions();

    expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
      'executions',
      'execution',
      [
        'execution.chat_session_id = session.id',
        'execution.state NOT IN (:...terminalExecutionStates)',
      ].join(' AND '),
      {
        terminalExecutionStates: ['completed', 'failed', 'reaped', 'cancelled'],
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('execution.id IS NULL');
  });

  describe('findStaleStartingSessions', () => {
    it('selects STARTING sessions whose updated_at predates the stale cutoff', async () => {
      const staleBefore = new Date('2026-06-12T00:00:00.000Z');

      await repo.findStaleStartingSessions(staleBefore);

      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('session');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'session.status = :status',
        { status: ChatSessionStatus.STARTING },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'session.updated_at < :staleBefore',
        { staleBefore },
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });

    it('returns the rows produced by the query', async () => {
      const rows = [{ id: 'stuck-1' }, { id: 'stuck-2' }] as ChatSession[];
      queryBuilder.getMany.mockResolvedValue(rows);

      const result = await repo.findStaleStartingSessions(new Date());

      expect(result).toBe(rows);
    });
  });

  describe('failIfNotTerminal', () => {
    let findOne: ReturnType<typeof vi.fn>;
    let update: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      findOne = vi.fn();
      update = vi.fn().mockResolvedValue(undefined);

      Object.assign(typeormRepo, { findOne, update });
    });

    it('writes FAILED status when session is non-terminal and has no error_message', async () => {
      const session: Partial<ChatSession> = {
        id: 'sess-1',
        status: ChatSessionStatus.RUNNING,
        error_message: null,
      };
      findOne.mockResolvedValue(session);

      const wrote = await repo.failIfNotTerminal('sess-1', {
        message: 'Container exited unexpectedly',
      });

      expect(wrote).toBe(true);
      expect(update).toHaveBeenCalledOnce();
      const [, patch] = update.mock.calls[0] as [string, Partial<ChatSession>];
      expect(patch.status).toBe(ChatSessionStatus.FAILED);
      expect(patch.execution_state).toBe('failed');
      expect(patch.completed_at).toBeInstanceOf(Date);
      expect(patch.error_message).toBe('Container exited unexpectedly');
    });

    it('preserves an existing specific error_message when writing FAILED', async () => {
      const session: Partial<ChatSession> = {
        id: 'sess-2',
        status: ChatSessionStatus.STARTING,
        error_message: 'Rate limit exceeded on provider X',
      };
      findOne.mockResolvedValue(session);

      const wrote = await repo.failIfNotTerminal('sess-2', {
        message: 'Generic failure fallback',
      });

      expect(wrote).toBe(true);
      expect(update).toHaveBeenCalledOnce();
      const [, patch] = update.mock.calls[0] as [string, Partial<ChatSession>];
      expect(patch.error_message).toBe('Rate limit exceeded on provider X');
    });

    it.each([
      ChatSessionStatus.COMPLETED,
      ChatSessionStatus.FAILED,
      ChatSessionStatus.CANCELLED,
    ])(
      'makes no write and returns false when session is already %s',
      async (terminalStatus) => {
        findOne.mockResolvedValue({
          id: 'sess-3',
          status: terminalStatus,
          error_message: null,
        });

        const wrote = await repo.failIfNotTerminal('sess-3', {
          message: 'Should not overwrite',
        });

        expect(wrote).toBe(false);
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('returns false without writing when session is not found', async () => {
      findOne.mockResolvedValue(null);

      const wrote = await repo.failIfNotTerminal('missing-id', {
        message: 'Should not write',
      });

      expect(wrote).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('search clause', () => {
    it('findAll emits the shared ILIKE clause via applySearch', async () => {
      await repo.findAll({ search: 'deploy', limit: 10, offset: 0 });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)',
        { searchTerm: '%deploy%' },
      );
    });

    it('count emits the shared ILIKE clause via applySearch', async () => {
      await repo.count({ search: 'deploy' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)',
        { searchTerm: '%deploy%' },
      );
    });
  });
});
