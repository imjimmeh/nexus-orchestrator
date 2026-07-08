import { BadRequestException, Injectable } from '@nestjs/common';
import { ScheduledJobType } from '@nexus/core';
import { parseExpression } from 'cron-parser';
import { DEFAULT_SCHEDULE_TIMEZONE } from './scheduled-jobs.constants';

interface ResolveInitialScheduleParams {
  scheduleType: ScheduledJobType;
  scheduleExpression: string;
  timezone?: string | null;
  now: Date;
}

interface ComputeNextAfterExecutionParams {
  scheduleType: ScheduledJobType;
  scheduleExpression: string;
  timezone?: string | null;
  now: Date;
  lastRunAt: Date;
}

interface ResolvedInitialSchedule {
  normalizedExpression: string;
  timezone: string | null;
  nextRunAt: Date | null;
}

const MIN_INTERVAL_SECONDS = 5;

@Injectable()
export class ScheduleExpressionService {
  resolveInitialSchedule(
    params: ResolveInitialScheduleParams,
  ): ResolvedInitialSchedule {
    const normalizedExpression = params.scheduleExpression.trim();
    if (normalizedExpression.length === 0) {
      throw new BadRequestException('schedule_expression is required');
    }

    if (params.scheduleType === ScheduledJobType.ONE_TIME) {
      const nextRunAt = this.parseOneTimeDate({
        expression: normalizedExpression,
      });
      if (nextRunAt.getTime() <= params.now.getTime()) {
        throw new BadRequestException(
          'one_time schedule_expression must be in the future',
        );
      }

      return {
        normalizedExpression,
        timezone: null,
        nextRunAt,
      };
    }

    if (params.scheduleType === ScheduledJobType.INTERVAL) {
      const intervalSeconds = this.parseIntervalSeconds(normalizedExpression);
      return {
        normalizedExpression,
        timezone: null,
        nextRunAt: new Date(params.now.getTime() + intervalSeconds * 1000),
      };
    }

    const timezone = this.normalizeTimezone(params.timezone);
    const nextRunAt = this.parseCronNextRun({
      expression: normalizedExpression,
      timezone,
      currentDate: params.now,
    });

    return {
      normalizedExpression,
      timezone,
      nextRunAt,
    };
  }

  computeNextRunAfterExecution(
    params: ComputeNextAfterExecutionParams,
  ): Date | null {
    const normalizedExpression = params.scheduleExpression.trim();

    if (params.scheduleType === ScheduledJobType.ONE_TIME) {
      return null;
    }

    if (params.scheduleType === ScheduledJobType.INTERVAL) {
      const intervalSeconds = this.parseIntervalSeconds(normalizedExpression);
      const intervalMs = intervalSeconds * 1000;
      const lastRunAtMs = params.lastRunAt.getTime();
      const nowMs = params.now.getTime();

      if (lastRunAtMs >= nowMs) {
        return new Date(lastRunAtMs + intervalMs);
      }

      const elapsedMs = nowMs - lastRunAtMs;
      const skippedIntervals = Math.floor(elapsedMs / intervalMs) + 1;
      return new Date(lastRunAtMs + skippedIntervals * intervalMs);
    }

    const timezone = this.normalizeTimezone(params.timezone);
    return this.parseCronNextRun({
      expression: normalizedExpression,
      timezone,
      currentDate: params.lastRunAt,
    });
  }

  private parseOneTimeDate(params: { expression: string }): Date {
    const timestamp = Date.parse(params.expression);
    if (Number.isNaN(timestamp)) {
      throw new BadRequestException(
        'one_time schedule_expression must be a valid ISO date-time',
      );
    }

    return new Date(timestamp);
  }

  private parseIntervalSeconds(expression: string): number {
    const parsed = Number.parseInt(expression, 10);
    if (!Number.isFinite(parsed) || parsed.toString() !== expression) {
      throw new BadRequestException(
        'interval schedule_expression must be an integer number of seconds',
      );
    }

    if (parsed < MIN_INTERVAL_SECONDS) {
      throw new BadRequestException(
        `interval schedule_expression must be at least ${MIN_INTERVAL_SECONDS.toString()} seconds`,
      );
    }

    return parsed;
  }

  private normalizeTimezone(timezone: string | null | undefined): string {
    const value = timezone?.trim() || DEFAULT_SCHEDULE_TIMEZONE;

    try {
      new Intl.DateTimeFormat(undefined, { timeZone: value });
      return value;
    } catch {
      throw new BadRequestException('timezone must be a valid IANA timezone');
    }
  }

  private parseCronNextRun(params: {
    expression: string;
    timezone: string;
    currentDate: Date;
  }): Date {
    try {
      const cron = parseExpression(params.expression, {
        currentDate: params.currentDate,
        tz: params.timezone,
      });
      return cron.next().toDate();
    } catch {
      throw new BadRequestException(
        'cron schedule_expression must be a valid cron expression',
      );
    }
  }
}
