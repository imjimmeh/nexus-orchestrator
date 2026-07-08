import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ScheduledJobType } from '@nexus/core';
import { ScheduleExpressionService } from './schedule-expression.service';

describe('ScheduleExpressionService', () => {
  const service = new ScheduleExpressionService();

  it('resolves one-time schedules to a future run and normalizes expression', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');
    const future = '2026-04-12T10:10:00.000Z';

    const resolved = service.resolveInitialSchedule({
      scheduleType: ScheduledJobType.ONE_TIME,
      scheduleExpression: `  ${future}  `,
      now,
    });

    expect(resolved.normalizedExpression).toBe(future);
    expect(resolved.timezone).toBeNull();
    expect(resolved.nextRunAt?.toISOString()).toBe(future);
  });

  it('throws when one-time schedule is in the past', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');

    expect(() =>
      service.resolveInitialSchedule({
        scheduleType: ScheduledJobType.ONE_TIME,
        scheduleExpression: '2026-04-12T09:59:59.000Z',
        now,
      }),
    ).toThrow(BadRequestException);
  });

  it('resolves interval schedules and computes catch-up next run', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');

    const resolved = service.resolveInitialSchedule({
      scheduleType: ScheduledJobType.INTERVAL,
      scheduleExpression: '30',
      now,
    });

    expect(resolved.nextRunAt?.toISOString()).toBe('2026-04-12T10:00:30.000Z');

    const nextRun = service.computeNextRunAfterExecution({
      scheduleType: ScheduledJobType.INTERVAL,
      scheduleExpression: '30',
      timezone: null,
      lastRunAt: new Date('2026-04-12T10:00:00.000Z'),
      now: new Date('2026-04-12T10:01:20.000Z'),
    });

    expect(nextRun?.toISOString()).toBe('2026-04-12T10:01:30.000Z');
  });

  it('returns null for next run of one-time executions', () => {
    const nextRun = service.computeNextRunAfterExecution({
      scheduleType: ScheduledJobType.ONE_TIME,
      scheduleExpression: '2026-04-12T10:10:00.000Z',
      timezone: null,
      lastRunAt: new Date('2026-04-12T10:10:00.000Z'),
      now: new Date('2026-04-12T10:11:00.000Z'),
    });

    expect(nextRun).toBeNull();
  });

  it('resolves cron schedules with default timezone when unset', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');

    const resolved = service.resolveInitialSchedule({
      scheduleType: ScheduledJobType.CRON,
      scheduleExpression: '*/5 * * * *',
      now,
    });

    expect(resolved.timezone).toBe('UTC');
    expect(resolved.nextRunAt).toBeInstanceOf(Date);
    expect((resolved.nextRunAt?.getTime() ?? 0) > now.getTime()).toBe(true);
  });

  it('throws for invalid cron timezone', () => {
    const now = new Date('2026-04-12T10:00:00.000Z');

    expect(() =>
      service.resolveInitialSchedule({
        scheduleType: ScheduledJobType.CRON,
        scheduleExpression: '*/5 * * * *',
        timezone: 'Mars/OlympusMons',
        now,
      }),
    ).toThrow(BadRequestException);
  });
});
