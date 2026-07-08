import type {
  HarnessSessionRef,
  SessionCheckpointPhase,
  HarnessId,
} from '@nexus/core';

export interface RecordCheckpointInput {
  executionId: string;
  workflowRunId: string;
  stepId: string;
  engine: HarnessId;
  phase: SessionCheckpointPhase;
  callSeq: number;
  sessionRef?: HarnessSessionRef | null;
  resumeNodeId?: string | null;
  transcriptLocator?: string | null;
  toolName?: string | null;
  idempotencyKey?: string | null;
}
