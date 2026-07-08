import type {
  FallbackChain,
  FallbackChainEntry,
  ProviderCooldownStatus,
} from "@nexus/core";
import type { ApiClient } from "./client";

export interface ApiClientFallbackChainsMethods {
  getGlobalFallbackChain(this: ApiClient): Promise<FallbackChain>;
  setGlobalFallbackChain(
    this: ApiClient,
    entries: FallbackChainEntry[],
  ): Promise<FallbackChain>;
  getProviderCooldowns(this: ApiClient): Promise<ProviderCooldownStatus[]>;
}
