import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessRuntimeConfig,
  type HarnessId,
  type HarnessCapabilities,
} from '@nexus/core';
import { resolveHarnessContributions } from '../../harness/harness-contribution-resolver';
import type { ResolveContributionsParams } from '../../harness/harness-contribution-resolver.types';
import { gatherContributionSources } from '../../harness/gather-contribution-sources';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { AgentProfileContributionsLoader } from './step-agent-step-executor.helpers.types';

type LedgerLike = { emitBestEffort: (payload: unknown) => unknown };

/**
 * Resolve contributions for the chosen harness and attach them to the config,
 * omitting the key entirely when nothing survives capability validation (keeps
 * empty-bundle runs byte-identical to before this feature).
 */
export function attachResolvedContributions(
  config: HarnessRuntimeConfig,
  resolveParams: ResolveContributionsParams,
): HarnessRuntimeConfig {
  const contributions = resolveHarnessContributions(resolveParams);
  if (contributions === EMPTY_HARNESS_CONTRIBUTIONS) return config;
  return { ...config, contributions };
}

/**
 * Gather the step/profile/skill contribution sources and attach the resolved,
 * capability-validated bundle to the base config. When the registry exposes no
 * capabilities the base config is returned unchanged.
 */
export async function resolveAndAttachStepContributions(params: {
  baseConfig: HarnessRuntimeConfig;
  harnessId: HarnessId;
  capabilities?: HarnessCapabilities;
  agentProfile?: string;
  scopeNodeId?: string;
  resolvedJobInputs: Record<string, unknown>;
  assignedSkills?: SkillLibraryRecord[];
  agentProfileResolution?: AgentProfileContributionsLoader;
  ledger?: LedgerLike;
}): Promise<HarnessRuntimeConfig> {
  if (!params.capabilities) return params.baseConfig;

  const profileContributions = params.agentProfileResolution
    ? await params.agentProfileResolution.resolveContributions(
        params.agentProfile,
        params.scopeNodeId ?? null,
      )
    : undefined;

  const sources = gatherContributionSources({
    stepInput: params.resolvedJobInputs.harness_contributions,
    profile: profileContributions,
    skills: params.assignedSkills ?? [],
  });

  return attachResolvedContributions(params.baseConfig, {
    harnessId: params.harnessId,
    capabilities: params.capabilities,
    sources,
    ledger: params.ledger,
  });
}
