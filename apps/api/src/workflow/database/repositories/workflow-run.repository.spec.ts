import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { WorkflowRun } from '../entities/workflow-run.entity';
import { WorkflowRunRepository } from './workflow-run.repository';

type QueryBuilderSubset = Pick<
  SelectQueryBuilder<WorkflowRun>,
  | 'where'
  | 'andWhere'
  | 'orderBy'
  | 'leftJoin'
  | 'skip'
  | 'take'
  | 'getOne'
  | 'getManyAndCount'
  | 'update'
  | 'set'
  | 'setParameters'
  | 'execute'
>;

describe('WorkflowRunRepository', () => {
  let queryBuilder: QueryBuilderSubset;
  let typeormRepo: Pick<Repository<WorkflowRun>, 'createQueryBuilder'>;
  let repo: WorkflowRunRepository;

  beforeEach(() => {
    queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      setParameters: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    typeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };
    repo = new WorkflowRunRepository(typeormRepo as Repository<WorkflowRun>);
  });

  it('matches active runs by canonical trigger.status', async () => {
    await repo.findActiveByTriggerContext('wf-1', {
      event: 'external.resource.status_changed.v1',
      scopeId: 'project-1',
      contextId: 'resource-1',
      status: 'in-review',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "wr.state_variables->'trigger'->>'status' = :status",
      { status: 'in-review' },
    );
  });

  it('finds the oldest pending run by trigger dedupe key', async () => {
    await repo.findPendingByScopeAndDedupeKey(
      'wf-1',
      'project-1',
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed',
    );

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'wr.workflow_id = :workflowId',
      { workflowId: 'wf-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'wr.concurrency_scope = :concurrencyScope',
      { concurrencyScope: 'project-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(wr.launch_dedupe_key = :dedupeKey OR wr.state_variables->'trigger'->>'dedupeKey' = :dedupeKey)",
      {
        dedupeKey:
          'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed',
      },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('wr.created_at', 'ASC');
  });

  it('finds the latest launch by trigger dedupe key across launch states', async () => {
    await repo.findLatestByWorkflowAndDedupeKey(
      'wf-1',
      'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
    );

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'wr.workflow_id = :workflowId',
      { workflowId: 'wf-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'wr.status IN (:...statuses)',
      { statuses: ['PENDING', 'RUNNING', 'COMPLETED'] },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(wr.launch_dedupe_key = :dedupeKey OR wr.state_variables->'trigger'->>'dedupeKey' = :dedupeKey OR wr.state_variables->'trigger'->'payload'->>'dedupeKey' = :dedupeKey)",
      {
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
      },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('wr.created_at', 'DESC');
  });

  it('finds the oldest pending queued run by launch dedupe key before JSON fallback', async () => {
    await repo.findPendingByScopeAndDedupeKey(
      'wf-1',
      'project-1',
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed',
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(wr.launch_dedupe_key = :dedupeKey OR wr.state_variables->'trigger'->>'dedupeKey' = :dedupeKey)",
      {
        dedupeKey:
          'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed',
      },
    );
  });

  describe('findPaged', () => {
    it('joins workflows and filters by sourceType when provided', async () => {
      await repo.findPaged(
        { limit: 10, offset: 0 },
        { sourceType: 'repository' },
      );

      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'workflows',
        'w',
        'w.id::text = wr.workflow_id',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'w.source_type IN (:...sourceTypes)',
        { sourceTypes: ['repository'] },
      );
    });

    it('splits comma-separated sourceType values', async () => {
      await repo.findPaged(
        { limit: 10, offset: 0 },
        { sourceType: 'seed,user' },
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'w.source_type IN (:...sourceTypes)',
        { sourceTypes: ['seed', 'user'] },
      );
    });

    it('does not join workflows when sourceType is absent', async () => {
      await repo.findPaged({ limit: 10, offset: 0 }, {});

      expect(queryBuilder.leftJoin).not.toHaveBeenCalled();
    });

    it('joins workflows and filters by search term when search is provided', async () => {
      await repo.findPaged({ limit: 10, offset: 0 }, { search: 'test-run' });

      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'workflows',
        'w',
        'w.id::text = wr.workflow_id',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('w.name ILIKE :search'),
        { search: '%test-run%' },
      );
    });
  });

  describe('touch', () => {
    it('updates only the updated_at column for the given run', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const repoWithUpdate = new WorkflowRunRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
        update,
      });

      await repoWithUpdate.touch('run-1');

      expect(update).toHaveBeenCalledTimes(1);
      const [id, patch] = update.mock.calls[0];
      expect(id).toBe('run-1');
      expect(Object.keys(patch)).toEqual(['updated_at']);
      expect(patch.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('setWaitState', () => {
    it('sets only the wait_reason for dependency waits on RUNNING runs', async () => {
      await repo.setWaitState('run-1', 'dependency');

      expect(queryBuilder.set).toHaveBeenCalledWith({
        wait_reason: 'dependency',
      });
      expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'run-1',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :status', {
        status: 'RUNNING',
      });
      expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it('also flags awaiting_input for human_input waits (back-compat)', async () => {
      await repo.setWaitState('run-1', 'human_input');

      expect(queryBuilder.set).toHaveBeenCalledWith({
        wait_reason: 'human_input',
        awaiting_input: true,
      });
    });
  });

  describe('setStateVariableAtomic', () => {
    const NUL = String.fromCharCode(0);

    it('strips NUL bytes from the persisted value so the jsonb write cannot abort', async () => {
      await repo.setStateVariableAtomic('run-1', 'jobs.quality_gate.output', {
        stdout: `health check timed out${NUL}${NUL}npm warn`,
        exit_code: 0,
      });

      const setParams = (queryBuilder.setParameters as ReturnType<typeof vi.fn>)
        .mock.calls[0][0] as { val: string };

      expect(setParams.val.includes(NUL)).toBe(false);
      expect(JSON.parse(setParams.val)).toEqual({
        stdout: 'health check timed outnpm warn',
        exit_code: 0,
      });
    });

    it('leaves NUL-free values untouched', async () => {
      await repo.setStateVariableAtomic('run-1', 'jobs.gate.output', {
        ok: true,
      });

      const setParams = (queryBuilder.setParameters as ReturnType<typeof vi.fn>)
        .mock.calls[0][0] as { val: string };

      expect(JSON.parse(setParams.val)).toEqual({ ok: true });
    });
  });

  describe('tryMarkJobCompleted', () => {
    it('atomically sets the completed_jobs flag only for a RUNNING run that is not already completed', async () => {
      await repo.tryMarkJobCompleted('run-1', 'apply_qa_decision');

      expect(queryBuilder.set).toHaveBeenCalledWith({
        state_variables: expect.any(Function),
      });
      expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'run-1',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :status', {
        status: 'RUNNING',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        `COALESCE("state_variables" #>> :leafPath, 'false') != 'true'`,
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          leafPath: '{_internal,completed_jobs,apply_qa_decision}',
        }),
      );
      expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it('uses nested jsonb_set calls to create intermediate objects', async () => {
      await repo.tryMarkJobCompleted('run-1', 'apply_qa_decision');

      const mockSet = queryBuilder.set as ReturnType<typeof vi.fn>;
      const arg = mockSet.mock.calls[0][0] as { state_variables: () => string };
      const sqlExpr = arg.state_variables();

      expect((sqlExpr.match(/jsonb_set/g) ?? []).length).toBeGreaterThan(1);
      expect(sqlExpr).toContain('COALESCE');
      expect(sqlExpr).toContain(':leafPath');
    });

    it('returns true when the atomic update wins the race (one row affected)', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 1 });

      const won = await repo.tryMarkJobCompleted('run-1', 'apply_qa_decision');

      expect(won).toBe(true);
    });

    it('returns false when the job is already completed or the run is not RUNNING (no row affected)', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 0 });

      const won = await repo.tryMarkJobCompleted('run-1', 'apply_qa_decision');

      expect(won).toBe(false);
    });
  });

  describe('tryMarkJobQueued', () => {
    it('uses nested jsonb_set calls to create intermediate objects when _internal.queued_jobs is absent', async () => {
      await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      const mockSet = queryBuilder.set as ReturnType<typeof vi.fn>;
      const arg = mockSet.mock.calls[0][0] as { state_variables: () => string };
      const sqlExpr = arg.state_variables();

      expect((sqlExpr.match(/jsonb_set/g) ?? []).length).toBeGreaterThan(1);
      expect(sqlExpr).toContain('COALESCE');
      expect(sqlExpr).toContain(':leafPath');
    });

    it('passes intermediate paths as named parameters so all levels of the path are created', async () => {
      await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      expect(queryBuilder.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPath0: '{_internal}',
          parentPath1: '{_internal,queued_jobs}',
          leafPath: '{_internal,queued_jobs,implement_and_commit}',
        }),
      );
    });

    it('guards on the leaf flag so a second call on the same job is rejected', async () => {
      await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        `COALESCE("state_variables" #>> :leafPath, 'false') != 'true'`,
      );
    });

    it('only runs for RUNNING workflow runs', async () => {
      await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :status', {
        status: 'RUNNING',
      });
    });

    it('returns true when the atomic update wins the race (one row affected)', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 1 });

      const won = await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      expect(won).toBe(true);
    });

    it('returns false when the job is already queued or the run is not RUNNING (no row affected)', async () => {
      queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 0 });

      const won = await repo.tryMarkJobQueued('run-1', 'implement_and_commit');

      expect(won).toBe(false);
    });
  });

  describe('clearWaitState', () => {
    it('clears wait_reason and awaiting_input for the run', async () => {
      await repo.clearWaitState('run-1');

      expect(queryBuilder.set).toHaveBeenCalledWith({
        wait_reason: null,
        awaiting_input: false,
      });
      expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'run-1',
      });
      expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    });
  });
});
