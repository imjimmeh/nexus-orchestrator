/**
 * Proposal provenance for a router-born definition-change proposal. Carries
 * an explicit index signature (rather than just the two known fields) so it
 * remains structurally assignable to `ImprovementProposalDraft.provenance`
 * (`Record<string, unknown>`) at the call site.
 */
export interface DefinitionChangeProvenance {
  source: 'retrospective_analyst';
  original_run_id: string;
  [key: string]: unknown;
}
