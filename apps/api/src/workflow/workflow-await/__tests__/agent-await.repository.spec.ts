import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import type { HarnessSessionRef, SatisfiedChild } from '@nexus/core';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRepository } from '../agent-await.repository';

type QueryBuilderSubset = Pick<
  SelectQueryBuilder<AgentAwaitEntity>,
  'where' | 'andWhere' | 'getMany' | 'update' | 'set' | 'execute'
>;

type RepositorySubset = Pick<
  Repository<AgentAwaitEntity>,
  'create' | 'save' | 'findOne' | 'createQueryBuilder'
>;

const createAwait = (
  overrides: Partial<AgentAwaitEntity> = {},
): AgentAwaitEntity => ({
  id: 'await-1',
  parent_run_id: 'parent-run-1',
  parent_step_id: 'step-1',
  parent_session_tree_id: null,
  awaited_run_ids: ['child-1'],
  satisfied_run_ids: [],
  status: 'WAITING',
  resume_node_id: null,
  created_at: new Date('2026-06-12T00:00:00.000Z'),
  updated_at: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides,
});

describe('AgentAwaitRepository', () => {
  let queryBuilder: QueryBuilderSubset;
  let typeormRepo: RepositorySubset;
  let repo: AgentAwaitRepository;

  beforeEach(() => {
    queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ affected: 0 }),
    };
    typeormRepo = {
      create: vi.fn((data) => data as AgentAwaitEntity),
      save: vi.fn(async (entity) => entity as AgentAwaitEntity),
      findOne: vi.fn().mockResolvedValue(null),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };
    repo = new AgentAwaitRepository(
      typeormRepo as Repository<AgentAwaitEntity>,
    );
  });

  describe('create', () => {
    it('persists a new await with WAITING status and empty satisfied list', async () => {
      await repo.create({
        parentRunId: 'parent-run-1',
        parentStepId: 'step-1',
        parentSessionTreeId: 'tree-1',
        awaitedRunIds: ['child-1', 'child-2'],
        resumeNodeId: 'node-1',
      });

      expect(typeormRepo.create).toHaveBeenCalledWith({
        parent_run_id: 'parent-run-1',
        parent_step_id: 'step-1',
        parent_session_tree_id: 'tree-1',
        awaited_run_ids: ['child-1', 'child-2'],
        satisfied_run_ids: [],
        status: 'WAITING',
        resume_node_id: 'node-1',
      });
      expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    });

    it('defaults optional fields to null', async () => {
      await repo.create({
        parentRunId: 'parent-run-1',
        parentStepId: 'step-1',
        awaitedRunIds: ['child-1'],
      });

      expect(typeormRepo.create).toHaveBeenCalledWith({
        parent_run_id: 'parent-run-1',
        parent_step_id: 'step-1',
        parent_session_tree_id: null,
        awaited_run_ids: ['child-1'],
        satisfied_run_ids: [],
        status: 'WAITING',
        resume_node_id: null,
      });
    });
  });

  describe('findWaitingByAwaitedChild', () => {
    it('filters by WAITING status and jsonb containment of the child run id', async () => {
      await repo.findWaitingByAwaitedChild('child-1');

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'await.status = :status',
        { status: 'WAITING' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'await.awaited_run_ids @> :child',
        { child: JSON.stringify(['child-1']) },
      );
    });
  });

  describe('findNonTerminal', () => {
    it('returns awaits in WAITING or RESUMING status', async () => {
      await repo.findNonTerminal();

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'await.status IN (:...statuses)',
        { statuses: ['WAITING', 'RESUMING'] },
      );
    });
  });

  describe('markSatisfied', () => {
    it('appends a satisfied child to the list', async () => {
      const entity = createAwait({ satisfied_run_ids: [] });
      typeormRepo.findOne = vi.fn().mockResolvedValue(entity);
      const child: SatisfiedChild = { runId: 'child-1', status: 'COMPLETED' };

      await repo.markSatisfied('await-1', child);

      expect(typeormRepo.save).toHaveBeenCalledTimes(1);
      const saved = (typeormRepo.save as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as AgentAwaitEntity;
      expect(saved.satisfied_run_ids).toEqual([child]);
    });

    it('is idempotent when the same run id is already satisfied', async () => {
      const existing: SatisfiedChild = {
        runId: 'child-1',
        status: 'COMPLETED',
      };
      const entity = createAwait({ satisfied_run_ids: [existing] });
      typeormRepo.findOne = vi.fn().mockResolvedValue(entity);

      await repo.markSatisfied('await-1', {
        runId: 'child-1',
        status: 'FAILED',
      });

      expect(typeormRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when the await does not exist', async () => {
      typeormRepo.findOne = vi.fn().mockResolvedValue(null);

      await repo.markSatisfied('missing', {
        runId: 'child-1',
        status: 'COMPLETED',
      });

      expect(typeormRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateParentSessionRef', () => {
    it('targets only WAITING awaits for the given parent run', async () => {
      const ref: HarnessSessionRef = {
        kind: 'claude_code',
        sessionId: 'sdk-session-1',
      };

      await repo.updateParentSessionRef('parent-run-1', ref);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'parent_run_id = :parentRunId',
        { parentRunId: 'parent-run-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :status', {
        status: 'WAITING',
      });
      expect(queryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ parent_session_ref: ref }),
      );
      expect(queryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('compareAndSetStatus', () => {
    it('returns true when exactly one row transitions', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 1 });

      const result = await repo.compareAndSetStatus(
        'await-1',
        'WAITING',
        'RESUMING',
      );

      expect(result).toBe(true);
    });

    it('returns false when the from status does not match (no-op)', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 0 });

      const result = await repo.compareAndSetStatus(
        'await-1',
        'WAITING',
        'RESUMING',
      );

      expect(result).toBe(false);
    });
  });
});
