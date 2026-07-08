import { getAutoRetryConfig } from './workflow-run-auto-retry-config.helpers';

const WORKFLOW_AUTO_RETRY_MINIMUM_DELAY_MS = 60000;

export function calculateRetryDelayMs(
  config: Awaited<ReturnType<typeof getAutoRetryConfig>>,
  attempt: number,
): number {
  const exponent = Math.max(attempt - 1, 0);
  const baseDelay = Math.min(
    Math.round(
      config.initialDelayMs * Math.pow(config.backoffMultiplier, exponent),
    ),
    config.maxDelayMs,
  );

  if (config.jitterRatio <= 0) {
    return baseDelay;
  }

  const jitterWindow = Math.round(baseDelay * config.jitterRatio);
  const jitterOffset = Math.round((Math.random() * 2 - 1) * jitterWindow);
  return Math.max(0, baseDelay + jitterOffset);
}

export function resolveRetryDelayMs(params: {
  retryConfig: Awaited<ReturnType<typeof getAutoRetryConfig>>;
  nextAttempt: number;
  overrideDelayMs?: number;
}): number {
  const calculatedDelayMs = calculateRetryDelayMs(
    params.retryConfig,
    params.nextAttempt,
  );

  if (
    typeof params.overrideDelayMs !== 'number' ||
    !Number.isFinite(params.overrideDelayMs)
  ) {
    return calculatedDelayMs;
  }

  return Math.max(
    WORKFLOW_AUTO_RETRY_MINIMUM_DELAY_MS,
    Math.round(params.overrideDelayMs),
  );
}
