import type {
  HarnessRuntimeConfig,
  RunnerProviderRegistrationConfig,
  RunnerThinkingLevel,
} from '@nexus/core';
import { parseThinkingLevel } from '@nexus/core';
import type { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import type { ThinkingLevelResolverLike } from './step-agent-step-executor.helpers.types';

type ThinkingLevelLedgerLike = {
  emitBestEffort: (payload: unknown) => unknown;
};

type ThinkingLevelAiConfig = Pick<
  AiConfigurationService,
  'getAgentProfileByName' | 'getModelDefaultThinkingLevel'
>;

/**
 * Loads profile/model thinking-level defaults from the DB, resolves the
 * effective level via `resolver`, and stamps it onto `baseConfig.model`. Shared
 * by the workflow-step dispatch path and the subagent-provisioning path so both
 * apply identical precedence and clamping. Skips all DB reads when no resolver
 * is wired in.
 *
 * Precedence is first-defined-wins across `stepInput` -> `agentProfile` ->
 * `modelDefault`. The subagent path has no step-input layer and passes
 * `stepInputRaw: undefined`.
 */
export async function resolveAndApplyThinkingLevel(params: {
  baseConfig: HarnessRuntimeConfig;
  resolver?: ThinkingLevelResolverLike;
  agentProfileName: string | undefined;
  stepInputRaw: unknown;
  modelId: string;
  provider: string;
  providerConfig?: RunnerProviderRegistrationConfig;
  harnessSupportsThinkingLevels: boolean;
  aiConfig: ThinkingLevelAiConfig;
  ledger?: ThinkingLevelLedgerLike;
}): Promise<void> {
  if (!params.resolver) return;

  const [agentProfile, modelDefault] = await Promise.all([
    params.agentProfileName
      ? params.aiConfig
          .getAgentProfileByName(params.agentProfileName)
          .then((p) => parseThinkingLevel(p?.thinking_level ?? null))
      : Promise.resolve<RunnerThinkingLevel | undefined>(undefined),
    params.aiConfig
      .getModelDefaultThinkingLevel(params.modelId)
      .then(parseThinkingLevel),
  ]);

  const thinkingLevelMap = params.providerConfig?.models?.find(
    (m) => m.id === params.modelId,
  )?.thinkingLevelMap;

  const decision = await params.resolver.resolve({
    stepInput: parseThinkingLevel(params.stepInputRaw),
    agentProfile,
    modelDefault,
    provider: params.provider,
    modelId: params.modelId,
    thinkingLevelMap,
    harnessSupportsThinkingLevels: params.harnessSupportsThinkingLevels,
  });

  if ('level' in decision) {
    params.baseConfig.model.thinkingLevel = decision.level;
    if (decision.clampedFrom) {
      params.ledger?.emitBestEffort({
        event_name: 'thinking_level.adjusted',
        requested: decision.clampedFrom,
        effective: decision.level,
        model: params.modelId,
      });
    }
  } else if (decision.dropped) {
    params.ledger?.emitBestEffort({
      event_name: 'thinking_level.adjusted',
      requested:
        typeof params.stepInputRaw === 'string'
          ? params.stepInputRaw
          : '(unknown)',
      effective: '(omitted)',
      model: params.modelId,
    });
  }
}
