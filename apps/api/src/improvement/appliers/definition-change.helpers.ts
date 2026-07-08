import type { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';

/** Overrides-jsonb key marking a row as pinned by an applied improvement proposal. */
export const IMPROVEMENT_OVERRIDES_KEY = 'improvement_proposal';

/**
 * Merge the proposal-provenance marker into a row's `overrides` jsonb. Both
 * reseed guards (`AgentProfileSeedService.shouldSkipReseed`,
 * `WorkflowSeedService.updateExistingWorkflowIfNeeded`) skip on ANY non-null
 * overrides value, so a non-null merged object is the entire protection.
 */
export function buildImprovementOverridesMarker(
  existing: Record<string, unknown> | null | undefined,
  proposalId: string,
  appliedAtIso: string,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    [IMPROVEMENT_OVERRIDES_KEY]: {
      proposal_id: proposalId,
      applied_at: appliedAtIso,
    },
  };
}

/**
 * Persist the pre-mutation snapshot exactly once. A retry after a mid-apply
 * failure must keep the FIRST snapshot (true pre-mutation state), never the
 * partially mutated state observed on the retry.
 */
export async function persistRollbackSnapshotOnce(
  repository: Repository<ImprovementProposal>,
  proposal: ImprovementProposal,
  snapshot: Record<string, unknown>,
): Promise<void> {
  if (proposal.rollback_data !== null && proposal.rollback_data !== undefined) {
    return;
  }
  await repository.update(proposal.id, {
    rollback_data: snapshot,
  } as QueryDeepPartialEntity<ImprovementProposal>);
  proposal.rollback_data = snapshot;
}
