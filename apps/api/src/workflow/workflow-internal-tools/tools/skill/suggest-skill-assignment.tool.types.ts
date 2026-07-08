import type {
  ImprovementProposalDraft,
  SubmitProposalResult,
} from '../../../../improvement/improvement-proposal.service.types';

/**
 * Narrow run-context shape `handleSuggestSkillAssignment` needs for
 * provenance — deliberately not the full `InternalToolExecutionContext`
 * (which uses `workflowRunId`) so the pure handler stays unit-testable
 * without a Nest execution context.
 */
export interface SuggestSkillAssignmentContext {
  runId?: string;
  agentProfileName?: string;
}

/**
 * Narrow dependency `handleSuggestSkillAssignment` needs to file the
 * proposal. A structural subset of {@link import('../../../../improvement/improvement-proposal.service').ImprovementProposalService}
 * so the pure handler stays unit-testable without a Nest DI context.
 */
export interface SuggestSkillAssignmentProposalService {
  submitProposal(
    draft: ImprovementProposalDraft,
  ): Promise<SubmitProposalResult>;
}

/** Every outcome `handleSuggestSkillAssignment` can report back to the agent. */
export type SuggestSkillAssignmentOutcome =
  | 'proposed'
  | 'auto_applied'
  | 'dropped'
  | 'apply_failed'
  | 'rejected';

export interface SuggestSkillAssignmentResult {
  status: SuggestSkillAssignmentOutcome;
  proposalId: string | null;
  created: boolean;
  reason?: string;
}
