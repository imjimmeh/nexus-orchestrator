import { ChatSessionStatus } from '@nexus/core';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import { buildSubagentSkillMountKey } from './subagent-orchestrator.skills.helpers';
import { mirrorSubagentDetails } from './subagent-details-mirror.helpers';
import type { SubagentCoordinationOperationsContext } from './subagent-orchestrator.operations.types';
import type { WaitForSubagentsResult } from './subagent-orchestrator.types';
import {
  isTerminalSubagentStatus,
  stopAndRemoveContainer,
} from './subagent-orchestrator.utils';

const CANCEL_VERIFY_ATTEMPTS = 3;

export async function emitWaitLifecycleEventOperation(
  context: SubagentCoordinationOperationsContext,
  parentContainerId: string,
  result: WaitForSubagentsResult,
): Promise<void> {
  if (result.status === 'timeout') {
    await context.emitSubagentLifecycleEvent({
      eventName: 'wait.timeout',
      outcome: 'failure',
      parentContainerId,
      payload: {
        pending_execution_ids: result.pending_execution_ids,
        timeout_seconds: result.timeout_seconds,
        elapsed_seconds: result.elapsed_seconds,
      },
      error: new Error('Timeout waiting for subagents to complete'),
    });
    return;
  }

  await context.emitSubagentLifecycleEvent({
    eventName: 'wait.completed',
    outcome: 'success',
    parentContainerId,
    payload: {
      execution_count: Object.keys(result.results).length,
    },
  });
}

export async function cancelSubagentExecutionOperation(
  context: SubagentCoordinationOperationsContext,
  params: {
    parentContainerId: string;
    workflowRunId?: string;
    execution: SubagentExecutionView;
    reason: string;
    cancelledAt: Date;
  },
): Promise<boolean> {
  const childContainerId = params.execution.child_container_id ?? null;
  try {
    await stopAndRemoveContainer({
      childContainerId,
      killContainer: (containerId) =>
        context.containerOrchestrator.killContainer(containerId),
      removeContainer: (containerId) =>
        context.containerOrchestrator.removeContainer(containerId),
    });

    if (childContainerId) {
      let containerConfirmedGone = false;
      for (let attempt = 0; attempt < CANCEL_VERIFY_ATTEMPTS; attempt++) {
        if (await context.liveness.isContainerLost(childContainerId)) {
          containerConfirmedGone = true;
          break;
        }
        await context.containerOrchestrator.removeContainer(childContainerId);
      }
      if (!containerConfirmedGone) {
        context.logger.warn(
          `Subagent ${params.execution.id} container ${childContainerId} still alive after ${CANCEL_VERIFY_ATTEMPTS} removal attempts; leaving for orphan reconciler`,
        );
      }
    }
  } catch {
    // Cancellation should still proceed even if runtime cleanup fails.
  }

  context.skillMounting.cleanupSkillMount(
    buildSubagentSkillMountKey(params.execution.id),
  );

  const cancellationResult = {
    status: 'Failed',
    failure_reason: params.reason,
    error: 'Cancelled because parent workflow execution was aborted',
    cancelled_at: params.cancelledAt.toISOString(),
  };

  try {
    await context.executionEvents.cancelled(params.execution.id, {
      failure_reason: 'parent_terminated',
      error_message: cancellationResult.error,
    });

    await mirrorSubagentDetails(context.subagentDetailsRepo, undefined, {
      execution_id: params.execution.id,
      result: cancellationResult,
      is_active: false,
    });

    if (params.execution.subagent_chat_session_id && context.chatSessionRepo) {
      await context.chatSessionRepo.update(
        params.execution.subagent_chat_session_id,
        {
          status: ChatSessionStatus.CANCELLED,
          execution_state: 'cancelled',
          completed_at: params.cancelledAt,
        },
      );
    }

    await context.emitSubagentLifecycleEvent({
      eventName: 'cancelled',
      outcome: 'success',
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      subagentExecutionId: params.execution.id,
      payload: {
        reason: params.reason,
        status: 'failed',
      },
    });
    return true;
  } catch (error) {
    await context.emitSubagentLifecycleEvent({
      eventName: 'cancel.failed',
      outcome: 'failure',
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      subagentExecutionId: params.execution.id,
      payload: { reason: params.reason },
      error,
    });
    return false;
  }
}

export async function cancelSubagentExecutionByIdOperation(
  context: SubagentCoordinationOperationsContext,
  params: {
    parentContainerId: string;
    workflowRunId?: string;
    executionId: string;
    reason: string;
    cancelledAt: Date;
  },
): Promise<SubagentExecutionView | null> {
  const execution = await context.subagentReadModel.findById(
    params.executionId,
  );
  if (!execution) {
    return null;
  }

  if (execution.parent_container_id !== params.parentContainerId) {
    return null;
  }

  if (isTerminalSubagentStatus(execution.status)) {
    return null;
  }

  const cancelled = await cancelSubagentExecutionOperation(context, {
    parentContainerId: params.parentContainerId,
    workflowRunId: params.workflowRunId,
    execution,
    reason: params.reason,
    cancelledAt: params.cancelledAt,
  });

  return cancelled ? execution : null;
}
