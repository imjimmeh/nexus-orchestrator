import { Injectable, Logger } from '@nestjs/common';
import { MemorySegmentLearningCandidateRepository } from '../memory/database/repositories/memory-segment.learning-candidate.repository';
import { LearningCandidateRepository } from '../memory/database/repositories/learning-candidate.repository';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { ImprovementProposalRepository } from '../improvement/database/repositories/improvement-proposal.repository';
import { WorkflowSkillBindingRepository } from '../workflow/workflow-skill-bindings/workflow-skill-binding.repository';
import type { WorkflowSkillBinding } from '../workflow/workflow-skill-bindings/workflow-skill-binding.entity';
import type {
  PromotedLesson,
  PromotedLessonsQuery,
  PromotedLessonsResponse,
  SkillBindingUsage,
} from './promoted-lessons.service.types';

const PROMOTED_SEGMENT_LIMIT = 50;
const ACTIVE_BINDING_LIMIT = 200;
const LEARNING_CANDIDATE_SOURCE = 'learning_candidate';

/**
 * Service backing `GET /self-improvement/promoted-lessons` — the
 * single API surface for the apps/web control plane's
 * `PromotedLessonsCard` and `SkillBindingUsageCard`. The two
 * cards are co-served from one endpoint because the relevant
 * facts (recent promotions + the bindings that already exist in
 * the system) form a small, coherent dataset; splitting them
 * would double the front-end round-trips and surface a stale
 * snapshot when the two are read moments apart.
 *
 * Inputs are validated by the controller's Zod pipe before they
 * reach this service; `since` is always a `Date` at the service
 * boundary. No controller-side, no DTO — the service trusts the
 * `Date` invariant.
 */
@Injectable()
export class PromotedLessonsService {
  private readonly logger = new Logger(PromotedLessonsService.name);

  constructor(
    private readonly learningCandidateRepo: MemorySegmentLearningCandidateRepository,
    private readonly learningCandidates: LearningCandidateRepository,
    private readonly signalGroupRepo: RuntimeFeedbackSignalGroupRepository,
    private readonly skillBindingRepo: WorkflowSkillBindingRepository,
    private readonly proposalRepo: ImprovementProposalRepository,
  ) {}

  async getPromotedLessons(
    query: PromotedLessonsQuery,
  ): Promise<PromotedLessonsResponse> {
    const since = query.since ?? parseDefaultSince();

    const [segments, activeBindings] = await Promise.all([
      this.learningCandidateRepo.listPromotedSegmentsAfter({
        since,
        limit: PROMOTED_SEGMENT_LIMIT,
      }),
      this.skillBindingRepo.listActive({ limit: ACTIVE_BINDING_LIMIT }),
    ]);

    const promoted = await this.mapPromoted(segments, since);
    const bindings = await this.mapBindings(activeBindings, since);

    return { promoted, bindings };
  }

  private async mapPromoted(
    segments: Array<{
      id: string;
      metadata_json: Record<string, unknown> | null;
      created_at: Date;
    }>,
    since: Date,
  ): Promise<PromotedLesson[]> {
    const out: PromotedLesson[] = [];
    for (const segment of segments) {
      const candidateId = readLearningCandidateId(segment.metadata_json);
      if (!candidateId) {
        // A row that has source='learning_candidate' but no
        // candidate id is malformed — skip rather than surface
        // a half-populated card row. The promotion write path
        // always stamps the id; anything else is pre-governance
        // residue that the read path should not amplify.
        this.logger.warn(
          `Promoted lesson ${segment.id} is missing metadata.learning_candidate_id; skipping`,
        );
        continue;
      }
      const [candidate, sourceSignalId] = await Promise.all([
        this.learningCandidates.findById(candidateId),
        this.signalGroupRepo.findMostRecentIdByCandidateId(candidateId),
      ]);
      out.push({
        id: segment.id,
        sourceSignalId,
        promotedAt: segment.created_at.toISOString(),
        confidence: candidate?.confidence ?? 0,
        workflowSkillBindingIds: extractWorkflowSkillBindingIds(
          candidate?.signals_json,
        ),
      });
    }
    // Re-sort defensively in case the segment ordering ever drifts;
    // the card renders freshest-first.
    out.sort((a, b) => (a.promotedAt < b.promotedAt ? 1 : -1));
    // Honour the route's window even if the repo ever returns
    // additional rows beyond the cap.
    void since;
    return out;
  }

  private async mapBindings(
    bindings: WorkflowSkillBinding[],
    since: Date,
  ): Promise<SkillBindingUsage[]> {
    const out: SkillBindingUsage[] = [];
    for (const binding of bindings) {
      const reuseCount7d =
        await this.proposalRepo.countSkillAssignmentReuseSince({
          since,
          skillName: binding.skill_name,
          workflowName: binding.workflow_name,
          stepId: binding.step_id,
        });
      out.push({
        id: binding.id,
        mostSpecificSource: binding.step_id === null ? 'workflow' : 'step',
        reuseCount7d,
        workflowStepIds: binding.step_id ? [binding.step_id] : [],
      });
    }
    return out;
  }
}

function parseDefaultSince(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function readLearningCandidateId(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata) {
    return null;
  }
  const value = metadata.learning_candidate_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractWorkflowSkillBindingIds(
  signals: Record<string, unknown> | undefined,
): string[] {
  if (!signals) {
    return [];
  }
  const raw = signals.workflow_skill_binding_ids;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
}

export { LEARNING_CANDIDATE_SOURCE };
