import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySegmentPostmortemRepository } from '../../memory/database/repositories/memory-segment.postmortem.repository';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WorkflowPostmortemLearningAggregatorService,
  coercePositiveInteger,
} from './workflow-failure-postmortem-learning-aggregator.service';

function createMemorySegmentRepo(count: number) {
  return {
    countPostmortemsByFailureClass: vi.fn(async () => count),
  };
}

function createSettings(
  options: {
    threshold?: number;
    windowDays?: number;
  } = {},
) {
  const threshold = options.threshold ?? 3;
  const windowDays = options.windowDays ?? 30;
  return {
    get: vi.fn(async (key: string) => {
      if (key === 'workflow_postmortem_occurrence_threshold') {
        return threshold;
      }
      if (key === 'workflow_postmortem_occurrence_window_days') {
        return windowDays;
      }
      return undefined;
    }),
  };
}

function createAggregator(
  options: {
    count: number;
    threshold?: number;
    windowDays?: number;
  } = { count: 0 },
) {
  const memorySegmentRepo = createMemorySegmentRepo(options.count);
  const settings = createSettings({
    ...(options.threshold !== undefined
      ? { threshold: options.threshold }
      : {}),
    ...(options.windowDays !== undefined
      ? { windowDays: options.windowDays }
      : {}),
  });
  const aggregator = new WorkflowPostmortemLearningAggregatorService(
    memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
    settings as unknown as SystemSettingsService,
  );
  return { aggregator, memorySegmentRepo, settings };
}

describe('WorkflowPostmortemLearningAggregatorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('reports below-threshold (no crossing) when the count is below the threshold', async () => {
    const { aggregator, memorySegmentRepo } = createAggregator({
      count: 2,
    });

    const result = await aggregator.recordPostmortemRecurrence({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-1',
      triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      thresholdCrossed: false,
      reason: 'below-threshold',
      count: 2,
      threshold: 3,
      windowDays: 30,
    });
    expect(
      memorySegmentRepo.countPostmortemsByFailureClass,
    ).toHaveBeenCalledWith(
      'project',
      'scope-1',
      'dependency_missing',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('reports a threshold crossing when the count equals the threshold (no candidate proposed)', async () => {
    const { aggregator, memorySegmentRepo } = createAggregator({
      count: 3,
    });

    const result = await aggregator.recordPostmortemRecurrence({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-at',
      triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      thresholdCrossed: true,
      count: 3,
      threshold: 3,
      windowDays: 30,
    });
    expect(
      memorySegmentRepo.countPostmortemsByFailureClass,
    ).toHaveBeenCalledTimes(1);
    // The retired emitter is gone — a crossing is logged as a gate signal.
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('threshold crossed'),
    );
  });

  it('honours a custom windowDays setting when computing the since anchor', async () => {
    const { aggregator, memorySegmentRepo } = createAggregator({
      count: 0,
      windowDays: 7,
    });

    await aggregator.recordPostmortemRecurrence({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-window',
      triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
    });

    const sinceIso = memorySegmentRepo.countPostmortemsByFailureClass.mock
      .calls[0]?.[3] as string;
    const sinceMs = new Date(sinceIso).getTime();
    const triggeredMs = new Date('2026-06-19T00:00:00.000Z').getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(triggeredMs - sinceMs).toBe(sevenDaysMs);
  });

  it('honours a custom threshold setting', async () => {
    const { aggregator } = createAggregator({
      count: 2,
      threshold: 2,
    });

    const result = await aggregator.recordPostmortemRecurrence({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-custom-threshold',
      triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      thresholdCrossed: true,
      count: 2,
      threshold: 2,
      windowDays: 30,
    });
  });

  it('returns recurrence-error and never throws when the repo throws', async () => {
    const memorySegmentRepo = {
      countPostmortemsByFailureClass: vi.fn(async () => {
        throw new Error('db offline');
      }),
    };
    const settings = createSettings();
    const aggregator = new WorkflowPostmortemLearningAggregatorService(
      memorySegmentRepo as unknown as MemorySegmentPostmortemRepository,
      settings as unknown as SystemSettingsService,
    );

    const result = await aggregator.recordPostmortemRecurrence({
      scopeId: 'scope-1',
      failureClass: 'dependency_missing',
      triggeredByWorkflowRunId: 'run-throw',
      triggeredAt: new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      thresholdCrossed: false,
      reason: 'recurrence-error',
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('db offline'),
      expect.anything(),
    );
  });
});

describe('coercePositiveInteger', () => {
  it.each([
    [3, 3],
    [0, 1], // falls back because 0 < 1
    [-1, 1], // falls back because -1 < 1
    [Number.NaN, 1], // falls back
    [Number.POSITIVE_INFINITY, 1], // falls back
    ['5', 5],
    ['abc', 1], // non-numeric string falls back
    [undefined, 1],
    [null, 1],
    [true, 1], // not a number → fallback
  ])('coerces %p to %p with fallback 1', (input, expected) => {
    expect(coercePositiveInteger(input, 1)).toBe(expected);
  });

  it('floors fractional positive values', () => {
    expect(coercePositiveInteger(2.7, 1)).toBe(2);
  });
});
