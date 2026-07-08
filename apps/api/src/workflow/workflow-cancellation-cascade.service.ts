import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowContainerCleanupService } from './workflow-container-cleanup.service';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import { WORKFLOW_RUN_CANCELLED_EVENT } from './workflow-events.constants';
import type { WorkflowRunEvent } from './workflow-events.types';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowCancellationCascadeService,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';

/**
 * Single-purpose cascade cancellation seam extracted from
 * `WorkflowEngineService`.
 *
 * Walks the run plus any active child runs via an iterative BFS so the
 * visited-set lives on the heap (one allocation per `cancelRun` call) rather
 * than threading through a recursive helper signature. Behaviour is
 * byte-for-byte equivalent to the engine's prior
 * `cancelWorkflowRunWithCascade`:
 *
 * - terminal-status short-circuit (CANCELLED / COMPLETED / FAILED);
 * - container kill via `WorkflowContainerCleanupService.stopManagedContainersForRun`;
 * - status update via `WorkflowPersistenceService.updateRunStatus`;
 * - `WORKFLOW_RUN_CANCELLED_EVENT` emission with the same
 *   `WorkflowRunEvent` payload shape;
 * - `WorkflowRunJobExecutionService.removeQueuedJobsForRun` queue purge.
 *
 * The optional child-discovery path is reserved for module wiring where
 * the workflow run repository port is not provided (the original engine declared
 * it `@Optional()`). When present, child-discovery failures are logged at
 * `warn` and absorbed so a single broken parent chain entry cannot abort
 * an otherwise healthy cascade.
 */
@Injectable()
export class WorkflowCancellationCascadeService implements IWorkflowCancellationCascadeService {
  private readonly logger = new Logger(WorkflowCancellationCascadeService.name);

  constructor(
    private readonly persistence: WorkflowPersistenceService,
    private readonly containerCleanup: WorkflowContainerCleanupService,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository?: IWorkflowRunRepository,
  ) {}

  /**
   * Public cascade entrypoint. Iterative BFS with a method-local visited
   * set — no recursive helpers are exposed.
   *
   * Each iteration short-circuits on:
   * - already-visited nodes (loops in the cascade graph are safe);
   * - load failures on the persisted run row (warn + skip);
   * - rows that resolve to `null` mid-traversal — a child run may have
   *   been GC'd or migrated between `findActiveChildRunsForParentRun`
   *   and our visit, and the cascade must not abort siblings because of
   *   it.
   */
  async cancelRun(runId: string, reason: string): Promise<void> {
    const visited = new Set<string>();
    const queue: string[] = [runId];

    while (queue.length > 0) {
      const nextId = queue.shift() as string;
      if (visited.has(nextId)) {
        continue;
      }
      visited.add(nextId);

      const cancelled = await this.cancelSingleRun(nextId, reason);
      if (!cancelled) {
        // Node could not be loaded (persistence error or null/missing
        // row). Do not descend into its children — there is no parent
        // context to walk from — but keep iterating siblings.
        continue;
      }

      const childIds = await this.discoverActiveChildRunIds(nextId);
      for (const childId of childIds) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  /**
   * Loads the run, short-circuits on terminal status, then executes the
   * single-node cancellation contract: kill containers, flip status to
   * CANCELLED, emit the cancelled event, then purge queued jobs.
   *
   * Returns `true` when the node was cancelled and the caller should
   * descend into its descendants, `false` when the node was skipped
   * (terminal status, missing row, or persistence failure) so the
   * caller must NOT discover children from it.
   */
  private async cancelSingleRun(
    runId: string,
    reason: string,
  ): Promise<boolean> {
    let run: Awaited<ReturnType<typeof this.persistence.getWorkflowRun>>;
    try {
      run = await this.persistence.getWorkflowRun(runId);
    } catch (error) {
      this.logger.warn(
        `Failed to load workflow run ${runId} during cascade: ${(error as Error).message}`,
      );
      return false;
    }

    if (!run) {
      this.logger.warn(
        `Skipping cascade node ${runId}: persistence resolved to null mid-traversal`,
      );
      return false;
    }

    if (
      run.status === WorkflowStatus.CANCELLED ||
      run.status === WorkflowStatus.COMPLETED ||
      run.status === WorkflowStatus.FAILED
    ) {
      return false;
    }

    await this.containerCleanup.stopManagedContainersForRun(runId);

    const cancelledRun = await this.persistence.updateRunStatus(
      runId,
      WorkflowStatus.CANCELLED,
    );
    const event: WorkflowRunEvent = {
      workflowRunId: runId,
      workflowId: run.workflow_id,
      status: WorkflowStatus.CANCELLED,
      stateVariables: cancelledRun.state_variables,
      reason,
    };
    this.eventEmitter.emit(WORKFLOW_RUN_CANCELLED_EVENT, event);

    await this.runExecution.removeQueuedJobsForRun(runId);

    this.logger.log(`Cancelled workflow run ${runId} (${reason})`);
    return true;
  }

  /**
   * Resolves the active child runs of `parentRunId` via the repository.
   * Returns an empty list when the repository is not wired (`@Optional()`)
   * so the parent can still cancel cleanly. Repository failures are logged
   * at `warn` and absorbed so siblings are not aborted.
   */
  private async discoverActiveChildRunIds(
    parentRunId: string,
  ): Promise<string[]> {
    if (!this.workflowRunRepository) {
      return [];
    }

    try {
      const children =
        await this.workflowRunRepository.findActiveChildRunsForParentRun(
          parentRunId,
        );
      return children.map((child) => child.id);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve active child runs for ${parentRunId}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
