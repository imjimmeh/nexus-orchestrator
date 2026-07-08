import { BadRequestException } from '@nestjs/common';
import type { IHostMountBinding } from '@nexus/core';
import type {
  SubagentRuntimeSelection,
  SubagentSpawnOperationsContext,
} from './subagent-orchestrator.operations.types';
import { mirrorSubagentDetails } from './subagent-details-mirror.helpers';

const MAX_SUBAGENT_DEPTH = 3;

/**
 * Records the resolved harness/provider/model on the subagent chat session so a
 * failed subagent's runtime is recoverable from the database (the columns were
 * previously left NULL, hiding pi-vs-claude-code after the fact).
 */
export async function persistSubagentRuntimeSelection(
  context: SubagentSpawnOperationsContext,
  params: {
    chatSessionId?: string | null;
    runtime: SubagentRuntimeSelection;
  },
): Promise<void> {
  if (!params.chatSessionId) {
    return;
  }
  try {
    await context.chatSessionRepo.update(params.chatSessionId, {
      provider: params.runtime.provider,
      model: params.runtime.model,
      harness_id: params.runtime.harnessId,
    });
  } catch (error) {
    context.logger.warn(
      `Failed to persist subagent runtime selection for chat session ${params.chatSessionId}: ${
        (error as Error).message
      }`,
    );
  }
}

export function upsertHostMountBinding(
  bindings: Map<string, IHostMountBinding>,
  binding: IHostMountBinding,
): void {
  const existing = bindings.get(binding.containerPath);
  if (!existing) {
    bindings.set(binding.containerPath, binding);
    return;
  }

  if (
    existing.hostPath !== binding.hostPath ||
    existing.readOnly !== binding.readOnly
  ) {
    throw new BadRequestException(
      `Conflicting host mount configuration for container path '${binding.containerPath}'`,
    );
  }
}

export async function resolveNextSubagentDepth(
  context: SubagentSpawnOperationsContext,
  parentContainerId: string,
): Promise<number> {
  const parentExecution =
    await context.subagentReadModel.findByChildContainerId(parentContainerId);
  return parentExecution ? parentExecution.depth + 1 : 1;
}

export function ensureDepthWithinLimit(depth: number): void {
  if (depth > MAX_SUBAGENT_DEPTH) {
    throw new BadRequestException(
      `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) exceeded`,
    );
  }
}

export async function markSpawnFailed(
  context: SubagentSpawnOperationsContext,
  params: {
    executionId: string;
    workflowRunId: string;
    parentContainerId: string;
    error: unknown;
  },
): Promise<void> {
  const reason = context.resolveErrorMessage(params.error);

  const result = {
    failure_reason: 'spawn_subagent_async_failed',
    error: reason,
  };

  await context.executionEvents.failed(params.executionId, {
    failure_reason: 'provision_failed',
    error_message: reason,
  });

  await mirrorSubagentDetails(context.subagentDetailsRepo, context.logger, {
    execution_id: params.executionId,
    result,
    is_active: false,
  });

  await context.emitSubagentLifecycleEvent({
    eventName: 'spawn.failed',
    outcome: 'failure',
    workflowRunId: params.workflowRunId,
    parentContainerId: params.parentContainerId,
    subagentExecutionId: params.executionId,
    payload: {
      mode: 'async',
    },
    error: params.error,
  });
}
