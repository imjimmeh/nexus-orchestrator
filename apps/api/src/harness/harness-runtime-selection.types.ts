import type { HarnessCapabilities, HarnessId } from '@nexus/core';
import type { AiConfigurationService } from '../ai-config/ai-configuration.service';

export type ResolvedRunnerProviderConfig = Awaited<
  ReturnType<AiConfigurationService['resolveRunnerProviderConfig']>
>;

/**
 * Minimal structural shape of the harness registry needed for runner
 * selection. Both `HarnessProviderRegistryService` and the workflow
 * `HarnessRegistryLike` interface satisfy it.
 */
export interface HarnessSelectionRegistry {
  validateForStep(
    harnessId: HarnessId,
    required: Partial<HarnessCapabilities>,
    platformDefault?: HarnessId,
  ): { harnessId: HarnessId; fallbackReason?: string };
  resolve?: (harnessId: HarnessId) => {
    capabilities: HarnessCapabilities;
    defaultEnv?: Record<string, string>;
  };
}

export interface RunnerHarnessSelection {
  harnessId: HarnessId;
  providerConfig: ResolvedRunnerProviderConfig;
}
