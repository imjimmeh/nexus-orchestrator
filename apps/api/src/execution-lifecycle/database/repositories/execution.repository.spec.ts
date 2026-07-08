import { describe, expect, it, vi } from 'vitest';
import { ExecutionRepository } from './execution.repository';
import { In, IsNull } from 'typeorm';
import type { Repository } from 'typeorm';
import type { ExecutionEntity } from '../entities/execution.entity';

function fakeRepo() {
  const rows = new Map<string, ExecutionEntity>();
  return {
    rows,
    findOne: vi.fn(
      async ({ where: { id } }: { where: { id: string } }) =>
        rows.get(id) ?? null,
    ),
    save: vi.fn(async (row: ExecutionEntity) => {
      rows.set(row.id, row);
      return row;
    }),
    find: vi.fn(async () => Array.from(rows.values())),
  };
}

describe('ExecutionRepository.applyTransition', () => {
  it('writes a legal transition and bumps state', async () => {
    const inner = fakeRepo();
    inner.rows.set('e1', {
      id: 'e1',
      kind: 'subagent',
      state: 'running',
      version: 1,
    } as ExecutionEntity);
    const repo = new ExecutionRepository(inner);

    const result = await repo.applyTransition('e1', 'reaped', {
      failure_reason: 'idle_timeout',
      error_message: 'no heartbeat',
    });

    expect(result?.state).toBe('reaped');
    expect(result?.failure_reason).toBe('idle_timeout');
    expect(result?.terminal_at).toBeInstanceOf(Date);
  });

  it('no-ops an illegal transition (already terminal)', async () => {
    const inner = fakeRepo();
    inner.rows.set('e1', {
      id: 'e1',
      kind: 'subagent',
      state: 'completed',
      version: 1,
    } as ExecutionEntity);
    const repo = new ExecutionRepository(inner);

    const result = await repo.applyTransition('e1', 'reaped', {
      failure_reason: 'idle_timeout',
    });

    expect(result).toBeNull();
    expect(inner.save).not.toHaveBeenCalled();
  });

  it('warns when a transition is rejected so silent lifecycle bugs surface', async () => {
    const inner = fakeRepo();
    inner.rows.set('e1', {
      id: 'e1',
      kind: 'workflow_step',
      state: 'pending',
      version: 1,
    } as ExecutionEntity);
    const repo = new ExecutionRepository(inner);
    const warnSpy = vi
      .spyOn(
        (repo as unknown as { logger: { warn: (msg: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await repo.applyTransition('e1', 'running');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pending -> running'),
    );
  });
});

describe('ExecutionRepository.findByWorkflowRunAndJob', () => {
  it('delegates to repository.find with workflow_run_id and context_id where clause', async () => {
    const matchRow = {
      id: 'e-match',
      kind: 'workflow_step',
      state: 'completed',
      workflow_run_id: 'run-1',
      context_id: 'job-1',
      version: 1,
    } as ExecutionEntity;

    const inner = {
      ...fakeRepo(),
      find: vi.fn().mockResolvedValue([matchRow]),
    };
    const repo = new ExecutionRepository(inner);

    const results = await repo.findByWorkflowRunAndJob('run-1', 'job-1');

    expect(inner.find).toHaveBeenCalledWith({
      where: { workflow_run_id: 'run-1', context_id: 'job-1' },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e-match');
  });
});

describe('ExecutionRepository.updateResolvedConfig', () => {
  it('patches only the provided resolved-config fields', async () => {
    const inner = {
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new ExecutionRepository(inner);

    await repo.updateResolvedConfig('exec-1', {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      harness_id: 'pi',
    });

    expect(inner.update).toHaveBeenCalledWith(
      { id: 'exec-1' },
      { provider: 'anthropic', model: 'claude-opus-4-8', harness_id: 'pi' },
    );
  });
});

describe('ExecutionRepository.findManyByIds', () => {
  it('returns an empty array without querying when ids is empty', async () => {
    const inner = { find: vi.fn() };
    const repo = new ExecutionRepository(inner);

    const result = await repo.findManyByIds([]);

    expect(result).toEqual([]);
    expect(inner.find).not.toHaveBeenCalled();
  });

  it('queries executions matching the supplied ids', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const inner = { find: vi.fn().mockResolvedValue(rows) };
    const repo = new ExecutionRepository(inner);

    const result = await repo.findManyByIds(['a', 'b']);

    expect(inner.find).toHaveBeenCalledWith({
      where: { id: expect.anything() },
    });
    expect(result).toBe(rows);
  });
});

describe('ExecutionRepository.findByContainerId', () => {
  it('queries by container id and optional kind', async () => {
    const row = { id: 'e1', kind: 'subagent' } as ExecutionEntity;
    const inner = { findOne: vi.fn().mockResolvedValue(row) };
    const repo = new ExecutionRepository(inner);

    const result = await repo.findByContainerId('container-1', 'subagent');

    expect(inner.findOne).toHaveBeenCalledWith({
      where: { container_id: 'container-1', kind: 'subagent' },
    });
    expect(result).toBe(row);
  });

  it('omits kind from the where clause when not supplied', async () => {
    const inner = { findOne: vi.fn().mockResolvedValue(null) };
    const repo = new ExecutionRepository(inner);

    await repo.findByContainerId('container-1');

    expect(inner.findOne).toHaveBeenCalledWith({
      where: { container_id: 'container-1' },
    });
  });
});

describe('ExecutionRepository.findByWorkflowRun', () => {
  it('queries executions for a run ordered by creation time', async () => {
    const rows = [{ id: 'a' }];
    const inner = { find: vi.fn().mockResolvedValue(rows) };
    const repo = new ExecutionRepository(inner);

    const result = await repo.findByWorkflowRun('run-1');

    expect(inner.find).toHaveBeenCalledWith({
      where: { workflow_run_id: 'run-1' },
      order: { created_at: 'ASC' },
    });
    expect(result).toBe(rows);
  });
});

describe('ExecutionRepository owner leases', () => {
  it('claims an unowned non-terminal execution lease', async () => {
    const updateBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const inner = {
      createQueryBuilder: vi.fn().mockReturnValue(updateBuilder),
    };
    const repo = new ExecutionRepository(inner);
    const now = new Date('2026-06-30T12:00:00.000Z');
    const leaseExpiresAt = new Date('2026-06-30T12:02:00.000Z');

    const claimed = await repo.claimOwnerLease({
      executionId: 'exec-1',
      ownerInstanceId: 'api-instance-1',
      now,
      leaseExpiresAt,
    });

    expect(claimed).toBe(true);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      owner_instance_id: 'api-instance-1',
      owner_lease_expires_at: leaseExpiresAt,
      last_progress_at: now,
    });
  });

  it('does not claim an execution owned by a non-expired lease', async () => {
    const updateBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ affected: 0 }),
    };
    const inner = {
      createQueryBuilder: vi.fn().mockReturnValue(updateBuilder),
    };
    const repo = new ExecutionRepository(inner);

    const claimed = await repo.claimOwnerLease({
      executionId: 'exec-1',
      ownerInstanceId: 'api-instance-2',
      now: new Date('2026-06-30T12:00:00.000Z'),
      leaseExpiresAt: new Date('2026-06-30T12:02:00.000Z'),
    });

    expect(claimed).toBe(false);
  });

  it('finds non-terminal executions with expired owner leases', async () => {
    const expiredExecution = {
      id: 'exec-expired',
      state: 'running',
    } as ExecutionEntity;
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([expiredExecution]),
    };
    const inner = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };
    const repo = new ExecutionRepository(inner);
    const now = new Date('2026-06-30T12:00:00.000Z');

    const result = await repo.findExpiredOwnerLeases(now);

    expect(inner.createQueryBuilder).toHaveBeenCalledWith('execution');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'execution.state NOT IN (:...terminalStates)',
      expect.objectContaining({ terminalStates: expect.any(Array) }),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'execution.owner_lease_expires_at IS NOT NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'execution.owner_lease_expires_at < :now',
      { now },
    );
    expect(result).toEqual([expiredExecution]);
  });
});

function makeRepo(rows: Partial<ExecutionEntity>[]) {
  const find = vi.fn().mockResolvedValue(rows);
  const update = vi.fn().mockResolvedValue({ affected: rows.length });
  const inner = { find, update } as unknown as Repository<ExecutionEntity>;
  return { repo: new ExecutionRepository(inner), find, update };
}

describe('ExecutionRepository freeze methods', () => {
  it('markFrozen sets frozen/paused_at/pause_reason', async () => {
    const { repo, update } = makeRepo([]);
    const at = new Date('2026-06-14T00:00:00.000Z');
    await repo.markFrozen('exec-1', 'service_shutdown', at);
    expect(update).toHaveBeenCalledWith(
      { id: 'exec-1' },
      { frozen: true, paused_at: at, pause_reason: 'service_shutdown' },
    );
  });

  it('clearFrozen resets the flag and refreshes heartbeat', async () => {
    const { repo, update } = makeRepo([]);
    const at = new Date('2026-06-14T00:01:00.000Z');
    await repo.clearFrozen('exec-1', at);
    expect(update).toHaveBeenCalledWith(
      { id: 'exec-1' },
      {
        frozen: false,
        paused_at: null,
        pause_reason: null,
        last_heartbeat_at: at,
      },
    );
  });
});

describe('ExecutionRepository.findNonTerminalSubagentsByRun', () => {
  it('returns only non-terminal subagent executions for the run', async () => {
    const subagentRunningA = {
      id: 'subagent-running-a',
      kind: 'subagent',
      state: 'running',
      workflow_run_id: 'run-a',
      version: 1,
    } as ExecutionEntity;

    const subagentCompletedA = {
      id: 'subagent-completed-a',
      kind: 'subagent',
      state: 'completed',
      workflow_run_id: 'run-a',
      version: 1,
    } as ExecutionEntity;

    const workflowStepRunningA = {
      id: 'workflow-step-running-a',
      kind: 'workflow_step',
      state: 'running',
      workflow_run_id: 'run-a',
      version: 1,
    } as ExecutionEntity;

    const subagentRunningB = {
      id: 'subagent-running-b',
      kind: 'subagent',
      state: 'running',
      workflow_run_id: 'run-b',
      version: 1,
    } as ExecutionEntity;

    const inner = {
      find: vi.fn().mockResolvedValue([subagentRunningA]),
    } as unknown as Repository<ExecutionEntity>;
    const repo = new ExecutionRepository(inner);

    const result = await repo.findNonTerminalSubagentsByRun('run-a');

    expect(inner.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflow_run_id: 'run-a',
          kind: 'subagent',
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('subagent-running-a');
  });
});

describe('ExecutionRepository.findRunIdsWithNonTerminalSubagents', () => {
  it('returns distinct run ids with non-terminal subagents', async () => {
    const inner = {
      find: vi
        .fn()
        .mockResolvedValue([
          { workflow_run_id: 'run-a' },
          { workflow_run_id: 'run-b' },
        ]),
    } as unknown as Repository<ExecutionEntity>;
    const repo = new ExecutionRepository(inner);

    const result = await repo.findRunIdsWithNonTerminalSubagents();

    expect(inner.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'subagent',
        }),
      }),
    );
    expect(result).toHaveLength(2);
    expect(result).toContain('run-a');
    expect(result).toContain('run-b');
  });
});

describe('ExecutionRepository.findRunningStepByRunAndContext', () => {
  it('returns the running row when both running and completed rows exist for the same run+context', async () => {
    const runningRow = {
      id: 'step-running',
      kind: 'workflow_step',
      state: 'running',
      workflow_run_id: 'run-1',
      context_id: 'job-1',
      terminal_at: null,
      created_at: new Date('2026-06-23T10:00:00.000Z'),
      version: 1,
    } as ExecutionEntity;

    const inner = {
      findOne: vi.fn().mockResolvedValue(runningRow),
    } as unknown as Repository<ExecutionEntity>;
    const repo = new ExecutionRepository(inner);

    const result = await repo.findRunningStepByRunAndContext('run-1', 'job-1');

    expect(inner.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'workflow_step',
          workflow_run_id: 'run-1',
          context_id: 'job-1',
          state: In(['provisioning', 'running']),
          terminal_at: IsNull(),
        }),
        order: { created_at: 'DESC' },
      }),
    );
    expect(result).toBe(runningRow);
  });

  it('returns null when only terminal rows exist for the run+context', async () => {
    const inner = {
      findOne: vi.fn().mockResolvedValue(null),
    } as unknown as Repository<ExecutionEntity>;
    const repo = new ExecutionRepository(inner);

    const result = await repo.findRunningStepByRunAndContext('run-1', 'job-1');

    expect(result).toBeNull();
  });
});
