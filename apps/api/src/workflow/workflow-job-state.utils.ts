import type { WorkflowRecordedResult } from './workflow-needs.types';

export async function markJobCompleted(params: {
  workflowRunId: string;
  jobId: string;
  output: Record<string, unknown>;
  result?: WorkflowRecordedResult;
  getVariable: (path: string) => Promise<unknown>;
  setVariable: (path: string, value: unknown) => Promise<unknown>;
}): Promise<void> {
  const result = params.result ?? resolveJobResultFromOutput(params.output);
  const existingOutput = await params.getVariable(
    `jobs.${params.jobId}.output`,
  );

  const mergedOutput =
    existingOutput && typeof existingOutput === 'object'
      ? {
          ...(existingOutput as Record<string, unknown>),
          ...params.output,
        }
      : params.output;

  await params.setVariable(`jobs.${params.jobId}.output`, mergedOutput);
  await params.setVariable(`jobs.${params.jobId}.result`, result);
  await params.setVariable(`_internal.job_results.${params.jobId}`, result);
  await params.setVariable(`_internal.completed_jobs.${params.jobId}`, true);
}

export async function markJobSkipped(params: {
  workflowRunId: string;
  jobId: string;
  reason: string;
  setVariable: (path: string, value: unknown) => Promise<unknown>;
}): Promise<void> {
  const output = { skipped: true, reason: params.reason };
  await params.setVariable(`jobs.${params.jobId}.output`, output);
  await params.setVariable(`jobs.${params.jobId}.result`, 'skipped');
  await params.setVariable(`_internal.job_results.${params.jobId}`, 'skipped');
  await params.setVariable(`_internal.completed_jobs.${params.jobId}`, true);
}

function resolveJobResultFromOutput(
  output: Record<string, unknown>,
): WorkflowRecordedResult {
  if (output.skipped === true) {
    return 'skipped';
  }

  if (output.ok === false || output.failed === true) {
    return 'failed';
  }

  return 'success';
}
