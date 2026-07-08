import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentOrphanReconcilerService } from './subagent-orphan-reconciler.service';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { SubagentCoordinationService } from './subagent-coordination.service';
import type { ShutdownStateService } from '../../shutdown/shutdown-state.service';

function makeDeps() {
  const executionRepo = {
    findRunIdsWithNonTerminalSubagents: vi.fn<[], Promise<string[]>>(),
    findNonTerminalSubagentsByRun: vi.fn<[string], Promise<{ id: string }[]>>(),
  } as unknown as ExecutionRepository;

  const runRepo = {
    findById: vi.fn<[string], Promise<unknown>>(),
  } as unknown as IWorkflowRunRepository;

  const subagentDetailsRepo = {
    findByExecutionId: vi
      .fn<[string], Promise<{ parent_container_id: string } | null>>()
      .mockResolvedValue(null),
  } as unknown as SubagentDetailsRepository;

  const subagentCoordination = {
    cancelActiveForParent: vi
      .fn<[string, object], Promise<{ cancelled_execution_ids: string[] }>>()
      .mockResolvedValue({ cancelled_execution_ids: [] }),
  } as unknown as SubagentCoordinationService;

  const shutdownState = {
    isShuttingDown: vi.fn<[], boolean>().mockReturnValue(false),
  } as unknown as ShutdownStateService;

  return {
    executionRepo,
    runRepo,
    subagentDetailsRepo,
    subagentCoordination,
    shutdownState,
  };
}

describe('SubagentOrphanReconcilerService.reconcileOrphans', () => {
  let executionRepo: ReturnType<typeof makeDeps>['executionRepo'];
  let runRepo: ReturnType<typeof makeDeps>['runRepo'];
  let subagentDetailsRepo: ReturnType<typeof makeDeps>['subagentDetailsRepo'];
  let subagentCoordination: ReturnType<typeof makeDeps>['subagentCoordination'];
  let shutdownState: ReturnType<typeof makeDeps>['shutdownState'];
  let reconciler: SubagentOrphanReconcilerService;

  beforeEach(() => {
    const deps = makeDeps();
    executionRepo = deps.executionRepo;
    runRepo = deps.runRepo;
    subagentDetailsRepo = deps.subagentDetailsRepo;
    subagentCoordination = deps.subagentCoordination;
    shutdownState = deps.shutdownState;
    reconciler = new SubagentOrphanReconcilerService(
      executionRepo,
      runRepo,
      subagentDetailsRepo,
      subagentCoordination,
      shutdownState,
    );
  });

  it('cancels a non-terminal subagent whose run has already finished', async () => {
    vi.mocked(
      executionRepo.findRunIdsWithNonTerminalSubagents,
    ).mockResolvedValue(['r1']);
    vi.mocked(runRepo.findById).mockResolvedValue({
      id: 'r1',
      status: 'COMPLETED',
    });
    vi.mocked(executionRepo.findNonTerminalSubagentsByRun).mockResolvedValue([
      { id: 's1' },
    ]);
    vi.mocked(subagentDetailsRepo.findByExecutionId).mockResolvedValue({
      parent_container_id: 'c1',
    });
    vi.mocked(subagentCoordination.cancelActiveForParent).mockResolvedValue({
      cancelled_execution_ids: ['s1'],
    });

    const count = await reconciler.reconcileOrphans();

    expect(count).toBe(1);
    expect(subagentCoordination.cancelActiveForParent).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ reason: expect.stringContaining('orphan') }),
    );
  });

  it('skips runs that are still RUNNING', async () => {
    vi.mocked(
      executionRepo.findRunIdsWithNonTerminalSubagents,
    ).mockResolvedValue(['r2']);
    vi.mocked(runRepo.findById).mockResolvedValue({
      id: 'r2',
      status: 'RUNNING',
    });

    const count = await reconciler.reconcileOrphans();

    expect(count).toBe(0);
    expect(subagentCoordination.cancelActiveForParent).not.toHaveBeenCalled();
  });

  it('returns 0 and does not call cancelActiveForParent when isShuttingDown is true', async () => {
    vi.mocked(shutdownState.isShuttingDown).mockReturnValue(true);

    const count = await reconciler.reconcileOrphans();

    expect(count).toBe(0);
    expect(
      executionRepo.findRunIdsWithNonTerminalSubagents,
    ).not.toHaveBeenCalled();
    expect(subagentCoordination.cancelActiveForParent).not.toHaveBeenCalled();
  });
});
