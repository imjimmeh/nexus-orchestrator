import {
  WorkflowDryRunJobOutputResolver,
  WorkflowDryRunResult,
} from '../workflow-engine.types';

export interface WorkflowTestHarnessResult extends WorkflowDryRunResult {
  triggerData: Record<string, unknown>;
  initialState: Record<string, unknown>;
}

export type WorkflowTestStepCallback = WorkflowDryRunJobOutputResolver;

export interface WorkflowDryRunExpectation {
  includesJobs?: string[];
  excludesJobs?: string[];
  jobConditions?: Record<string, boolean>;
  resolvedInputs?: Record<string, Record<string, unknown>>;
  outputs?: Record<string, Record<string, unknown>>;
}
