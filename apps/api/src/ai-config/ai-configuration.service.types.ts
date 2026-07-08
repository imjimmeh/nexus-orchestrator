import type { FallbackChainEntry, HarnessRuntimeConfig } from '@nexus/core';

export interface ResolveStepSettingsParams {
  explicitModel?: string;
  explicitSystemPrompt?: string;
  explicitProviderName?: string;
  agentProfileName?: string;
  promptMode?: 'override' | 'append';
  /** Inline fallback chain from steps[].inputs.fallback_chain (highest precedence). */
  stepFallbackChain?: FallbackChainEntry[];
}

export interface ResolvedAgentSettings {
  model: string;
  systemPrompt: string;
  providerName?: string;
  providerId?: string | null;
  providerSource?: 'global' | 'user' | 'scope' | null;
}

export interface ResolvedRunnerProviderConfig {
  provider: string;
  auth: HarnessRuntimeConfig['model']['auth'];
  apiKey?: string;
  baseUrl?: string;
  providerConfig?: HarnessRuntimeConfig['model']['providerConfig'];
  providerEnv: Record<string, string>;
}

export type ResolvedEmbeddingModelConfig =
  | { configured: false }
  | {
      configured: true;
      /** Database id of the active embedding `LlmModel` row. */
      modelId: string;
      /** Name used as the `model` param in the `/v1/embeddings` request. */
      modelName: string;
      provider: string;
      auth: HarnessRuntimeConfig['model']['auth'];
      apiKey?: string;
      baseUrl?: string;
      embeddingDimension: number | null;
      providerEnv: Record<string, string>;
    };
