import { IJob, IWorkflowDefinition } from '@nexus/core';
import { markJobSkipped } from './workflow-job-state.utils';
import {
  areDependencyJobsTerminal,
  resolveStrictDependencies,
} from './workflow-run-job-execution.utils';

export async function skipStrictJobWhenDependencyResultsBlock(params: {
  workflowRunId: string;
  definition: IWorkflowDefinition;
  job: IJob;
  getVariable: (path: string) => Promise<unknown>;
  setVariable: (path: string, value: unknown) => Promise<unknown>;
}): Promise<void> {
  if (!resolveStrictDependencies(params.definition, params.job)) {
    return;
  }

  const dependencyJobsTerminal = await areDependencyJobsTerminal({
    job: params.job,
    getVariable: params.getVariable,
  });
  if (!dependencyJobsTerminal) {
    return;
  }

  await markJobSkipped({
    workflowRunId: params.workflowRunId,
    jobId: params.job.id,
    reason: 'needs_not_satisfied',
    setVariable: params.setVariable,
  });
}
