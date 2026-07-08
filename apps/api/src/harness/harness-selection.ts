import type { HarnessId, HarnessCapabilities } from '@nexus/core';

interface PrecedenceInputs {
  stepOverride?: string;
  profileDefault?: string;
  projectDefault?: string;
  platformDefault: string;
}

export const FALLBACK_HARNESS_ID = 'pi' as const satisfies HarnessId;

export function resolveHarnessId(i: Partial<PrecedenceInputs>): HarnessId {
  return (i.stepOverride ??
    i.profileDefault ??
    i.projectDefault ??
    i.platformDefault ??
    FALLBACK_HARNESS_ID) as HarnessId;
}

export function requiredCapabilitiesForStep(step: {
  resumeNodeId?: string;
}): Partial<HarnessCapabilities> {
  return {
    supportsBranching: step.resumeNodeId !== undefined ? true : undefined,
  };
}

export function validateOrFallback(
  caps: HarnessCapabilities,
  required: Partial<HarnessCapabilities>,
  selectedHarnessId: HarnessId,
  platformDefault: HarnessId,
): { harnessId: HarnessId; fallbackReason?: string } {
  if (required.supportsBranching && !caps.supportsBranching) {
    return {
      harnessId: platformDefault,
      fallbackReason: 'selected harness lacks session-tree branching',
    };
  }
  return { harnessId: selectedHarnessId };
}

export function validateProviderCompatibility(
  caps: HarnessCapabilities,
  providerName: string | undefined,
  selectedHarnessId: HarnessId,
  platformDefault: HarnessId,
): { harnessId: HarnessId; providerName?: string; fallbackReason?: string } {
  const compatible = caps.compatibleProviderIds;
  if (!compatible || compatible.length === 0) {
    return { harnessId: selectedHarnessId };
  }
  if (providerName !== undefined && compatible.includes(providerName)) {
    return { harnessId: selectedHarnessId };
  }
  return {
    harnessId: platformDefault,
    providerName: caps.defaultProviderId,
    fallbackReason: `provider '${providerName ?? '(none)'}' is incompatible with harness '${selectedHarnessId}'`,
  };
}
