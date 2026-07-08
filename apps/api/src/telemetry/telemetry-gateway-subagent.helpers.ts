import { ConflictException } from '@nestjs/common';
import type { SubagentOrchestratorService } from '../workflow/workflow-subagents/subagent-orchestrator.service';
import { mergeSdkNativeToolsForSubagent } from '../workflow/workflow-subagents/subagent-tool-merge.helpers';
import type { WorkflowRuntimeTerminalRunGuardService } from '../workflow/workflow-runtime/workflow-runtime-terminal-run-guard.service';
import type {
  AuthenticatedSocket,
  CheckSubagentStatusPayload,
  SpawnSubagentAsyncPayload,
  WaitForSubagentsPayload,
} from './types';

type SubagentOrchestratorLike = Pick<
  SubagentOrchestratorService,
  'spawn' | 'waitForSubagents' | 'checkStatus'
>;
type TerminalRunGuardLike = Pick<
  WorkflowRuntimeTerminalRunGuardService,
  'assertRunIsActive'
>;

type ResolveContainerContext = (context: {
  workflowRunId: string;
  jobId?: string;
  stepId?: string;
}) => Promise<string | null>;

function emitCommandError(
  client: AuthenticatedSocket,
  type: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {
    type,
    success: false,
    error: (error as Error).message,
  };

  if (metadata) {
    Object.assign(payload, metadata);
  }

  client.emit('command', payload);
}

async function ensureSubagentCommandContext(params: {
  client: AuthenticatedSocket;
  resultType: string;
  resolveContainerContext?: ResolveContainerContext;
}): Promise<{ workflowRunId: string; containerId: string } | null> {
  const { client, resultType, resolveContainerContext } = params;

  if (client.role !== 'agent') {
    emitCommandError(
      client,
      resultType,
      new Error('subagent orchestration commands require an agent socket'),
    );
    return null;
  }

  if (!client.workflowRunId) {
    emitCommandError(
      client,
      resultType,
      new Error('missing workflow run context for subagent command'),
    );
    return null;
  }

  if (!client.containerId && resolveContainerContext) {
    const resolvedContainerId = await resolveContainerContext({
      workflowRunId: client.workflowRunId,
      jobId: client.jobId,
      stepId: client.stepId,
    });

    if (resolvedContainerId) {
      client.containerId = resolvedContainerId;
    }
  }

  if (!client.containerId) {
    emitCommandError(
      client,
      resultType,
      new Error(
        'missing container context for subagent command; this session cannot spawn subagents',
      ),
    );
    return null;
  }

  return {
    workflowRunId: client.workflowRunId,
    containerId: client.containerId,
  };
}

export async function handleSpawnSubagentAsyncCompat(params: {
  client: AuthenticatedSocket;
  payload: SpawnSubagentAsyncPayload;
  subagentOrchestrator: SubagentOrchestratorLike;
  resolveContainerContext?: ResolveContainerContext;
  terminalRunGuard?: TerminalRunGuardLike;
}): Promise<void> {
  const {
    client,
    payload,
    subagentOrchestrator,
    resolveContainerContext,
    terminalRunGuard,
  } = params;

  const context = await ensureSubagentCommandContext({
    client,
    resultType: 'spawn_subagent_async_result',
    resolveContainerContext,
  });
  if (!context) {
    return;
  }

  // Refuse to provision subagents for a terminal run: the parent step is
  // already finalized, so a spawned container would be an orphan that consumes
  // a slot until reaped. `executionStatus: 'terminated'` signals the runner to
  // stop the agent turn rather than retrying.
  if (terminalRunGuard) {
    try {
      await terminalRunGuard.assertRunIsActive(context.workflowRunId, {
        action: 'spawn_subagent_async',
        jobId: client.jobId,
        stepId: client.stepId,
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      emitCommandError(client, 'spawn_subagent_async_result', error, {
        executionStatus: 'terminated',
      });
      return;
    }
  }

  try {
    const assignedFiles = normalizeStringListInput(payload.assigned_files);
    const payloadRest = omitSubagentListFields(payload);
    const normalizedTools = mergeSdkNativeToolsForSubagent(
      normalizeStringListInput(payload.tools) ?? [],
    );
    const executionId = await subagentOrchestrator.spawn(context.containerId, {
      ...payloadRest,
      tier: 'heavy',
      workflowRunId: context.workflowRunId,
      parent_job_id: client.jobId,
      ...(assignedFiles !== undefined ? { assigned_files: assignedFiles } : {}),
      tools: normalizedTools,
    });
    client.emit('command', {
      type: 'spawn_subagent_async_result',
      success: true,
      execution_id: executionId,
    });
  } catch (error) {
    emitCommandError(client, 'spawn_subagent_async_result', error);
  }
}

function omitSubagentListFields<
  T extends { assigned_files?: unknown; tools?: unknown },
>(value: T): Omit<T, 'assigned_files' | 'tools'> {
  const rest = { ...value };
  Reflect.deleteProperty(rest, 'assigned_files');
  Reflect.deleteProperty(rest, 'tools');
  return rest;
}

export async function handleWaitForSubagentsCompat(params: {
  client: AuthenticatedSocket;
  payload: WaitForSubagentsPayload | undefined;
  subagentOrchestrator: SubagentOrchestratorLike;
  resolveContainerContext?: ResolveContainerContext;
}): Promise<void> {
  const { client, payload, subagentOrchestrator, resolveContainerContext } =
    params;

  const context = await ensureSubagentCommandContext({
    client,
    resultType: 'wait_for_subagents_result',
    resolveContainerContext,
  });
  if (!context) {
    return;
  }

  try {
    const result = await subagentOrchestrator.waitForSubagents(
      context.containerId,
      {
        executionIds: normalizeStringListInput(payload?.execution_ids),
        timeoutSeconds: normalizeTimeoutSeconds(payload?.timeout_seconds),
      },
    );
    client.emit('command', {
      type: 'wait_for_subagents_result',
      success: true,
      ...result,
    });
  } catch (error) {
    emitCommandError(client, 'wait_for_subagents_result', error);
  }
}

export async function handleCheckSubagentStatusCompat(params: {
  client: AuthenticatedSocket;
  payload: CheckSubagentStatusPayload;
  subagentOrchestrator: SubagentOrchestratorLike;
  resolveContainerContext?: ResolveContainerContext;
}): Promise<void> {
  const { client, payload, subagentOrchestrator, resolveContainerContext } =
    params;

  const context = await ensureSubagentCommandContext({
    client,
    resultType: 'check_subagent_status_result',
    resolveContainerContext,
  });
  if (!context) {
    return;
  }

  try {
    const result = await subagentOrchestrator.checkStatus(
      context.containerId,
      payload.execution_id,
      context.workflowRunId,
    );
    client.emit('command', {
      type: 'check_subagent_status_result',
      success: true,
      ...result,
    });
  } catch (error) {
    emitCommandError(client, 'check_subagent_status_result', error);
  }
}

function normalizeStringListInput(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return normalizeStringEntries(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const jsonParsed = parseJsonStringArray(trimmed);
  if (jsonParsed) {
    return jsonParsed;
  }

  return [trimmed];
}

function parseJsonStringArray(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return normalizeStringEntries(
      parsed.filter((entry): entry is string => typeof entry === 'string'),
    );
  } catch {
    return null;
  }
}

function normalizeTimeoutSeconds(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }

  return Number(trimmed);
}

function normalizeStringEntries(value: string[]): string[] {
  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}
