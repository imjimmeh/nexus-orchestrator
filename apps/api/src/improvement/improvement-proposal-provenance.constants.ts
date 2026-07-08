/**
 * Provenance marker for a `skill_assignment` proposal submitted directly by
 * a human operator via `POST /improvement/proposals` (FU-10/PD-4's "Assign
 * skill" flow), as opposed to one inferred by the `suggest_skill_assignment`
 * agent tool (`provenance.tool: 'suggest_skill_assignment'`).
 *
 * An operator's explicit choice carries no `struggle_backed`/`inference`
 * evidence signal, so `ImprovementGovernancePolicyService`/
 * `decideGovernanceAction` exempt a draft carrying this marker from the
 * evidence-class confidence cap instead of silently capping it to the
 * `inference` ceiling (0.45) and potentially downgrading an intended
 * auto-apply under `autonomous` mode. Shared between the controller (which
 * stamps it onto `ImprovementProposalDraft.provenance.source`) and the
 * governance helpers (which check for it), so both sides can never drift on
 * the literal string.
 */
export const UI_OPERATOR_PROVENANCE_SOURCE = 'ui_operator' as const;
