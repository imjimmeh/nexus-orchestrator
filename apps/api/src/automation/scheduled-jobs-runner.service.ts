import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ScheduledJobRunStatus } from '@nexus/core';
import { ScheduledJob } from './database/entities/scheduled-job.entity';
import { ScheduledJobRun } from './database/entities/scheduled-job-run.entity';
import { ScheduledJobRunRepository } from './database/repositories/scheduled-job-run.repository';
import { ScheduledJobRepository } from './database/repositories/scheduled-job.repository';
import { ScheduleExpressionService } from './schedule-expression.service';
import type {
  PollDueSchedulesResult,
  ScheduledJobRunSummaryView,
} from './scheduled-jobs.types';
import { toScheduledJobRunSummary } from './scheduled-jobs.view';
import { WORKFLOW_ENGINE_SERVICE } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../workflow/kernel/interfaces/workflow-kernel.ports';

@Injectable()
export class ScheduledJobsRunnerService {
  private readonly logger = new Logger(ScheduledJobsRunnerService.name);

  constructor(
    private readonly scheduledJobRepository: ScheduledJobRepository,
    private readonly scheduledJobRunRepository: ScheduledJobRunRepository,
    private readonly scheduleExpressionService: ScheduleExpressionService,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngineService: IWorkflowEngineService,
  ) {}

  async runScheduledJobNow(
    job: ScheduledJob,
  ): Promise<ScheduledJobRunSummaryView> {
    const dueAt = new Date();
    const run = await this.scheduledJobRunRepository.create({
      scheduled_job_id: job.id,
      status: ScheduledJobRunStatus.TRIGGERED,
      due_at: dueAt,
      triggered_at: dueAt,
      started_at: null,
      finished_at: null,
      workflow_run_id: null,
      error_code: null,
      error_message: null,
      diagnostics_json: { source: 'manual' },
    });

    return this.dispatchScheduledJobRun({
      job,
      run,
      dueAt,
      source: 'manual',
    });
  }

  async processDueSchedules(params: {
    now: Date;
    batchSize: number;
  }): Promise<PollDueSchedulesResult> {
    const dueJobs = await this.scheduledJobRepository.findDueJobs({
      now: params.now,
      limit: params.batchSize,
    });

    let started = 0;
    let skipped = 0;

    for (const job of dueJobs) {
      const dispatched = await this.processDueScheduledJob(job, params.now);
      if (dispatched) {
        started++;
      } else {
        skipped++;
      }
    }

    return {
      scanned: dueJobs.length,
      started,
      skipped,
    };
  }

  private async processDueScheduledJob(
    job: ScheduledJob,
    now: Date,
  ): Promise<boolean> {
    const dueAt = job.next_run_at;
    if (!dueAt) {
      return false;
    }

    const nextRunAt =
      this.scheduleExpressionService.computeNextRunAfterExecution({
        scheduleType: job.schedule_type,
        scheduleExpression: job.schedule_expression,
        timezone: job.timezone,
        now,
        lastRunAt: dueAt,
      });

    const claimed = await this.scheduledJobRepository.advanceNextRunIfDue({
      id: job.id,
      dueAt,
      nextRunAt,
    });
    if (!claimed) {
      return false;
    }

    const run = await this.scheduledJobRunRepository.createIfNotExistsByDueKey({
      scheduled_job_id: job.id,
      status: ScheduledJobRunStatus.TRIGGERED,
      due_at: dueAt,
      triggered_at: now,
      started_at: null,
      finished_at: null,
      workflow_run_id: null,
      error_code: null,
      error_message: null,
      diagnostics_json: { source: 'poll' },
    });

    if (!run) {
      return false;
    }

    await this.dispatchScheduledJobRun({
      job,
      run,
      dueAt,
      source: 'poll',
    });
    return true;
  }

  private async dispatchScheduledJobRun(params: {
    job: ScheduledJob;
    run: ScheduledJobRun;
    dueAt: Date;
    source: 'poll' | 'manual';
  }): Promise<ScheduledJobRunSummaryView> {
    await this.scheduledJobRunRepository.update(params.run.id, {
      status: ScheduledJobRunStatus.RUNNING,
      started_at: new Date(),
    });

    try {
      const workflowRunId = await this.workflowEngineService.startWorkflow(
        params.job.execution_target_ref,
        {
          // The engine wraps this object under a top-level `trigger` key, so
          // these fields must stay flat for templates like
          // {{ trigger.scopeId }} / {{ trigger.scheduledRunId }} to resolve.
          // This matches the flat shape produced by the manual-launch path.
          event: 'scheduled.job',
          source: params.source,
          scopeId: params.job.scopeId ?? null,
          scheduledJobId: params.job.id,
          scheduledRunId: params.run.id,
          dueAt: params.dueAt.toISOString(),
          payload: params.job.payload_json,
        },
      );

      if (!workflowRunId) {
        return await this.markRunSkipped(params.run.id);
      }

      const running = await this.scheduledJobRunRepository.update(
        params.run.id,
        {
          workflow_run_id: workflowRunId,
        },
      );
      if (!running) {
        throw new NotFoundException(
          `Scheduled job run ${params.run.id} not found`,
        );
      }

      this.logger.log(
        `Scheduled job ${params.job.id} dispatched workflow run successfully`,
      );
      return toScheduledJobRunSummary(running);
    } catch (error) {
      return this.markRunFailed(params.run.id, error);
    }
  }

  private async markRunSkipped(
    runId: string,
  ): Promise<ScheduledJobRunSummaryView> {
    const skipped = await this.scheduledJobRunRepository.update(runId, {
      status: ScheduledJobRunStatus.SKIPPED,
      finished_at: new Date(),
      error_code: 'workflow_not_started',
      error_message:
        'Workflow start returned no run id (likely skipped by concurrency policy)',
    });

    if (!skipped) {
      throw new NotFoundException(`Scheduled job run ${runId} not found`);
    }

    return toScheduledJobRunSummary(skipped);
  }

  private async markRunFailed(
    runId: string,
    error: unknown,
  ): Promise<ScheduledJobRunSummaryView> {
    const message =
      error instanceof Error ? error.message : 'Unknown workflow start error';
    const failed = await this.scheduledJobRunRepository.update(runId, {
      status: ScheduledJobRunStatus.FAILED,
      finished_at: new Date(),
      error_code: 'workflow_start_failed',
      error_message: message,
    });

    if (!failed) {
      throw new NotFoundException(`Scheduled job run ${runId} not found`);
    }

    return toScheduledJobRunSummary(failed);
  }
}
