import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PromotionGovernancePolicyService,
  decideGovernance,
} from './promotion-governance-policy.service';
import { GOVERNANCE_SETTING_KEYS } from './governance.settings.constants';
import type { SystemSettingsService } from '../../settings/system-settings.service';

const MS_PER_DAY = 86_400_000;
// Fixed instant: 2026-07-01T00:00:00.000Z.
const NOW_MS = Date.UTC(2026, 6, 1, 0, 0, 0, 0);

function makeSettings(
  overrides: Partial<Record<string, number>> = {},
): SystemSettingsService {
  const get = vi.fn(async (key: string, fallback: number) =>
    Object.prototype.hasOwnProperty.call(overrides, key)
      ? (overrides[key] as number)
      : fallback,
  );
  return { get } as unknown as SystemSettingsService;
}

describe('PromotionGovernancePolicyService', () => {
  let service: PromotionGovernancePolicyService;

  beforeEach(() => {
    service = new PromotionGovernancePolicyService(makeSettings());
  });

  it('NEVER auto-promotes a `global` finding, even at confidence 0.99', async () => {
    const decision = await service.evaluate({
      routingTarget: 'global',
      confidence: 0.99,
      nowMs: NOW_MS,
    });

    expect(decision.autoPromote).toBe(false);
    expect(decision.requiresProposal).toBe(true);
    expect(decision.governanceState).toBeNull();
    expect(decision.drop).toBe(false);
  });

  it('auto-promotes a high-confidence `project` fact as provisional with an exact probation date', async () => {
    const decision = await service.evaluate({
      routingTarget: 'project',
      confidence: 0.8,
      nowMs: NOW_MS,
    });

    expect(decision.autoPromote).toBe(true);
    expect(decision.governanceState).toBe('provisional');
    expect(decision.requiresProposal).toBe(false);
    expect(decision.drop).toBe(false);
    expect(decision.probationUntil).toBeInstanceOf(Date);
    expect(decision.probationUntil?.getTime()).toBe(NOW_MS + 14 * MS_PER_DAY);
  });

  it('does NOT auto-promote a `project` fact below the 0.5 floor', async () => {
    const decision = await service.evaluate({
      routingTarget: 'project',
      confidence: 0.49,
      nowMs: NOW_MS,
    });

    expect(decision.autoPromote).toBe(false);
    expect(decision.requiresProposal).toBe(true);
    expect(decision.governanceState).toBeNull();
    expect(decision.probationUntil ?? null).toBeNull();
  });

  it('treats `agent_preference` more strictly: 0.75 → not auto, 0.85 → auto', async () => {
    const below = await service.evaluate({
      routingTarget: 'agent_preference',
      confidence: 0.75,
      nowMs: NOW_MS,
    });
    const above = await service.evaluate({
      routingTarget: 'agent_preference',
      confidence: 0.85,
      nowMs: NOW_MS,
    });

    expect(below.autoPromote).toBe(false);
    expect(below.requiresProposal).toBe(true);

    expect(above.autoPromote).toBe(true);
    expect(above.governanceState).toBe('provisional');
    expect(above.probationUntil?.getTime()).toBe(NOW_MS + 14 * MS_PER_DAY);
  });

  it('always routes `skill_new` / `skill_patch` to a proposal, never a segment', async () => {
    for (const routingTarget of ['skill_new', 'skill_patch'] as const) {
      const decision = await service.evaluate({
        routingTarget,
        confidence: 0.99,
        nowMs: NOW_MS,
      });
      expect(decision.requiresProposal).toBe(true);
      expect(decision.autoPromote).toBe(false);
      expect(decision.governanceState).toBeNull();
      expect(decision.drop).toBe(false);
    }
  });

  it('auto-drops a `drop` target', async () => {
    const decision = await service.evaluate({
      routingTarget: 'drop',
      confidence: 0.99,
      nowMs: NOW_MS,
    });

    expect(decision.drop).toBe(true);
    expect(decision.autoPromote).toBe(false);
    expect(decision.requiresProposal).toBe(false);
    expect(decision.governanceState).toBeNull();
  });

  it('honours an operator-tuned agent-preference threshold from settings', async () => {
    const lenient = new PromotionGovernancePolicyService(
      makeSettings({
        [GOVERNANCE_SETTING_KEYS.agentPreferenceMinConfidence]: 0.7,
      }),
    );

    const decision = await lenient.evaluate({
      routingTarget: 'agent_preference',
      confidence: 0.75,
      nowMs: NOW_MS,
    });

    expect(decision.autoPromote).toBe(true);
  });

  it('honours an operator-tuned probation window from settings', async () => {
    const longProbation = new PromotionGovernancePolicyService(
      makeSettings({ [GOVERNANCE_SETTING_KEYS.probationDays]: 30 }),
    );

    const decision = await longProbation.evaluate({
      routingTarget: 'project',
      confidence: 0.9,
      nowMs: NOW_MS,
    });

    expect(decision.probationUntil?.getTime()).toBe(NOW_MS + 30 * MS_PER_DAY);
  });

  describe('workflow routing target (Epic C — treated like project)', () => {
    const thresholds = {
      promotionFloor: 0.5,
      agentPreferenceMinConfidence: 0.8,
      probationDays: 14,
    };
    const nowMs = Date.parse('2026-07-02T00:00:00.000Z');

    it('auto-promotes at/above the promotion floor with provisional state + probation', () => {
      const decision = decideGovernance(
        { routingTarget: 'workflow', confidence: 0.5 },
        thresholds,
        nowMs,
      );
      expect(decision.autoPromote).toBe(true);
      expect(decision.governanceState).toBe('provisional');
      expect(decision.probationUntil).toEqual(
        new Date(nowMs + 14 * 86_400_000),
      );
    });

    it('requires a proposal below the floor', () => {
      const decision = decideGovernance(
        { routingTarget: 'workflow', confidence: 0.49 },
        thresholds,
        nowMs,
      );
      expect(decision.autoPromote).toBe(false);
      expect(decision.requiresProposal).toBe(true);
    });
  });

  it('is fail-soft: a settings read failure falls back to defaults (global still never auto)', async () => {
    const broken = {
      get: vi.fn(async () => {
        throw new Error('settings unavailable');
      }),
    } as unknown as SystemSettingsService;
    const failSoft = new PromotionGovernancePolicyService(broken);

    const projectAuto = await failSoft.evaluate({
      routingTarget: 'project',
      confidence: 0.9,
      nowMs: NOW_MS,
    });
    const globalNever = await failSoft.evaluate({
      routingTarget: 'global',
      confidence: 0.99,
      nowMs: NOW_MS,
    });

    expect(projectAuto.autoPromote).toBe(true);
    expect(projectAuto.probationUntil?.getTime()).toBe(
      NOW_MS + 14 * MS_PER_DAY,
    );
    expect(globalNever.autoPromote).toBe(false);
  });
});
