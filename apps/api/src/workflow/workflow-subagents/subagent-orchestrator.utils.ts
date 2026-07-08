import { BadRequestException } from '@nestjs/common';
import { asRecord } from '@nexus/core';
import { sleep } from '../../common/utils/async.utils';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type {
  NormalizedSubagentStatus,
  SubagentExecutionResultRecord,
  SubagentResultMap,
  WaitForSubagentsOptions,
  WaitForSubagentsResult,
} from './subagent-orchestrator.types';
import { sanitizeSubagentResult } from './subagent-result-sanitizer';

type WorkflowRunStateVariables = {
  trigger?: {
    basePath?: unknown;
    resolvedRepoPath?: unknown;
    resolved_repo_path?: unknown;
  };
  jobs?: {
    provision_worktree?: {
      output?: {
        worktreePath?: unknown;
        worktree_path?: unknown;
      };
    };
  };
};

const TERMINAL_SUBAGENT_STATUSES = new Set<SubagentExecutionView['status']>([
  'Completed',
  'Failed',
]);

function firstNonEmptyString(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return undefined;
}

export function resolveWorktreePathFromRun(
  run: WorkflowRun | null,
): string | undefined {
  const worktreePath = firstNonEmptyString(
    getWorktreePathCandidates(getWorkflowRunStateVariables(run)),
  );

  return worktreePath;
}

function getWorktreePathCandidates(
  stateVariables: WorkflowRunStateVariables | undefined,
): unknown[] {
  if (!stateVariables) {
    return [];
  }

  const output = stateVariables.jobs?.provision_worktree?.output;
  const trigger = stateVariables.trigger;
  return [
    output?.worktreePath,
    output?.worktree_path,
    trigger?.basePath,
    trigger?.resolvedRepoPath,
    trigger?.resolved_repo_path,
  ];
}

function getWorkflowRunStateVariables(
  run: WorkflowRun | null,
): WorkflowRunStateVariables | undefined {
  return run?.state_variables;
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}

export function resolveWaitTimeoutSeconds(timeoutSeconds?: number): number {
  const defaultTimeoutSeconds = 30 * 60;
  if (timeoutSeconds === undefined) {
    return defaultTimeoutSeconds;
  }

  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new BadRequestException('timeout_seconds must be a positive integer');
  }

  return timeoutSeconds;
}

export function isTerminalSubagentStatus(
  status: SubagentExecutionView['status'],
): boolean {
  return TERMINAL_SUBAGENT_STATUSES.has(status);
}

export function normalizeSubagentStatus(
  status: SubagentExecutionView['status'],
): NormalizedSubagentStatus {
  switch (status) {
    case 'Spawning':
      return 'spawning';
    case 'Running':
      return 'running';
    case 'Completed':
      return 'completed';
    case 'Failed':
      return 'failed';
  }
}

export function resolveSubagentFailureReason(
  execution: Pick<SubagentExecutionView, 'status' | 'result'>,
): string | undefined {
  const resultRecord = asRecord(sanitizeSubagentResult(execution.result));

  const explicitReason = firstNonEmptyString([
    resultRecord?.failure_reason,
    resultRecord?.failureReason,
    resultRecord?.error_code,
    resultRecord?.errorCode,
    resultRecord?.error,
    resultRecord?.message,
  ]);

  if (explicitReason) {
    return explicitReason;
  }

  if (execution.status === 'Failed') {
    return 'unknown_failure';
  }

  return undefined;
}

export function toSubagentExecutionResultRecord(
  execution: SubagentExecutionView,
): SubagentExecutionResultRecord {
  const resultRecord = asRecord(sanitizeSubagentResult(execution.result));
  const failureReason = resolveSubagentFailureReason(execution);
  const latestProgress = resolveTerminalExecutionProgress(
    execution,
    resultRecord,
  );

  return {
    ...(resultRecord ?? {}),
    status: execution.status,
    ...(failureReason ? { failure_reason: failureReason } : {}),
    ...latestProgress,
    started_at: execution.created_at?.toISOString(),
    completed_at: execution.completed_at?.toISOString(),
  };
}

function resolveTerminalExecutionProgress(
  execution: SubagentExecutionView,
  resultRecord: Record<string, unknown> | null,
): Pick<
  SubagentExecutionResultRecord,
  'latest_response' | 'latest_stop_reason' | 'latest_turn_at'
> {
  if (!isTerminalSubagentStatus(execution.status)) {
    return {};
  }

  const output = asRecord(resultRecord?.output);
  const response = firstNonEmptyString([output?.response]);
  if (!response) {
    return {};
  }

  const stopReason = firstNonEmptyString([output?.stopReason]);
  return {
    latest_response: response,
    ...(stopReason ? { latest_stop_reason: stopReason } : {}),
    ...(execution.completed_at
      ? { latest_turn_at: execution.completed_at.toISOString() }
      : {}),
  };
}

export function filterExecutionsForWait(
  executions: SubagentExecutionView[],
  requestedExecutionIds: string[],
): SubagentExecutionView[] {
  if (requestedExecutionIds.length === 0) {
    return executions;
  }

  const requestedSet = new Set(requestedExecutionIds);
  return executions.filter((execution) => requestedSet.has(execution.id));
}

export function ensureExecutionIdsExist(
  requestedExecutionIds: string[],
  executions: SubagentExecutionView[],
): void {
  if (requestedExecutionIds.length === 0) {
    return;
  }

  const foundIds = new Set(executions.map((execution) => execution.id));
  const missingIds = requestedExecutionIds.filter((id) => !foundIds.has(id));

  if (missingIds.length === 0) {
    return;
  }

  throw new BadRequestException(
    `Unknown subagent execution id(s): ${missingIds.join(', ')}`,
  );
}

export function ensureNoAssignedFileOverlap(
  requestedFiles: string[],
  activeExecutions: SubagentExecutionView[],
): void {
  if (requestedFiles.length === 0) {
    return;
  }

  const requested = new Set(requestedFiles);
  const overlapping = new Set<string>();
  const overlaps: Array<{
    assigned_file: string;
    subagent_execution_id: string;
  }> = [];
  const blockingIds = new Set<string>();

  for (const execution of activeExecutions) {
    for (const assignedFile of execution.assigned_files ?? []) {
      if (requested.has(assignedFile)) {
        overlapping.add(assignedFile);
        overlaps.push({
          assigned_file: assignedFile,
          subagent_execution_id: execution.id,
        });
        blockingIds.add(execution.id);
      }
    }
  }

  if (overlapping.size === 0) {
    return;
  }

  const overlappingList = [...overlapping].sort().join(', ');
  throw new BadRequestException({
    code: 'subagent_assigned_files_overlap',
    message: `assigned_files overlap with active subagents: ${overlappingList}`,
    retryable: true,
    recommended_action: 'wait_for_subagents',
    overlapping_files: [...overlapping].sort(),
    blocking_subagent_ids: [...blockingIds].sort(),
    overlaps,
  });
}

export async function stopAndRemoveContainer(params: {
  childContainerId: string | null;
  killContainer: (containerId: string) => Promise<void>;
  removeContainer: (containerId: string) => Promise<void>;
}): Promise<void> {
  if (!params.childContainerId) {
    return;
  }

  await params.killContainer(params.childContainerId);
  await params.removeContainer(params.childContainerId);
}

export function formatSkillMountDiagnostics(params: {
  workflowRunId: string;
  executionId: string;
  agentProfile: string;
  assignedSkillNames: string[];
  skillMountPath?: string | null;
  containerSkillsRoot: string;
}): string {
  const assignedLabel =
    params.assignedSkillNames.length > 0
      ? params.assignedSkillNames.join(', ')
      : 'none';
  const hostMountPath = params.skillMountPath ?? 'none';
  return `Subagent skill mount diagnostics: run=${params.workflowRunId} execution=${params.executionId} profile=${params.agentProfile} assigned=[${assignedLabel}] host_mount=${hostMountPath} container_mount=${params.containerSkillsRoot}`;
}

export async function waitForSubagentExecutions(params: {
  parentContainerId: string;
  options: WaitForSubagentsOptions;
  findByParentContainerId: (
    parentContainerId: string,
  ) => Promise<SubagentExecutionView[]>;
}): Promise<WaitForSubagentsResult> {
  const requestedExecutionIds = normalizeStringList(
    params.options.executionIds,
  );
  const pollInterval = 5000;
  const timeoutSeconds = resolveWaitTimeoutSeconds(
    params.options.timeoutSeconds,
  );
  const maxWaitTime = timeoutSeconds * 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const snapshot = await fetchSubagentExecutionSnapshot({
      parentContainerId: params.parentContainerId,
      requestedExecutionIds,
      findByParentContainerId: params.findByParentContainerId,
    });

    if (snapshot.pendingExecutionIds.length === 0) {
      return {
        status: 'all_completed',
        results: snapshot.results,
      };
    }

    const elapsedTime = Date.now() - startTime;
    const remainingTime = maxWaitTime - elapsedTime;
    const sleepDuration = Math.min(pollInterval, remainingTime);

    await sleep(sleepDuration);
  }

  const snapshot = await fetchSubagentExecutionSnapshot({
    parentContainerId: params.parentContainerId,
    requestedExecutionIds,
    findByParentContainerId: params.findByParentContainerId,
  });

  if (snapshot.pendingExecutionIds.length === 0) {
    return {
      status: 'all_completed',
      results: snapshot.results,
      timeout_seconds: timeoutSeconds,
      elapsed_seconds: Math.ceil((Date.now() - startTime) / 1000),
    };
  }

  return {
    status: 'timeout',
    results: snapshot.results,
    pending_execution_ids: snapshot.pendingExecutionIds,
    timeout_seconds: timeoutSeconds,
    elapsed_seconds: Math.ceil((Date.now() - startTime) / 1000),
  };
}

async function fetchSubagentExecutionSnapshot(params: {
  parentContainerId: string;
  requestedExecutionIds: string[];
  findByParentContainerId: (
    parentContainerId: string,
  ) => Promise<SubagentExecutionView[]>;
}): Promise<{
  results: SubagentResultMap;
  pendingExecutionIds: string[];
}> {
  const allExecutions = await params.findByParentContainerId(
    params.parentContainerId,
  );
  const executions = filterExecutionsForWait(
    allExecutions,
    params.requestedExecutionIds,
  );

  ensureExecutionIdsExist(params.requestedExecutionIds, executions);

  const pendingExecutionIds = executions
    .filter((execution) => !isTerminalSubagentStatus(execution.status))
    .map((execution) => execution.id);

  const results = executions.reduce<SubagentResultMap>(
    (accumulator, execution) => {
      accumulator[execution.id] = toSubagentExecutionResultRecord(execution);
      return accumulator;
    },
    {},
  );

  return { results, pendingExecutionIds };
}

export function extractScopeIdFromRunStateVariables(
  stateVariablesInput: unknown,
): string | undefined {
  const stateVariables = asRecord(stateVariablesInput);
  const trigger = asRecord(stateVariables?.trigger);

  return (
    readStringProperty(trigger, 'scopeId') ||
    readStringProperty(trigger, 'scope_id') ||
    readStringProperty(stateVariables, 'scopeId') ||
    readStringProperty(stateVariables, 'scope_id')
  );
}

export function readStringProperty(
  source: Record<string, unknown> | undefined | null,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
