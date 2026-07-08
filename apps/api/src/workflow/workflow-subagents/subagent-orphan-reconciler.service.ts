import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import { SubagentCoordinationService } from './subagent-coordination.service';
import { ShutdownStateService } from '../../shutdown/shutdown-state.service';

const RECONCILE_INTERVAL_MS = 60_000;
const ORPHAN_REASON = 'orphaned subagent reconciled (run/parent terminal)';
const TERMINAL_RUN_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;

type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

@Injectable()
export class SubagentOrphanReconcilerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubagentOrphanReconcilerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly executionRepo: ExecutionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
    private readonly subagentCoordination: SubagentCoordinationService,
    private readonly shutdownState: ShutdownStateService,
  ) {}

  onApplicationBootstrap(): void {
    void this.reconcileOrphans();
    this.timer = setInterval(
      () => void this.reconcileOrphans(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  /**
   * Cancels all non-terminal subagent executions belonging to runs that have
   * already reached a terminal status (COMPLETED / FAILED / CANCELLED).
   *
   * @returns The total number of subagent executions cancelled in this pass.
   */
  async reconcileOrphans(): Promise<number> {
    if (this.shutdownState.isShuttingDown()) return 0;

    let cancelled = 0;
    const runIds =
      await this.executionRepo.findRunIdsWithNonTerminalSubagents();

    for (const runId of runIds) {
      const run = await this.runRepo.findById(runId);
      const runFinished =
        !run || TERMINAL_RUN_STATUSES.includes(run.status as TerminalRunStatus);

      if (!runFinished) continue;

      const executions =
        await this.executionRepo.findNonTerminalSubagentsByRun(runId);

      const parents = await this.resolveParentContainerIds(
        executions.map((e) => e.id),
      );

      for (const parentContainerId of parents) {
        const { cancelled_execution_ids } =
          await this.subagentCoordination.cancelActiveForParent(
            parentContainerId,
            { workflowRunId: runId, reason: ORPHAN_REASON },
          );
        cancelled += cancelled_execution_ids.length;
      }
    }

    if (cancelled > 0) {
      this.logger.warn(`Reconciled ${cancelled} orphaned subagent(s)`);
    }

    return cancelled;
  }

  private async resolveParentContainerIds(
    executionIds: string[],
  ): Promise<Set<string>> {
    const parents = new Set<string>();
    for (const executionId of executionIds) {
      const details =
        await this.subagentDetailsRepo.findByExecutionId(executionId);
      if (details?.parent_container_id) {
        parents.add(details.parent_container_id);
      }
    }
    return parents;
  }
}
