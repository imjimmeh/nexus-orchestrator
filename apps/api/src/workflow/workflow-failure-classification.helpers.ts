import { classifyProviderTransientFailure } from '../llm/provider-transient-failure.helpers';
import type { WorkflowFailureClassification } from './workflow-failure-classification.types';

const PROVIDER_OVERLOAD_MARKERS = [
  'high traffic detected',
  'http 529',
  ' 529 ',
  'status code: 529',
  'provider overloaded',
];

export const AGENT_TRANSPORT_TIMEOUT_PATTERN =
  /(?:HTTP POST timed out|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|504.*timed out|gateway timeout|Gateway Timeout|504)/i;

const RESOURCE_CONTENTION_PATTERN =
  /lane_capacity_exhausted|conflicting lease|Mutation blocked — conflicting lease|lease capacity/i;

const PROVIDER_ABORT_FINISH_REASON_PATTERN =
  /Provider finish_reason:\s*abort|finish_reason:\s*abort/i;

export function matchesProviderAbortFinishReason(reason: string): boolean {
  return PROVIDER_ABORT_FINISH_REASON_PATTERN.test(reason);
}

// A lost execution container (reaped by the supervisor) and a stale-run watchdog
// stall are the same underlying fault: the run was left with no live step job
// because its container exited before reporting an outcome. Classifying both
// distinctly keeps the failure out of the opaque `generic_failure` bucket so
// telemetry, repair eligibility, and operators can recognise it on sight.
const CONTAINER_LOST_PATTERN =
  /Execution container exited or was lost|no active or queued step job|stale-run watchdog/i;

export function classifyWorkflowFailure(params: {
  reason: string;
  providerOverloadDelayMs: number;
  rateLimitResetBufferMs?: number;
}): WorkflowFailureClassification {
  const providerFailure = classifyProviderTransientFailure({
    message: params.reason,
    resetBufferMs: params.rateLimitResetBufferMs ?? 60_000,
  });

  if (providerFailure.reasonCode === 'provider_rate_limit_429') {
    return {
      reasonCode: providerFailure.reasonCode,
      retryCategory: providerFailure.reasonCode,
      retryDelayMsOverride: providerFailure.retryDelayMsOverride,
      resetAt: providerFailure.resetAt,
      providerTier: providerFailure.providerTier,
      usageLimit: providerFailure.usageLimit,
    };
  }

  if (providerFailure.reasonCode === 'provider_overload_529') {
    return {
      reasonCode: providerFailure.reasonCode,
      retryCategory: providerFailure.reasonCode,
      retryDelayMsOverride: params.providerOverloadDelayMs,
    };
  }

  if (AGENT_TRANSPORT_TIMEOUT_PATTERN.test(params.reason)) {
    return {
      reasonCode: 'agent_transport_timeout',
      retryCategory: 'default',
    };
  }

  if (matchesProviderAbortFinishReason(params.reason)) {
    return {
      reasonCode: 'provider_finish_reason_abort',
      retryCategory: 'default',
    };
  }

  if (RESOURCE_CONTENTION_PATTERN.test(params.reason)) {
    return {
      reasonCode: 'resource_contention',
      retryCategory: 'resource_contention',
    };
  }

  if (CONTAINER_LOST_PATTERN.test(params.reason)) {
    return {
      reasonCode: 'container_lost',
      retryCategory: 'default',
    };
  }

  const normalizedReason = params.reason.toLowerCase();
  const isProviderOverload = PROVIDER_OVERLOAD_MARKERS.some((marker) =>
    normalizedReason.includes(marker),
  );

  if (!isProviderOverload) {
    return {
      reasonCode: 'generic_failure',
      retryCategory: 'default',
    };
  }

  return {
    reasonCode: 'provider_overload_529',
    retryCategory: 'provider_overload_529',
    retryDelayMsOverride: params.providerOverloadDelayMs,
  };
}
