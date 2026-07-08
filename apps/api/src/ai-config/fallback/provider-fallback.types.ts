import type { ProviderCooldownReason } from '@nexus/core';

export interface FallbackTrigger {
  reason: ProviderCooldownReason;
  resetAt?: string | null;
}
