import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidatePipelineService } from './candidate-pipeline.service';
import type { CandidateClustererService } from './candidate-clusterer.service';
import type { CandidateScoringService } from './candidate-scoring.service';
import type { LearningRouterService } from '../learning/learning-router.service';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { ClusterResult } from './candidate-clusterer.types';
import type { ScoringPassResult } from './candidate-scoring.types';
import type { RoutingDecision } from '../learning/learning-router.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'cand-1',
    scope_type: 'project',
    scopeId: 'scope-1',
    candidate_type: 'agent_capture',
    title: 'Lesson',
    summary: 'A short lesson',
    fingerprint: 'fp-1',
    signals_json: {},
    score: 0.6,
    confidence: 0.7,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1.0,
    source_quality_confidence: 0.5,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    routing_target: null,
    first_seen_at: new Date('2024-01-01T00:00:00Z'),
    last_seen_at: new Date('2024-01-01T00:00:00Z'),
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as LearningCandidate;
}

const CLUSTER_RESULT: ClusterResult = {
  clustersFormed: 1,
  candidatesMerged: 2,
  totalPending: 5,
};

const SCORING_RESULT: ScoringPassResult = {
  scored: 5,
  totalPending: 5,
};

function makeRoutingDecision(candidate: LearningCandidate): RoutingDecision {
  return {
    target: 'project',
    scopeType: 'project',
    scopeId: candidate.scopeId,
    rationale: 'deterministic',
    confidence: 0.9,
    signals: {},
  };
}

interface Mocks {
  clusterer: {
    cluster: ReturnType<typeof vi.fn<() => Promise<ClusterResult>>>;
  };
  scorer: {
    scoreAll: ReturnType<typeof vi.fn<() => Promise<ScoringPassResult>>>;
  };
  router: {
    route: ReturnType<
      typeof vi.fn<(candidate: LearningCandidate) => Promise<RoutingDecision>>
    >;
  };
  candidateRepo: {
    findPendingForRouting: ReturnType<
      typeof vi.fn<(limit: number) => Promise<LearningCandidate[]>>
    >;
    setRoutingTarget: ReturnType<
      typeof vi.fn<(id: string, target: string) => Promise<void>>
    >;
  };
}

function makeSvc(): { svc: CandidatePipelineService; mocks: Mocks } {
  const clusterer = { cluster: vi.fn<() => Promise<ClusterResult>>() };
  const scorer = {
    scoreAll: vi.fn<() => Promise<ScoringPassResult>>(),
  };
  const router = {
    route: vi.fn<(candidate: LearningCandidate) => Promise<RoutingDecision>>(),
  };
  const candidateRepo = {
    findPendingForRouting:
      vi.fn<(limit: number) => Promise<LearningCandidate[]>>(),
    setRoutingTarget: vi.fn<(id: string, target: string) => Promise<void>>(),
  };

  const svc = new CandidatePipelineService(
    clusterer as unknown as CandidateClustererService,
    scorer as unknown as CandidateScoringService,
    router as unknown as LearningRouterService,
    candidateRepo as unknown as LearningCandidateRepository,
  );

  return {
    svc,
    mocks: { clusterer, scorer, router, candidateRepo },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CandidatePipelineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── (a) Happy-path full run ─────────────────────────────────────────────

  it('(a) runs cluster → scoreAll → route in order and returns the aggregated PipelineRunResult', async () => {
    const { svc, mocks } = makeSvc();

    const candidates = [
      makeCandidate({ id: 'cand-1' }),
      makeCandidate({ id: 'cand-2' }),
    ];

    const callOrder: string[] = [];

    mocks.clusterer.cluster.mockImplementation(() => {
      callOrder.push('cluster');
      return Promise.resolve(CLUSTER_RESULT);
    });
    mocks.scorer.scoreAll.mockImplementation(() => {
      callOrder.push('scoreAll');
      return Promise.resolve(SCORING_RESULT);
    });
    mocks.candidateRepo.findPendingForRouting.mockImplementation(() => {
      callOrder.push('route:load');
      return Promise.resolve(candidates);
    });
    mocks.router.route.mockImplementation((c) => {
      callOrder.push(`route:${c.id}`);
      return Promise.resolve(makeRoutingDecision(c));
    });
    mocks.candidateRepo.setRoutingTarget.mockResolvedValue(undefined);

    const result = await svc.run();

    // Ordering: cluster runs FIRST, then scoreAll, then routing loads+iterates.
    expect(callOrder).toEqual([
      'cluster',
      'scoreAll',
      'route:load',
      'route:cand-1',
      'route:cand-2',
    ]);
    expect(mocks.router.route).toHaveBeenCalledTimes(2);
    expect(mocks.candidateRepo.setRoutingTarget).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      cluster: CLUSTER_RESULT,
      scoring: SCORING_RESULT,
      routed: 2,
    });
  });

  // ── (b) Per-candidate routing failure logs warning and continues ────────

  it('(b) catches per-candidate routing failures and counts only successful routes', async () => {
    const { svc, mocks } = makeSvc();

    const candidates = [
      makeCandidate({ id: 'cand-1' }),
      makeCandidate({ id: 'cand-2' }),
      makeCandidate({ id: 'cand-3' }),
    ];
    mocks.clusterer.cluster.mockResolvedValue(CLUSTER_RESULT);
    mocks.scorer.scoreAll.mockResolvedValue(SCORING_RESULT);
    mocks.candidateRepo.findPendingForRouting.mockResolvedValue(candidates);

    // cand-1 → ok; cand-2 → throws; cand-3 → ok.
    mocks.router.route.mockImplementation((c) => {
      if (c.id === 'cand-2') {
        return Promise.reject(new Error('router outage for cand-2'));
      }
      return Promise.resolve(makeRoutingDecision(c));
    });
    mocks.candidateRepo.setRoutingTarget.mockResolvedValue(undefined);

    const result = await svc.run();

    // The failing candidate must NOT have its routing target persisted.
    expect(mocks.candidateRepo.setRoutingTarget).toHaveBeenCalledTimes(2);
    expect(mocks.candidateRepo.setRoutingTarget).toHaveBeenCalledWith(
      'cand-1',
      'project',
    );
    expect(mocks.candidateRepo.setRoutingTarget).toHaveBeenCalledWith(
      'cand-3',
      'project',
    );
    expect(mocks.candidateRepo.setRoutingTarget).not.toHaveBeenCalledWith(
      'cand-2',
      expect.anything(),
    );

    // `routed` reflects successful routes only (2 of 3).
    expect(result.cluster).toBe(CLUSTER_RESULT);
    expect(result.scoring).toBe(SCORING_RESULT);
    expect(result.routed).toBe(2);
  });

  // ── (c) Cluster failure re-throws ───────────────────────────────────────

  it('(c) re-throws when cluster fails and does not invoke scoring or routing', async () => {
    const { svc, mocks } = makeSvc();

    const failure = new Error('cluster db outage');
    mocks.clusterer.cluster.mockRejectedValue(failure);

    await expect(svc.run()).rejects.toBe(failure);

    expect(mocks.clusterer.cluster).toHaveBeenCalledTimes(1);
    // Downstream steps must NOT have been called.
    expect(mocks.scorer.scoreAll).not.toHaveBeenCalled();
    expect(mocks.candidateRepo.findPendingForRouting).not.toHaveBeenCalled();
    expect(mocks.router.route).not.toHaveBeenCalled();
    expect(mocks.candidateRepo.setRoutingTarget).not.toHaveBeenCalled();
  });

  // ── (d) Scoring failure is caught and routed still runs ─────────────────

  it('(d) catches scoring failure, continues to routing, and routed reflects successful routes only', async () => {
    const { svc, mocks } = makeSvc();

    const candidates = [
      makeCandidate({ id: 'cand-1' }),
      makeCandidate({ id: 'cand-2' }),
    ];
    mocks.clusterer.cluster.mockResolvedValue(CLUSTER_RESULT);
    mocks.scorer.scoreAll.mockRejectedValue(
      new Error('scoring transient outage'),
    );
    mocks.candidateRepo.findPendingForRouting.mockResolvedValue(candidates);
    mocks.router.route.mockImplementation((c) =>
      Promise.resolve(makeRoutingDecision(c)),
    );
    mocks.candidateRepo.setRoutingTarget.mockResolvedValue(undefined);

    const result = await svc.run();

    // Scoring ran (and threw), but the pipeline did NOT short-circuit.
    expect(mocks.scorer.scoreAll).toHaveBeenCalledTimes(1);
    expect(mocks.candidateRepo.findPendingForRouting).toHaveBeenCalledTimes(1);
    expect(mocks.router.route).toHaveBeenCalledTimes(2);
    expect(mocks.candidateRepo.setRoutingTarget).toHaveBeenCalledTimes(2);

    // The cluster summary is still the source-of-truth from the cluster step.
    expect(result.cluster).toBe(CLUSTER_RESULT);
    // On scoring failure the pipeline returns a defaulted zero-count result
    // so callers downstream do not need a defensive null check.
    expect(result.scoring).toEqual({ scored: 0, totalPending: 0 });
    // Routing still ran to completion; routed reflects the 2 successes.
    expect(result.routed).toBe(2);
  });
});
