import { Injectable } from '@nestjs/common';
import type { FallbackChainEntry } from '@nexus/core';
import {
  FallbackChainRepository,
  GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
} from '../database/repositories/fallback-chain.repository';
import { ProviderCooldownRepository } from '../database/repositories/provider-cooldown.repository';
import type { EffectiveChainParams } from './fallback-chain-resolver.types';

@Injectable()
export class FallbackChainResolverService {
  constructor(
    private readonly chains: FallbackChainRepository,
    private readonly cooldowns: ProviderCooldownRepository,
  ) {}

  /**
   * Builds the effective fallback chain applying layered precedence:
   * stepInlineChain > profileChain > global default.
   * The primary is always guaranteed to lead the chain.
   * Duplicate (provider, model) pairs are removed, preserving order.
   */
  async buildEffectiveChain(
    params: EffectiveChainParams,
  ): Promise<FallbackChainEntry[]> {
    const configured =
      this.nonEmpty(params.stepInlineChain) ??
      this.nonEmpty(params.profileChain) ??
      this.nonEmpty(
        (await this.chains.findByName(GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME))
          ?.entries,
      );

    if (!configured) {
      return [params.primary];
    }

    // Guarantee the primary leads the chain and entries are de-duplicated by (provider, model).
    return this.dedupe([params.primary, ...configured]);
  }

  /**
   * Pure: returns the first entry whose provider is not in cooledProviders;
   * null if every entry is cooled.
   */
  selectViableEntry(
    chain: FallbackChainEntry[],
    cooledProviders: Set<string>,
  ): FallbackChainEntry | null {
    return (
      chain.find((entry) => !cooledProviders.has(entry.provider_name)) ?? null
    );
  }

  /**
   * Convenience for the read path: builds the effective chain, loads active
   * cooldowns at `now`, selects the first viable entry, and falls back to the
   * primary (best-effort) when all entries are cooled or no chain is configured.
   */
  async resolve(
    params: EffectiveChainParams,
    now: Date,
  ): Promise<FallbackChainEntry> {
    const chain = await this.buildEffectiveChain(params);
    if (chain.length <= 1) {
      return params.primary;
    }
    const cooled = await this.cooldowns.findActiveProviderNames(now);
    return this.selectViableEntry(chain, cooled) ?? params.primary;
  }

  private nonEmpty(
    entries?: FallbackChainEntry[] | null,
  ): FallbackChainEntry[] | null {
    return entries && entries.length > 0 ? entries : null;
  }

  private dedupe(entries: FallbackChainEntry[]): FallbackChainEntry[] {
    const seen = new Set<string>();
    const out: FallbackChainEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.provider_name}::${entry.model_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(entry);
      }
    }
    return out;
  }
}
