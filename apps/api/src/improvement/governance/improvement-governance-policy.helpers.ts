import type { GovernanceAction, ImprovementProposalKind } from '@nexus/core';
import { GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR } from '../../memory/learning/governance.settings.constants';
import { RETROSPECTIVE_ROUTER_SETTING_DEFAULTS } from '../../workflow/workflow-retrospective/retrospective-router.settings.constants';
import { UI_OPERATOR_PROVENANCE_SOURCE } from '../improvement-proposal-provenance.constants';
import type { GovernanceDecisionInput } from './improvement-governance-policy.types';

const SKILL_ASSIGNMENT_KIND: ImprovementProposalKind = 'skill_assignment';

const TIERED_AUTO_APPLY_KINDS: ReadonlySet<ImprovementProposalKind> = new Set([
  SKILL_ASSIGNMENT_KIND,
]);

/**
 * The ONLY proposal kind whose operator-directed (`ui_operator`) drafts are
 * exempt from the evidence-class confidence cap. Deliberately narrow: a
 * higher-risk kind (`code_change`, `workflow_definition_change`,
 * `agent_profile_change`) that ever carried a `ui_operator` provenance marker
 * must still be capped by its evidence class — the exemption is a
 * skill-assignment convenience, not a global cap bypass.
 */
const CAP_EXEMPT_OPERATOR_KIND: ImprovementProposalKind = SKILL_ASSIGNMENT_KIND;

/** No ceiling — used in place of an evidence-class cap when it is exempted. */
const UNCAPPED_CONFIDENCE_CEILING = 1;

/**
 * Pure decision function for the self-improvement governance policy.
 *
 * Ordering is load-bearing:
 * 1. The evidence-class confidence cap applies in EVERY mode (defense in
 *    depth — a producer that mis-reports confidence for an inference
 *    finding can never exceed `RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap`)
 *    — UNLESS the draft is an operator-directed (`UI_OPERATOR_PROVENANCE_SOURCE`)
 *    `skill_assignment` (`CAP_EXEMPT_OPERATOR_KIND`), in which case the cap is
 *    skipped entirely: a human's explicit choice carries no `struggle_backed`/
 *    `inference` evidence class to cap in the first place, and capping it
 *    anyway would silently downgrade an operator's intended auto-apply
 *    under `autonomous` mode (inference caps at 0.45, below the 0.5 floor).
 *    The exemption is scoped to `skill_assignment` specifically — a
 *    higher-risk kind carrying the same marker is still capped.
 * 2. A capped confidence of 0 (no positive evidence) drops before any mode
 *    dispatch runs.
 * 3. Per-kind overrides beat the global mode.
 * 4. Only then does the mode-specific dispatch (manual/tiered/autonomous) run.
 */
export function decideGovernanceAction(
  input: GovernanceDecisionInput,
): GovernanceAction {
  const isOperatorDirected =
    input.provenanceSource === UI_OPERATOR_PROVENANCE_SOURCE &&
    input.kind === CAP_EXEMPT_OPERATOR_KIND;
  const cap = isOperatorDirected
    ? UNCAPPED_CONFIDENCE_CEILING
    : input.evidenceClass === 'struggle_backed'
      ? RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.struggleCap
      : RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap;
  const capped = Math.max(0, Math.min(input.confidence, cap));

  if (capped <= 0) {
    return 'drop';
  }

  const mode = input.overrides[input.kind] ?? input.mode;

  if (mode === 'manual') {
    return 'propose';
  }
  if (mode === 'tiered') {
    return TIERED_AUTO_APPLY_KINDS.has(input.kind) ? 'auto_apply' : 'propose';
  }
  // autonomous
  return capped >= GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR
    ? 'auto_apply'
    : 'propose';
}
