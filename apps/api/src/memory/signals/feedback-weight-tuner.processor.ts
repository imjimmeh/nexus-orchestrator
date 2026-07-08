import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { FeedbackWeightTunerService } from './feedback-weight-tuner.service';
import type { WeightTuneOutcome } from './feedback-weight-tuner.types';
import {
  FEEDBACK_WEIGHT_TUNER_QUEUE,
  FEEDBACK_WEIGHT_TUNER_JOB_NAME,
} from './feedback-weight-tuner.constants';

/**
 * BullMQ processor for the weekly weight-tuner queue (EPIC-212 Phase-3
 * Task 9).
 *
 * Owns the *work*; the schedule is owned by
 * {@link FeedbackWeightTunerScheduler}. Only
 * {@link FEEDBACK_WEIGHT_TUNER_JOB_NAME} is handled — any other job name is
 * logged at `debug` and returned as `null`.
 *
 * The processor does not gate on the enabled flag: the service no-ops (before
 * any DB query) when `feedback_weight_tuner_enabled` is off, mirroring the
 * clusterer's "service decides" approach. A hard failure that escapes the
 * service is re-thrown so BullMQ retries per the queue's default policy.
 */
@Injectable()
@Processor(FEEDBACK_WEIGHT_TUNER_QUEUE)
export class FeedbackWeightTunerProcessor extends WorkerHost {
  private readonly logger = new Logger(FeedbackWeightTunerProcessor.name);

  constructor(private readonly tuner: FeedbackWeightTunerService) {
    super();
  }

  async process(
    job: Job<unknown, WeightTuneOutcome>,
  ): Promise<WeightTuneOutcome | null> {
    if (job.name !== FEEDBACK_WEIGHT_TUNER_JOB_NAME) {
      this.logger.debug(
        `Ignoring unknown feedback-weight-tuner queue task: ${job.name}`,
      );
      return null;
    }

    const outcome = await this.tuner.runTune();
    this.logger.log(
      `FeedbackWeightTunerProcessor tick: applied=${outcome.applied.toString()}, ` +
        `reason=${outcome.reason}, sampleSize=${outcome.sampleSize.toString()}, ` +
        `boundedDelta=${outcome.boundedDelta.toString()}`,
    );
    return outcome;
  }
}
