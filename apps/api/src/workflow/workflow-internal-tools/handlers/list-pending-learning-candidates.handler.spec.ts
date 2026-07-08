/**
 * Focused tests for the template-noise exclusion wired into
 * ListPendingLearningCandidatesHandler.listPendingCandidates
 * (Task 5 — EPIC-212).
 *
 * Template-classified rows must NOT appear in the sweep queue returned by
 * listPendingCandidates.  They are not deleted — they still accumulate
 * recurrence_count for future scoring — but the listing layer must filter
 * them out so the sweep agent never wastes a promotion slot on content-free
 * noise.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../../../memory/database/entities/learning-candidate.entity';
import { ListPendingLearningCandidatesHandler } from './list-pending-learning-candidates.handler';

// ---------------------------------------------------------------------------
// Minimal stubs — only the paths exercised by listPendingCandidates matter.
// ---------------------------------------------------------------------------

function buildCandidate(
  id: string,
  title: string,
  summary: string,
): LearningCandidate {
  return {
    id,
    scope_type: 'workflow_run',
    scopeId: 'run-abc',
    candidate_type: 'runtime_learning',
    title,
    summary,
    fingerprint: 'f'.repeat(64),
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: 'pending',
    routing_target: null,
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    last_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
  };
}

/** Candidate with a genuine actionable lesson — should appear in listing. */
const ACTIONABLE_CANDIDATE = buildCandidate(
  'cand-actionable',
  'Retry policy drift in the run_command step',
  'Always set a timeout_ms on run_command to prevent the watchdog from reaping long-running build jobs.',
);

/** Candidate matching the recurring-failures template — must be excluded. */
const TEMPLATE_RECURRING = buildCandidate(
  'cand-recurring',
  'Recurring auth failures (3 occurrences in 7 days)',
  'Recurring auth failures (3 occurrences in 7 days)',
);

/** Candidate matching the workflow-completed-cleanly template — must be excluded. */
const TEMPLATE_COMPLETED_CLEANLY = buildCandidate(
  'cand-clean',
  'Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope project-x completed cleanly in 12s',
  'Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope project-x completed cleanly in 12s',
);

function buildHandlerWithRepo(allCandidates: LearningCandidate[]): {
  handler: ListPendingLearningCandidatesHandler;
  candidateRepository: { list: ReturnType<typeof vi.fn> };
} {
  const candidateRepository = {
    list: vi.fn().mockResolvedValue({
      data: allCandidates,
      total: allCandidates.length,
    }),
  };

  const handler = new ListPendingLearningCandidatesHandler(
    candidateRepository as never,
  );

  return { handler, candidateRepository };
}

function buildHandler(
  allCandidates: LearningCandidate[],
): ListPendingLearningCandidatesHandler {
  return buildHandlerWithRepo(allCandidates).handler;
}

describe('ListPendingLearningCandidatesHandler.listPendingCandidates — template-noise exclusion', () => {
  it('excludes a recurring-failures template candidate from the sweep queue', async () => {
    const handler = buildHandler([ACTIONABLE_CANDIDATE, TEMPLATE_RECURRING]);

    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string }>;
      total: number;
    };

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain('cand-actionable');
    expect(ids).not.toContain('cand-recurring');
  });

  it('excludes a workflow-completed-cleanly template candidate from the sweep queue', async () => {
    const handler = buildHandler([
      ACTIONABLE_CANDIDATE,
      TEMPLATE_COMPLETED_CLEANLY,
    ]);

    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string }>;
      total: number;
    };

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain('cand-actionable');
    expect(ids).not.toContain('cand-clean');
  });

  it('returns all items when none are template-classified', async () => {
    const handler = buildHandler([ACTIONABLE_CANDIDATE]);

    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string }>;
    };

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('cand-actionable');
  });

  it('returns an empty list when all items are template-classified', async () => {
    const handler = buildHandler([
      TEMPLATE_RECURRING,
      TEMPLATE_COMPLETED_CLEANLY,
    ]);

    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string }>;
      total: number;
    };

    expect(result.items).toHaveLength(0);
  });
});

describe('ListPendingLearningCandidatesHandler.listPendingCandidates — rich fields', () => {
  it('includes signals_json and recurrence_count in each returned item', async () => {
    const candidate = buildCandidate(
      'cand-rich',
      'Use explicit timeout on run_command to prevent watchdog reap',
      'Always set timeout_ms on run_command.',
    );
    candidate.signals_json = {
      lesson: 'Always set timeout_ms',
      provenance: { tool: 'remember' },
    };
    candidate.recurrence_count = 3;
    candidate.score = 0.85;

    const handler = buildHandler([candidate]);
    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{
        id: string;
        signals_json: unknown;
        recurrence_count: number;
        score: number;
      }>;
      total: number;
      total_sweep_eligible: number;
    };

    expect(result.items).toHaveLength(1);
    expect(result.items[0].signals_json).toEqual(candidate.signals_json);
    expect(result.items[0].recurrence_count).toBe(3);
    expect(result.items[0].score).toBe(0.85);
  });

  it('returns total_sweep_eligible equal to post-template-filter count', async () => {
    const handler = buildHandler([ACTIONABLE_CANDIDATE, TEMPLATE_RECURRING]);

    const result = (await handler.listPendingCandidates({})) as {
      total: number;
      total_sweep_eligible: number;
    };

    expect(result.total).toBe(2); // raw DB count from mock
    expect(result.total_sweep_eligible).toBe(1); // only actionable passes template filter
  });

  it('returns score-ordered items (repository orders by score DESC)', async () => {
    const lowScore = buildCandidate(
      'cand-low',
      'Low score lesson content',
      'Low score lesson content text longer.',
    );
    lowScore.score = 0.2;
    const highScore = buildCandidate(
      'cand-high',
      'High score lesson content',
      'High score lesson content text longer.',
    );
    highScore.score = 0.9;

    // Mock returns them in DB order (already score-ordered by repository)
    const handler = buildHandler([highScore, lowScore]);
    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string; score: number }>;
    };

    expect(result.items[0].id).toBe('cand-high');
    expect(result.items[1].id).toBe('cand-low');
  });
});

describe('ListPendingLearningCandidatesHandler.listPendingCandidates — offset-to-page translation', () => {
  // The `list_pending_learning_candidates` tool contract still exposes
  // `limit`/`offset` to agents (Task 5 — EPIC-212); internally the handler
  // must translate that into the repository's `page`-based pagination
  // (Task 17 fix for the offset -> page rename in
  // LearningCandidateRepository.list()).

  it('defaults to page 1 when no offset/limit are provided', async () => {
    const { handler, candidateRepository } = buildHandlerWithRepo([
      ACTIONABLE_CANDIDATE,
    ]);

    await handler.listPendingCandidates({});

    expect(candidateRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, page: 1 }),
    );
  });

  it('translates offset:0 with an explicit limit to page 1 (first page, unchanged behavior)', async () => {
    const { handler, candidateRepository } = buildHandlerWithRepo([
      ACTIONABLE_CANDIDATE,
    ]);

    await handler.listPendingCandidates({ limit: 25, offset: 0 });

    expect(candidateRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, page: 1 }),
    );
  });

  it('translates a non-zero offset into the correct page number', async () => {
    const { handler, candidateRepository } = buildHandlerWithRepo([
      ACTIONABLE_CANDIDATE,
    ]);

    // offset 50 with limit 25 is the 3rd page (rows 50-74).
    await handler.listPendingCandidates({ limit: 25, offset: 50 });

    expect(candidateRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, page: 3 }),
    );
  });
});
