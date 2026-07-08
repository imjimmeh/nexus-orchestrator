import { describe, expect, it, vi } from 'vitest';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import type { ExecutionState } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { SubagentDetails } from '../database/entities/subagent-details.entity';
import {
  SubagentExecutionReadModel,
  projectSubagentStatusFromState,
} from './subagent-execution-read-model';

function buildExecution(
  overrides: Partial<ExecutionEntity> = {},
): ExecutionEntity {
  return {
    id: 'exec-1',
    kind: 'subagent',
    state: 'running',
    container_id: 'child-container-1',
    chat_session_id: 'chat-session-1',
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    terminal_at: null,
    ...overrides,
  } as ExecutionEntity;
}

function buildDetails(
  overrides: Partial<SubagentDetails> = {},
): SubagentDetails {
  return {
    execution_id: 'exec-1',
    parent_container_id: 'parent-container-1',
    delegation_contract_id: 'contract-1',
    lineage_trace_id: 'trace-1',
    lineage_parent_trace_id: 'parent-trace-1',
    parent_session_tree_id: 'tree-1',
    depth: 2,
    assigned_files: ['src/a.ts'],
    result: { foo: 'bar' },
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function buildReadModel(deps: {
  execution?: ExecutionRepository;
  details?: SubagentDetailsRepository;
}): {
  readModel: SubagentExecutionReadModel;
  executionRepo: ExecutionRepository;
  subagentDetailsRepo: SubagentDetailsRepository;
} {
  const executionRepo = (deps.execution ?? {
    findById: vi.fn(),
    findManyByIds: vi.fn(),
    findByContainerId: vi.fn(),
  }) as unknown as ExecutionRepository;
  const subagentDetailsRepo = (deps.details ?? {
    findByExecutionId: vi.fn(),
    findByParentContainerId: vi.fn(),
  }) as unknown as SubagentDetailsRepository;
  return {
    readModel: new SubagentExecutionReadModel(
      executionRepo,
      subagentDetailsRepo,
    ),
    executionRepo,
    subagentDetailsRepo,
  };
}

describe('projectSubagentStatusFromState', () => {
  const cases: Array<[ExecutionState, string]> = [
    ['pending', 'Spawning'],
    ['provisioning', 'Spawning'],
    ['running', 'Running'],
    ['awaiting_input', 'Running'],
    ['completing', 'Running'],
    ['retry_scheduled', 'Running'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['reaped', 'Failed'],
    ['cancelled', 'Failed'],
  ];

  it.each(cases)(
    'maps execution state %s to legacy status %s',
    (state, status) => {
      expect(projectSubagentStatusFromState(state)).toBe(status);
    },
  );
});

describe('SubagentExecutionReadModel', () => {
  it('findById assembles execution lifecycle fields with satellite fields', async () => {
    const execution = buildExecution({
      state: 'completed',
      terminal_at: new Date('2026-06-02T00:00:00.000Z'),
    });
    const details = buildDetails();
    const { readModel } = buildReadModel({
      execution: {
        findById: vi.fn().mockResolvedValue(execution),
      } as unknown as ExecutionRepository,
      details: {
        findByExecutionId: vi.fn().mockResolvedValue(details),
      } as unknown as SubagentDetailsRepository,
    });

    const projection = await readModel.findById('exec-1');

    expect(projection).toMatchObject({
      id: 'exec-1',
      status: 'Completed',
      child_container_id: 'child-container-1',
      subagent_chat_session_id: 'chat-session-1',
      parent_container_id: 'parent-container-1',
      delegation_contract_id: 'contract-1',
      lineage_trace_id: 'trace-1',
      lineage_parent_trace_id: 'parent-trace-1',
      parent_session_tree_id: 'tree-1',
      depth: 2,
      assigned_files: ['src/a.ts'],
      result: { foo: 'bar' },
      completed_at: new Date('2026-06-02T00:00:00.000Z'),
    });
  });

  it('findById returns null when execution is missing or not a subagent', async () => {
    const { readModel } = buildReadModel({
      execution: {
        findById: vi
          .fn()
          .mockResolvedValue(buildExecution({ kind: 'workflow_step' })),
      } as unknown as ExecutionRepository,
    });

    expect(await readModel.findById('exec-1')).toBeNull();
  });

  it('findByParentContainerId joins satellite rows to executions', async () => {
    const details = [
      buildDetails({ execution_id: 'exec-1' }),
      buildDetails({ execution_id: 'exec-2', depth: 3 }),
    ];
    const executions = [
      buildExecution({ id: 'exec-1', state: 'running' }),
      buildExecution({ id: 'exec-2', state: 'completed' }),
    ];
    const { readModel } = buildReadModel({
      execution: {
        findManyByIds: vi.fn().mockResolvedValue(executions),
      } as unknown as ExecutionRepository,
      details: {
        findByParentContainerId: vi.fn().mockResolvedValue(details),
      } as unknown as SubagentDetailsRepository,
    });

    const projections =
      await readModel.findByParentContainerId('parent-container-1');

    expect(projections).toHaveLength(2);
    expect(projections.map((p) => [p.id, p.status])).toEqual([
      ['exec-1', 'Running'],
      ['exec-2', 'Completed'],
    ]);
    const exec1Projection = projections.find((p) => p.id === 'exec-1');
    const exec2Projection = projections.find((p) => p.id === 'exec-2');
    expect(exec1Projection?.depth).toBe(2);
    expect(exec2Projection?.depth).toBe(3);
  });

  it('findByParentContainerId returns empty when no satellite rows exist', async () => {
    const { readModel } = buildReadModel({
      details: {
        findByParentContainerId: vi.fn().mockResolvedValue([]),
      } as unknown as SubagentDetailsRepository,
    });

    expect(await readModel.findByParentContainerId('parent')).toEqual([]);
  });

  it('findByChildContainerId resolves the parent subagent by container id', async () => {
    const execution = buildExecution({ id: 'parent-exec', state: 'running' });
    const details = buildDetails({ execution_id: 'parent-exec', depth: 1 });
    const findByContainerId = vi.fn().mockResolvedValue(execution);
    const { readModel } = buildReadModel({
      execution: {
        findByContainerId,
      } as unknown as ExecutionRepository,
      details: {
        findByExecutionId: vi.fn().mockResolvedValue(details),
      } as unknown as SubagentDetailsRepository,
    });

    const projection =
      await readModel.findByChildContainerId('parent-container');

    expect(findByContainerId).toHaveBeenCalledWith(
      'parent-container',
      'subagent',
    );
    expect(projection?.depth).toBe(1);
  });

  it('findByChildContainerId returns null when no subagent owns the container', async () => {
    const { readModel } = buildReadModel({
      execution: {
        findByContainerId: vi.fn().mockResolvedValue(null),
      } as unknown as ExecutionRepository,
    });

    expect(await readModel.findByChildContainerId('container')).toBeNull();
  });
});
