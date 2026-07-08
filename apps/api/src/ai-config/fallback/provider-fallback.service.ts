import { Injectable } from '@nestjs/common';
import type { FallbackChainEntry, ProviderCooldownReason } from '@nexus/core';
import type { ProviderTerminalFailureCode } from '../../llm/provider-terminal-failure.types';
import { classifyProviderTerminalFailure } from '../../llm/provider-terminal-failure.helpers';
import { classifyProviderTransientFailure } from '../../llm/provider-transient-failure.helpers';
import { classifyProviderOutageFailure } from '../../llm/provider-outage-failure.helpers';
import { deriveCooldownUntil } from './cooldown-duration.helpers';
import { FallbackChainResolverService } from './fallback-chain-resolver.service';
import { ProviderCooldownRepository } from '../database/repositories/provider-cooldown.repository';
import type { FallbackTrigger } from './provider-fallback.types';

const TERMINAL_REASON_MAP: Record<
  ProviderTerminalFailureCode,
  ProviderCooldownReason
> = {
  provider_usage_exhausted: 'usage_exhausted',
  provider_billing_exhausted: 'billing_exhausted',
  provider_auth_failed: 'auth_failed',
};

@Injectable()
export class ProviderFallbackService {
  constructor(
    private readonly resolver: FallbackChainResolverService,
    private readonly cooldowns: ProviderCooldownRepository,
  ) {}

  /**
   * Maps a raw provider error message to a cooldown reason, or null if not a
   * fallback trigger (e.g. plain 429 rate limits are retried, not fallen back).
   */
  classifyTrigger(message: string): FallbackTrigger | null {
    const terminal = classifyProviderTerminalFailure(message);
    if (terminal) {
      return { reason: TERMINAL_REASON_MAP[terminal.reasonCode] };
    }
    if (classifyProviderOutageFailure(message)) {
      const transient = classifyProviderTransientFailure({
        message,
        resetBufferMs: 0,
      });
      return { reason: 'provider_outage', resetAt: transient.resetAt ?? null };
    }
    return null;
  }

  /**
   * Records the cooldown for the failing provider and returns whether a viable
   * next entry exists in the effective chain.
   *
   * Returns `{ shouldRequeue: true }` when there is at least one non-cooled
   * entry remaining — the caller should requeue the job so the fallback entry
   * is used. Returns `{ shouldRequeue: false }` when the failure is not a
   * fallback trigger or when every chain entry is now under cooldown.
   */
  async handleFailure(params: {
    message: string;
    failingProvider: string;
    primary: FallbackChainEntry;
    stepInlineChain?: FallbackChainEntry[];
    profileChain?: FallbackChainEntry[] | null;
    runId?: string | null;
    now: Date;
  }): Promise<
    | { shouldRequeue: boolean; reason: ProviderCooldownReason }
    | { shouldRequeue: false; reason: null }
  > {
    const trigger = this.classifyTrigger(params.message);
    if (!trigger) {
      return { shouldRequeue: false, reason: null };
    }

    await this.cooldowns.upsertCooldown({
      provider_name: params.failingProvider,
      reason: trigger.reason,
      cooled_until: deriveCooldownUntil({
        reason: trigger.reason,
        resetAt: trigger.resetAt,
        now: params.now,
      }),
      last_failure_at: params.now,
      source_run_id: params.runId ?? null,
    });

    const chain = await this.resolver.buildEffectiveChain({
      primary: params.primary,
      stepInlineChain: params.stepInlineChain,
      profileChain: params.profileChain,
    });
    const cooled = await this.cooldowns.findActiveProviderNames(params.now);
    const viable = this.resolver.selectViableEntry(chain, cooled);

    return { shouldRequeue: viable !== null, reason: trigger.reason };
  }
}
