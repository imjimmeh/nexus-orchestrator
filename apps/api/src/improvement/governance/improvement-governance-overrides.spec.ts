import { describe, expect, it, vi } from 'vitest';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { ImprovementGovernancePolicyService } from './improvement-governance-policy.service';
import {
  IMPROVEMENT_GOVERNANCE_MODE_KEY,
  IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY,
} from './improvement-governance.settings.constants';

/**
 * FU-3: `readOverrides()` must validate each per-kind override value the same
 * way `readMode()` validates the global mode. A corrupted override entry
 * (e.g. an unrecognized string) must never survive into
 * `decideGovernanceAction` — there, an override that matches neither the
 * `manual` nor `tiered` branch falls through to the most-permissive
 * `autonomous` auto-apply branch, silently upgrading invalid data to the
 * most permissive mode. Invalid overrides must instead be dropped so the
 * global mode governs.
 */
function buildPolicy(
  mode: 'tiered' | 'manual' | 'autonomous',
  overrides: Record<string, unknown>,
): ImprovementGovernancePolicyService {
  const settings = {
    get: vi.fn(async (key: string, def: unknown) => {
      if (key === IMPROVEMENT_GOVERNANCE_MODE_KEY) return mode;
      if (key === IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY) return overrides;
      return def;
    }),
  } as unknown as SystemSettingsService;
  return new ImprovementGovernancePolicyService(settings);
}

describe('ImprovementGovernancePolicyService — override validation', () => {
  it('drops a corrupted per-kind override value and falls back to the global mode', async () => {
    const policy = buildPolicy('manual', { code_change: 'yolo' });

    const action = await policy.resolveAction({
      kind: 'code_change',
      evidenceClass: 'struggle_backed',
      confidence: 0.7,
    });

    // Global mode is 'manual': every kind proposes. A corrupted override
    // must not let this reach the autonomous auto-apply fallthrough.
    expect(action).not.toBe('auto_apply');
    expect(action).toBe('propose');
  });

  it('still applies a valid per-kind override alongside a corrupted one', async () => {
    const policy = buildPolicy('autonomous', {
      code_change: 'yolo',
      workflow_definition_change: 'manual',
    });

    const validOverrideAction = await policy.resolveAction({
      kind: 'workflow_definition_change',
      evidenceClass: 'struggle_backed',
      confidence: 0.9,
    });
    expect(validOverrideAction).toBe('propose');

    const corruptedOverrideAction = await policy.resolveAction({
      kind: 'code_change',
      evidenceClass: 'struggle_backed',
      confidence: 0.7,
    });
    // Falls back to the global 'autonomous' mode, which does auto-apply at
    // this confidence — proving the corrupted entry was dropped, not that
    // it happened to resolve to 'propose' for other reasons.
    expect(corruptedOverrideAction).toBe('auto_apply');
  });
});
