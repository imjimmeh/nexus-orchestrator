import { BadRequestException } from '@nestjs/common';

export async function resolveSetJobOutputContext(params: {
  agentContext: { workflowRunId: string; jobId: string } | null | undefined;
  requestedWorkflowRunId?: string;
  requestedJobId?: string;
  emitContextMismatch: (input: {
    workflowRunId: string;
    jobId: string;
    field: 'workflow_run_id' | 'job_id';
    provided: string;
    expected: string;
  }) => Promise<void>;
}): Promise<{ workflowRunId: string; jobId: string }> {
  if (params.agentContext) {
    const workflowRunId = params.agentContext.workflowRunId;
    const jobId = params.agentContext.jobId;

    if (
      params.requestedWorkflowRunId &&
      params.requestedWorkflowRunId !== workflowRunId
    ) {
      await params.emitContextMismatch({
        workflowRunId,
        jobId,
        field: 'workflow_run_id',
        provided: params.requestedWorkflowRunId,
        expected: workflowRunId,
      });
      throw new BadRequestException(
        'set_job_output workflow_run_id does not match current execution context',
      );
    }

    if (params.requestedJobId && params.requestedJobId !== jobId) {
      await params.emitContextMismatch({
        workflowRunId,
        jobId,
        field: 'job_id',
        provided: params.requestedJobId,
        expected: jobId,
      });
      throw new BadRequestException(
        'set_job_output job_id does not match current execution context',
      );
    }

    return { workflowRunId, jobId };
  }

  if (!params.requestedWorkflowRunId || !params.requestedJobId) {
    throw new BadRequestException(
      'set_job_output requires workflow_run_id and job_id context',
    );
  }

  return {
    workflowRunId: params.requestedWorkflowRunId,
    jobId: params.requestedJobId,
  };
}
