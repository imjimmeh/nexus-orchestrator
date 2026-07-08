import type {
  FallbackChainEntry,
  HarnessCapabilities,
  HarnessContributions,
  HarnessId,
  ResolvedHarnessCredential,
  RunnerProviderAuth,
  RunnerThinkingLevel,
} from '@nexus/core';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';

export interface AgentProfileContributionsLoader {
  resolveContributions(
    name: string | undefined,
    scopeNodeId: string | null,
  ): Promise<Partial<HarnessContributions> | undefined>;
}

export interface HarnessRegistryLike {
  validateForStep(
    harnessId: HarnessId,
    required: Partial<HarnessCapabilities>,
    platformDefault?: HarnessId,
  ): { harnessId: HarnessId; fallbackReason?: string };
  resolve?: (harnessId: HarnessId) => { capabilities: HarnessCapabilities };
}

export interface HarnessCredentialResolverLike {
  resolvePrimaryAuth(params: {
    harnessId: HarnessId;
    scopeNodeId?: string;
    providerAuth: RunnerProviderAuth;
  }): Promise<RunnerProviderAuth>;
  resolveAll(params: {
    harnessId: HarnessId;
    scopeNodeId?: string;
  }): Promise<Record<string, ResolvedHarnessCredential>>;
}

export interface ScopedDefaultsLike {
  resolve(scopeNodeId?: string): Promise<{
    harnessId?: string;
    modelName?: string;
    providerName?: string;
  }>;
}

export type ThinkingLevelDecision =
  | { dropped: boolean }
  | { level: RunnerThinkingLevel; clampedFrom?: RunnerThinkingLevel };

export interface ThinkingLevelResolverLike {
  resolve(input: {
    stepInput?: RunnerThinkingLevel;
    agentProfile?: RunnerThinkingLevel;
    modelDefault?: RunnerThinkingLevel;
    provider: string;
    modelId: string;
    thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
    harnessSupportsThinkingLevels: boolean;
  }): Promise<ThinkingLevelDecision>;
}

/** Optional result-reporting hooks for `buildStepRunnerConfigPayload`. */
export type BuildStepRunnerConfigCallbacks = {
  onProfileChainResolved?: (chain: FallbackChainEntry[] | null) => void;
  onProfileResolved?: (profile: {
    id: string | null;
    name: string | null;
  }) => void;
  onAssignedSkillsResolved?: (skills: SkillLibraryRecord[]) => void;
};
