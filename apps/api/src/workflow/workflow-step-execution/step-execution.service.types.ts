import type { IJob, IJobStep } from '@nexus/core';

export interface StepExecutionResult {
  status: 'completed' | 'failed';
  finalStepId?: string;
  outputs: Record<string, Record<string, unknown>>;
}

export interface StepExecutionContext {
  workflowRunId: string;
  jobId: string;
  job: IJob;
  stateVariables: Record<string, unknown>;
  executeStep: (step: IJobStep) => Promise<Record<string, unknown>>;
}
