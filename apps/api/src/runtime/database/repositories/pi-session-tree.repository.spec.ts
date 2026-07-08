import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { PiSessionTree } from '../entities/pi-session-tree.entity';
import { PiSessionTreeRepository } from './pi-session-tree.repository';

type QueryBuilderMock = {
  leftJoin: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  getRawMany: ReturnType<typeof vi.fn>;
};

describe('PiSessionTreeRepository', () => {
  let repo: PiSessionTreeRepository;
  let queryBuilder: QueryBuilderMock;
  let findOne: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;
  let typeormRepo: Pick<
    Repository<PiSessionTree>,
    'createQueryBuilder' | 'findOne' | 'find'
  >;

  beforeEach(() => {
    queryBuilder = {
      leftJoin: vi.fn(),
      select: vi.fn(),
      where: vi.fn(),
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      getRawMany: vi.fn(),
    };

    queryBuilder.leftJoin.mockReturnValue(queryBuilder);
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.limit.mockReturnValue(queryBuilder);

    findOne = vi
      .fn<() => Promise<PiSessionTree | null>>()
      .mockResolvedValue(null);
    find = vi.fn<() => Promise<PiSessionTree[]>>().mockResolvedValue([]);

    typeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      findOne,
      find,
    } as Pick<
      Repository<PiSessionTree>,
      'createQueryBuilder' | 'findOne' | 'find'
    >;

    repo = new PiSessionTreeRepository(
      typeormRepo as Repository<PiSessionTree>,
    );
  });

  it('finds recent successful session trees for learning', async () => {
    const occurredAfter = new Date('2026-04-01T00:00:00.000Z');
    const rows = [
      {
        id: 'tree-1',
        workflow_run_id: 'workflow-run-1',
        chat_session_id: null,
        jsonl_data: [{ type: 'message' }],
        created_at: new Date('2026-04-02T00:00:00.000Z'),
        updated_at: new Date('2026-04-02T00:01:00.000Z'),
        workflow_status: 'COMPLETED',
        chat_status: null,
        chat_scope_id: null,
      },
    ];
    queryBuilder.getRawMany.mockResolvedValue(rows);

    const result = await repo.findRecentSuccessfulForLearning({
      occurredAfter,
      limit: 25,
    });

    expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('tree');
    expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
      'workflow_runs',
      'workflow_run',
      'workflow_run.id = tree.workflow_run_id',
    );
    expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
      'chat_sessions',
      'chat_session',
      'chat_session.id = tree.chat_session_id',
    );
    expect(queryBuilder.select).toHaveBeenCalledWith([
      'tree.id AS id',
      'tree.workflow_run_id AS workflow_run_id',
      'tree.chat_session_id AS chat_session_id',
      'tree.jsonl_data AS jsonl_data',
      'tree.created_at AS created_at',
      'tree.updated_at AS updated_at',
      'workflow_run.status AS workflow_status',
      'chat_session.status AS chat_status',
      'chat_session.scope_id AS chat_scope_id',
    ]);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tree.created_at >= :occurredAfter',
      { occurredAfter },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'tree.archived_at IS NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(workflow_run.status = 'COMPLETED' OR chat_session.status = 'COMPLETED')",
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'tree.created_at',
      'DESC',
    );
    expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual(rows);
  });

  it('selects the freshest session tree for a workflow run with deterministic ordering', async () => {
    const freshest = { id: 'tree-newest' } as PiSessionTree;
    findOne.mockResolvedValue(freshest);

    const result = await repo.findByWorkflowRunId('workflow-run-1');

    expect(findOne).toHaveBeenCalledWith({
      where: { workflow_run_id: 'workflow-run-1' },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
    expect(result).toBe(freshest);
  });

  it('finds only lightweight metadata for active trees during cleanup', async () => {
    const rows = [
      {
        id: 'tree-1',
        workflow_run_id: 'run-1',
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ];
    find.mockResolvedValue(rows);

    const result = await repo.findActiveMetadataForCleanup({
      skip: 0,
      take: 1000,
    });

    expect(find).toHaveBeenCalledWith({
      select: {
        id: true,
        workflow_run_id: true,
        created_at: true,
      },
      where: {
        archived_at: expect.anything(),
      },
      skip: 0,
      take: 1000,
      order: {
        created_at: 'ASC',
      },
    });
    expect(result).toEqual(rows);
  });
});
