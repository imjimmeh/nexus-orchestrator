import { Logger } from '@nestjs/common';
import type { ISessionHydrationService } from '../shared/interfaces/session-hydration.interface';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';

type PersistSessionCheckpoint = (params: {
  workflowRunId: string;
  containerId: string;
  chatSessionId?: string;
  eventType?: string;
  subagentExecutionId?: string;
}) => Promise<string | undefined>;

type ResolveContainerContextForCheckpoint = (context: {
  workflowRunId: string;
  jobId?: string;
  stepId?: string;
}) => Promise<string | null>;

type ShouldPersistSessionCheckpoint = (params: {
  checkpointKey: string;
  eventType: string;
  workflowRunId: string;
  chatSessionId?: string;
  subagentExecutionId?: string;
}) => boolean;

const DEFAULT_SESSION_CHECKPOINT_DEBOUNCE_MS = 2_000;

export function createSessionCheckpointDebouncer(params?: {
  debounceMs?: number;
  now?: () => number;
}): ShouldPersistSessionCheckpoint {
  const lastCheckpointByKey = new Map<string, number>();
  const debounceMs =
    params?.debounceMs ?? DEFAULT_SESSION_CHECKPOINT_DEBOUNCE_MS;
  const now = params?.now ?? Date.now;

  return ({ checkpointKey }) => {
    const currentTime = now();
    const lastCheckpointAt = lastCheckpointByKey.get(checkpointKey);
    if (
      typeof lastCheckpointAt === 'number' &&
      currentTime - lastCheckpointAt < debounceMs
    ) {
      return false;
    }

    lastCheckpointByKey.set(checkpointKey, currentTime);
    return true;
  };
}

function nonEmptyTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function persistSessionCheckpointImpl(
  params: Parameters<PersistSessionCheckpoint>[0],
  sessionHydration: ISessionHydrationService | undefined,
  logger: Logger,
): Promise<string | undefined> {
  const {
    workflowRunId,
    containerId,
    chatSessionId,
    eventType,
    subagentExecutionId,
  } = params;
  if (!sessionHydration) {
    return undefined;
  }

  try {
    if (typeof chatSessionId === 'string' && chatSessionId.length > 0) {
      const sessionTreeId = await sessionHydration.saveSessionForWorkflowChat(
        containerId,
        workflowRunId,
        chatSessionId,
      );
      return typeof sessionTreeId === 'string' ? sessionTreeId : undefined;
    }

    const sessionTreeId = await sessionHydration.saveSessionFromExitedContainer(
      containerId,
      workflowRunId,
    );
    return typeof sessionTreeId === 'string' ? sessionTreeId : undefined;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to checkpoint session for run ${workflowRunId} ` +
        `(event=${eventType ?? 'unknown'}, container=${containerId}, ` +
        `chatSession=${chatSessionId ?? 'none'}, ` +
        `subagentExecution=${subagentExecutionId ?? 'none'}): ` +
        errorMessage,
    );
    return undefined;
  }
}

export async function maybePersistSessionCheckpoint(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  eventType: string;
  persistSessionCheckpoint?: PersistSessionCheckpoint;
  resolveContainerContext?: ResolveContainerContextForCheckpoint;
  shouldPersistSessionCheckpoint?: ShouldPersistSessionCheckpoint;
}): Promise<string | undefined> {
  if (!params.persistSessionCheckpoint || !params.client.workflowRunId) {
    return undefined;
  }

  const containerId = await resolveCheckpointContainerId(params);
  if (!containerId) {
    return undefined;
  }

  const chatSessionId = nonEmptyTrimmed(params.client.chatSessionId);
  const subagentExecutionId = nonEmptyTrimmed(
    params.client.subagentExecutionId,
  );
  const checkpointKey = containerId;
  if (
    params.shouldPersistSessionCheckpoint &&
    !params.shouldPersistSessionCheckpoint({
      checkpointKey,
      eventType: params.eventType,
      workflowRunId: params.client.workflowRunId,
      ...(chatSessionId ? { chatSessionId } : {}),
      ...(subagentExecutionId ? { subagentExecutionId } : {}),
    })
  ) {
    return undefined;
  }

  return params.persistSessionCheckpoint({
    workflowRunId: params.client.workflowRunId,
    containerId,
    eventType: params.eventType,
    ...(chatSessionId ? { chatSessionId } : {}),
    ...(subagentExecutionId ? { subagentExecutionId } : {}),
  });
}

async function resolveCheckpointContainerId(params: {
  client: AuthenticatedSocket;
  resolveContainerContext?: ResolveContainerContextForCheckpoint;
}): Promise<string | undefined> {
  const directContainerId = nonEmptyTrimmed(params.client.containerId);
  if (directContainerId) {
    return directContainerId;
  }

  if (!params.resolveContainerContext || !params.client.workflowRunId) {
    return undefined;
  }

  const resolvedContainerId = await params.resolveContainerContext({
    workflowRunId: params.client.workflowRunId,
    jobId: nonEmptyTrimmed(params.client.jobId),
    stepId: nonEmptyTrimmed(params.client.stepId),
  });
  const normalizedResolvedContainerId = nonEmptyTrimmed(resolvedContainerId);
  if (!normalizedResolvedContainerId) {
    return undefined;
  }

  params.client.containerId = normalizedResolvedContainerId;
  return normalizedResolvedContainerId;
}

export type {
  PersistSessionCheckpoint,
  ResolveContainerContextForCheckpoint,
  ShouldPersistSessionCheckpoint,
};
