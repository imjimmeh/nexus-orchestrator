import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SCHEDULED_JOBS_QUEUE } from '../../automation/scheduled-jobs.constants';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';

interface QueueThresholds {
  warn_backlog: number;
  fail_backlog: number;
  warn_failed: number;
  fail_failed: number;
}

const QUEUE_THRESHOLDS: Record<string, QueueThresholds> = {
  'workflow-steps': {
    warn_backlog: 25,
    fail_backlog: 120,
    warn_failed: 1,
    fail_failed: 15,
  },
  [SCHEDULED_JOBS_QUEUE]: {
    warn_backlog: 10,
    fail_backlog: 40,
    warn_failed: 1,
    fail_failed: 8,
  },
};

@Injectable()
export class QueueLagDeadLetterCheckService implements DoctorCheck {
  readonly checkId = 'queue_lag_and_dead_letter_detector';

  constructor(
    @InjectQueue('workflow-steps')
    private readonly workflowStepsQueue: Queue,
    @InjectQueue(SCHEDULED_JOBS_QUEUE)
    private readonly scheduledJobsQueue: Queue,
  ) {}

  async run(): Promise<DoctorCheckResult> {
    const inspections = await Promise.all([
      this.inspectQueue('workflow-steps', this.workflowStepsQueue),
      this.inspectQueue(SCHEDULED_JOBS_QUEUE, this.scheduledJobsQueue),
    ]);

    const status = this.resolveOverallStatus(inspections.map((q) => q.status));
    const failingQueues = inspections.filter(
      (queue) => queue.status === 'fail',
    );
    const warningQueues = inspections.filter(
      (queue) => queue.status === 'warn',
    );

    let summary = 'Queue lag and dead-letter checks are healthy.';
    if (failingQueues.length > 0) {
      summary = `Queue health check failed for ${failingQueues.length.toString()} queue(s).`;
    } else if (warningQueues.length > 0) {
      summary = `Queue health check raised warnings for ${warningQueues.length.toString()} queue(s).`;
    }

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          queues: inspections,
        },
      },
    };
  }

  private async inspectQueue(
    queueName: string,
    queue: Queue,
  ): Promise<{
    name: string;
    status: DoctorCheckStatus;
    backlog_count: number;
    active_count: number;
    failed_count: number;
    delayed_count: number;
    prioritized_count: number;
    sample_failed_jobs: Array<{ id: string; reason: string | null }>;
  }> {
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'failed',
      'delayed',
      'prioritized',
    );

    const backlogCount =
      (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);

    const failedJobs = await queue.getJobs(['failed'], 0, 2);
    const sampleFailedJobs = failedJobs.map((job) => ({
      id: String(job.id),
      reason: job.failedReason ?? null,
    }));

    const thresholds = QUEUE_THRESHOLDS[queueName];
    const status = this.resolveQueueStatus({
      backlogCount,
      failedCount: counts.failed ?? 0,
      thresholds,
    });

    return {
      name: queueName,
      status,
      backlog_count: backlogCount,
      active_count: counts.active ?? 0,
      failed_count: counts.failed ?? 0,
      delayed_count: counts.delayed ?? 0,
      prioritized_count: counts.prioritized ?? 0,
      sample_failed_jobs: sampleFailedJobs,
    };
  }

  private resolveQueueStatus(params: {
    backlogCount: number;
    failedCount: number;
    thresholds: QueueThresholds;
  }): DoctorCheckStatus {
    if (
      params.backlogCount >= params.thresholds.fail_backlog ||
      params.failedCount >= params.thresholds.fail_failed
    ) {
      return 'fail';
    }

    if (
      params.backlogCount >= params.thresholds.warn_backlog ||
      params.failedCount >= params.thresholds.warn_failed
    ) {
      return 'warn';
    }

    return 'ok';
  }

  private resolveOverallStatus(
    statuses: DoctorCheckStatus[],
  ): DoctorCheckStatus {
    if (statuses.includes('fail')) {
      return 'fail';
    }

    if (statuses.includes('warn')) {
      return 'warn';
    }

    return 'ok';
  }
}
