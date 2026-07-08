import { describe, expect, it, vi } from 'vitest';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { ImprovementGovernancePolicyService } from './improvement-governance-policy.service';
import { IMPROVEMENT_GOVERNANCE_MODE_KEY } from './improvement-governance.settings.constants';

/**
 * Task 5 (Epic D): pins the governance posture for the two definition-change
 * proposal kinds (`agent_profile_change`, `workflow_definition_change`) that
 * mutate live agent-profile / workflow definitions. These are riskier than
 * the other proposal kinds, so the assertion table below is the binding
 * contract: definition changes never auto-apply below the autonomous mode's
 * struggle-backed floor, and never auto-apply at all outside autonomous mode.
 */
function buildPolicy(
  mode: 'tiered' | 'manual' | 'autonomous',
): ImprovementGovernancePolicyService {
  const settings = {
    get: vi.fn(async (key: string, def: unknown) =>
      key === IMPROVEMENT_GOVERNANCE_MODE_KEY ? mode : def,
    ),
  } as unknown as SystemSettingsService;
  return new ImprovementGovernancePolicyService(settings);
}

const CASES: Array<{
  mode: 'tiered' | 'manual' | 'autonomous';
  kind: 'agent_profile_change' | 'workflow_definition_change';
  evidenceClass: 'struggle_backed' | 'inference';
  confidence: number;
  expected: 'auto_apply' | 'propose';
}> = [
  // tiered: definition changes ALWAYS propose, even at the struggle cap
  {
    mode: 'tiered',
    kind: 'agent_profile_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.7,
    expected: 'propose',
  },
  {
    mode: 'tiered',
    kind: 'workflow_definition_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.7,
    expected: 'propose',
  },
  {
    mode: 'tiered',
    kind: 'agent_profile_change',
    evidenceClass: 'inference',
    confidence: 0.45,
    expected: 'propose',
  },
  {
    mode: 'tiered',
    kind: 'workflow_definition_change',
    evidenceClass: 'inference',
    confidence: 0.45,
    expected: 'propose',
  },
  // manual: everything above the drop floor proposes
  {
    mode: 'manual',
    kind: 'agent_profile_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.7,
    expected: 'propose',
  },
  {
    mode: 'manual',
    kind: 'workflow_definition_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.7,
    expected: 'propose',
  },
  // autonomous: auto-apply reachable ONLY by struggle-backed evidence at/above the 0.5 floor
  {
    mode: 'autonomous',
    kind: 'agent_profile_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.7,
    expected: 'auto_apply',
  },
  {
    mode: 'autonomous',
    kind: 'workflow_definition_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.5,
    expected: 'auto_apply',
  },
  {
    mode: 'autonomous',
    kind: 'agent_profile_change',
    evidenceClass: 'struggle_backed',
    confidence: 0.45,
    expected: 'propose',
  },
  // autonomous + inference: the 0.45 inference cap keeps speculation below the floor
  {
    mode: 'autonomous',
    kind: 'agent_profile_change',
    evidenceClass: 'inference',
    confidence: 0.45,
    expected: 'propose',
  },
  {
    mode: 'autonomous',
    kind: 'workflow_definition_change',
    evidenceClass: 'inference',
    confidence: 0.45,
    expected: 'propose',
  },
];

describe('ImprovementGovernancePolicyService — definition-change posture', () => {
  it.each(CASES)(
    '$mode/$kind/$evidenceClass@$confidence → $expected',
    async (row) => {
      const policy = buildPolicy(row.mode);
      await expect(
        policy.resolveAction({
          kind: row.kind,
          evidenceClass: row.evidenceClass,
          confidence: row.confidence,
        }),
      ).resolves.toBe(row.expected);
    },
  );
});
