import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import {
  ensureNoAssignedFileOverlap,
  extractScopeIdFromRunStateVariables,
  resolveSubagentFailureReason,
  resolveWorktreePathFromRun,
  waitForSubagentExecutions,
  toSubagentExecutionResultRecord,
} from './subagent-orchestrator.utils';

function buildExecution(
  overrides: Partial<SubagentExecutionView> = {},
): SubagentExecutionView {
  return {
    id: 'subagent-exec-1',
    parent_container_id: 'parent-container-1',
    child_container_id: 'child-container-1',
    delegation_contract_id: undefined,
    lineage_trace_id: undefined,
    lineage_parent_trace_id: undefined,
    parent_session_tree_id: undefined,
    depth: 1,
    status: 'Completed',
    result: undefined,
    assigned_files: undefined,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    completed_at: new Date('2026-04-30T00:01:00.000Z'),
    ...overrides,
  };
}

describe('toSubagentExecutionResultRecord', () => {
  it('returns a sanitized result record while preserving metadata fields', () => {
    const record = toSubagentExecutionResultRecord(
      buildExecution({
        result: {
          response: '<think>hidden</think>Visible response',
          metadata: { tokenCount: 12 },
        },
      }),
    );

    expect(record).toEqual({
      response: 'Visible response',
      metadata: { tokenCount: 12 },
      status: 'Completed',
      started_at: '2026-04-30T00:00:00.000Z',
      completed_at: '2026-04-30T00:01:00.000Z',
    });
  });

  it('adds sanitized terminal output as latest response for wait results', () => {
    const record = toSubagentExecutionResultRecord(
      buildExecution({
        result: {
          output: {
            response: '<think>hidden</think>final response',
            stopReason: 'stop',
          },
        },
      }),
    );

    expect(record.latest_response).toBe('final response');
    expect(record.latest_stop_reason).toBe('stop');
    expect(record.latest_turn_at).toBe('2026-04-30T00:01:00.000Z');
  });
});

describe('resolveSubagentFailureReason', () => {
  it.each([
    ['error', { error: '<think>hidden</think>visible error' }, 'visible error'],
    [
      'failureReason',
      { failureReason: '<think>hidden</think>visible failure' },
      'visible failure',
    ],
    [
      'error_code',
      { error_code: '<think>hidden</think>visible snake code' },
      'visible snake code',
    ],
    [
      'errorCode',
      { errorCode: '<think>hidden</think>visible camel code' },
      'visible camel code',
    ],
  ])('returns sanitized text from %s', (_fieldName, result, expected) => {
    expect(
      resolveSubagentFailureReason(
        buildExecution({
          status: 'Failed',
          result,
        }),
      ),
    ).toBe(expected);
  });
});

describe('resolveWorktreePathFromRun', () => {
  it('returns worktree path from provision_worktree job output', () => {
    const run = {
      state_variables: {
        jobs: {
          provision_worktree: {
            output: {
              worktreePath: '/data/worktrees/project-1/item-1',
            },
          },
        },
      },
    };

    expect(resolveWorktreePathFromRun(run as never)).toBe(
      '/data/worktrees/project-1/item-1',
    );
  });

  it('falls back to basePath from trigger for project-level workflows', () => {
    const run = {
      state_variables: {
        trigger: {
          scope_id: 'project-1',
          basePath: '/data/repos/project-1',
        },
      },
    };

    expect(resolveWorktreePathFromRun(run as never)).toBe(
      '/data/repos/project-1',
    );
  });

  it('prefers provision_worktree output over trigger basePath', () => {
    const run = {
      state_variables: {
        jobs: {
          provision_worktree: {
            output: {
              worktreePath: '/data/worktrees/project-1/item-1',
            },
          },
        },
        trigger: {
          scope_id: 'project-1',
          basePath: '/data/repos/project-1',
        },
      },
    };

    expect(resolveWorktreePathFromRun(run as never)).toBe(
      '/data/worktrees/project-1/item-1',
    );
  });

  it('uses trigger.resolvedRepoPath when no provisioned worktree or basePath exists', () => {
    const run = {
      state_variables: {
        trigger: {
          resolvedRepoPath: '/data/nexus-workspaces/clones/project-1',
        },
      },
    };

    expect(resolveWorktreePathFromRun(run as never)).toBe(
      '/data/nexus-workspaces/clones/project-1',
    );
  });

  it('uses trigger.resolved_repo_path when no camelCase repo path exists', () => {
    const run = {
      state_variables: {
        trigger: {
          resolved_repo_path: '/data/nexus-workspaces/clones/project-1',
        },
      },
    };

    expect(resolveWorktreePathFromRun(run as never)).toBe(
      '/data/nexus-workspaces/clones/project-1',
    );
  });

  it('returns undefined when no worktree or basePath exists', () => {
    const run = {
      state_variables: {},
    };

    expect(resolveWorktreePathFromRun(run as never)).toBeUndefined();
  });

  it('returns undefined when run is null', () => {
    expect(resolveWorktreePathFromRun(null)).toBeUndefined();
  });
});

describe('extractScopeIdFromRunStateVariables', () => {
  it('extracts scopeId from trigger when basePath is missing', () => {
    const run = {
      state_variables: {
        trigger: {
          scopeId: 'infrastructure-db',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    };

    expect(extractScopeIdFromRunStateVariables(run.state_variables)).toBe(
      'infrastructure-db',
    );
  });

  it('returns undefined when no trigger or scopeId exists', () => {
    const run = {
      state_variables: {
        jobs: {
          provision_worktree: {
            output: {
              worktreePath: '/data/worktrees/project-1/item-1',
            },
          },
        },
      },
    };

    expect(
      extractScopeIdFromRunStateVariables(run.state_variables),
    ).toBeUndefined();
  });

  it('returns undefined when state_variables is undefined', () => {
    expect(extractScopeIdFromRunStateVariables(undefined)).toBeUndefined();
  });
});

describe('waitForSubagentExecutions', () => {
  let findByParentContainerId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    findByParentContainerId = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns all_completed when terminal on first post-timeout refresh', async () => {
    findByParentContainerId
      .mockResolvedValueOnce([
        buildExecution({
          id: 'subagent-1',
          status: 'Running',
          completed_at: undefined,
        }),
      ])
      .mockResolvedValueOnce([
        buildExecution({
          id: 'subagent-1',
          status: 'Completed',
          result: {
            output: {
              response: 'subagent finished',
            },
          },
        }),
      ]);

    const resultPromise = waitForSubagentExecutions({
      parentContainerId: 'parent-container-1',
      options: { timeoutSeconds: 5 },
      findByParentContainerId: findByParentContainerId as any,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result).toEqual({
      status: 'all_completed',
      results: {
        'subagent-1': {
          output: {
            response: 'subagent finished',
          },
          status: 'Completed',
          latest_response: 'subagent finished',
          latest_turn_at: '2026-04-30T00:01:00.000Z',
          started_at: '2026-04-30T00:00:00.000Z',
          completed_at: '2026-04-30T00:01:00.000Z',
        },
      },
      timeout_seconds: 5,
      elapsed_seconds: 5,
    });
  });

  it('rejects with structured overlap error when assigned files conflict with active subagents', () => {
    const activeExecutions = [
      {
        id: 'active-1',
        status: 'Running',
        assigned_files: ['file-a.ts', 'file-b.ts'],
      } as SubagentExecutionView,
      {
        id: 'active-2',
        status: 'Running',
        assigned_files: ['file-c.ts'],
      } as SubagentExecutionView,
    ];

    expect(() => {
      ensureNoAssignedFileOverlap(['file-b.ts', 'file-c.ts'], activeExecutions);
    }).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'subagent_assigned_files_overlap',
          message: expect.stringContaining('file-b.ts'),
          retryable: true,
          recommended_action: 'wait_for_subagents',
          overlapping_files: ['file-b.ts', 'file-c.ts'],
          blocking_subagent_ids: ['active-1', 'active-2'],
          overlaps: [
            { assigned_file: 'file-b.ts', subagent_execution_id: 'active-1' },
            { assigned_file: 'file-c.ts', subagent_execution_id: 'active-2' },
          ],
        }),
      }),
    );
  });

  it('passes when assigned files do not overlap with active subagents', () => {
    const activeExecutions = [
      {
        id: 'active-1',
        status: 'Running',
        assigned_files: ['file-a.ts', 'file-b.ts'],
      } as SubagentExecutionView,
    ];

    expect(() => {
      ensureNoAssignedFileOverlap(['file-x.ts', 'file-y.ts'], activeExecutions);
    }).not.toThrow();
  });

  it('passes when requested files array is empty', () => {
    expect(() => {
      ensureNoAssignedFileOverlap([], []);
    }).not.toThrow();
  });

  it('caps polling delay at remaining timeout window', async () => {
    findByParentContainerId.mockResolvedValue([
      buildExecution({
        id: 'subagent-1',
        status: 'Running',
        completed_at: undefined,
      }),
    ]);

    const resultPromise = waitForSubagentExecutions({
      parentContainerId: 'parent-container-1',
      options: { timeoutSeconds: 1 },
      findByParentContainerId: findByParentContainerId as any,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result).toEqual({
      status: 'timeout',
      results: {
        'subagent-1': {
          status: 'Running',
          started_at: '2026-04-30T00:00:00.000Z',
          completed_at: undefined,
        },
      },
      pending_execution_ids: ['subagent-1'],
      timeout_seconds: 1,
      elapsed_seconds: 1,
    });
  });
});
