import { WorkflowStatus } from '@nexus/core';

export const WORKFLOW_RUN_STATUS_CHANGED_EVENT = 'workflow.run.status-changed';

export interface WorkflowRunStatusChangedPayload {
  workflowRunId: string;
  status: WorkflowStatus;
  stateVariables: Record<string, unknown>;
}

export interface TriggerDedupeContext {
  event: string;
  scopeId: string;
  contextId: string;
  status: string;
}

export interface WorkflowDryRunResult {
  dryRun: true;
  workflowId: string;
  workflowName: string;
  executionPath: string[];
  parallelGroups: string[][];
  stateTransitions: string[];
  mockJobsApplied: string[];
  jobSimulations: WorkflowDryRunJobSimulation[];
}

export interface WorkflowDryRunJobResolverContext {
  workflowId: string;
  workflowName: string;
  jobId: string;
  jobType: string;
  resolvedInputs: Record<string, unknown>;
  triggerData: Record<string, unknown>;
  jobOutputs: Record<string, Record<string, unknown>>;
}

export type WorkflowDryRunJobOutputResolver = (
  context: WorkflowDryRunJobResolverContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface WorkflowDryRunJobSimulation {
  jobId: string;
  jobType: string;
  conditionMet: boolean;
  resolvedInputs: Record<string, unknown>;
  forEachResolvedInputs?: Record<string, unknown>[];
  output: Record<string, unknown>;
  outputSource: 'resolver' | 'mock' | 'default';
}

export interface StartWorkflowOptions {
  dryRun?: boolean;
  mockJobOutputs?: Record<string, Record<string, unknown>>;
  mockJobOutputResolvers?: Record<string, WorkflowDryRunJobOutputResolver>;
}
