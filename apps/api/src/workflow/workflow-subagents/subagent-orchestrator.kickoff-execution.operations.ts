import { ChatSessionStatus } from '@nexus/core';
import { mirrorSubagentDetails } from './subagent-details-mirror.helpers';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import {
  isTerminalSubagentStatus,
  stopAndRemoveContainer,
} from './subagent-orchestrator.utils';

const SUBAGENT_START_FAILURE_REASON = 'subagent_start_failed';

function scheduleSubagentExecutionKickoff(
  context: SubagentSpawnOperationsContext,
  params: {
    executionId: string;
    workflowRunId: string;
    parentContainerId: string;
    childContainerId: string;
    skillMountKey: string;
    subagentChatSessionId?: string | null;
    resumeSessionTreeId?: string;
  },
): void {
  void kickoffSubagentExecution(context, params).catch((error: unknown) => {
    const errorMsg = context.resolveErrorMessage(error);
    context.logger.error(
      `Unhandled subagent kickoff failure for ${params.executionId}: ${errorMsg}`,
      {
        error,
        executionId: params.executionId,
        workflowRunId: params.workflowRunId,
      },
    );
    // Note: failSubagentExecutionKickoff should have been called inside kickoffSubagentExecution catch block
    // If we reach here, it means the error wasn't caught properly — emit a safety event
    void context
      .emitSubagentLifecycleEvent({
        eventName: 'spawn.execution_failed',
        outcome: 'failure',
        workflowRunId: params.workflowRunId,
        parentContainerId: params.parentContainerId,
        subagentExecutionId: params.executionId,
        payload: {
          status: 'failed',
          error: context.resolveErrorMessage(error),
        },
        error,
      })
      .catch((emitError: unknown) => {
        context.logger.error(
          `Failed to emit subagent failure event: ${context.resolveErrorMessage(emitError)}`,
        );
      });
  });
}

async function maybeInjectResumeSession(
  context: SubagentSpawnOperationsContext,
  params: {
    childContainerId: string;
    workflowRunId: string;
    executionId: string;
    resumeSessionTreeId?: string;
  },
): Promise<void> {
  if (!params.resumeSessionTreeId) {
    return;
  }

  try {
    await context.sessionHydration.injectSessionIntoContainer(
      params.childContainerId,
      params.resumeSessionTreeId,
    );
  } catch (injectError) {
    context.logger.warn(
      `Failed to inject resume session tree ${params.resumeSessionTreeId} into container ${params.childContainerId}: ${context.resolveErrorMessage(injectError)}. Continuing with execution.`,
      {
        workflowRunId: params.workflowRunId,
        executionId: params.executionId,
        containerId: params.childContainerId,
        resumeSessionTreeId: params.resumeSessionTreeId,
      },
    );
  }
}

async function kickoffSubagentExecution(
  context: SubagentSpawnOperationsContext,
  params: {
    executionId: string;
    workflowRunId: string;
    parentContainerId: string;
    childContainerId: string;
    skillMountKey: string;
    subagentChatSessionId?: string | null;
    resumeSessionTreeId?: string;
  },
): Promise<void> {
  try {
    let containerIp: string;
    try {
      containerIp = await context.resolveContainerIpAddress(
        params.childContainerId,
      );
    } catch (error) {
      throw new Error(
        `Failed to resolve container IP for ${params.childContainerId}: ${context.resolveErrorMessage(error)}`,
        { cause: error },
      );
    }

    const baseUrl = context.containerHttpClient.buildBaseUrl(containerIp);
    context.logger.debug(
      `Waiting for container health at ${baseUrl} for execution ${params.executionId}`,
    );

    try {
      await context.containerHttpClient.waitForHealth(baseUrl, undefined, {
        containerId: params.childContainerId,
        fetchLogs: () =>
          context.containerOrchestrator.fetchContainerLogSnapshot(
            params.childContainerId,
          ),
      });
    } catch (error) {
      throw new Error(
        `Container health check failed at ${baseUrl}: ${context.resolveErrorMessage(error)}`,
        { cause: error },
      );
    }

    await maybeInjectResumeSession(context, params);

    context.logger.debug(
      `Retrieving runner config for execution ${params.executionId}`,
    );
    const runnerConfig = await context.runnerConfigStore.get(
      params.workflowRunId,
      params.executionId,
    );

    if (!runnerConfig) {
      throw new Error(
        `Missing runner config for workflow ${params.workflowRunId} execution ${params.executionId}. Config may have expired or been consumed already.`,
      );
    }

    context.logger.debug(
      `Executing subagent task at ${baseUrl} for execution ${params.executionId}`,
    );
    const response = await context.containerHttpClient.executeAgent(baseUrl, {
      provider: runnerConfig.model.provider,
      model: runnerConfig.model.model,
      auth: runnerConfig.model.auth,
      baseUrl: runnerConfig.model.baseUrl,
      providerConfig: runnerConfig.model.providerConfig,
      systemPrompt: runnerConfig.prompt.systemPrompt,
      initialPrompt: runnerConfig.prompt.initialPrompt,
      temperature: runnerConfig.model.temperature,
      thinkingLevel: runnerConfig.model.thinkingLevel,
      stepId: params.executionId,
      background: true,
    });

    if (!response.ok) {
      throw new Error(
        response.error ||
          `Subagent execution ${params.executionId} returned a non-ok response`,
      );
    }

    if (params.subagentChatSessionId) {
      await context.chatSessionRepo.update(params.subagentChatSessionId, {
        status: ChatSessionStatus.RUNNING,
        execution_state: 'running',
      });
      context.logger.log(
        `Chat session ${params.subagentChatSessionId} status transitioned to ${ChatSessionStatus.RUNNING}`,
      );
    }

    context.logger.log(
      `Subagent execution ${params.executionId} kickoff successful`,
    );
  } catch (error: unknown) {
    context.logger.error(
      `Subagent kickoff failed for ${params.executionId}: ${context.resolveErrorMessage(error)}`,
      { error },
    );
    await failSubagentExecutionKickoff(context, {
      executionId: params.executionId,
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      childContainerId: params.childContainerId,
      skillMountKey: params.skillMountKey,
      error,
    });
  }
}

async function failSubagentExecutionKickoff(
  context: SubagentSpawnOperationsContext,
  params: {
    executionId: string;
    workflowRunId: string;
    parentContainerId: string;
    childContainerId: string;
    skillMountKey: string;
    error: unknown;
  },
): Promise<void> {
  const execution = await context.subagentReadModel.findById(
    params.executionId,
  );
  if (!execution || isTerminalSubagentStatus(execution.status)) {
    context.logger.debug(
      `Subagent ${params.executionId} already in terminal status ${execution?.status ?? 'unknown'}, skipping kickoff failure handling`,
    );
    return;
  }

  const reason = context.resolveErrorMessage(params.error);
  context.logger.warn(
    `Marking subagent ${params.executionId} as Failed due to kickoff failure: ${reason}`,
  );

  try {
    await stopAndRemoveContainer({
      childContainerId: params.childContainerId,
      killContainer: (containerId) =>
        context.containerOrchestrator.killContainer(containerId),
      removeContainer: (containerId) =>
        context.containerOrchestrator.removeContainer(containerId),
    });
  } catch (cleanupError) {
    context.logger.error(
      `Failed to cleanup container ${params.childContainerId}: ${context.resolveErrorMessage(cleanupError)}. Continuing with execution status update.`,
    );
    // Continue anyway; execution status still needs to transition to terminal
  }

  try {
    context.skillMounting.cleanupSkillMount(params.skillMountKey);
  } catch (skillError) {
    context.logger.warn(
      `Failed to cleanup skill mount ${params.skillMountKey}: ${context.resolveErrorMessage(skillError)}`,
    );
  }

  const failureResult = {
    status: 'Failed',
    failure_reason: SUBAGENT_START_FAILURE_REASON,
    error: reason,
  };

  await context.executionEvents.failed(params.executionId, {
    failure_reason: 'provision_failed',
    error_message: reason,
  });

  await mirrorSubagentDetails(context.subagentDetailsRepo, context.logger, {
    execution_id: params.executionId,
    result: failureResult,
    is_active: false,
  });

  try {
    await context.runnerConfigStore.delete(
      params.workflowRunId,
      params.executionId,
    );
  } catch (deleteError) {
    context.logger.warn(
      `Failed to delete runner config: ${context.resolveErrorMessage(deleteError)}`,
    );
  }

  try {
    await context.emitSubagentLifecycleEvent({
      eventName: 'spawn.execution_failed',
      outcome: 'failure',
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      subagentExecutionId: params.executionId,
      payload: {
        status: 'failed',
        error: context.resolveErrorMessage(params.error),
      },
      error: params.error,
    });
  } catch (eventError) {
    context.logger.error(
      `Failed to emit spawn.execution_failed event: ${context.resolveErrorMessage(eventError)}`,
    );
  }
}

export {
  scheduleSubagentExecutionKickoff,
  kickoffSubagentExecution,
  failSubagentExecutionKickoff,
};
