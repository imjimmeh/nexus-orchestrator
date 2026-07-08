/**
 * `PostmortemMemoryBackfiller` — milestone 3 of work item
 * 71cdcd7b-daff-489d-b681-44d239765c99.
 *
 * Thin pass-through over
 * {@link WorkflowPostmortemLearningAggregatorService}. The wrapper exists
 * for two reasons:
 *
 *   1. **Seam documentation.** The aggregator's recurrence-count call is
 *      the "post-write backfill" step in the listener's success path —
 *      i.e. it fires AFTER `PostmortemWriter.writePostmortem` has returned
 *      `kind: 'ok'`. Naming the wrapper after that seam (rather than the
 *      underlying "learning aggregator") makes the listener's success path
 *      read like the orchestration it actually performs: write the
 *      postmortem, then backfill the recurrence count.
 *   2. **Stable surface.** Milestone 4 will rewire the listener to
 *      inject this wrapper instead of the aggregator directly. The
 *      listener is then decoupled from the aggregator's class name; future
 *      refactors (e.g. swapping the implementation, adding caching, or
 *      routing the call through a queue) can land on the wrapper without
 *      touching the listener's collaborator graph.
 *
 * Behaviour: this service is a thin pass-through with a single defensive
 * catch-all around the aggregator call. The normal path
 * (`below-threshold` / `threshold-crossed` / the aggregator's own
 * `recurrence-error` return) is forwarded verbatim — the wrapper adds NO
 * behaviour of its own. If the aggregator itself ever throws (e.g. a
 * future code path that escapes its own catch-all), the wrapper returns
 * `{thresholdCrossed: false, reason: 'recurrence-error'}` instead of
 * surfacing the throw. That guarantees the listener's success path stays
 * intact on transient failures regardless of the aggregator's internal
 * error-handling shape.
 *
 * The wrapper is NOT yet wired into
 * `WorkflowFailurePostmortemListener` — that lands in milestone 4. For
 * this milestone the service is created in isolation; the listener still
 * injects and calls the aggregator directly so the milestone-by-milestone
 * refactor stays behaviour-preserving.
 */
import { Injectable, Logger } from '@nestjs/common';
import { WorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import type {
  PostmortemRecurrenceInput,
  PostmortemRecurrenceResult,
} from './workflow-failure-postmortem-learning-aggregator.types';

export type {
  PostmortemRecurrenceInput,
  PostmortemRecurrenceResult,
} from './workflow-failure-postmortem-learning-aggregator.types';

@Injectable()
export class PostmortemMemoryBackfiller {
  private readonly logger = new Logger(PostmortemMemoryBackfiller.name);

  constructor(
    private readonly aggregator: WorkflowPostmortemLearningAggregatorService,
  ) {}

  /**
   * Record the just-written postmortem's recurrence count against the
   * configured occurrence threshold. Pure pass-through to the underlying
   * aggregator, plus a defensive catch-all that converts any thrown
   * error into the canonical
   * `{thresholdCrossed: false, reason: 'recurrence-error'}` shape so the
   * listener's success path NEVER observes a throw from this seam.
   *
   * In the normal case the wrapper returns the aggregator's result
   * verbatim:
   *   - `below-threshold` →
   *     `{thresholdCrossed: false, reason: 'below-threshold', count,
   *     threshold, windowDays}`.
   *   - Threshold crossed (count >= threshold) →
   *     `{thresholdCrossed: true, count, threshold, windowDays}`.
   *   - Aggregator-internal error swallowed by the aggregator →
   *     `{thresholdCrossed: false, reason: 'recurrence-error'}`.
   *
   * The defensive catch-all only fires when the aggregator itself
   * throws — i.e. an unhandled escape that bypassed the aggregator's own
   * catch. The listener therefore sees a uniform contract: every call
   * resolves to a `PostmortemRecurrenceResult` (never a throw).
   *
   * Input fields (`scopeId`, `failureClass`,
   * `triggeredByWorkflowRunId`, `triggeredAt`) are forwarded to the
   * aggregator verbatim.
   */
  async recordRecurrence(
    input: PostmortemRecurrenceInput,
  ): Promise<PostmortemRecurrenceResult> {
    try {
      return await this.aggregator.recordPostmortemRecurrence(input);
    } catch (error) {
      // Defensive catch-all: the aggregator's own catch should
      // already have converted internal errors into the
      // `recurrence-error` shape. This branch fires only when the
      // aggregator's contract is broken (e.g. a future code path
      // that escapes its own catch). Log at warn so the escape is
      // observable in the event/log stream, and return the
      // canonical safe shape so the listener's success path stays
      // intact.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `PostmortemMemoryBackfiller swallowed unhandled error from aggregator for scope ${input.scopeId}/${input.failureClass}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { thresholdCrossed: false, reason: 'recurrence-error' };
    }
  }
}
