/** Fields needed to build a `skill_create` improvement-proposal draft. */
export interface CreateSkillProposalDraftParams {
  target_skill_name: string;
  proposal_title: string;
  proposal_summary: string;
  patch_markdown: string;
  rationale?: string;
}
