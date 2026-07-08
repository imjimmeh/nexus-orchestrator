import { BadRequestException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import { ChatSessionStatus, readString } from '@nexus/core';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { SubagentExecutionReadModel } from './subagent-execution-read-model';
import type { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import type { MeshDelegationService } from './mesh-delegation.service';
import { buildSubagentSkillMountKey } from './subagent-orchestrator.skills.helpers';
import type {
  FindLatestSubagentTurn,
  SubagentLifecycleEventParams,
} from './subagent-orchestrator.operations.types';
import type { SubagentParentResumeService } from './subagent-parent-resume.service';
import type { SubagentStatusResult } from './subagent-orchestrator.types';
import { sanitizeSubagentResult } from './subagent-result-sanitizer';
import { mirrorSubagentDetails } from './subagent-details-mirror.helpers';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';
import type { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import {
  isTerminalSubagentStatus,
  normalizeSubagentStatus,
  resolveSubagentFailureReason,
  stopAndRemoveContainer,
} from './subagent-orchestrator.utils';
import type {
  ChatSessionDomainPort,
  IChatSessionRepositoryPort,
} from '../domain-ports';

type HandleSubagentCompletionOperationParams = {
  logger: Logger;
  executionId: string;
  workflowRunId?: string;
  result: Record<string, unknown>;
  jwtSecret: string;
  subagentDetailsRepo: SubagentDetailsRepository;
  subagentReadModel: SubagentExecutionReadModel;
  chatSessionRepo?: Pick<IChatSessionRepositoryPort, 'update'>;
  containerOrchestrator: ContainerOrchestratorService;
  skillMounting: SkillMountingService;
  sessionHydration: Pick<
    ChatSessionDomainPort,
    'saveSessionForChat' | 'saveSessionForWorkflowChat'
  >;
  parentResumeService: SubagentParentResumeService;
  meshDelegation: MeshDelegationService;
  emitSubagentLifecycleEvent: (
    params: SubagentLifecycleEventParams,
  ) => Promise<void>;
  spawnSubagentFromDelegation: (request: {
    parentContainerId: string;
    agentProfile: string;
    taskPrompt: string;
    tools: string[];
    tier: 'light' | 'heavy';
    workflowRunId: string;
    lifecycleStage: WorkflowLifecycleStage | null;
    assignedFiles: string[];
    contractId: string;
    traceId: string;
    parentTraceId: string | null;
    resumeSessionTreeId?: string;
  }) => Promise<string>;
  clearRunnerConfig: (
    workflowRunId: string,
    executionId: string,
  ) => Promise<void>;
  executionEvents: ExecutionEventPublisher;
};

export async function handleSubagentCompletionOperation(
  params: HandleSubagentCompletionOperationParams,
): Promise<void> {
  params.logger.log(`Subagent execution ${params.executionId} completed task`);

  const execution = await params.subagentReadModel.findById(params.executionId);
  if (!execution) {
    params.logger.error(
      `No subagent execution found for id ${params.executionId}`,
    );
    await params.emitSubagentLifecycleEvent({
      eventName: 'completion.failed',
      outcome: 'failure',
      subagentExecutionId: params.executionId,
      payload: { reason: 'execution_not_found' },
    });
    return;
  }

  if (execution.subagent_chat_session_id && execution.child_container_id) {
    try {
      if (typeof params.workflowRunId === 'string') {
        await params.sessionHydration.saveSessionForWorkflowChat(
          execution.child_container_id,
          params.workflowRunId,
          execution.subagent_chat_session_id,
        );
      } else {
        await params.sessionHydration.saveSessionForChat(
          execution.child_container_id,
          execution.subagent_chat_session_id,
        );
      }
    } catch (error) {
      params.logger.warn(
        `Failed to persist session tree for subagent ${execution.id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  await stopAndRemoveContainer({
    childContainerId: execution.child_container_id ?? null,
    killContainer: (containerId) =>
      params.containerOrchestrator.killContainer(containerId),
    removeContainer: (containerId) =>
      params.containerOrchestrator.removeContainer(containerId),
  });

  params.skillMounting.cleanupSkillMount(
    buildSubagentSkillMountKey(execution.id),
  );

  if (execution.parent_session_tree_id) {
    await params.parentResumeService.resumeParentAfterSubagent(
      execution.parent_session_tree_id,
      params.result,
      params.jwtSecret,
    );
  }

  await finalizeExecutionAndEmitEvent(params, execution);
  await dispatchQueuedDelegationsForCompletion(params, execution);
}

// A subagent turn that the harness aborted (container/process killed, provider
// stream terminated) surfaces as an `agent_end` with `ok: false` and an error
// stop reason. Such a turn carries no usable result, so it MUST be recorded as
// a failure — otherwise the engine launders a terminated subagent into a clean
// completion and the coordinator consumes an empty error stub as if it were the
// subagent's findings.
const FAILED_AGENT_STOP_REASONS = new Set(['error', 'aborted']);

type AgentResultOutcome = {
  failed: boolean;
  errorMessage: string | null;
};

function resolveAgentResultOutcome(
  result: Record<string, unknown>,
): AgentResultOutcome {
  const output = readRecord(result.output);
  if (!output) {
    return { failed: false, errorMessage: null };
  }

  const stopReason = readNonEmptyString(output.stopReason);
  const failed =
    output.ok === false ||
    (stopReason !== undefined && FAILED_AGENT_STOP_REASONS.has(stopReason));
  if (!failed) {
    return { failed: false, errorMessage: null };
  }

  const errorMessage =
    readNonEmptyString(output.errorMessage) ??
    stopReason ??
    readNonEmptyString(output.response) ??
    'agent_error';
  return { failed: true, errorMessage };
}

async function finalizeExecutionAndEmitEvent(
  params: HandleSubagentCompletionOperationParams,
  execution: SubagentExecutionView,
): Promise<void> {
  const completedAt = new Date();
  const outcome = resolveAgentResultOutcome(params.result);

  if (outcome.failed) {
    await params.executionEvents.failed(execution.id, {
      failure_reason: 'agent_error',
      error_message: outcome.errorMessage,
    });
  } else {
    await params.executionEvents.completed(execution.id);
  }

  // The raw result is mirrored regardless of outcome so the terminated turn's
  // partial response remains inspectable for debugging.
  await mirrorSubagentDetails(params.subagentDetailsRepo, params.logger, {
    execution_id: execution.id,
    result: params.result,
    is_active: false,
  });

  if (execution.subagent_chat_session_id && params.chatSessionRepo) {
    await params.chatSessionRepo.update(
      execution.subagent_chat_session_id,
      outcome.failed
        ? {
            status: ChatSessionStatus.FAILED,
            execution_state: 'failed',
            error_message: outcome.errorMessage,
            completed_at: completedAt,
          }
        : {
            status: ChatSessionStatus.COMPLETED,
            execution_state: 'completed',
            error_message: null,
            failure_info: null,
            retry_metadata: null,
            completed_at: completedAt,
          },
    );
  }

  await params.emitSubagentLifecycleEvent(
    outcome.failed
      ? {
          eventName: 'completion.failed',
          outcome: 'failure',
          workflowRunId: params.workflowRunId,
          parentContainerId: execution.parent_container_id,
          subagentExecutionId: execution.id,
          payload: {
            reason: 'agent_error',
            error_message: outcome.errorMessage,
          },
        }
      : {
          eventName: 'completion.succeeded',
          outcome: 'success',
          workflowRunId: params.workflowRunId,
          parentContainerId: execution.parent_container_id,
          subagentExecutionId: execution.id,
          payload: {
            has_result: Object.keys(params.result).length > 0,
            status: 'completed',
          },
        },
  );

  if (typeof params.workflowRunId === 'string') {
    await params.clearRunnerConfig(params.workflowRunId, execution.id);
  }
}

async function dispatchQueuedDelegationsForCompletion(
  params: HandleSubagentCompletionOperationParams,
  execution: SubagentExecutionView,
): Promise<void> {
  const contract = await params.meshDelegation.handleSubagentCompletion({
    subagentExecutionId: execution.id,
    result: params.result,
  });

  if (!contract) {
    return;
  }

  await params.meshDelegation.dispatchQueuedDelegations({
    workflowRunId: contract.workflow_run_id,
    parentContainerId: contract.parent_container_id,
    lifecycleStage: null,
    spawnHandler: params.spawnSubagentFromDelegation,
  });
}

export async function checkSubagentStatusOperation(params: {
  parentContainerId: string;
  executionId: string;
  subagentReadModel: SubagentExecutionReadModel;
  emitSubagentLifecycleEvent: (
    params: SubagentLifecycleEventParams,
  ) => Promise<void>;
  workflowRunId?: string;
  findLatestTurnForStep?: FindLatestSubagentTurn;
}): Promise<SubagentStatusResult> {
  const normalizedExecutionId = params.executionId.trim();
  if (!normalizedExecutionId) {
    await params.emitSubagentLifecycleEvent({
      eventName: 'status.failed',
      outcome: 'failure',
      parentContainerId: params.parentContainerId,
      payload: { reason: 'missing_execution_id' },
      error: new Error('execution_id is required'),
    });
    throw new BadRequestException('execution_id is required');
  }

  const execution = await params.subagentReadModel.findById(
    normalizedExecutionId,
  );
  if (!execution) {
    await params.emitSubagentLifecycleEvent({
      eventName: 'status.failed',
      outcome: 'failure',
      parentContainerId: params.parentContainerId,
      subagentExecutionId: normalizedExecutionId,
      payload: { reason: 'execution_not_found' },
      error: new Error(
        `Subagent execution not found: ${normalizedExecutionId}`,
      ),
    });
    throw new BadRequestException(
      `Subagent execution not found: ${normalizedExecutionId}`,
    );
  }

  if (execution.parent_container_id !== params.parentContainerId) {
    await params.emitSubagentLifecycleEvent({
      eventName: 'status.failed',
      outcome: 'failure',
      parentContainerId: params.parentContainerId,
      subagentExecutionId: normalizedExecutionId,
      payload: { reason: 'execution_parent_mismatch' },
      error: new Error(
        `Subagent execution ${normalizedExecutionId} does not belong to this parent container`,
      ),
    });
    throw new BadRequestException(
      `Subagent execution ${normalizedExecutionId} does not belong to this parent container`,
    );
  }

  const failureReason = resolveSubagentFailureReason(execution);
  const normalizedStatus = normalizeSubagentStatus(execution.status);
  const latestProgress =
    resolveTerminalProgress(execution) ??
    (await resolveLatestProgress({
      workflowRunId: params.workflowRunId,
      stepId: execution.id,
      findLatestTurnForStep: params.findLatestTurnForStep,
    }));

  await params.emitSubagentLifecycleEvent({
    eventName: 'status.checked',
    outcome: 'success',
    parentContainerId: params.parentContainerId,
    subagentExecutionId: execution.id,
    payload: {
      status: normalizedStatus,
      terminal: isTerminalSubagentStatus(execution.status),
      failure_reason: failureReason,
    },
  });

  return {
    execution_id: execution.id,
    status: execution.status,
    normalized_status: normalizedStatus,
    terminal: isTerminalSubagentStatus(execution.status),
    delegation_contract_id: execution.delegation_contract_id,
    lineage_trace_id: execution.lineage_trace_id,
    lineage_parent_trace_id: execution.lineage_parent_trace_id,
    failure_reason: failureReason,
    ...latestProgress,
    result: sanitizeSubagentResult(execution.result),
    assigned_files: execution.assigned_files,
    started_at: execution.created_at,
    completed_at: execution.completed_at,
  };
}

function resolveTerminalProgress(
  execution: SubagentExecutionView,
):
  | Pick<
      SubagentStatusResult,
      'latest_response' | 'latest_stop_reason' | 'latest_turn_at'
    >
  | undefined {
  if (!isTerminalSubagentStatus(execution.status)) {
    return undefined;
  }

  const result = readRecord(sanitizeSubagentResult(execution.result));
  const output = readRecord(result?.output);
  const response = readNonEmptyString(output?.response);
  if (!response) {
    return undefined;
  }

  const stopReason = readNonEmptyString(output?.stopReason);
  return {
    latest_response: response,
    ...(stopReason ? { latest_stop_reason: stopReason } : {}),
    ...(execution.completed_at
      ? { latest_turn_at: execution.completed_at }
      : {}),
  };
}

async function resolveLatestProgress(params: {
  workflowRunId?: string;
  stepId: string;
  findLatestTurnForStep?: FindLatestSubagentTurn;
}): Promise<
  Pick<
    SubagentStatusResult,
    'latest_response' | 'latest_stop_reason' | 'latest_turn_at'
  >
> {
  if (!params.workflowRunId || !params.findLatestTurnForStep) {
    return {};
  }

  const latestTurn = await params.findLatestTurnForStep({
    workflowRunId: params.workflowRunId,
    stepId: params.stepId,
  });
  if (!latestTurn) {
    return {};
  }

  const output = readRecord(readRecord(latestTurn.payload)?.output);
  const response = readNonEmptyString(output?.response);
  const stopReason = readNonEmptyString(output?.stopReason);
  const sanitizedResponse = response
    ? sanitizeSubagentResult(response).trim()
    : undefined;

  return {
    ...(sanitizedResponse ? { latest_response: sanitizedResponse } : {}),
    ...(stopReason ? { latest_stop_reason: stopReason } : {}),
    latest_turn_at: latestTurn.occurred_at,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
