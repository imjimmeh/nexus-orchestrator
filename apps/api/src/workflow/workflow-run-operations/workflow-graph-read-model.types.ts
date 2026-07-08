import type { WorkflowStatus } from '@nexus/core';

export interface RuntimeContext {
  runStatus: WorkflowStatus | null;
  currentJobId: string | null;
  completedJobs: Set<string>;
  queuedJobs: Set<string>;
  failedJobs: Set<string>;
  hasOutstandingQuestion: boolean;
}

export interface StatusBuckets {
  activeNodeIds: string[];
  queuedNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
}
