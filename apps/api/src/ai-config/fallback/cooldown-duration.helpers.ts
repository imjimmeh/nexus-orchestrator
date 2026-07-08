import {
  FALLBACK_COOLDOWN_DEFAULT_MS,
  type ProviderCooldownReason,
} from '@nexus/core';

export function deriveCooldownUntil(params: {
  reason: ProviderCooldownReason;
  resetAt?: string | null;
  now: Date;
}): Date {
  if (params.resetAt) {
    const reset = new Date(params.resetAt);
    if (
      !Number.isNaN(reset.getTime()) &&
      reset.getTime() > params.now.getTime()
    ) {
      return reset;
    }
  }
  return new Date(
    params.now.getTime() + FALLBACK_COOLDOWN_DEFAULT_MS[params.reason],
  );
}
