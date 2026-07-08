import type {
  FallbackChain,
  FallbackChainEntry,
  ProviderCooldownStatus,
} from "@nexus/core";
import type { ApiClient } from "./client";
import type { ApiClientFallbackChainsMethods } from "./client.fallback-chains.types";

export type { ApiClientFallbackChainsMethods };

export const fallbackChainsApiMethods: ApiClientFallbackChainsMethods = {
  async getGlobalFallbackChain(this: ApiClient): Promise<FallbackChain> {
    return this.get<FallbackChain>("/ai-config/fallback-chains/global");
  },

  async setGlobalFallbackChain(
    this: ApiClient,
    entries: FallbackChainEntry[],
  ): Promise<FallbackChain> {
    return this.put<FallbackChain>("/ai-config/fallback-chains/global", {
      entries,
    });
  },

  async getProviderCooldowns(
    this: ApiClient,
  ): Promise<ProviderCooldownStatus[]> {
    return this.get<ProviderCooldownStatus[]>("/ai-config/provider-cooldowns");
  },
};
