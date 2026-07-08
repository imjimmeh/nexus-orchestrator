import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import type { Job, Queue } from 'bullmq';
import { ExecutionRepository } from '../execution-lifecycle/database/repositories/execution.repository';
import type { WorkflowRun } from '../workflow/database/entities/workflow-run.entity';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRecoveryDiagnostics } from './workflow-recovery-candidates.types';

const DEFAULT_STALE_RUNNING_MINUTES = 3;
const DEFAULT_STALE_PENDING_MINUTES = 10;

@Injectable()
export class WorkflowRecoveryCandidatesService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly executionRepository: ExecutionRepository,
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
  ) {}

  async inspect(params?: {
    staleRunningMinutes?: number;
    stalePendingMinutes?: number;
  }): Promise<WorkflowRecoveryDiagnostics> {
    const staleRunningMinutes = this.normalizeMinutes(
      params?.staleRunningMinutes,
      DEFAULT_STALE_RUNNING_MINUTES,
    );
    const stalePendingMinutes = this.normalizeMinutes(
      params?.stalePendingMinutes,
      DEFAULT_STALE_PENDING_MINUTES,
    );

    const [runningRuns, pendingRuns, liveRunIds, expiredOwnerLeases] =
      await Promise.all([
        this.workflowRunRepository.findByStatus(WorkflowStatus.RUNNING),
        this.workflowRunRepository.findByStatus(WorkflowStatus.PENDING),
        this.collectLiveRunIds(),
        this.executionRepository.findExpiredOwnerLeases(new Date()),
      ]);

    const staleRunningRunIds = runningRuns
      .filter((run) =>
        this.isOlderThanMinutes(run.updated_at, staleRunningMinutes),
      )
      .filter((run) => !liveRunIds.has(run.id))
      .map((run) => run.id);

    const recoverablePendingRunIds = pendingRuns
      .filter((run) => this.isRecoverablePendingRun(run, stalePendingMinutes))
      .filter((run) => !liveRunIds.has(run.id))
      .map((run) => run.id);

    return {
      running_count: runningRuns.length,
      pending_count: pendingRuns.length,
      live_queue_run_count: liveRunIds.size,
      stale_running_run_ids: staleRunningRunIds,
      recoverable_pending_run_ids: recoverablePendingRunIds,
      expired_owner_lease_execution_ids: expiredOwnerLeases.map(
        (execution) => execution.id,
      ),
    };
  }

  private async collectLiveRunIds(): Promise<Set<string>> {
    const liveJobs = await this.stepQueue.getJobs(
      ['active', 'waiting', 'delayed', 'prioritized'],
      0,
      999,
    );

    const runIds = new Set<string>();
    for (const job of liveJobs) {
      const workflowRunId = this.extractWorkflowRunId(job);
      if (workflowRunId) {
        runIds.add(workflowRunId);
      }
    }

    return runIds;
  }

  private extractWorkflowRunId(job: Job): string | null {
    if (!job.data || typeof job.data !== 'object') {
      return null;
    }

    const record = job.data as Record<string, unknown>;
    return typeof record.workflowRunId === 'string'
      ? record.workflowRunId
      : null;
  }

  private isRecoverablePendingRun(
    run: WorkflowRun,
    stalePendingMinutes: number,
  ): boolean {
    if (!this.isOlderThanMinutes(run.updated_at, stalePendingMinutes)) {
      return false;
    }

    if (!run.current_step_id || run.current_step_id.length === 0) {
      return false;
    }

    if (run.concurrency_scope) {
      return false;
    }

    const trigger = this.readTrigger(run);
    return typeof trigger?.orchestrationId === 'string';
  }

  private readTrigger(run: WorkflowRun): Record<string, unknown> | null {
    const state = run.state_variables;
    if (!state || typeof state !== 'object') {
      return null;
    }

    const trigger = state.trigger;
    if (!trigger || typeof trigger !== 'object') {
      return null;
    }

    return trigger as Record<string, unknown>;
  }

  private isOlderThanMinutes(
    date: Date | undefined,
    thresholdMinutes: number,
  ): boolean {
    const timestamp = date?.getTime();
    if (!timestamp) {
      return false;
    }

    return Date.now() - timestamp >= thresholdMinutes * 60_000;
  }

  private normalizeMinutes(
    value: number | undefined,
    fallback: number,
  ): number {
    if (value === undefined) {
      return fallback;
    }

    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }
}
