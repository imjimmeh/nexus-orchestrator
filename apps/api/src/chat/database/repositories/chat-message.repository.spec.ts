import { describe, expect, it, vi } from 'vitest';
import { ChatMessageRepository } from './chat-message.repository';

describe('ChatMessageRepository', () => {
  it('scopes pending run links to the chat session with grouped status predicate', async () => {
    const getMany = vi.fn().mockResolvedValue([]);
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
      getCount: vi.fn().mockResolvedValue(0),
      getOne: vi.fn().mockResolvedValue(null),
      getMany,
    };

    const repositoryMock = {
      findOne: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      find: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const repository = new ChatMessageRepository(repositoryMock);

    await repository.findPendingRunLinks('chat-1');

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'message.chat_session_id = :chatSessionId',
      { chatSessionId: 'chat-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'message.run_id IS NOT NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(message.run_status IS NULL OR message.run_status NOT IN (:...terminalStatuses))',
      {
        terminalStatuses: ['COMPLETED', 'FAILED', 'CANCELLED'],
      },
    );
    expect(getMany).toHaveBeenCalledOnce();
  });

  describe('findPendingRelayCandidates', () => {
    function buildQueryBuilderMock(candidates: unknown[]) {
      const andWhereCalls: unknown[] = [];
      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn((clause: unknown, params?: unknown) => {
          andWhereCalls.push({ clause, params });
          return queryBuilder;
        }),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
        getOne: vi.fn().mockResolvedValue(null),
        getMany: vi.fn().mockResolvedValue(candidates),
      };

      return { queryBuilder, andWhereCalls };
    }

    it('returns the telegram pending relay candidates with the same row count', async () => {
      const telegramCandidates = [{ id: 'msg-1' }, { id: 'msg-2' }];
      const { queryBuilder, andWhereCalls } =
        buildQueryBuilderMock(telegramCandidates);

      const repositoryMock = {
        findOne: vi.fn(),
        create: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
        find: vi.fn(),
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      };

      const repository = new ChatMessageRepository(repositoryMock as never);

      const candidates = await repository.findPendingRelayCandidates(
        'telegram',
        25,
      );

      expect(candidates).toBe(telegramCandidates);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'message.direction = :direction',
        { direction: 'inbound' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'message.channel = :channel',
        { channel: 'telegram' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'message.event_type = :eventType',
        { eventType: 'user_message' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'message.run_id IS NOT NULL',
      );
      expect(andWhereCalls).toContainEqual({
        clause:
          "(message.metadata IS NULL OR message.metadata->>'telegramRelaySentAt' IS NULL)",
        params: undefined,
      });
      expect(andWhereCalls).toContainEqual({
        clause:
          "(message.metadata IS NULL OR message.metadata->>'telegramRelaySkippedAt' IS NULL)",
        params: undefined,
      });
      expect(queryBuilder.limit).toHaveBeenCalledWith(25);
      expect(queryBuilder.getMany).toHaveBeenCalledOnce();
    });

    it('plumbs the provider discriminant through to the channel filter', async () => {
      const { queryBuilder, andWhereCalls } = buildQueryBuilderMock([]);
      const repositoryMock = {
        findOne: vi.fn(),
        create: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
        find: vi.fn(),
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      };

      const repository = new ChatMessageRepository(repositoryMock as never);

      await repository.findPendingRelayCandidates('email', 10);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'message.channel = :channel',
        { channel: 'email' },
      );
      // The same row-count clauses that previously hardcoded telegram now
      // run identically for any provider, so the andWhere call count is
      // stable across discriminant values.
      const channelFilterCalls = andWhereCalls.filter(
        (entry) =>
          (entry as { clause?: string }).clause ===
          'message.channel = :channel',
      );
      expect(channelFilterCalls).toHaveLength(1);
      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
    });
  });
});
