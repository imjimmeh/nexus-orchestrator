import type { FallbackChainEntry } from '@nexus/core';
import type { ProviderFallbackService } from '../../ai-config/fallback/provider-fallback.service';

/** System-settings key that gates the fallback-chain feature (default `true`). */
export const FALLBACK_CHAINS_ENABLED_KEY = 'fallback_chains.enabled';

/**
 * Validates and narrows an unknown value to a `FallbackChainEntry[]`.
 * Returns `undefined` when the value is absent, empty, or contains no valid
 * entries so the caller can fall through to the global default chain.
 */
export function parseFallbackChain(
  value: unknown,
): FallbackChainEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const entries = (value as unknown[]).filter(
    (item): item is FallbackChainEntry =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).provider_name === 'string' &&
      typeof (item as Record<string, unknown>).model_name === 'string',
  );
  return entries.length > 0 ? entries : undefined;
}

/**
 * Builds callbacks used by the step executor to (a) capture the resolved
 * provider/model after runner config is built, (b) capture the agent profile's
 * fallback chain after the profile is resolved, and (c) attempt a
 * fallback-chain advance when the provider fails terminally.
 *
 * @param getEnabled - Async supplier that reads the `fallback_chains.enabled`
 *   system setting. Called lazily on each advance attempt so the setting can
 *   be changed at runtime without restarting the service.
 */
export function buildFallbackAdvanceDeps(
  fallbackSvc: ProviderFallbackService,
  requeue: (args: {
    runId: string;
    failedJobId: string;
    retryPrompt: string;
  }) => Promise<void>,
  getEnabled: () => Promise<boolean>,
): {
  captureProvider: (
    providerName: string,
    modelName: string,
    chain?: FallbackChainEntry[],
  ) => void;
  captureProfileChain: (chain: FallbackChainEntry[] | null) => void;
  advance: (args: {
    message: string;
    runId: string;
    failedJobId: string;
  }) => Promise<boolean>;
} {
  let primary: FallbackChainEntry | null = null;
  let stepInlineChain: FallbackChainEntry[] | undefined;
  let profileChain: FallbackChainEntry[] | null = null;
  return {
    captureProvider(providerName, modelName, chain) {
      primary = { provider_name: providerName, model_name: modelName };
      stepInlineChain = chain;
    },
    captureProfileChain(chain) {
      profileChain = chain;
    },
    async advance({ message, runId, failedJobId }) {
      if (!primary) return false;
      const enabled = await getEnabled();
      return maybeAdvanceFallback({
        enabled,
        message,
        primary,
        profileChain,
        stepInlineChain,
        runId,
        failedJobId,
        now: new Date(),
        fallback: fallbackSvc,
        requeue,
      });
    },
  };
}

export async function maybeAdvanceFallback(params: {
  enabled: boolean;
  message: string;
  primary: FallbackChainEntry;
  profileChain?: FallbackChainEntry[] | null;
  stepInlineChain?: FallbackChainEntry[];
  runId: string;
  failedJobId: string;
  now: Date;
  fallback: ProviderFallbackService;
  requeue: (args: {
    runId: string;
    failedJobId: string;
    retryPrompt: string;
  }) => Promise<unknown>;
}): Promise<boolean> {
  if (!params.enabled) {
    return false;
  }
  const decision = await params.fallback.handleFailure({
    message: params.message,
    failingProvider: params.primary.provider_name,
    primary: params.primary,
    stepInlineChain: params.stepInlineChain,
    profileChain: params.profileChain,
    runId: params.runId,
    now: params.now,
  });
  if (!decision.shouldRequeue) {
    return false;
  }
  await params.requeue({
    runId: params.runId,
    failedJobId: params.failedJobId,
    retryPrompt: `The previous provider was unavailable (${decision.reason}); retrying this job on the next configured fallback model.`,
  });
  return true;
}
