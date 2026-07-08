/**
 * `PromotionGovernancePolicyService` — EPIC-212 Phase-2 Task 9.
 *
 * Encodes the tiered "who may auto-promote" matrix that Task 10 consumes in the
 * promotion dispatch. The decision math is PURE and deterministic (see
 * {@link decideGovernance}); the only I/O is reading two operator-tunable
 * thresholds, and the probation date is computed from an injected `nowMs` so
 * every matrix cell is unit-testable to the millisecond.
 *
 * ## Tiered matrix (routingTarget × confidence → decision)
 *   - `project`          → auto-promote (provisional + probation) at/above the
 *                          0.5 promotion floor; else requires a proposal.
 *   - `workflow`         → same tier as `project` (0.5 promotion floor,
 *                          provisional + probation).
 *   - `agent_preference` → stricter: auto-promote only at/above
 *                          `governance_agent_preference_min_confidence` (0.8);
 *                          else requires a proposal.
 *   - `global`           → NEVER auto-promotes at any confidence (load-bearing
 *                          safety rail) → always requires a proposal.
 *   - `skill_new` /
 *     `skill_patch`      → always a proposal, never a direct segment.
 *   - `drop`             → auto-drop (no segment, no proposal).
 *
 * Every auto-promotion carries `governanceState='provisional'` and a
 * `probationUntil` window (Phase 3 adds the evaluator that confirms or
 * reverts it). Fail-soft: a settings read error degrades to the canonical
 * defaults — `global` still never auto-promotes.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR,
  GOVERNANCE_SETTING_DEFAULTS,
  GOVERNANCE_SETTING_KEYS,
} from './governance.settings.constants';
import type {
  GovernanceDecision,
  GovernanceEvaluationInput,
  GovernanceThresholds,
} from './promotion-governance-policy.types';

export type {
  GovernanceDecision,
  GovernanceEvaluationInput,
  GovernanceState,
  GovernanceThresholds,
} from './promotion-governance-policy.types';

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PromotionGovernancePolicyService {
  private readonly logger = new Logger(PromotionGovernancePolicyService.name);

  constructor(private readonly settings: SystemSettingsService) {}

  /**
   * Evaluate the governance matrix for one candidate. The pure decision is
   * delegated to {@link decideGovernance}; only the threshold resolution and
   * the `nowMs` fallback live here.
   */
  async evaluate(
    input: GovernanceEvaluationInput,
  ): Promise<GovernanceDecision> {
    const thresholds = await this.resolveThresholds();
    const nowMs = input.nowMs ?? Date.now();
    return decideGovernance(
      { routingTarget: input.routingTarget, confidence: input.confidence },
      thresholds,
      nowMs,
    );
  }

  /**
   * Read the two tunable thresholds, fail-soft to the canonical defaults. A
   * settings outage must never make the matrix more permissive than the
   * defaults (and `global` is unconditionally never-auto regardless).
   */
  private async resolveThresholds(): Promise<GovernanceThresholds> {
    return {
      promotionFloor: GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR,
      agentPreferenceMinConfidence: await this.readSetting(
        GOVERNANCE_SETTING_KEYS.agentPreferenceMinConfidence,
        GOVERNANCE_SETTING_DEFAULTS.agentPreferenceMinConfidence,
      ),
      probationDays: await this.readSetting(
        GOVERNANCE_SETTING_KEYS.probationDays,
        GOVERNANCE_SETTING_DEFAULTS.probationDays,
      ),
    };
  }

  private async readSetting(key: string, fallback: number): Promise<number> {
    try {
      return await this.settings.get<number>(key, fallback);
    } catch (error) {
      this.logger.warn(
        `Governance setting ${key} read failed; using default ${fallback.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }
}

// ── Pure decision math (unit-tested directly) ────────────────────────────────

/**
 * The pure governance decision. No I/O, no `Date.now()` — the probation date is
 * derived from the supplied `nowMs`, so the verdict is fully deterministic for
 * a given `(routingTarget, confidence, thresholds, nowMs)`.
 */
export function decideGovernance(
  input: {
    routingTarget: GovernanceEvaluationInput['routingTarget'];
    confidence: number;
  },
  thresholds: GovernanceThresholds,
  nowMs: number,
): GovernanceDecision {
  switch (input.routingTarget) {
    case 'drop':
      return dropDecision();
    case 'skill_new':
    case 'skill_patch':
      return proposalDecision(
        'skill route is always a proposal, never a direct memory segment',
      );
    case 'global':
      return proposalDecision(
        'global scope never auto-promotes — requires a human/proposal path',
      );
    case 'agent_preference':
      return tieredAutoDecision(
        'agent_preference',
        input.confidence,
        thresholds.agentPreferenceMinConfidence,
        thresholds.probationDays,
        nowMs,
      );
    case 'workflow':
      return tieredAutoDecision(
        'workflow',
        input.confidence,
        thresholds.promotionFloor,
        thresholds.probationDays,
        nowMs,
      );
    case 'project':
      return tieredAutoDecision(
        'project',
        input.confidence,
        thresholds.promotionFloor,
        thresholds.probationDays,
        nowMs,
      );
    default:
      return proposalDecision('unknown routing target → safe proposal');
  }
}

function tieredAutoDecision(
  target: string,
  confidence: number,
  threshold: number,
  probationDays: number,
  nowMs: number,
): GovernanceDecision {
  if (confidence >= threshold) {
    return {
      autoPromote: true,
      governanceState: 'provisional',
      probationUntil: new Date(nowMs + probationDays * MS_PER_DAY),
      requiresProposal: false,
      drop: false,
      reason: `${target} confidence ${confidence.toString()} ≥ ${threshold.toString()} → auto-promote (provisional, ${probationDays.toString()}d probation)`,
    };
  }
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: true,
    drop: false,
    reason: `${target} confidence ${confidence.toString()} < ${threshold.toString()} → requires a human/proposal path`,
  };
}

function proposalDecision(reason: string): GovernanceDecision {
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: true,
    drop: false,
    reason,
  };
}

function dropDecision(): GovernanceDecision {
  return {
    autoPromote: false,
    governanceState: null,
    probationUntil: null,
    requiresProposal: false,
    drop: true,
    reason: 'templated / low-signal candidate → auto-drop',
  };
}
