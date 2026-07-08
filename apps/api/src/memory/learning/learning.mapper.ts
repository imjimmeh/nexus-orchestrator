import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { LearningCandidateListItem } from './learning.types';

export function toLearningCandidateListItem(
  candidate: LearningCandidate,
): LearningCandidateListItem {
  return {
    id: candidate.id,
    scope_type: candidate.scope_type,
    scope_id: candidate.scopeId,
    candidate_type: candidate.candidate_type,
    title: candidate.title,
    summary: candidate.summary,
    fingerprint: candidate.fingerprint,
    status: toPublicLearningCandidateStatus(candidate.status),
    score: candidate.score,
    confidence: candidate.confidence,
    recurrence_count: candidate.recurrence_count,
    signals_json: candidate.signals_json,
    promoted_at: candidate.promoted_at?.toISOString() ?? null,
    human_approved_at: candidate.human_approved_at?.toISOString() ?? null,
    first_seen_at: candidate.first_seen_at.toISOString(),
    last_seen_at: candidate.last_seen_at.toISOString(),
    rejected_at: candidate.rejected_at?.toISOString() ?? null,
    rejected_by: candidate.rejected_by,
    rejection_reason: candidate.rejection_reason,
    archived_at: candidate.archived_at?.toISOString() ?? null,
    archived_by: candidate.archived_by,
    archive_reason: candidate.archive_reason,
    created_at: candidate.created_at.toISOString(),
    updated_at: candidate.updated_at.toISOString(),
  };
}

function toPublicLearningCandidateStatus(status: string): string {
  return status === 'promotion_in_progress' ? 'pending' : status;
}
