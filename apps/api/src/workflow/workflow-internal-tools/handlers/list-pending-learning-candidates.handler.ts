import { Injectable } from '@nestjs/common';
import { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import { classifyTemplateNoise } from '../../../memory/signals/template-noise.classifier';

/**
 * Extracted handler for the `list_pending_learning_candidates` runtime
 * capability (refactoring work item: split `MemoryToolsHandler` per
 * public method). Behaviour is identical to the previous aggregate's
 * `listPendingCandidates` implementation — same `limit` / `offset`
 * defaults (100 / 0), same offset-to-page translation
 * (`Math.floor(offset / limit) + 1`), same `candidates.list` call with
 * `statuses: ['pending']`, same template-noise exclusion via
 * `classifyTemplateNoise`, and the same response shape
 * `{ items, total, total_sweep_eligible, limit, offset }` (where
 * `total` is the raw DB count for pagination context and
 * `total_sweep_eligible` is the post-template-filter count, i.e. the
 * actual sweep work volume) — so the existing
 * `MemoryToolsHandler.listPendingCandidates — template-noise
 * exclusion` and `MemoryToolsHandler.listPendingCandidates —
 * offset-to-page translation` describes in
 * `memory-tools.list-pending.spec.ts` continue to exercise the read
 * path unchanged until task 1.5 rewires the tool wrapper to target
 * this handler.
 *
 * AC-9 (no new dependencies): the constructor surface is intentionally
 * narrow — this handler only needs the single repository that owns the
 * actual read path (`LearningCandidateRepository`). The template-noise
 * filter is a pure function (`classifyTemplateNoise`) so it is imported
 * directly rather than injected. All other dependencies the aggregate
 * carries stay on the aggregate, which keeps the wiring graph here
 * honest and the handler trivially mockable.
 */
@Injectable()
export class ListPendingLearningCandidatesHandler {
  constructor(private readonly candidates: LearningCandidateRepository) {}

  async listPendingCandidates(params: {
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>> {
    const limit = Number(params.limit) || 100;
    const offset = Number(params.offset) || 0;
    const page = Math.floor(offset / limit) + 1;
    const { data, total } = await this.candidates.list({
      statuses: ['pending'],
      limit,
      page,
    });

    // Exclude template-classified rows from the sweep queue.
    // Template rows are not deleted — they still accumulate recurrence_count
    // for future scoring — but content-free noise must never reach the sweep
    // agent to waste a promotion slot.
    const sweepCandidates = data.filter(
      (candidate) => !classifyTemplateNoise(candidate).isTemplate,
    );

    return {
      items: sweepCandidates.map((candidate) => ({
        id: candidate.id,
        scope_type: candidate.scope_type,
        scope_id: candidate.scopeId,
        candidate_type: candidate.candidate_type,
        title: candidate.title,
        summary: candidate.summary,
        fingerprint: candidate.fingerprint,
        signals_json: candidate.signals_json,
        recurrence_count: candidate.recurrence_count,
        score: candidate.score,
        confidence: candidate.confidence,
        status: candidate.status,
        created_at: candidate.created_at,
        updated_at: candidate.updated_at,
      })),
      // total: raw DB pending count (for pagination context)
      total,
      // total_sweep_eligible: post-template-filter count (actual sweep work volume)
      total_sweep_eligible: sweepCandidates.length,
      limit,
      offset,
    };
  }
}
