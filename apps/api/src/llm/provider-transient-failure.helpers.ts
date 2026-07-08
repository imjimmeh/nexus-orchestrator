import type { ProviderTransientFailureClassification } from './provider-transient-failure.types';

const HTTP_429_RATE_LIMIT_PATTERN =
  /(?:\bhttp\s+429\b|\bstatus\s+code:?\s*429\b|\b429\b(?=[^\n]*\b(?:usage\s+limit|rate\s+limit|too\s+many\s+requests)\b))/i;
const HTTP_529_OVERLOAD_PATTERN =
  /(?:\bhttp\s+529\b|\bstatus\s+code:?\s*529\b|\b529\b(?=[^\n]*\b(?:high\s+traffic|overload(?:ed)?)\b))/i;
const RESET_AT_PATTERN = /\bresets\s+at\s+([^\s,)]+)/i;
const PROVIDER_TIER_PATTERN =
  /\busage\s+limit\s+reached\s+for\s+(.+?)\s+\(\d+\/\d+\s+used\)/i;
const USAGE_LIMIT_PATTERN = /\((\d+)\/(\d+)\s+used\)/i;

export function classifyProviderTransientFailure(params: {
  message: string;
  resetBufferMs: number;
}): ProviderTransientFailureClassification {
  if (HTTP_429_RATE_LIMIT_PATTERN.test(params.message)) {
    return {
      retryable: true,
      reasonCode: 'provider_rate_limit_429',
      httpStatus: 429,
      ...extractUsageLimitDetails(params),
    };
  }

  if (HTTP_529_OVERLOAD_PATTERN.test(params.message)) {
    return {
      retryable: true,
      reasonCode: 'provider_overload_529',
      httpStatus: 529,
    };
  }

  return {
    retryable: false,
    reasonCode: 'generic_failure',
  };
}

function extractUsageLimitDetails(params: {
  message: string;
  resetBufferMs: number;
}): Omit<
  ProviderTransientFailureClassification,
  'retryable' | 'reasonCode' | 'httpStatus'
> {
  const details: Omit<
    ProviderTransientFailureClassification,
    'retryable' | 'reasonCode' | 'httpStatus'
  > = {};
  const resetAt = extractResetAt(params.message);

  if (resetAt) {
    details.resetAt = resetAt.toISOString();
    details.retryDelayMsOverride = Math.max(
      0,
      resetAt.getTime() - Date.now() + params.resetBufferMs,
    );
  }

  const providerTierMatch = params.message.match(PROVIDER_TIER_PATTERN);

  if (providerTierMatch) {
    details.providerTier = providerTierMatch[1].trim();
  }

  const usageLimitMatch = params.message.match(USAGE_LIMIT_PATTERN);

  if (usageLimitMatch) {
    details.usageLimit = {
      used: Number(usageLimitMatch[1]),
      limit: Number(usageLimitMatch[2]),
      unit: 'tokens',
    };
  }

  return details;
}

function extractResetAt(message: string): Date | undefined {
  const resetAtMatch = message.match(RESET_AT_PATTERN);

  if (!resetAtMatch) {
    return undefined;
  }

  const resetAt = new Date(resetAtMatch[1]);

  return Number.isNaN(resetAt.getTime()) ? undefined : resetAt;
}
