import { Injectable } from '@nestjs/common';
import { ScheduledJobsService } from '../../../automation/scheduled-jobs.service';
import {
  ScheduledJobScope,
  ScheduledJobType,
  type ScheduledJobStatus,
} from '@nexus/core';
import {
  CreateScheduledJobParams,
  UpdateScheduledJobParams,
} from '../../../automation/scheduled-jobs.types';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';

@Injectable()
export class ScheduleToolsHandler {
  constructor(private readonly scheduledJobsService: ScheduledJobsService) {}

  async listSchedules(params: {
    scope_id?: string;
    scope?: ScheduledJobScope;
    status?: ScheduledJobStatus;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>> {
    const pagination = this.resolvePagination(params.limit, params.offset);
    const data = await this.scheduledJobsService.listScheduledJobs(
      {
        scopeId: params.scope_id,
        scope: params.scope,
        status: params.status,
      },
      pagination,
    );

    return {
      schedules: data.items,
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  }

  async getSchedule(scheduleId: string): Promise<Record<string, unknown>> {
    const schedule = await this.scheduledJobsService.getScheduledJob(
      requireNonEmptyString(scheduleId, 'scheduled_job_id'),
    );

    return {
      schedule,
    };
  }

  async createSchedule(params: {
    scope_id?: string;
    schedule_scope?: ScheduledJobScope;
    name: string;
    schedule_type: CreateScheduledJobParams['schedule_type'] | string;
    schedule_expression: string;
    timezone?: string;
    workflow_id: string;
    payload_json?: Record<string, unknown>;
    created_by?: string;
  }): Promise<Record<string, unknown>> {
    const schedule = await this.scheduledJobsService.createScheduledJob({
      ...params,
      schedule_type: this.normalizeScheduleType(
        params.schedule_type,
        'schedule_type',
      ),
    });

    return {
      schedule,
    };
  }

  async updateSchedule(params: {
    scheduled_job_id: string;
    name?: string;
    schedule_type?: UpdateScheduledJobParams['schedule_type'] | string;
    schedule_expression?: string;
    timezone?: string;
    workflow_id?: string;
    payload_json?: Record<string, unknown>;
    updated_by?: string;
  }): Promise<Record<string, unknown>> {
    const schedule = await this.scheduledJobsService.updateScheduledJob(
      requireNonEmptyString(params.scheduled_job_id, 'scheduled_job_id'),
      {
        name: params.name,
        schedule_type:
          params.schedule_type === undefined
            ? undefined
            : this.normalizeScheduleType(params.schedule_type, 'schedule_type'),
        schedule_expression: params.schedule_expression,
        timezone: params.timezone,
        workflow_id: params.workflow_id,
        payload_json: params.payload_json,
        updated_by: params.updated_by,
      },
    );

    return {
      schedule,
    };
  }

  async pauseSchedule(params: {
    scheduled_job_id: string;
    updated_by?: string;
  }): Promise<Record<string, unknown>> {
    const schedule = await this.scheduledJobsService.pauseScheduledJob(
      requireNonEmptyString(params.scheduled_job_id, 'scheduled_job_id'),
      params.updated_by,
    );

    return {
      schedule,
    };
  }

  async resumeSchedule(params: {
    scheduled_job_id: string;
    updated_by?: string;
  }): Promise<Record<string, unknown>> {
    const schedule = await this.scheduledJobsService.resumeScheduledJob(
      requireNonEmptyString(params.scheduled_job_id, 'scheduled_job_id'),
      params.updated_by,
    );

    return {
      schedule,
    };
  }

  async runScheduleNow(scheduleId: string): Promise<Record<string, unknown>> {
    const run = await this.scheduledJobsService.runScheduledJobNow(
      requireNonEmptyString(scheduleId, 'scheduled_job_id'),
    );

    return {
      run,
    };
  }

  async deleteSchedule(scheduleId: string): Promise<Record<string, unknown>> {
    const normalizedScheduleId = requireNonEmptyString(
      scheduleId,
      'scheduled_job_id',
    );
    await this.scheduledJobsService.deleteScheduledJob(normalizedScheduleId);

    return {
      scheduled_job_id: normalizedScheduleId,
      deleted: true,
    };
  }

  async listScheduleRuns(params: {
    scheduled_job_id: string;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>> {
    const pagination = this.resolvePagination(params.limit, params.offset);
    const data = await this.scheduledJobsService.listScheduledJobRuns(
      requireNonEmptyString(params.scheduled_job_id, 'scheduled_job_id'),
      pagination,
    );

    return {
      runs: data.items,
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  }

  private resolvePagination(
    limit?: number,
    offset?: number,
  ): {
    limit: number;
    offset: number;
  } {
    const resolvedLimit =
      typeof limit === 'number' && Number.isInteger(limit) && limit > 0
        ? limit
        : 20;
    const resolvedOffset =
      typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
        ? offset
        : 0;

    return {
      limit: resolvedLimit,
      offset: resolvedOffset,
    };
  }

  private normalizeScheduleType(
    scheduleType: string,
    _field: string,
  ): CreateScheduledJobParams['schedule_type'] {
    const normalized = scheduleType.toLowerCase();

    const scheduleTypeMap: Record<
      string,
      CreateScheduledJobParams['schedule_type']
    > = {
      cron: ScheduledJobType.CRON,
      interval: ScheduledJobType.INTERVAL,
      one_time: ScheduledJobType.ONE_TIME,
      once: ScheduledJobType.ONE_TIME,
    };

    const result = scheduleTypeMap[normalized];
    if (result) {
      return result;
    }
    return ScheduledJobType.INTERVAL; // Default
  }
}
