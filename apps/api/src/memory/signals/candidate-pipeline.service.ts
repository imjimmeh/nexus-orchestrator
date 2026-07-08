import { Injectable, Logger } from '@nestjs/common';
import { CandidateClustererService } from './candidate-clusterer.service';
import { CandidateScoringService } from './candidate-scoring.service';
import { LearningRouterService } from '../learning/learning-router.service';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { PipelineRunResult } from './pipeline.types';

// ── Module-level constants ────────────────────────────────────────────────────

/**
 * Maximum number of pending, un-routed candidates the routing pass evaluates
 * per pipeline run. Mirrors the clustering load ceiling; the router runs only
 * on surviving canonical (non-`merged`) rows, so this bounds an already-small
 * set.
 */
const MAX_ROUTING_LOAD = 10_000;

/**
 * Orchestrates the cluster → scoreAll → routePendingCandidates pipeline.
 *
 * Extracted from `CandidateClustererProcessor` so the processor can stay a
 * thin BullMQ entry point and the orchestration logic — its error
 * semantics, ordering invariants, and per-step observability — live in a
 * single, independently-testable unit.
 *
 * **`StruggleDetectorService` is intentionally scoped OUT of this pipeline.**
 * Struggle detection is an event-driven, write-new flow that lives in the
 * MemoryModule, not a `load → mutate → mutate` chain over the existing
 * `pending` candidate set. Folding it in here would conflate two lifecycles
 * with different triggers, cost profiles, and write shapes (see
 * `pipeline.types.ts::SignalCandidate` JSDoc).
 *
 * **Error semantics (preserved from the processor)**
 * 1. `cluster()` — errors RE-THROW. The cluster step is the hard prerequisite
 *    for downstream scoring and routing; swallowing its failure would let a
 *    broken nightly pass return a misleading success. Re-throw so BullMQ
 *    can retry per the queue's policy (and so cron observability surfaces
 *    the real error).
 * 2. `scoreAll()` — errors are CAUGHT, logged, and the pipeline returns
 *    `routed: 0` for the run. Scoring is idempotent and a transient failure
 *    does not warrant a hard cron abort; the next tick will re-score.
 * 3. Routing loop — per-candidate failures are CAUGHT, logged as warnings,
 *    and skipped. One bad row never aborts the batch.
 *
 * **Ordering invariants (preserved)**
 * 1. Cluster runs FIRST so the composite score reflects the freshly
 *    computed `recurrence_count`.
 * 2. Scoring runs SECOND and BEFORE the 2am sweep consumes the queue.
 * 3. Routing runs LAST so every pending, un-routed canonical candidate
 *    carries a deterministic `routing_target` BEFORE the sweep/promotion
 *    consults it.
 */
@Injectable()
export class CandidatePipelineService {
  private readonly logger = new Logger(CandidatePipelineService.name);

  constructor(
    private readonly clusterer: CandidateClustererService,
    private readonly scorer: CandidateScoringService,
    private readonly router: LearningRouterService,
    private readonly candidateRepo: LearningCandidateRepository,
  ) {}

  /**
   * Execute one full pipeline run: cluster → scoreAll → route pending.
   *
   * @returns The aggregated {@link PipelineRunResult} carrying the cluster
   *   summary, the scoring summary, and the routing success count. The
   *   cluster summary is the source-of-truth return (it is what the
   *   processor propagates to BullMQ and what the cron tick reports).
   */
  async run(): Promise<PipelineRunResult> {
    // Step 1: cluster — failures re-throw for cron observability.
    const cluster = await this.clusterer.cluster();

    // Step 2: scoring — fail-soft. A transient scoring error logs and
    // proceeds with an empty scoring result; the next tick will retry.
    let scoring;
    try {
      scoring = await this.scorer.scoreAll();
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `CandidatePipelineService scoring failed: ${err.message}`,
        err.stack,
      );
      scoring = { scored: 0, totalPending: 0 };
    }

    // Step 3: routing — per-candidate fail-soft. The outer step counts
    // successes; an individual row failure never aborts the batch.
    const routed = await this.routePendingCandidates();

    return { cluster, scoring, routed };
  }

  /**
   * Route every pending, un-routed candidate and persist its `routing_target`.
   * Idempotent: only `status='pending'` rows with `routing_target IS NULL` are
   * loaded, so a re-run (or a BullMQ retry) skips already-routed candidates.
   * Per-candidate fail-soft: a routing or persistence error for one candidate
   * is logged and skipped so the rest of the batch still completes.
   */
  private async routePendingCandidates(): Promise<number> {
    const pending =
      await this.candidateRepo.findPendingForRouting(MAX_ROUTING_LOAD);
    let routed = 0;
    for (const candidate of pending) {
      try {
        const decision = await this.router.route(candidate);
        await this.candidateRepo.setRoutingTarget(
          candidate.id,
          decision.target,
        );
        routed++;
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `CandidatePipelineService routing failed for candidate ${candidate.id}: ${err.message}`,
          err.stack,
        );
      }
    }
    return routed;
  }
}
