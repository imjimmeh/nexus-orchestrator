import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { SCHEDULED_JOBS_QUEUE } from '../../automation/scheduled-jobs.constants';
import { QueueLagDeadLetterCheckService } from './queue-lag-dead-letter.check';

type QueueCounts = {
  waiting?: number;
  active?: number;
  failed?: number;
  delayed?: number;
  prioritized?: number;
};

function buildQueueMock(
  counts: QueueCounts,
  failedReasons: string[] = [],
): Queue {
  return {
    getJobCounts: vi.fn().mockResolvedValue(counts),
    getJobs: vi.fn().mockResolvedValue(
      failedReasons.map((reason, index) => ({
        id: `job-${index + 1}`,
        failedReason: reason,
      })),
    ),
  };
}

describe('QueueLagDeadLetterCheckService', () => {
  let workflowQueue: Queue;
  let scheduledQueue: Queue;

  beforeEach(() => {
    workflowQueue = buildQueueMock({
      waiting: 0,
      delayed: 0,
      prioritized: 0,
      failed: 0,
      active: 0,
    });
    scheduledQueue = buildQueueMock({
      waiting: 0,
      delayed: 0,
      prioritized: 0,
      failed: 0,
      active: 0,
    });
  });

  it('returns fail when a queue exceeds fail thresholds', async () => {
    workflowQueue = buildQueueMock(
      { waiting: 121, delayed: 0, prioritized: 0, failed: 0, active: 0 },
      ['boom'],
    );

    const service = new QueueLagDeadLetterCheckService(
      workflowQueue,
      scheduledQueue,
    );

    const result = await service.run();

    expect(result.status).toBe('fail');
    expect(result.evidence.summary).toContain('failed');
    const queue = (
      result.evidence.details.queues as Array<{ name: string; status: string }>
    ).find((item) => item.name === 'workflow-steps');
    expect(queue?.status).toBe('fail');
  });

  it('returns warn when queues exceed warn thresholds but not fail', async () => {
    scheduledQueue = buildQueueMock({
      waiting: 10,
      delayed: 0,
      prioritized: 0,
      failed: 0,
      active: 0,
    });

    const service = new QueueLagDeadLetterCheckService(
      workflowQueue,
      scheduledQueue,
    );

    const result = await service.run();

    expect(result.status).toBe('warn');
    expect(result.evidence.summary).toContain('warnings');
  });

  it('checks all expected queue names', async () => {
    const service = new QueueLagDeadLetterCheckService(
      workflowQueue,
      scheduledQueue,
    );

    const result = await service.run();
    const queueNames = (
      result.evidence.details.queues as Array<{ name: string }>
    ).map((queue) => queue.name);

    expect(queueNames).toEqual(
      expect.arrayContaining(['workflow-steps', SCHEDULED_JOBS_QUEUE]),
    );
  });
});
