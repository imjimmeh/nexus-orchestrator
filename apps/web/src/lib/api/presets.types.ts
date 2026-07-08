/**
 * Provider / model preset and effective-config types — moved out of
 * `./types.ts` so the rest of the web API client can consume a stable
 * surface while the legacy `./types.ts` is incrementally depopulated by
 * child-7.
 */

import type { AuthType } from "./common.types";

export interface ProviderPreset {
  id: string;
  name: string;
  auth_type: AuthType;
  uses_callback_server?: boolean;
  oauth_authorization_url?: string | null;
  oauth_token_url?: string | null;
  oauth_scopes?: string[] | null;
}

export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  supportedThinkingLevels?: string[];
  thinkingLevelMap?: Partial<Record<string, string | null>>;
}

export interface EffectiveConfigLayer {
  rowId: string;
  scopeNodeId: string | null;
  source: string;
  strategy: "replace" | "merge";
}

export interface EffectiveConfig<T> {
  objectType: string;
  name: string;
  scopeNodeId: string;
  value: T;
  contributingLayers: EffectiveConfigLayer[];
  isDefault: boolean;
  locked: boolean;
}