import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CandidatePipelineService } from './candidate-pipeline.service';
import type { PipelineRunResult } from './pipeline.types';
import {
  CANDIDATE_CLUSTERING_QUEUE,
  CANDIDATE_CLUSTERING_JOB_NAME,
} from './candidate-clusterer.constants';

/**
 * BullMQ processor for the candidate-clustering queue.
 *
 * The queue is dedicated to the nightly `CandidatePipelineService` pass.
 * This processor owns the *work entry point*; the schedule is owned by
 * {@link CandidateClustererScheduler} which registers a repeatable job on
 * the same queue at application bootstrap.
 *
 * Job name dispatch:
 *   Only {@link CANDIDATE_CLUSTERING_JOB_NAME} is handled. Any other job
 *   name that lands in the queue is logged at `debug` and returned as
 *   `null` — the pipeline is the single consumer and there is no
 *   shared multi-job contract on this queue today.
 *
 * Retry policy:
 *   The pipeline's per-candidate evaluation is best-effort (individual
 *   `updateById` failures should not abort the whole pass). A hard
 *   failure that escapes `pipeline.run()` (e.g. a transient DB outage on
 *   the clusterer candidate query) is re-thrown so BullMQ can retry per
 *   the queue's default policy.
 *
 * Orchestration:
 *   The `cluster → scoreAll → routePendingCandidates` sequence lives in
 *   {@link CandidatePipelineService} so the per-step error semantics and
 *   ordering invariants are unit-testable in isolation. This processor is
 *   a thin BullMQ adapter that propagates the pipeline result and the
 *   cluster step's re-throw contract to the queue.
 */
@Injectable()
@Processor(CANDIDATE_CLUSTERING_QUEUE)
export class CandidateClustererProcessor extends WorkerHost {
  private readonly logger = new Logger(CandidateClustererProcessor.name);

  constructor(private readonly pipeline: CandidatePipelineService) {
    super();
  }

  async process(
    job: Job<unknown, PipelineRunResult>,
  ): Promise<PipelineRunResult | null> {
    if (job.name !== CANDIDATE_CLUSTERING_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown candidate-clustering queue task: ${job.name}`,
      );
      return null;
    }
    return this.handleCronTick();
  }

  private async handleCronTick(): Promise<PipelineRunResult> {
    this.logger.log('CandidateClustererProcessor cron tick received');

    try {
      const result = await this.pipeline.run();
      this.logger.debug(
        `CandidateClustererProcessor tick summary: totalPending=${result.cluster.totalPending.toString()}, ` +
          `clustersFormed=${result.cluster.clustersFormed.toString()}, ` +
          `candidatesMerged=${result.cluster.candidatesMerged.toString()}`,
      );
      this.logger.debug(
        `CandidateClustererProcessor scoring summary: scored=${result.scoring.scored.toString()}, ` +
          `totalPending=${result.scoring.totalPending.toString()}`,
      );
      this.logger.debug(
        `CandidateClustererProcessor routing summary: routed=${result.routed.toString()}`,
      );
      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `CandidateClustererProcessor tick failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
