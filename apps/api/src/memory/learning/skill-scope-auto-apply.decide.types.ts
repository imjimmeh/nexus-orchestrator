import type { SkillScopeConfirmationMode } from '../../settings/skill-scope-confirmation.settings.constants.types';

/**
 * Input to the pure scope-application decider (EPIC-212 Phase 4, Task 7).
 *
 * `recommendedScope` is the raw JSON object extracted from the analyst job
 * output — typed as `Record<string, unknown>` because it arrives via dynamic
 * state-variable parsing.
 */
export interface ScopeApplicationInput {
  recommendedScope: Record<string, unknown> | null | undefined;
  rationale?: string;
  mode: SkillScopeConfirmationMode;
  /**
   * The scope_node_id the proposal actually ran under, or null if unknown.
   * A recommendation can only auto-apply if it stays within this scope —
   * anything wider (a different project, or no project restriction at all)
   * always stages for manual confirmation, regardless of `mode`.
   */
  originScopeId: string | null;
}

/**
 * Decision emitted by {@link decideScopeApplication}.
 *
 * - `action: 'auto_apply'` — the scope should be committed immediately;
 *   `confirmedScope` is always present in this case.
 * - `action: 'stage'` — the scope should remain parked as `pending: true`;
 *   `confirmedScope` is absent.
 * - `reason` — short human-readable explanation, useful for debug logging.
 */
export interface ScopeApplicationDecision {
  action: 'auto_apply' | 'stage';
  confirmedScope?: Record<string, unknown> | null;
  reason: string;
}
