import type { Job, Queue } from 'bullmq';

export async function fetchQueueJobsForRun(params: {
  stepQueue: Queue;
  workflowRunId: string;
  queueScanLimit: number;
}): Promise<Job[]> {
  const states: Parameters<Queue['getJobs']>[0] = [
    'active',
    'waiting',
    'delayed',
    'prioritized',
    'failed',
  ];
  const allJobs = await Promise.all(
    states.map((state) =>
      params.stepQueue.getJobs([state], 0, params.queueScanLimit - 1),
    ),
  );

  return allJobs.flatMap((jobs) =>
    jobs.filter(
      (job) => extractWorkflowRunId(job.data) === params.workflowRunId,
    ),
  );
}

function extractWorkflowRunId(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const workflowRunId = record.workflowRunId;
  return typeof workflowRunId === 'string' && workflowRunId.length > 0
    ? workflowRunId
    : null;
}
