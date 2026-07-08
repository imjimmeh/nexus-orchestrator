import type { FallbackChainEntry } from '@nexus/core';

export interface EffectiveChainParams {
  /** The resolved primary (provider, model) — always the chain leader. */
  primary: FallbackChainEntry;
  /** Inline fallback chain from steps[].inputs.fallback_chain (highest precedence). */
  stepInlineChain?: FallbackChainEntry[];
  /** Fallback chain from the agent profile (second precedence). */
  profileChain?: FallbackChainEntry[] | null;
}
