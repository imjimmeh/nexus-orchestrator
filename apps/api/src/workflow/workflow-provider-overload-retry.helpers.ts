import type { SystemSettingsService } from '../settings/system-settings.service';
import { classifyWorkflowFailure } from './workflow-failure-classification.helpers';
import type { WorkflowRetryDecision } from './workflow-provider-overload-retry.types';

const WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_ENABLED_KEY =
  'workflow_auto_retry_provider_overload_enabled';
const WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_DELAY_MS_KEY =
  'workflow_auto_retry_provider_overload_delay_ms';
const WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_DELAY_MS_DEFAULT =
  5 * 60 * 60 * 1000;
const WORKFLOW_AUTO_RETRY_RATE_LIMIT_RESET_BUFFER_MS_KEY =
  'workflow_auto_retry_rate_limit_reset_buffer_ms';
const WORKFLOW_AUTO_RETRY_RATE_LIMIT_RESET_BUFFER_MS_DEFAULT = 60 * 1000;

export async function resolveWorkflowRetryDecision(params: {
  reason: string;
  systemSettings: SystemSettingsService;
}): Promise<WorkflowRetryDecision> {
  const providerOverloadRetryEnabled = await params.systemSettings.get<boolean>(
    WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_ENABLED_KEY,
    true,
  );
  const providerOverloadDelayRaw = await params.systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_DELAY_MS_KEY,
    WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_DELAY_MS_DEFAULT,
  );
  const providerOverloadDelayMs =
    typeof providerOverloadDelayRaw === 'number' &&
    Number.isFinite(providerOverloadDelayRaw)
      ? Math.round(providerOverloadDelayRaw)
      : WORKFLOW_AUTO_RETRY_PROVIDER_OVERLOAD_DELAY_MS_DEFAULT;
  const rateLimitResetBufferRaw = await params.systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_RATE_LIMIT_RESET_BUFFER_MS_KEY,
    WORKFLOW_AUTO_RETRY_RATE_LIMIT_RESET_BUFFER_MS_DEFAULT,
  );
  const rateLimitResetBufferMs =
    typeof rateLimitResetBufferRaw === 'number' &&
    Number.isFinite(rateLimitResetBufferRaw)
      ? Math.max(0, Math.round(rateLimitResetBufferRaw))
      : WORKFLOW_AUTO_RETRY_RATE_LIMIT_RESET_BUFFER_MS_DEFAULT;

  const failureClassification = classifyWorkflowFailure({
    reason: params.reason,
    providerOverloadDelayMs,
    rateLimitResetBufferMs,
  });

  if (
    failureClassification.retryCategory === 'provider_overload_529' &&
    providerOverloadRetryEnabled
  ) {
    return {
      reasonCode: failureClassification.reasonCode,
      allowWhenWorkflowAutoRetryDisabled: true,
      retryDelayMsOverride: failureClassification.retryDelayMsOverride,
    };
  }

  if (failureClassification.retryCategory === 'provider_rate_limit_429') {
    return {
      reasonCode: failureClassification.reasonCode,
      allowWhenWorkflowAutoRetryDisabled: true,
      retryDelayMsOverride: failureClassification.retryDelayMsOverride,
      resetAt: failureClassification.resetAt,
      providerTier: failureClassification.providerTier,
      usageLimit: failureClassification.usageLimit,
    };
  }

  return {
    reasonCode: failureClassification.reasonCode,
  };
}
