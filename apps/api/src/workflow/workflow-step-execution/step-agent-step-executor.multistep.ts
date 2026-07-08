import { IJobStep } from '@nexus/core';
import { JobQueueData } from './step-execution.types';
import type { ContainerAgentRequest } from '../../docker/container-http-client.service';
import { waitForStepContainerHealth } from './step-agent-step-executor.health-wait';
import type { JobExecutionDependencies } from './step-agent-step-executor.multistep.types';
import { classifyProviderTransientFailure } from '../../llm/provider-transient-failure.helpers';
import { classifyProviderTerminalFailure } from '../../llm/provider-terminal-failure.helpers';
import { classifyProviderOutageFailure } from '../../llm/provider-outage-failure.helpers';
import { executeAgentWithInSessionTransientRetry } from './step-agent-in-session-transient-retry.helpers';
import {
  ASYNC_DISPATCH_MODE_ENV,
  ASYNC_DISPATCH_MODE_VALUE,
} from './async-dispatch-registry';
import { runWithPeriodicHeartbeat } from './command-step-heartbeat.helpers';

export type { JobExecutionDependencies } from './step-agent-step-executor.multistep.types';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveRequestAuth(
  request: ContainerAgentRequest,
): ContainerAgentRequest['auth'] {
  return request.auth ?? { type: 'api_key', apiKey: request.apiKey ?? '' };
}

function hasRunnableAuth(request: ContainerAgentRequest): boolean {
  const auth = resolveRequestAuth(request);
  if (auth.type === 'api_key') {
    return isNonEmptyString(auth.apiKey) || isNonEmptyString(request.apiKey);
  }

  return (
    isNonEmptyString(auth.credential.refreshToken) &&
    isNonEmptyString(auth.credential.accessToken) &&
    Number.isFinite(auth.credential.expiresAt)
  );
}

function collectMissingAgentRequestFields(
  request: ContainerAgentRequest,
): string[] {
  const missing: string[] = [];

  if (!isNonEmptyString(request.provider)) {
    missing.push('provider');
  }
  if (!isNonEmptyString(request.model)) {
    missing.push('model');
  }
  if (!hasRunnableAuth(request)) {
    missing.push('auth');
  }
  if (!isNonEmptyString(request.stepId)) {
    missing.push('stepId');
  }

  return missing;
}

async function injectSessionBestEffort(
  containerId: string,
  deps: JobExecutionDependencies,
  resumeSessionTreeId?: string,
): Promise<void> {
  if (!deps.injectSession) {
    return;
  }

  try {
    await deps.injectSession(containerId, resumeSessionTreeId);
  } catch (error) {
    deps.warn(
      `Failed to inject previous session into container: ${(error as Error).message}`,
    );
  }
}

async function persistProducedSessionRefBestEffort(
  workflowRunId: string,
  result: StepExecutionResult,
  deps: JobExecutionDependencies,
): Promise<void> {
  if (!deps.persistProducedSessionRef) {
    return;
  }
  // Collect any produced Claude Code session id from the step outputs.
  const sessionId = Object.values(result.outputs)
    .map((o) => o.producedSessionId)
    .find((id): id is string => typeof id === 'string' && id.length > 0);

  if (!sessionId) {
    return;
  }

  try {
    await deps.persistProducedSessionRef(workflowRunId, {
      kind: 'claude_code',
      sessionId,
    });
  } catch (error) {
    deps.warn(
      `Failed to persist produced session ref for run ${workflowRunId}: ${(error as Error).message}`,
    );
  }
}

async function persistResolvedConfigBestEffort(
  runnerConfig: Awaited<
    ReturnType<JobExecutionDependencies['buildStepRunnerConfig']>
  >,
  deps: JobExecutionDependencies,
): Promise<void> {
  if (!deps.persistResolvedConfig) {
    return;
  }

  try {
    const resolvedProfile = deps.getResolvedAgentProfile?.() ?? null;
    await deps.persistResolvedConfig({
      provider: runnerConfig.model.provider,
      model: runnerConfig.model.model,
      harness_id: runnerConfig.harnessId,
      ...(resolvedProfile
        ? {
            agent_profile_id: resolvedProfile.id,
            agent_profile_name: resolvedProfile.name,
          }
        : {}),
    });
  } catch (error) {
    deps.warn(
      `Failed to persist resolved runner config: ${(error as Error).message}`,
    );
  }
}

async function notifyContainerProvisionedBestEffort(
  containerId: string,
  jobId: string,
  deps: JobExecutionDependencies,
): Promise<void> {
  if (!deps.notifyContainerProvisioned) {
    return;
  }

  try {
    await deps.notifyContainerProvisioned(containerId);
  } catch (error) {
    deps.warn(
      `Failed to report provisioned container ${containerId} for job ${jobId}: ${(error as Error).message}`,
    );
  }
}

async function saveSessionBestEffort(
  containerId: string,
  jobId: string,
  deps: JobExecutionDependencies,
): Promise<string | null> {
  if (!deps.saveSession) {
    return null;
  }

  try {
    const sessionTreeId = await deps.saveSession(containerId);
    deps.log(`Saved session tree ${sessionTreeId} for job ${jobId}`);
    return sessionTreeId;
  } catch (error) {
    deps.warn(
      `Failed to save session for job ${jobId}: ${(error as Error).message}`,
    );
    return null;
  }
}

async function shutdownContainerServerBestEffort(
  baseUrl: string,
  deps: JobExecutionDependencies,
): Promise<void> {
  try {
    await deps.containerHttpClient.shutdown(baseUrl);
  } catch {
    // best-effort graceful shutdown
  }
}

export async function executeJobCore(params: {
  data: JobQueueData;
  bullJobId: string | number | undefined;
  stateVariables: Record<string, unknown>;
  resolvedJobInputs: Record<string, unknown>;
  deps: JobExecutionDependencies;
}): Promise<unknown> {
  const { data, stateVariables, resolvedJobInputs, deps } = params;
  const { workflowRunId, jobId, job } = data;
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (!steps.length) throw new Error(`Job ${jobId} has no steps to execute`);

  deps.log(
    `Executing job ${jobId} (${steps.length} step(s)) via container server`,
  );

  let containerId: string | null = null;
  let stopLogStreaming: (() => void) | null = null;
  let baseUrl: string | null = null;

  try {
    if (deps.killStaleContainers) {
      await deps.killStaleContainers(workflowRunId, jobId);
    }

    containerId = await deps.provisionContainer(data, stateVariables);
    await notifyContainerProvisionedBestEffort(containerId, jobId, deps);
    await injectSessionBestEffort(containerId, deps, data.resumeSessionTreeId);

    stopLogStreaming = await deps.startContainerAndStreamLogs(
      containerId,
      workflowRunId,
      jobId,
    );

    const containerIp = await deps.getContainerIp(containerId);
    baseUrl = deps.containerHttpClient.buildBaseUrl(containerIp);

    deps.log(`Container ${containerId} IP=${containerIp}, waiting for health`);
    await waitForStepContainerHealth(deps, baseUrl, containerId);
    const healthyBaseUrl = baseUrl;

    const result = await deps.stepExecutionService.execute({
      workflowRunId,
      jobId,
      job,
      stateVariables,
      executeStep: async (step: IJobStep) => {
        return executeStepOnContainer(
          step,
          healthyBaseUrl,
          data,
          resolvedJobInputs,
          stateVariables,
          deps,
        );
      },
    });

    const sessionTreeIdForRetry = await saveSessionBestEffort(
      containerId,
      jobId,
      deps,
    );

    await persistProducedSessionRefBestEffort(workflowRunId, result, deps);

    // Classify and handle provider failures:
    //  - Transient (429/529): publish retryable turn-end and re-throw.
    //  - Outage (5xx): advance fallback chain; if no viable entry, fall through.
    //  - Terminal (billing/auth/usage): advance fallback chain or hard-fail.
    const requeued = await handleProviderFailure({
      containerId,
      jobId,
      result,
      sessionTreeId: sessionTreeIdForRetry,
      workflowRunId,
      deps,
    });
    if (requeued) return { status: 'fallback_requeued', containerId };

    const retryDecision = await deps.checkRequiredToolRetry(containerId);
    if (retryDecision === 'retried') {
      deps.log(`Job ${jobId} re-enqueued due to missing required tool calls`);
      return { status: 'retried', containerId };
    }

    const output = buildJobCompletionOutput({
      containerId,
      jobId,
      result,
      sessionTreeId: sessionTreeIdForRetry,
    });

    if (result.status === 'failed') {
      await deps.publishTurnEnd(workflowRunId, jobId, output);
      throw new Error(resolveStepFailureMessage(result, jobId));
    }

    await deps.publishTurnEndAndComplete(workflowRunId, jobId, output);

    return { status: result.status, containerId };
  } finally {
    if (baseUrl) {
      await shutdownContainerServerBestEffort(baseUrl, deps);
    }
    if (containerId) {
      await deps.cleanup(containerId, stopLogStreaming);
    }
  }
}

type StepExecutionResult = Awaited<
  ReturnType<JobExecutionDependencies['stepExecutionService']['execute']>
>;

/**
 * Unified provider failure handler. Returns true when the job is requeued on
 * a fallback entry. Throws for transient retries or hard terminal failures.
 */
async function handleProviderFailure(params: {
  containerId: string;
  deps: JobExecutionDependencies;
  jobId: string;
  result: StepExecutionResult;
  sessionTreeId: string | null;
  workflowRunId: string;
}): Promise<boolean> {
  if (params.result.status !== 'failed') {
    return false;
  }

  const errorMsg = resolveStepFailureMessage(params.result, params.jobId);
  const completionOutput = buildJobCompletionOutput({
    containerId: params.containerId,
    jobId: params.jobId,
    result: params.result,
    sessionTreeId: params.sessionTreeId,
  });

  const transient = classifyProviderTransientFailure({
    message: errorMsg,
    resetBufferMs: 60000,
  });
  if (transient.retryable) {
    await params.deps.publishTurnEnd(params.workflowRunId, params.jobId, {
      ...completionOutput,
      retryable: true,
      reasonCode: transient.reasonCode,
      httpStatus: transient.httpStatus,
      resetAt: transient.resetAt,
      providerTier: transient.providerTier,
      usageLimit: transient.usageLimit,
    });
    throw new Error(errorMsg);
  }

  // Outage (5xx/529): advance fallback chain; if no viable entry, fall through.
  if (classifyProviderOutageFailure(errorMsg)) {
    const outageRequeued = await params.deps.tryFallbackAdvance?.({
      message: errorMsg,
      runId: params.workflowRunId,
      failedJobId: params.jobId,
    });
    if (outageRequeued) return true;
  }

  const terminal = classifyProviderTerminalFailure(errorMsg);
  if (!terminal) {
    return false;
  }

  const terminalRequeued = await params.deps.tryFallbackAdvance?.({
    message: errorMsg,
    runId: params.workflowRunId,
    failedJobId: params.jobId,
  });
  if (terminalRequeued) return true;

  await params.deps.publishTurnEnd(params.workflowRunId, params.jobId, {
    ...completionOutput,
    retryable: false,
    reasonCode: terminal.reasonCode,
  });
  throw new Error(errorMsg);
}

function resolveStepFailureMessage(
  result: StepExecutionResult,
  jobId: string,
): string {
  const o = result.outputs[result.finalStepId ?? ''];
  return (
    ((o?.error || o?.errorMessage || o?.message) as string) ||
    `Job ${jobId} failed at step ${result.finalStepId}`
  );
}

function buildJobCompletionOutput(params: {
  containerId: string;
  jobId: string;
  result: StepExecutionResult;
  sessionTreeId: string | null;
}): Record<string, unknown> {
  return {
    ok: params.result.status === 'completed',
    containerId: params.containerId,
    jobId: params.jobId,
    finalStepId: params.result.finalStepId,
    outputs: params.result.outputs,
    ...(params.sessionTreeId ? { sessionTreeId: params.sessionTreeId } : {}),
  };
}

async function executeStepOnContainer(
  step: IJobStep,
  baseUrl: string,
  data: JobQueueData,
  resolvedJobInputs: Record<string, unknown>,
  stateVariables: Record<string, unknown>,
  deps: JobExecutionDependencies,
): Promise<Record<string, unknown>> {
  const stepType = step.type ?? 'agent';

  if (stepType === 'run_command') {
    return executeCommandStepOnContainer(step, baseUrl, deps);
  }

  if (stepType === 'agent') {
    return executeAgentStepOnContainer(
      step,
      baseUrl,
      data,
      resolvedJobInputs,
      stateVariables,
      deps,
    );
  }

  throw new Error(`Unsupported step type '${stepType}' in container execution`);
}

async function executeAgentStepOnContainer(
  step: IJobStep,
  baseUrl: string,
  data: JobQueueData,
  resolvedJobInputs: Record<string, unknown>,
  stateVariables: Record<string, unknown>,
  deps: JobExecutionDependencies,
): Promise<Record<string, unknown>> {
  const runnerConfig = await deps.buildStepRunnerConfig(
    data,
    step,
    resolvedJobInputs,
    stateVariables,
  );

  await persistResolvedConfigBestEffort(runnerConfig, deps);

  const request: ContainerAgentRequest = {
    provider: runnerConfig.model.provider,
    model: runnerConfig.model.model,
    auth: runnerConfig.model.auth,
    baseUrl: runnerConfig.model.baseUrl,
    providerConfig: runnerConfig.model.providerConfig,
    systemPrompt: runnerConfig.prompt.systemPrompt,
    initialPrompt: runnerConfig.prompt.initialPrompt,
    temperature: runnerConfig.model.temperature,
    thinkingLevel: runnerConfig.model.thinkingLevel,
    stepId: step.id,
  };

  const missingFields = collectMissingAgentRequestFields(request);
  if (missingFields.length > 0) {
    throw new Error(
      `Cannot execute agent step '${step.id ?? 'unknown'}' for job '${data.jobId}': missing required runner config fields (${missingFields.join(', ')})`,
    );
  }

  const kickoffMessage =
    typeof request.initialPrompt === 'string' &&
    request.initialPrompt.trim().length > 0
      ? request.initialPrompt
      : request.systemPrompt;

  const publishProcessEvent = deps.publishProcessEvent;
  if (typeof publishProcessEvent === 'function') {
    try {
      await publishProcessEvent(data.workflowRunId, 'agent_prompt_sent', {
        workflowRunId: data.workflowRunId,
        jobId: data.jobId,
        stepId: step.id,
        source: 'workflow_step',
        message: kickoffMessage,
      });
    } catch {
      deps.warn(
        `Failed to publish outbound kickoff prompt for step '${step.id}'`,
      );
    }
  }

  if (
    process.env[ASYNC_DISPATCH_MODE_ENV] === ASYNC_DISPATCH_MODE_VALUE &&
    deps.awaitAsyncDispatch
  ) {
    const accepted = await deps.containerHttpClient.executeAgentAsync(
      baseUrl,
      request,
    );
    if (!accepted.ok) {
      throw new Error(`Async agent dispatch rejected for step '${step.id}'`);
    }
    deps.log(
      `Async dispatch accepted for step '${step.id}', awaiting completion`,
    );
    await deps.awaitAsyncDispatch(data.workflowRunId, step.id);
    return {
      ok: true,
      stepId: step.id,
      response: '',
    };
  }

  deps.log(`Executing agent step '${step.id}' on container`);
  const response = await executeAgentWithInSessionTransientRetry({
    baseUrl,
    request,
    step,
    data,
    deps,
  });

  return {
    ok: response.ok,
    stepId: step.id,
    response: response.response,
    ...(response.error ? { error: response.error } : {}),
    ...(response.producedSessionId
      ? { producedSessionId: response.producedSessionId }
      : {}),
  };
}

async function executeCommandStepOnContainer(
  step: IJobStep,
  baseUrl: string,
  deps: JobExecutionDependencies,
): Promise<Record<string, unknown>> {
  const command = step.command;
  if (!command) {
    throw new Error(`run_command step '${step.id}' has no command`);
  }

  deps.log(`Executing command step '${step.id}': ${command}`);
  const response = await runWithPeriodicHeartbeat(
    () =>
      deps.containerHttpClient.executeCommand(baseUrl, {
        command,
        timeoutMs: step.timeout_ms,
        workingDir: step.working_dir,
        stepId: step.id,
      }),
    () => deps.recordHeartbeat?.(),
  );

  return {
    ok: response.ok,
    stepId: step.id,
    exit_code: response.exit_code,
    stdout: response.stdout,
    stderr: response.stderr,
    timed_out: response.timed_out,
    stdout_lines: response.stdout ? response.stdout.split(/\r?\n/) : [],
  };
}
