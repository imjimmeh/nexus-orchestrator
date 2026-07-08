import type { AiConfigurationService } from '../ai-config/ai-configuration.service';
import {
  FALLBACK_HARNESS_ID,
  resolveHarnessId,
  validateProviderCompatibility,
} from './harness-selection';
import { emitHarnessSelectionEvents } from './harness-diagnostics';
import type {
  HarnessSelectionRegistry,
  ResolvedRunnerProviderConfig,
  RunnerHarnessSelection,
} from './harness-runtime-selection.types';

type LedgerLike = { emitBestEffort: (payload: unknown) => unknown };

/**
 * Resolves the runner harness for an agent run using shared precedence —
 * step override → project (scoped) default → platform fallback (`pi`) — then
 * applies registry validation and provider-compatibility fallback.
 *
 * Shared by top-level workflow steps and subagent provisioning so a subagent
 * inherits the same harness (and therefore the same provider/credential path)
 * as its parent's scope rather than silently defaulting to `pi`.
 */
export async function resolveRunnerHarness(params: {
  registry: HarnessSelectionRegistry;
  stepOverride?: string;
  projectDefault?: string;
  providerConfig: ResolvedRunnerProviderConfig;
  resolvedModel: string;
  aiConfig: Pick<AiConfigurationService, 'resolveRunnerProviderConfig'>;
  scopeNodeId?: string;
  ledger?: LedgerLike;
}): Promise<RunnerHarnessSelection> {
  const selectedHarnessId = resolveHarnessId({
    stepOverride: params.stepOverride,
    projectDefault: params.projectDefault,
    platformDefault: FALLBACK_HARNESS_ID,
  });

  let harnessId = params.registry.validateForStep(
    selectedHarnessId,
    {},
    FALLBACK_HARNESS_ID,
  ).harnessId;
  let providerConfig = params.providerConfig;

  if (!params.registry.resolve) {
    return { harnessId, providerConfig };
  }

  const caps = params.registry.resolve(harnessId).capabilities;
  const compat = validateProviderCompatibility(
    caps,
    providerConfig.provider,
    harnessId,
    FALLBACK_HARNESS_ID,
  );

  if (!compat.fallbackReason) {
    return { harnessId, providerConfig };
  }

  const fromHarnessId = harnessId;
  harnessId = compat.harnessId;
  if (compat.providerName && compat.providerName !== providerConfig.provider) {
    providerConfig = await params.aiConfig.resolveRunnerProviderConfig({
      modelName: params.resolvedModel,
      providerName: compat.providerName,
    });
  }
  if (params.ledger) {
    await emitHarnessSelectionEvents(params.ledger, {
      harnessId,
      scope: { scopeNodeId: params.scopeNodeId },
      precedenceSource: 'scoped_default',
      fallback: {
        from: fromHarnessId,
        to: harnessId,
        reason: compat.fallbackReason,
      },
    });
  }
  return { harnessId, providerConfig };
}
