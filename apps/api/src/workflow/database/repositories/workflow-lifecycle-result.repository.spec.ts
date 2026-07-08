import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { WorkflowLifecycleResult } from '../entities/workflow-lifecycle-result.entity';
import { WorkflowLifecycleResultRepository } from './workflow-lifecycle-result.repository';

type MockTypeOrmRepository = Pick<
  Repository<WorkflowLifecycleResult>,
  'create' | 'save' | 'find' | 'findOne' | 'createQueryBuilder'
>;

type LifecycleResultQueryBuilder = {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
};

function createTypeOrmRepository(
  overrides: Partial<MockTypeOrmRepository> = {},
): MockTypeOrmRepository {
  return {
    create: vi.fn(),
    save: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    createQueryBuilder: vi.fn(),
    ...overrides,
  };
}

function createQueryBuilder(): LifecycleResultQueryBuilder {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue([]),
  };
}

function createResult(
  overrides: Partial<WorkflowLifecycleResult> = {},
): WorkflowLifecycleResult {
  return {
    id: 'result-1',
    scope_id: 'scope-1',
    context_id: 'context-1',
    phase: 'review',
    hook: 'before_transition',
    blocking_only: true,
    aggregate_status: 'passed',
    results: [
      {
        workflowId: 'wf-1',
        workflowDefinitionId: 'wf-def-1',
        workflowName: 'Test Workflow',
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
        status: 'passed',
        runId: 'run-1',
      },
    ],
    repository_ref: 'repo-1',
    created_at: new Date('2026-06-03T12:00:00.000Z'),
    updated_at: new Date('2026-06-03T12:00:00.000Z'),
    ...overrides,
  };
}

describe('WorkflowLifecycleResultRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('save', () => {
    it('creates and saves a lifecycle result record', async () => {
      const entity = createResult();
      const repo = createTypeOrmRepository({
        create: vi.fn().mockReturnValue(entity),
        save: vi.fn().mockResolvedValue(entity),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const data = {
        scope_id: 'scope-1',
        context_id: 'context-1',
        phase: 'review',
        hook: 'before_transition',
        blocking_only: true,
        aggregate_status: 'passed',
        results: entity.results,
        repository_ref: 'repo-1',
      };

      const result = await subject.save(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(repo.save).toHaveBeenCalledWith(entity);
      expect(result).toEqual(entity);
    });

    it('handles partial data with missing optional fields', async () => {
      const entity = createResult({
        context_id: null,
        repository_ref: null,
      });
      const repo = createTypeOrmRepository({
        create: vi.fn().mockReturnValue(entity),
        save: vi.fn().mockResolvedValue(entity),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const data = {
        scope_id: 'scope-1',
        phase: 'review',
        hook: 'before_transition',
        blocking_only: false,
        aggregate_status: 'skipped',
        results: [],
      };

      const result = await subject.save(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result.id).toBe('result-1');
    });
  });

  describe('findByScope', () => {
    it('returns lifecycle results for a scope ordered by created_at DESC', async () => {
      const entities = [
        createResult({ id: 'result-3' }),
        createResult({ id: 'result-1' }),
      ];
      const repo = createTypeOrmRepository({
        find: vi.fn().mockResolvedValue(entities),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const result = await subject.findByScope('scope-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { scope_id: 'scope-1' },
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual(entities);
    });

    it('returns empty array when no results exist for scope', async () => {
      const repo = createTypeOrmRepository({
        find: vi.fn().mockResolvedValue([]),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const result = await subject.findByScope('unknown-scope');

      expect(result).toEqual([]);
    });
  });

  describe('findLatestByScopeAndPhase', () => {
    it('returns the latest result for a given scope, phase, and hook', async () => {
      const entity = createResult();
      const repo = createTypeOrmRepository({
        findOne: vi.fn().mockResolvedValue(entity),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const result = await subject.findLatestByScopeAndPhase(
        'scope-1',
        'review',
        'before_transition',
      );

      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          scope_id: 'scope-1',
          phase: 'review',
          hook: 'before_transition',
        },
        order: { created_at: 'DESC' },
      });
      expect(result).toEqual(entity);
    });

    it('returns null when no matching result exists', async () => {
      const repo = createTypeOrmRepository({
        findOne: vi.fn().mockResolvedValue(null),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      const result = await subject.findLatestByScopeAndPhase(
        'scope-1',
        'review',
        'after_transition',
      );

      expect(result).toBeNull();
    });
  });

  describe('findFiltered', () => {
    it('filters by scopeId, contextId, phase, and hook', async () => {
      const queryBuilder = createQueryBuilder();
      const repo = createTypeOrmRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      await subject.findFiltered({
        scopeId: 'scope-1',
        contextId: 'context-1',
        phase: 'review',
        hook: 'before_transition',
      });

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('lr');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'lr.scope_id = :scopeId',
        { scopeId: 'scope-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'lr.context_id = :contextId',
        { contextId: 'context-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('lr.phase = :phase', {
        phase: 'review',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('lr.hook = :hook', {
        hook: 'before_transition',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'lr.created_at',
        'DESC',
      );
    });

    it('omits optional filters when only scopeId is provided', async () => {
      const queryBuilder = createQueryBuilder();
      const repo = createTypeOrmRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });
      const subject = new WorkflowLifecycleResultRepository(
        repo as Repository<WorkflowLifecycleResult>,
      );

      await subject.findFiltered({ scopeId: 'scope-1' });

      expect(queryBuilder.where).toHaveBeenCalledTimes(1);
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });
});
