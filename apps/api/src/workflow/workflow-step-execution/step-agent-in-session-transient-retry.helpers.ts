import type { IJobStep } from '@nexus/core';
import type {
  ContainerAgentRequest,
  ContainerAgentResponse,
} from '../../docker/container-http-client.service';
import { classifyProviderTransientFailure } from '../../llm/provider-transient-failure.helpers';
import type {
  InSessionTransientRetryConfig,
  JobExecutionDependencies,
} from './step-agent-step-executor.multistep.types';
import type { JobQueueData } from './step-execution.types';
import { sleep } from '../../common/utils/async.utils';

const IN_SESSION_TRANSIENT_RETRY_DEFAULTS: InSessionTransientRetryConfig = {
  enabled: true,
  maxAttempts: 5,
  maxDurationMs: 0,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  retry429Unbounded: true,
  retry529Unbounded: true,
};

async function delayInSessionRetry(
  deps: JobExecutionDependencies,
  delayMs: number,
): Promise<void> {
  if (deps.sleep) {
    await deps.sleep(delayMs);
    return;
  }

  await sleep(delayMs);
}

async function resolveInSessionTransientRetryConfig(
  deps: JobExecutionDependencies,
): Promise<InSessionTransientRetryConfig> {
  if (!deps.getInSessionTransientRetryConfig) {
    return IN_SESSION_TRANSIENT_RETRY_DEFAULTS;
  }

  return deps.getInSessionTransientRetryConfig();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function shouldContinueInSessionRetry(params: {
  deps: JobExecutionDependencies;
  workflowRunId: string;
}): Promise<boolean> {
  if (!params.deps.shouldContinueInSessionRetry) {
    return true;
  }

  return params.deps.shouldContinueInSessionRetry(params.workflowRunId);
}

function calculateInSessionRetryDelayMs(params: {
  config: InSessionTransientRetryConfig;
  attempt: number;
  overrideDelayMs?: number;
}): number {
  if (
    typeof params.overrideDelayMs === 'number' &&
    Number.isFinite(params.overrideDelayMs)
  ) {
    return Math.max(0, Math.round(params.overrideDelayMs));
  }

  const exponent = Math.max(params.attempt - 1, 0);
  const baseDelay = Math.min(
    Math.round(
      params.config.initialDelayMs *
        Math.pow(params.config.backoffMultiplier, exponent),
    ),
    params.config.maxDelayMs,
  );

  if (params.config.jitterRatio <= 0) {
    return baseDelay;
  }

  const jitterWindow = Math.round(baseDelay * params.config.jitterRatio);
  const jitterOffset = Math.round((Math.random() * 2 - 1) * jitterWindow);
  return Math.max(0, baseDelay + jitterOffset);
}

function shouldRetryByReasonCode(params: {
  reasonCode: string;
  config: InSessionTransientRetryConfig;
  attempt: number;
  startedAtMs: number;
  nowMs: number;
}): boolean {
  if (
    params.config.maxDurationMs > 0 &&
    params.nowMs - params.startedAtMs >= params.config.maxDurationMs
  ) {
    return false;
  }

  if (
    params.reasonCode === 'provider_rate_limit_429' &&
    params.config.retry429Unbounded
  ) {
    return true;
  }

  if (
    params.reasonCode === 'provider_overload_529' &&
    params.config.retry529Unbounded
  ) {
    return true;
  }

  return params.attempt < params.config.maxAttempts;
}

export async function executeAgentWithInSessionTransientRetry(params: {
  baseUrl: string;
  request: ContainerAgentRequest;
  step: IJobStep;
  data: JobQueueData;
  deps: JobExecutionDependencies;
}): Promise<ContainerAgentResponse> {
  const config = await resolveInSessionTransientRetryConfig(params.deps);
  if (!config.enabled) {
    return params.deps.containerHttpClient.executeAgent(
      params.baseUrl,
      params.request,
    );
  }

  const startedAtMs = Date.now();
  let attempt = 0;

  while (true) {
    try {
      const response = await params.deps.containerHttpClient.executeAgent(
        params.baseUrl,
        params.request,
      );

      if (!response.error || response.ok) {
        return response;
      }

      const classification = classifyProviderTransientFailure({
        message: response.error,
        resetBufferMs: 60000,
      });
      if (!classification.retryable) {
        return response;
      }

      attempt += 1;
      const continuationAllowed = await shouldContinueInSessionRetry({
        deps: params.deps,
        workflowRunId: params.data.workflowRunId,
      });
      if (!continuationAllowed) {
        return response;
      }

      const shouldRetry = shouldRetryByReasonCode({
        reasonCode: classification.reasonCode,
        config,
        attempt,
        startedAtMs,
        nowMs: Date.now(),
      });
      if (!shouldRetry) {
        return response;
      }

      const delayMs = calculateInSessionRetryDelayMs({
        config,
        attempt,
        overrideDelayMs: classification.retryDelayMsOverride,
      });
      params.deps.log(
        `In-session transient retry scheduled for step '${params.step.id}' (attempt ${attempt}, reason=${classification.reasonCode}, delayMs=${delayMs})`,
      );
      await delayInSessionRetry(params.deps, delayMs);
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      const classification = classifyProviderTransientFailure({
        message: errorMessage,
        resetBufferMs: 60000,
      });

      if (!classification.retryable) {
        throw error;
      }

      attempt += 1;
      const continuationAllowed = await shouldContinueInSessionRetry({
        deps: params.deps,
        workflowRunId: params.data.workflowRunId,
      });
      if (!continuationAllowed) {
        throw error;
      }

      const shouldRetry = shouldRetryByReasonCode({
        reasonCode: classification.reasonCode,
        config,
        attempt,
        startedAtMs,
        nowMs: Date.now(),
      });
      if (!shouldRetry) {
        throw error;
      }

      const delayMs = calculateInSessionRetryDelayMs({
        config,
        attempt,
        overrideDelayMs: classification.retryDelayMsOverride,
      });
      params.deps.log(
        `In-session transient retry scheduled for step '${params.step.id}' after transport error (attempt ${attempt}, reason=${classification.reasonCode}, delayMs=${delayMs})`,
      );
      await delayInSessionRetry(params.deps, delayMs);
    }
  }
}
