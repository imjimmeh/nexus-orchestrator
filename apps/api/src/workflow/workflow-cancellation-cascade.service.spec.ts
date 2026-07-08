import { describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import type { IWorkflowRun } from '@nexus/core';
import { WORKFLOW_RUN_CANCELLED_EVENT } from './workflow-events.constants';
import { WorkflowCancellationCascadeService } from './workflow-cancellation-cascade.service';

type WorkflowRunFixture = Pick<
  IWorkflowRun,
  'id' | 'workflow_id' | 'status' | 'state_variables'
>;

const buildRun = (overrides: Partial<WorkflowRunFixture>): IWorkflowRun => {
  return {
    id: overrides.id ?? 'run-1',
    workflow_id: overrides.workflow_id ?? 'wf-1',
    status: overrides.status ?? WorkflowStatus.RUNNING,
    state_variables: overrides.state_variables ?? { trigger: {} },
  } as IWorkflowRun;
};

/**
 * Spec for WorkflowCancellationCascadeService.
 *
 * Builds only the surface the cascade actually consumes: persistence,
 * run repo, run execution (queue purge), container cleanup, and event
 * emitter. No import of WorkflowEngineService — the engine must remain
 * oblivious to the cascade seam.
 */
describe('WorkflowCancellationCascadeService', () => {
  const createCascade = (overrides?: {
    runsById?: Record<string, IWorkflowRun | null>;
    findActiveChildRunsForParentRun?: ReturnType<typeof vi.fn>;
    runIdOrdering?: Record<string, string[]>;
    persistenceError?: (runId: string) => Error | undefined;
  }) => {
    const calls = {
      updateRunStatus: vi.fn(),
      removeQueuedJobsForRun: vi.fn().mockResolvedValue(0),
      stopManagedContainersForRun: vi.fn().mockResolvedValue(0),
      emit: vi.fn(),
    };

    const runsById = overrides?.runsById ?? {};

    const persistence = {
      getWorkflowRun: vi.fn((runId: string) => {
        const error = overrides?.persistenceError?.(runId);
        if (error) {
          return Promise.reject(error);
        }
        // Resolves to `null` when explicitly asked to mimic a child
        // whose `findById` returns null mid-traversal (test case g).
        if (runId in runsById) {
          return Promise.resolve(runsById[runId] as IWorkflowRun);
        }
        return Promise.resolve(null);
      }),
      updateRunStatus: calls.updateRunStatus.mockImplementation(
        (runId: string, status: WorkflowStatus) => {
          const original = runsById[runId];
          const next = {
            ...(original ?? buildRun({ id: runId })),
            status,
          };
          runsById[runId] = next;
          return Promise.resolve(next);
        },
      ),
    };

    const findActiveChildRunsForParentRun =
      overrides?.findActiveChildRunsForParentRun ??
      vi.fn().mockImplementation((parentId: string) => {
        const childIds = overrides?.runIdOrdering?.[parentId] ?? [];
        return Promise.resolve(
          childIds.map((childId) => buildRun({ id: childId })),
        );
      });

    const workflowRunRepository = {
      findActiveChildRunsForParentRun,
    };

    const containerCleanup = {
      stopManagedContainersForRun: calls.stopManagedContainersForRun,
    };

    const runExecution = {
      removeQueuedJobsForRun: calls.removeQueuedJobsForRun,
    };

    const eventEmitter: Pick<EventEmitter2, 'emit'> = {
      emit: calls.emit,
    };

    const service = new WorkflowCancellationCascadeService(
      persistence as never,
      containerCleanup as never,
      runExecution as never,
      eventEmitter as never,
      workflowRunRepository as never,
    );

    return {
      service,
      calls,
      persistence,
      workflowRunRepository,
      containerCleanup,
      runExecution,
      eventEmitter,
      runsById,
    };
  };

  /**
   * (a) terminal-state runs (CANCELLED / COMPLETED / FAILED) are skipped
   * without emitting events or touching containers.
   */
  describe('terminal-state runs', () => {
    it.each([
      ['CANCELLED', WorkflowStatus.CANCELLED],
      ['COMPLETED', WorkflowStatus.COMPLETED],
      ['FAILED', WorkflowStatus.FAILED],
    ])(
      'skips %s runs without emitting events or killing containers',
      async (_label, status) => {
        const { service, calls, containerCleanup, eventEmitter, runsById } =
          createCascade({
            runsById: {
              'run-terminal': buildRun({ id: 'run-terminal', status }),
            },
          });

        await service.cancelRun('run-terminal', 'user_abort');

        expect(calls.updateRunStatus).not.toHaveBeenCalled();
        expect(
          containerCleanup.stopManagedContainersForRun,
        ).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalledWith(
          WORKFLOW_RUN_CANCELLED_EVENT,
          expect.anything(),
        );
        expect(runsById['run-terminal']?.status).toBe(status);
      },
    );
  });

  /**
   * (b) RUNNING run + N child runs each get WORKFLOW_RUN_CANCELLED_EVENT
   *     emitted exactly once with the supplied reason.
   */
  it('emits a cancelled event for the parent and every child exactly once with the supplied reason', async () => {
    const { service, calls, eventEmitter } = createCascade({
      runsById: {
        'run-parent': buildRun({
          id: 'run-parent',
          workflow_id: 'wf-parent',
          status: WorkflowStatus.RUNNING,
        }),
        'run-child-1': buildRun({
          id: 'run-child-1',
          workflow_id: 'wf-child',
          status: WorkflowStatus.RUNNING,
        }),
        'run-child-2': buildRun({
          id: 'run-child-2',
          workflow_id: 'wf-child',
          status: WorkflowStatus.RUNNING,
        }),
        'run-grandchild': buildRun({
          id: 'run-grandchild',
          workflow_id: 'wf-grandchild',
          status: WorkflowStatus.RUNNING,
        }),
      },
      runIdOrdering: {
        'run-parent': ['run-child-1', 'run-child-2'],
        'run-child-1': ['run-grandchild'],
        'run-child-2': [],
        'run-grandchild': [],
      },
    });

    await service.cancelRun('run-parent', 'user_abort');

    const cancelEmits = (
      eventEmitter.emit as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      ([eventName]: [string]) => eventName === WORKFLOW_RUN_CANCELLED_EVENT,
    );
    expect(cancelEmits).toHaveLength(4);

    const emittedRunIds = cancelEmits
      .map(
        ([, payload]: [string, { workflowRunId: string; reason: string }]) => ({
          id: payload.workflowRunId,
          reason: payload.reason,
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    expect(emittedRunIds).toEqual([
      { id: 'run-child-1', reason: 'user_abort' },
      { id: 'run-child-2', reason: 'user_abort' },
      { id: 'run-grandchild', reason: 'user_abort' },
      { id: 'run-parent', reason: 'user_abort' },
    ]);

    // updateRunStatus must have flipped every node exactly once.
    expect(calls.updateRunStatus).toHaveBeenCalledTimes(4);
    const updatedRunIds = calls.updateRunStatus.mock.calls
      .map(([runId]: [string]) => runId)
      .sort();
    expect(updatedRunIds).toEqual(
      ['run-child-1', 'run-child-2', 'run-grandchild', 'run-parent'].sort(),
    );
  });

  /**
   * (c) stopManagedContainersForRun is invoked for each cancelled run.
   */
  it('invokes stopManagedContainersForRun for every cancelled run', async () => {
    const { service, containerCleanup } = createCascade({
      runsById: {
        'run-parent': buildRun({
          id: 'run-parent',
          workflow_id: 'wf-parent',
          status: WorkflowStatus.RUNNING,
        }),
        'run-child': buildRun({
          id: 'run-child',
          workflow_id: 'wf-child',
          status: WorkflowStatus.RUNNING,
        }),
      },
      runIdOrdering: {
        'run-parent': ['run-child'],
        'run-child': [],
      },
    });

    await service.cancelRun('run-parent', 'user_abort');

    expect(containerCleanup.stopManagedContainersForRun).toHaveBeenCalledTimes(
      2,
    );
    expect(containerCleanup.stopManagedContainersForRun).toHaveBeenCalledWith(
      'run-child',
    );
    expect(containerCleanup.stopManagedContainersForRun).toHaveBeenCalledWith(
      'run-parent',
    );
  });

  /**
   * (d) removeQueuedJobsForRun is invoked for each cancelled run.
   */
  it('invokes removeQueuedJobsForRun for every cancelled run', async () => {
    const { service, runExecution } = createCascade({
      runsById: {
        'run-parent': buildRun({
          id: 'run-parent',
          workflow_id: 'wf-parent',
          status: WorkflowStatus.RUNNING,
        }),
        'run-child': buildRun({
          id: 'run-child',
          workflow_id: 'wf-child',
          status: WorkflowStatus.RUNNING,
        }),
      },
      runIdOrdering: {
        'run-parent': ['run-child'],
        'run-child': [],
      },
    });

    await service.cancelRun('run-parent', 'user_abort');

    expect(runExecution.removeQueuedJobsForRun).toHaveBeenCalledTimes(2);
    expect(runExecution.removeQueuedJobsForRun).toHaveBeenCalledWith(
      'run-child',
    );
    expect(runExecution.removeQueuedJobsForRun).toHaveBeenCalledWith(
      'run-parent',
    );
  });

  /**
   * (e) parent and child both report each other as active descendants →
   *     BFS terminates without infinite recursion. updateRunStatus is
   *     called exactly once per node and no stack-overflow occurs.
   */
  it('terminates without infinite recursion when the cascade graph has a cycle', async () => {
    const { service, calls, workflowRunRepository } = createCascade({
      runsById: {
        'run-parent': buildRun({
          id: 'run-parent',
          workflow_id: 'wf-parent',
          status: WorkflowStatus.RUNNING,
        }),
        'run-child': buildRun({
          id: 'run-child',
          workflow_id: 'wf-child',
          status: WorkflowStatus.RUNNING,
        }),
      },
      findActiveChildRunsForParentRun: vi
        .fn()
        .mockImplementation((parentId: string) => {
          if (parentId === 'run-parent') {
            return Promise.resolve([buildRun({ id: 'run-child' })]);
          }
          if (parentId === 'run-child') {
            return Promise.resolve([buildRun({ id: 'run-parent' })]);
          }
          return Promise.resolve([]);
        }),
    });

    await service.cancelRun('run-parent', 'user_abort');

    // Exactly two nodes cancelled.
    expect(calls.updateRunStatus).toHaveBeenCalledTimes(2);
    const updatedRunIds = calls.updateRunStatus.mock.calls
      .map(([runId]: [string]) => runId)
      .sort();
    expect(updatedRunIds).toEqual(['run-child', 'run-parent']);

    // The repository is asked for children exactly twice — one per node
    // before the visited-set short-circuit kicks in on the second pass.
    const discoveryCalls =
      workflowRunRepository.findActiveChildRunsForParentRun.mock.calls;
    expect(discoveryCalls).toHaveLength(2);
  });

  /**
   * (f) findActiveChildRunsForParentRun failures are swallowed with a
   *     warn log and the parent run is still cancelled.
   */
  it('logs a warn and continues when findActiveChildRunsForParentRun throws', async () => {
    const warn = vi.fn();
    const { service, calls, workflowRunRepository, containerCleanup } =
      createCascade({
        runsById: {
          'run-parent': buildRun({
            id: 'run-parent',
            workflow_id: 'wf-parent',
            status: WorkflowStatus.RUNNING,
          }),
          'run-sibling': buildRun({
            id: 'run-sibling',
            workflow_id: 'wf-sibling',
            status: WorkflowStatus.RUNNING,
          }),
        },
        runIdOrdering: {
          'run-parent': [],
          'run-sibling': [],
        },
        findActiveChildRunsForParentRun: vi
          .fn()
          .mockImplementation((parentId: string) => {
            if (parentId === 'run-parent') {
              return Promise.reject(new Error('postgres connection refused'));
            }
            return Promise.resolve(
              (parentId === 'run-sibling' ? [] : []).map((id: string) =>
                buildRun({ id }),
              ),
            );
          }),
      });

    // Swap the cascade logger so we can assert on the warn without
    // leaking it to global test output. Keep `log` as a no-op so the
    // success-path log line in `cancelSingleRun` does not throw.
    (
      service as unknown as {
        logger: { warn: typeof warn; log: () => void };
      }
    ).logger = { warn, log: () => undefined };

    await service.cancelRun('run-parent', 'user_abort');

    // Parent still cancelled cleanly.
    expect(calls.updateRunStatus).toHaveBeenCalledTimes(1);
    expect(calls.updateRunStatus).toHaveBeenCalledWith(
      'run-parent',
      WorkflowStatus.CANCELLED,
    );
    expect(containerCleanup.stopManagedContainersForRun).toHaveBeenCalledWith(
      'run-parent',
    );
    expect(
      workflowRunRepository.findActiveChildRunsForParentRun,
    ).toHaveBeenCalledWith('run-parent');
    expect(warn).toHaveBeenCalledWith(
      'Failed to resolve active child runs for run-parent: postgres connection refused',
    );
  });

  /**
   * (g) a child whose persistence load resolves to null mid-traversal
   *     must not abort siblings. The cascade must keep going and cancel
   *     the remaining nodes.
   */
  it('skips null mid-traversal nodes without aborting siblings', async () => {
    const warn = vi.fn();
    const { service, calls, containerCleanup, runExecution, eventEmitter } =
      createCascade({
        runsById: {
          'run-parent': buildRun({
            id: 'run-parent',
            workflow_id: 'wf-parent',
            status: WorkflowStatus.RUNNING,
          }),
          'run-child-a': buildRun({
            id: 'run-child-a',
            workflow_id: 'wf-child',
            status: WorkflowStatus.RUNNING,
          }),
          'run-child-b': null, // resolved to null mid-traversal
          'run-child-c': buildRun({
            id: 'run-child-c',
            workflow_id: 'wf-child',
            status: WorkflowStatus.RUNNING,
          }),
        },
        runIdOrdering: {
          'run-parent': ['run-child-a', 'run-child-b', 'run-child-c'],
          'run-child-a': [],
          'run-child-b': [],
          'run-child-c': [],
        },
      });

    (
      service as unknown as {
        logger: { warn: typeof warn; log: () => void };
      }
    ).logger = { warn, log: () => undefined };

    await service.cancelRun('run-parent', 'user_abort');

    // Siblings still cancelled.
    expect(calls.updateRunStatus).toHaveBeenCalledTimes(3);
    const updatedRunIds = calls.updateRunStatus.mock.calls
      .map(([runId]: [string]) => runId)
      .sort();
    expect(updatedRunIds).toEqual(
      ['run-child-a', 'run-child-c', 'run-parent'].sort(),
    );
    expect(containerCleanup.stopManagedContainersForRun).toHaveBeenCalledTimes(
      3,
    );
    expect(runExecution.removeQueuedJobsForRun).toHaveBeenCalledTimes(3);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(3);

    // Null node was logged as a warn, not silenced or thrown.
    expect(warn).toHaveBeenCalledWith(
      'Skipping cascade node run-child-b: persistence resolved to null mid-traversal',
    );
  });
});
