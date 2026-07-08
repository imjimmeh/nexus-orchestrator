import type { WorkflowDependencyResult } from '@nexus/core';

export type WorkflowRecordedResult =
  | 'success'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type WorkflowNeedResultPolicy = WorkflowDependencyResult;

export type WorkflowNeedScope = 'job' | 'step';

export interface NormalizedWorkflowNeed {
  readonly id: string;
  readonly scope: WorkflowNeedScope;
  readonly requiredResult: WorkflowNeedResultPolicy;
  readonly optional: boolean;
}

export interface WorkflowNeedsContextEntry {
  readonly result: WorkflowRecordedResult;
  readonly output?: Record<string, unknown>;
}

export type WorkflowNeedsContext = Record<string, WorkflowNeedsContextEntry>;
