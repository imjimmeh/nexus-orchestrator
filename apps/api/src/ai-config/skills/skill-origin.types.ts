export interface RuntimeSkillOrigin {
  source: 'agent_factory';
  source_proposal_id?: string;
  generated_from_run_id?: string;
  /** ISO 8601 timestamp set when the skill was first written or last re-stamped. */
  stamped_at: string;
}
