import type {
  PersistSessionCheckpoint,
  ResolveContainerContextForCheckpoint,
} from './telemetry-gateway-session-checkpoint.helpers';

export type SessionCheckpointRuntimeParams = {
  persistSessionCheckpoint?: PersistSessionCheckpoint;
  resolveContainerContext?: ResolveContainerContextForCheckpoint;
  shouldPersistSessionCheckpoint?: (params: {
    checkpointKey: string;
    eventType: string;
    workflowRunId: string;
    chatSessionId?: string;
    subagentExecutionId?: string;
  }) => boolean;
};
