import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPostmortemLearningAggregatorService } from './workflow-failure-postmortem-learning-aggregator.service';
import type {
  PostmortemRecurrenceInput,
  PostmortemRecurrenceResult,
} from './workflow-failure-postmortem-learning-aggregator.types';
import { PostmortemMemoryBackfiller } from './postmortem-memory-backfiller.service';

function createAggregator(
  options: {
    result?: PostmortemRecurrenceResult;
    throws?: Error;
  } = {},
) {
  const recordPostmortemRecurrence = vi.fn(async () => {
    if (options.throws !== undefined) {
      throw options.throws;
    }
    return options.result;
  });
  const aggregator = { recordPostmortemRecurrence };
  return { aggregator, recordPostmortemRecurrence };
}

function createBackfiller(
  options: {
    result?: PostmortemRecurrenceResult;
    throws?: Error;
  } = {},
) {
  const { aggregator, recordPostmortemRecurrence } = createAggregator(options);
  const backfiller = new PostmortemMemoryBackfiller(
    aggregator as unknown as WorkflowPostmortemLearningAggregatorService,
  );
  return { backfiller, aggregator, recordPostmortemRecurrence };
}

const SAMPLE_INPUT: PostmortemRecurrenceInput = {
  scopeId: 'scope-1',
  failureClass: 'dependency_missing',
  triggeredByWorkflowRunId: 'run-backfill-1',
  triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
};

describe('PostmortemMemoryBackfiller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('below-threshold: forwards the aggregator result verbatim and propagates the input fields', async () => {
    const aggregatorResult: PostmortemRecurrenceResult = {
      thresholdCrossed: false,
      reason: 'below-threshold',
      count: 1,
      threshold: 5,
      windowDays: 30,
    };
    const { backfiller, recordPostmortemRecurrence } = createBackfiller({
      result: aggregatorResult,
    });

    const result = await backfiller.recordRecurrence(SAMPLE_INPUT);

    // Verbatim pass-through — the wrapper does not add, remove,
    // or reshape any field on the aggregator's `below-threshold`
    // return value.
    expect(result).toEqual(aggregatorResult);
    expect(result.thresholdCrossed).toBe(false);
    expect(result.reason).toBe('below-threshold');
    expect(result.count).toBe(1);
    expect(result.threshold).toBe(5);
    expect(result.windowDays).toBe(30);

    // Input fields are forwarded verbatim (object identity is
    // preserved, including the `triggeredAt: Date` reference).
    expect(recordPostmortemRecurrence).toHaveBeenCalledTimes(1);
    expect(recordPostmortemRecurrence).toHaveBeenCalledWith(SAMPLE_INPUT);
    const forwarded = recordPostmortemRecurrence.mock
      .calls[0]?.[0] as PostmortemRecurrenceInput;
    expect(forwarded).toBe(SAMPLE_INPUT);
    expect(forwarded.triggeredAt).toBe(SAMPLE_INPUT.triggeredAt);
  });

  it('threshold-crossed: forwards the aggregator result verbatim with count/threshold/windowDays intact', async () => {
    const aggregatorResult: PostmortemRecurrenceResult = {
      thresholdCrossed: true,
      count: 5,
      threshold: 5,
      windowDays: 30,
    };
    const { backfiller, recordPostmortemRecurrence } = createBackfiller({
      result: aggregatorResult,
    });

    const result = await backfiller.recordRecurrence(SAMPLE_INPUT);

    // Verbatim pass-through on the threshold-crossed branch —
    // the wrapper must NOT mutate or strip count/threshold/
    // windowDays, and it must NOT inject a `reason` field that
    // the aggregator did not surface.
    expect(result).toEqual({
      thresholdCrossed: true,
      count: 5,
      threshold: 5,
      windowDays: 30,
    });
    expect(result.reason).toBeUndefined();

    expect(recordPostmortemRecurrence).toHaveBeenCalledTimes(1);
    expect(recordPostmortemRecurrence).toHaveBeenCalledWith(SAMPLE_INPUT);
  });

  it('aggregator-error swallowed: aggregator throwing returns {thresholdCrossed: false, reason: "recurrence-error"} without re-throwing', async () => {
    const { backfiller, recordPostmortemRecurrence } = createBackfiller({
      throws: new Error('aggregator contract violated'),
    });

    // The wrapper's defensive catch-all must absorb the
    // aggregator's throw — the listener's success path sees a
    // uniform contract (a `PostmortemRecurrenceResult`, never a
    // throw).
    let result: PostmortemRecurrenceResult | undefined;
    let thrown: unknown;
    try {
      result = await backfiller.recordRecurrence(SAMPLE_INPUT);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
    expect(result).toEqual({
      thresholdCrossed: false,
      reason: 'recurrence-error',
    });

    // The aggregator was invoked exactly once with the input
    // forwarded verbatim — the wrapper does not retry, mutate,
    // or swallow the call before invoking the dependency.
    expect(recordPostmortemRecurrence).toHaveBeenCalledTimes(1);
    expect(recordPostmortemRecurrence).toHaveBeenCalledWith(SAMPLE_INPUT);

    // The escape was logged at warn so it stays observable in
    // the event/log stream (the listener relies on this surface
    // never throwing, but a thrown escape is still a bug to be
    // surfaced during development).
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('aggregator contract violated'),
      expect.anything(),
    );
  });

  it('aggregator-recurrence-error-shape: forwards the aggregator own recurrence-error shape verbatim', async () => {
    // The aggregator's own catch-all already converts internal
    // errors into `{thresholdCrossed: false, reason:
    // 'recurrence-error'}`. The wrapper must forward that shape
    // verbatim (NOT re-wrap, NOT log a warn — the aggregator has
    // already logged the underlying cause).
    const aggregatorResult: PostmortemRecurrenceResult = {
      thresholdCrossed: false,
      reason: 'recurrence-error',
    };
    const { backfiller } = createBackfiller({ result: aggregatorResult });

    const result = await backfiller.recordRecurrence(SAMPLE_INPUT);

    expect(result).toEqual({
      thresholdCrossed: false,
      reason: 'recurrence-error',
    });
    // No warn-log on this path: the aggregator already handled
    // the error, so the wrapper's own warn spy should NOT have
    // fired.
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });
});
