import type { HarnessSessionRef } from '@nexus/core';

export interface CancelledSubagentExecution {
  executionId: string;
  sessionTreeId?: string;
  agentProfileName?: string;
  contractId?: string;
}

export interface InterruptionRecoveryResult {
  cancelledSubagentExecutions: CancelledSubagentExecution[];
  parentResume?: {
    resumeSessionTreeId: string;
    resumeSessionRef: HarnessSessionRef;
  };
}

export interface PrepareRecoveryInput {
  workflowRunId: string;
  jobId: string;
  parentContainerIds: Set<string>;
  source: 'stale-run-watchdog' | 'supervisor-reap';
  sidecarSessionJsonl?: string | null;
  containerTier?: number;
  parentExecutionId?: string;
}
