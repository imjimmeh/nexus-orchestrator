import type { GovernanceMode } from '@nexus/core';

export const IMPROVEMENT_GOVERNANCE_MODE_KEY = 'improvement_governance_mode';
export const IMPROVEMENT_GOVERNANCE_MODE_DEFAULT: GovernanceMode = 'tiered';

export const IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY =
  'improvement_governance_overrides';
export const IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT: Record<string, never> =
  {};

export const IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [IMPROVEMENT_GOVERNANCE_MODE_KEY]: {
    value: IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
    description:
      'Global autonomy posture for the self-improvement pipeline: `tiered` (low-risk auto-applies, others propose), `manual` (everything queues for approval), or `autonomous` (auto-apply above the 0.5 confidence floor; evidence-class caps still apply).',
  },
  [IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY]: {
    value: IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
    description:
      'Per-kind governance-mode overrides, e.g. {"workflow_definition_change":"manual"}. A kind present here uses its override mode instead of the global mode.',
  },
};
