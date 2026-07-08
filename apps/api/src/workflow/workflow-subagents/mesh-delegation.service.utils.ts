import { randomUUID } from 'crypto';
import type {
  DelegationContract,
  DelegationContractStatus,
} from '../database/entities/delegation-contract.entity';
import type {
  MeshDelegationDispatchParams,
  MeshDelegationSpawnRequest,
} from './mesh-delegation.service.types';

export const DEFAULT_MESH_QUEUE_DEPTH = 50;
export const DEFAULT_MESH_CONCURRENCY = 3;
const DEFAULT_SPAWN_ASSIGNED_FILE_PREFIX = 'mesh-contract:';
export const MESH_DELEGATION_EVENT_PREFIX = 'mesh.delegation';

export function normalizeAssignedFiles(
  assignedFiles: string[] | null | undefined,
): string[] {
  const normalized = Array.isArray(assignedFiles)
    ? assignedFiles
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

  if (normalized.length > 0) {
    return [...new Set(normalized)];
  }

  return [`${DEFAULT_SPAWN_ASSIGNED_FILE_PREFIX}${randomUUID()}`];
}

export function resolveDeadline(
  now: Date,
  timeBudgetMs: number | null,
): Date | null {
  if (!timeBudgetMs || timeBudgetMs <= 0) {
    return null;
  }

  return new Date(now.getTime() + timeBudgetMs);
}

export function resolveTerminalStatusFromResult(
  result: Record<string, unknown>,
): DelegationContractStatus {
  const outputValue = result.output;
  const output =
    outputValue && typeof outputValue === 'object'
      ? (outputValue as Record<string, unknown>)
      : null;

  if (result.ok === false) {
    return 'failed';
  }

  if (
    typeof output?.errorMessage === 'string' &&
    output.errorMessage.trim().length > 0
  ) {
    return 'failed';
  }

  return 'completed';
}

export function resolveResultErrorMessage(
  result: Record<string, unknown>,
): string {
  const outputValue = result.output;
  const output =
    outputValue && typeof outputValue === 'object'
      ? (outputValue as Record<string, unknown>)
      : null;

  const candidates = [output?.errorMessage, output?.error, result.error];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return 'unknown_failure';
}

export function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isTerminalContractStatus(
  status: DelegationContractStatus,
): boolean {
  return ['completed', 'failed', 'cancelled', 'timed_out', 'denied'].includes(
    status,
  );
}

export function toSpawnRequest(
  contract: DelegationContract,
  params: MeshDelegationDispatchParams,
): MeshDelegationSpawnRequest {
  return {
    contractId: contract.id,
    workflowRunId: contract.workflow_run_id,
    parentContainerId: contract.parent_container_id,
    lifecycleStage: params.lifecycleStage,
    agentProfile: contract.target_agent_profile,
    taskPrompt: contract.task_prompt,
    tools: contract.effective_tools,
    tier: contract.target_tier,
    assignedFiles: normalizeAssignedFiles(contract.assigned_files),
    traceId: contract.trace_id,
    parentTraceId: contract.parent_trace_id ?? null,
  };
}
