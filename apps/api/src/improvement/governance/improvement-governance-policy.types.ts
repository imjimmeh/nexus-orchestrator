import type {
  GovernanceMode,
  ImprovementEvidenceClass,
  ImprovementProposalKind,
} from '@nexus/core';

export interface GovernanceDecisionInput {
  kind: ImprovementProposalKind;
  evidenceClass: ImprovementEvidenceClass;
  confidence: number;
  mode: GovernanceMode;
  overrides: Partial<Record<ImprovementProposalKind, GovernanceMode>>;
  /**
   * `draft.provenance.source`, forwarded verbatim from
   * {@link import('../improvement-proposal.service.types').ImprovementProposalDraft}.
   * When it equals {@link import('./improvement-proposal-provenance.constants').UI_OPERATOR_PROVENANCE_SOURCE},
   * `decideGovernanceAction` exempts the proposal from the evidence-class
   * confidence cap (see that function's doc comment). Optional — most
   * producers carry no provenance source relevant to governance.
   */
  provenanceSource?: string;
}
