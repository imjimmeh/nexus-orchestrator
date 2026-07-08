import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { Queue } from 'bullmq';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ServiceLifecycleStateService } from '../../execution-lifecycle/service-lifecycle-state.service';
import { SubagentContainerLivenessProbe } from '../../execution-lifecycle/subagent-container-liveness.probe';
import type { ContainerLivenessProbe } from '../../execution-lifecycle/execution-supervisor.service';
import { ShutdownStateService } from '../../shutdown/shutdown-state.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { isUnactivatablePendingReason } from '../workflow-run-job-execution.utils';
import { UserQuestionAwaitRepository } from '../database/repositories/user-question-await.repository';
import { InterruptionRecoveryService } from '../workflow-interruption-recovery/interruption-recovery.service';
import {
  immuniseRunsWithLiveChild,
  immuniseRunsWithLiveStepContainer,
  indexParentExecution,
  resolveStalledJobIds,
} from './stalled-job-resolution.helpers';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';

const FAILED_SCAN_LIMIT = 500;
const LIVE_SCAN_LIMIT = 1000;
export const DEFAULT_STALE_RUN_GRACE_MS = 5 * 60 * 1000; // 5 minutes

export function resolveStaleRunGraceMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_STALE_RUN_GRACE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_STALE_RUN_GRACE_MS;
  }
  return parsed;
}

const STALE_RUN_GRACE_MS = resolveStaleRunGraceMs(
  process.env.WORKFLOW_STALE_RUN_GRACE_MS,
);

const STALE_RUN_REASON =
  'Run stalled: RUNNING with no active or queued step job (stale-run watchdog)';

const UNACTIVATABLE_PENDING_RUN_REASON =
  'Queued run can never activate: no running scope owner and workflow missing or concurrency policy no longer queues (pending-run watchdog)';

const RECONCILE_INTERVAL_MS = 30_000;
const MAX_PROCESSED_KEYS = 1000;

@Injectable()
export class WorkflowRunReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowRunReconciliationService.name);
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private reconciliationInFlight = false;
  private readonly processedFailedJobKeys = new Set<string>();

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly executionRepo: ExecutionRepository,
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
    private readonly interruptionRecovery: InterruptionRecoveryService,
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly shutdownState: ShutdownStateService,
    @Inject(SubagentContainerLivenessProbe)
    private readonly containerLiveness: ContainerLivenessProbe,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileNow('startup');

    this.reconciliationTimer = setInterval(() => {
      void this.reconcileNow('interval');
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  private isOlderThanGrace(updatedAt: Date | undefined, now: number): boolean {
    const timestamp = updatedAt?.getTime();
    if (!timestamp) {
      return false;
    }
    return now - timestamp >= STALE_RUN_GRACE_MS;
  }

  async reconcileNow(source: 'startup' | 'interval' | 'manual'): Promise<void> {
    if (this.reconciliationInFlight) {
      return;
    }
    if (this.lifecycle.isReapingSuspended()) {
      return;
    }
    if (this.shutdownState.isShuttingDown()) {
      this.logger.log('Skipping reconcile: API is shutting down');
      return;
    }

    this.reconciliationInFlight = true;
    try {
      const [runningRuns, liveJobs, failedJobs] = await Promise.all([
        this.runRepo.findByStatus(WorkflowStatus.RUNNING),
        this.stepQueue.getJobs(
          ['active', 'waiting', 'delayed', 'prioritized'],
          0,
          LIVE_SCAN_LIMIT - 1,
        ),
        this.stepQueue.getJobs(['failed'], 0, FAILED_SCAN_LIMIT - 1),
      ]);
      const liveRunIds = this.runIdsFromJobs(liveJobs);
      const failedRunIds = this.runIdsFromJobs(failedJobs);
      await this.reconcileFailedQueueJobs(
        source,
        runningRuns,
        liveRunIds,
        failedJobs,
      );
      await this.reconcileOrphanedPendingRuns(source);
      await this.reconcileStaleRunningRuns(
        source,
        runningRuns,
        liveRunIds,
        failedRunIds,
      );
    } catch (error) {
      this.logger.error(
        `Workflow run reconciliation failed (${source}): ${(error as Error).message}`,
      );
    } finally {
      this.reconciliationInFlight = false;
    }
  }

  private async reconcileFailedQueueJobs(
    source: string,
    runningRuns: WorkflowRun[],
    liveRunIds: Set<string>,
    failedJobs: Array<{ id?: string; data: unknown; failedReason?: string }>,
  ): Promise<void> {
    if (runningRuns.length === 0) {
      return;
    }

    // Runs parked for any reason (user input or a dependency wait) are
    // intentionally idle, not stalled — never repair them from a
    // failed/stalled queue job (that would re-enqueue the job and kill the
    // container blocked on ask_user_questions or its dependency).
    const runningRunIds = new Set(
      runningRuns
        .filter((run) => !run.awaiting_input && !run.wait_reason)
        .map((run) => run.id),
    );
    const fallbackJobByRun = new Map(
      runningRuns.map((run) => [
        run.id,
        this.resolveRunJobId(run.current_step_id),
      ]),
    );

    let repairedCount = 0;
    for (const failedJob of failedJobs) {
      const context = this.extractQueueJobContext(failedJob.data);
      if (!context || !runningRunIds.has(context.workflowRunId)) {
        continue;
      }

      // A live job means the in-band onFailed handler already scheduled a retry
      // (or the next step). Re-handling here double-counts the auto-retry attempt
      // and gets the real retry dropped as "stale". Only reconcile genuinely
      // unhandled failures (no live job, e.g. the process died before onFailed).
      if (liveRunIds.has(context.workflowRunId)) {
        continue;
      }

      const jobId =
        context.jobId ?? fallbackJobByRun.get(context.workflowRunId);
      if (!jobId) {
        continue;
      }
      const failedReason =
        failedJob.failedReason ??
        'Workflow queue job failed before run status was updated';

      const dedupeKey = this.computeFailedJobKey(
        failedJob,
        context.workflowRunId,
        jobId,
        failedReason,
      );
      if (this.processedFailedJobKeys.has(dedupeKey)) {
        continue;
      }

      await this.runExecution.handleJobFailed(
        context.workflowRunId,
        jobId,
        failedReason,
      );
      this.trackProcessedKey(dedupeKey);
      repairedCount += 1;
    }

    if (repairedCount > 0) {
      this.logger.warn(
        `Reconciled ${repairedCount.toString()} failed queue job(s) into workflow run failures (${source})`,
      );
    }
  }

  private async reconcileStaleRunningRuns(
    source: string,
    runningRuns: WorkflowRun[],
    liveRunIds: Set<string>,
    failedRunIds: Set<string>,
  ): Promise<void> {
    const now = Date.now();
    const {
      activeRunIds: activeExecutionRunIds,
      parentContainerIdsByRunId,
      parentExecutionIdsByRunId,
    } = await this.findNonTerminalExecutionIndex(now);
    const runsWithOpenQuestions =
      await this.questionAwaitRepo.findRunIdsWithOpenQuestions();
    let recoveredCount = 0;

    for (const run of runningRuns) {
      // Runs parked for any reason (awaiting input or a dependency wait) are
      // intentionally idle; live runs are already progressing; runs with a
      // failed queue job are owned by reconcileFailedQueueJobs; runs inside the
      // grace window may just be slow.
      if (
        run.awaiting_input ||
        run.wait_reason ||
        liveRunIds.has(run.id) ||
        failedRunIds.has(run.id) ||
        runsWithOpenQuestions.has(run.id)
      ) {
        continue;
      }
      if (!this.isOlderThanGrace(run.updated_at, now)) {
        continue;
      }
      // Fire-and-poll dispatch keeps no queue job while the agent works, so a
      // run with an actively heartbeating execution record is healthy even
      // when its own row looks stale.
      if (activeExecutionRunIds.has(run.id)) {
        continue;
      }

      const anyRecovered = await this.recoverStaleRun(
        run,
        parentContainerIdsByRunId,
        parentExecutionIdsByRunId,
        source,
      );
      if (anyRecovered) {
        recoveredCount += 1;
      }
    }

    if (recoveredCount > 0) {
      this.logger.warn(
        `Recovered ${recoveredCount.toString()} stale RUNNING run(s) with no active queue job (${source})`,
      );
    }
  }

  /**
   * Returns the workflow run ids that have a non-terminal execution whose most
   * recent activity (heartbeat, transition, or creation) is inside the grace
   * window, plus a map of each run's non-terminal `workflow_step` container
   * ids so a stale run's in-flight subagents can be cancelled before retry.
   * Legacy rows stuck without activity never immunise a run.
   */
  private async findNonTerminalExecutionIndex(now: number): Promise<{
    activeRunIds: Set<string>;
    parentContainerIdsByRunId: Map<string, Set<string>>;
    parentExecutionIdsByRunId: Map<string, Set<string>>;
  }> {
    const activeRunIds = new Set<string>();
    const parentContainerIdsByRunId = new Map<string, Set<string>>();
    const parentExecutionIdsByRunId = new Map<string, Set<string>>();
    let executions: ExecutionEntity[];
    try {
      executions = await this.executionRepo.findNonTerminal();
    } catch (error) {
      this.logger.warn(
        `Could not load non-terminal executions for stale-run reconciliation: ${(error as Error).message}`,
      );
      return {
        activeRunIds,
        parentContainerIdsByRunId,
        parentExecutionIdsByRunId,
      };
    }

    // Stale-heartbeat workflow_step executions that still hold a container —
    // probed for liveness below (see immuniseRunsWithLiveStepContainer).
    const livenessProbeCandidates: ExecutionEntity[] = [];

    for (const execution of executions) {
      if (!execution.workflow_run_id) {
        continue;
      }
      const runId = execution.workflow_run_id;
      if (execution.kind === 'workflow_step') {
        indexParentExecution(
          execution,
          runId,
          parentContainerIdsByRunId,
          parentExecutionIdsByRunId,
        );
      }
      if (execution.frozen) {
        activeRunIds.add(runId);
        continue;
      }
      const lastActivity =
        execution.last_heartbeat_at ??
        execution.updated_at ??
        execution.created_at;
      if (!this.isOlderThanGrace(lastActivity, now)) {
        activeRunIds.add(runId);
      } else if (execution.kind === 'workflow_step' && execution.container_id) {
        livenessProbeCandidates.push(execution);
      }
    }

    // Structural watchdog immunity: a run whose workflow_step has a live child
    // subagent is considered active regardless of heartbeat age.
    immuniseRunsWithLiveChild(
      executions,
      parentContainerIdsByRunId,
      activeRunIds,
    );

    // Container-liveness immunity: mirror the supervisor's treatment of
    // workflow_step executions (which never heartbeat through the telemetry
    // gateway). A stale-but-alive step container is healthy work in progress,
    // not a stall — defer genuine container loss to the supervisor's debounced
    // container_lost reaper rather than killing it here.
    await immuniseRunsWithLiveStepContainer(
      livenessProbeCandidates,
      activeRunIds,
      this.containerLiveness,
      this.logger.warn.bind(this.logger),
    );

    return {
      activeRunIds,
      parentContainerIdsByRunId,
      parentExecutionIdsByRunId,
    };
  }

  private async recoverStaleRun(
    run: WorkflowRun,
    parentContainerIdsByRunId: Map<string, Set<string>>,
    parentExecutionIdsByRunId: Map<string, Set<string>>,
    source: string,
  ): Promise<boolean> {
    const stalledJobIds = resolveStalledJobIds(run);
    if (stalledJobIds.length === 0) {
      this.logger.warn(
        `Stale RUNNING run ${run.id} has no resolvable stalled job; cannot recover automatically (${source})`,
      );
      return false;
    }

    const parentContainerIds =
      parentContainerIdsByRunId.get(run.id) ?? new Set<string>();
    const parentExecutionIds =
      parentExecutionIdsByRunId.get(run.id) ?? new Set<string>();
    const parentExecutionId = parentExecutionIds.values().next().value;
    const parentJobId = stalledJobIds[0];

    const recovery = await this.interruptionRecovery.prepareRecovery({
      workflowRunId: run.id,
      jobId: parentJobId,
      parentContainerIds,
      source: 'stale-run-watchdog',
      parentExecutionId,
    });

    let anyRecovered = false;
    for (const jobId of stalledJobIds) {
      try {
        await this.runExecution.handleJobFailed(
          run.id,
          jobId,
          STALE_RUN_REASON,
          recovery.parentResume,
        );
        anyRecovered = true;
      } catch (error) {
        this.logger.error(
          `Failed to recover stale RUNNING run ${run.id} job ${jobId} (${source}): ${(error as Error).message}`,
        );
      }
    }
    return anyRecovered;
  }

  private runIdsFromJobs(
    jobs: Array<{ data: unknown }> | undefined,
  ): Set<string> {
    const runIds = new Set<string>();
    for (const job of jobs ?? []) {
      const context = this.extractQueueJobContext(job.data);
      if (context) {
        runIds.add(context.workflowRunId);
      }
    }
    return runIds;
  }

  private async reconcileOrphanedPendingRuns(source: string): Promise<void> {
    const pendingRuns = await this.runRepo.findByStatus(WorkflowStatus.PENDING);
    if (pendingRuns.length === 0) {
      return;
    }

    const now = Date.now();
    const processedScopes = new Set<string>();
    let activatedCount = 0;
    let cancelledCount = 0;
    for (const run of pendingRuns) {
      const workflowId = run.workflow_id;
      const concurrencyScope = run.concurrency_scope;
      if (!workflowId || !concurrencyScope) {
        continue;
      }

      const scopeKey = `${workflowId}:${concurrencyScope}`;
      if (processedScopes.has(scopeKey)) {
        continue;
      }
      processedScopes.add(scopeKey);

      const runningRun = await this.runRepo.findOldestRunningByScope(
        workflowId,
        concurrencyScope,
      );
      if (runningRun) {
        // A live owner still holds the scope; the queue is legitimately waiting.
        continue;
      }

      const outcome = await this.runExecution.activateQueuedRun(
        workflowId,
        concurrencyScope,
      );
      if (outcome.activated) {
        activatedCount += 1;
        continue;
      }

      // No live owner AND activation will never succeed (workflow gone or the
      // concurrency policy no longer queues) → the whole scope's queue is dead.
      // Cancel it instead of re-attempting activation every cycle forever.
      if (isUnactivatablePendingReason(outcome.reason)) {
        cancelledCount += await this.cancelUnactivatableScope(
          pendingRuns,
          workflowId,
          concurrencyScope,
          outcome.reason,
          now,
        );
      }
    }

    if (activatedCount > 0) {
      this.logger.warn(
        `Activated ${activatedCount.toString()} orphaned pending workflow run queue(s) with no running scope owner (${source})`,
      );
    }
    if (cancelledCount > 0) {
      this.logger.warn(
        `Cancelled ${cancelledCount.toString()} unactivatable pending workflow run(s) with no running scope owner (${source})`,
      );
    }
  }

  private async cancelUnactivatableScope(
    pendingRuns: WorkflowRun[],
    workflowId: string,
    concurrencyScope: string,
    reason: string,
    now: number,
  ): Promise<number> {
    let cancelled = 0;
    for (const run of pendingRuns) {
      if (
        run.workflow_id !== workflowId ||
        run.concurrency_scope !== concurrencyScope
      ) {
        continue;
      }
      // Only terminate runs that have been queued past the grace window, so a
      // run created moments ago (and about to be activated) is never reaped.
      if (!this.isOlderThanGrace(run.updated_at, now)) {
        continue;
      }

      try {
        await this.runExecution.cancelUnactivatablePendingRun(
          run.id,
          `${UNACTIVATABLE_PENDING_RUN_REASON} (${reason})`,
        );
        cancelled += 1;
      } catch (error) {
        this.logger.error(
          `Failed to cancel unactivatable pending run ${run.id}: ${(error as Error).message}`,
        );
      }
    }
    return cancelled;
  }

  private extractQueueJobContext(data: unknown): {
    workflowRunId: string;
    jobId?: string;
  } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const record = data as Record<string, unknown>;
    if (typeof record.workflowRunId !== 'string') {
      return null;
    }

    return {
      workflowRunId: record.workflowRunId,
      jobId: typeof record.jobId === 'string' ? record.jobId : undefined,
    };
  }

  private resolveRunJobId(currentStepId: string | undefined): string {
    return currentStepId && currentStepId.length > 0
      ? currentStepId
      : 'unknown_job';
  }

  private computeFailedJobKey(
    failedJob: { id?: string },
    workflowRunId: string,
    jobId: string,
    failedReason: string,
  ): string {
    if (failedJob.id) {
      return failedJob.id;
    }
    return `${workflowRunId}:${jobId}:${failedReason}`;
  }

  private trackProcessedKey(key: string): void {
    if (this.processedFailedJobKeys.has(key)) {
      return;
    }
    this.processedFailedJobKeys.add(key);
    if (this.processedFailedJobKeys.size > MAX_PROCESSED_KEYS) {
      for (const oldest of this.processedFailedJobKeys) {
        this.processedFailedJobKeys.delete(oldest);
        break;
      }
    }
  }
}
