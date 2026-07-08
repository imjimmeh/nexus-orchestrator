import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ScheduledJobScope,
  ScheduledJobStatus,
  ScheduledJobTargetType,
} from '@nexus/core';
import { ScheduledJobRunRepository } from './database/repositories/scheduled-job-run.repository';
import { ScheduledJobRepository } from './database/repositories/scheduled-job.repository';
import { ScheduledJob } from './database/entities/scheduled-job.entity';
import { ScheduledJobRun } from './database/entities/scheduled-job-run.entity';
import { ScheduleExpressionService } from './schedule-expression.service';
import { ScheduledJobsRunnerService } from './scheduled-jobs-runner.service';
import { WORKFLOW_DEFINITION_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowDefinitionRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  CreateScheduledJobParams,
  ListScheduledJobRunsResult,
  ListScheduledJobsResult,
  PollDueSchedulesResult,
  ScheduledJobListFilters,
  ScheduledJobPagination,
  ScheduledJobRunSummaryView,
  ScheduledJobSummaryView,
  UpdateScheduledJobParams,
} from './scheduled-jobs.types';
import {
  toScheduledJobRunSummary,
  toScheduledJobSummary,
} from './scheduled-jobs.view';

@Injectable()
export class ScheduledJobsService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository: IWorkflowDefinitionRepository,
    private readonly scheduledJobRepository: ScheduledJobRepository,
    private readonly scheduledJobRunRepository: ScheduledJobRunRepository,
    private readonly scheduleExpressionService: ScheduleExpressionService,
    private readonly scheduledJobsRunner: ScheduledJobsRunnerService,
  ) {}

  async listScheduledJobs(
    filters: ScheduledJobListFilters,
    pagination: ScheduledJobPagination,
  ): Promise<ListScheduledJobsResult> {
    const { data, total } = await this.scheduledJobRepository.findAll(
      filters,
      pagination,
    );

    const latestRuns =
      await this.scheduledJobRunRepository.findLatestByScheduledJobIds(
        data.map((item) => item.id),
      );
    const runMap = new Map<string, ScheduledJobRun>(
      latestRuns.map((run) => [run.scheduled_job_id, run]),
    );

    return {
      items: data.map((job) =>
        toScheduledJobSummary(job, runMap.get(job.id) ?? null),
      ),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async getScheduledJob(id: string): Promise<ScheduledJobSummaryView> {
    const job = await this.requireScheduledJob(id);
    const lastRun = await this.readLatestRunForJob(id);
    return toScheduledJobSummary(job, lastRun);
  }

  async createScheduledJob(
    params: CreateScheduledJobParams,
  ): Promise<ScheduledJobSummaryView> {
    const scope = this.resolveScheduleScope(params.schedule_scope);
    const scopeId = await this.resolveScopeIdForCreate({
      scope,
      scopeId: params.scopeId,
    });
    await this.ensureWorkflowExists(params.workflow_id);

    const now = new Date();
    const resolved = this.scheduleExpressionService.resolveInitialSchedule({
      scheduleType: params.schedule_type,
      scheduleExpression: params.schedule_expression,
      timezone: params.timezone,
      now,
    });

    const created = await this.scheduledJobRepository.create({
      schedule_scope: scope,
      scopeId: scopeId,
      name: this.normalizeName(params.name),
      status: ScheduledJobStatus.ACTIVE,
      schedule_type: params.schedule_type,
      schedule_expression: resolved.normalizedExpression,
      timezone: resolved.timezone,
      next_run_at: resolved.nextRunAt,
      execution_target_type: ScheduledJobTargetType.WORKFLOW,
      execution_target_ref: params.workflow_id,
      payload_json: params.payload_json ?? {},
      created_by: params.created_by ?? null,
      updated_by: params.created_by ?? null,
      paused_at: null,
    });

    return toScheduledJobSummary(created, null);
  }

  async updateScheduledJob(
    id: string,
    params: UpdateScheduledJobParams,
  ): Promise<ScheduledJobSummaryView> {
    const existing = await this.requireScheduledJob(id);

    const updatePayload = await this.buildUpdatePayload(existing, params);
    const updated = await this.scheduledJobRepository.update(id, updatePayload);

    if (!updated) {
      throw new NotFoundException(`Scheduled job ${id} not found`);
    }

    const lastRun = await this.readLatestRunForJob(id);
    return toScheduledJobSummary(updated, lastRun);
  }

  async pauseScheduledJob(
    id: string,
    updatedBy?: string,
  ): Promise<ScheduledJobSummaryView> {
    const existing = await this.requireScheduledJob(id);
    if (existing.status === ScheduledJobStatus.PAUSED) {
      const lastRun = await this.readLatestRunForJob(id);
      return toScheduledJobSummary(existing, lastRun);
    }

    const updated = await this.scheduledJobRepository.update(id, {
      status: ScheduledJobStatus.PAUSED,
      paused_at: new Date(),
      updated_by: updatedBy ?? existing.updated_by,
    });

    if (!updated) {
      throw new NotFoundException(`Scheduled job ${id} not found`);
    }

    const lastRun = await this.readLatestRunForJob(id);
    return toScheduledJobSummary(updated, lastRun);
  }

  async resumeScheduledJob(
    id: string,
    updatedBy?: string,
  ): Promise<ScheduledJobSummaryView> {
    const existing = await this.requireScheduledJob(id);

    const resolved = this.scheduleExpressionService.resolveInitialSchedule({
      scheduleType: existing.schedule_type,
      scheduleExpression: existing.schedule_expression,
      timezone: existing.timezone,
      now: new Date(),
    });

    const updated = await this.scheduledJobRepository.update(id, {
      status: ScheduledJobStatus.ACTIVE,
      paused_at: null,
      next_run_at: resolved.nextRunAt,
      updated_by: updatedBy ?? existing.updated_by,
    });

    if (!updated) {
      throw new NotFoundException(`Scheduled job ${id} not found`);
    }

    const lastRun = await this.readLatestRunForJob(id);
    return toScheduledJobSummary(updated, lastRun);
  }

  async runScheduledJobNow(id: string): Promise<ScheduledJobRunSummaryView> {
    const job = await this.requireScheduledJob(id);
    return this.scheduledJobsRunner.runScheduledJobNow(job);
  }

  async deleteScheduledJob(id: string): Promise<void> {
    await this.requireScheduledJob(id);
    await this.scheduledJobRepository.remove(id);
  }

  async listScheduledJobRuns(
    id: string,
    pagination: ScheduledJobPagination,
  ): Promise<ListScheduledJobRunsResult> {
    await this.requireScheduledJob(id);
    const { data, total } =
      await this.scheduledJobRunRepository.findByScheduledJobId(id, pagination);

    return {
      items: data.map((run) => toScheduledJobRunSummary(run)),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async processDueSchedules(params: {
    now: Date;
    batchSize: number;
  }): Promise<PollDueSchedulesResult> {
    return this.scheduledJobsRunner.processDueSchedules(params);
  }

  private async buildUpdatePayload(
    existing: ScheduledJob,
    params: UpdateScheduledJobParams,
  ): Promise<Partial<ScheduledJob>> {
    const workflowId = await this.resolveWorkflowId(existing, params);
    const schedule = this.resolveScheduleFields(existing, params);

    return {
      name: this.resolveName(existing, params),
      schedule_type: schedule.scheduleType,
      schedule_expression: schedule.scheduleExpression,
      timezone: schedule.timezone,
      next_run_at: schedule.nextRunAt,
      execution_target_ref: workflowId,
      payload_json: params.payload_json ?? existing.payload_json,
      updated_by: params.updated_by ?? existing.updated_by,
    };
  }

  private async resolveWorkflowId(
    existing: ScheduledJob,
    params: UpdateScheduledJobParams,
  ): Promise<string> {
    if (!params.workflow_id) {
      return existing.execution_target_ref;
    }

    await this.ensureWorkflowExists(params.workflow_id);
    return params.workflow_id;
  }

  private resolveScheduleFields(
    existing: ScheduledJob,
    params: UpdateScheduledJobParams,
  ): {
    scheduleType: ScheduledJob['schedule_type'];
    scheduleExpression: string;
    timezone: string | null;
    nextRunAt: Date | null;
  } {
    const scheduleType = params.schedule_type ?? existing.schedule_type;
    const scheduleExpression =
      params.schedule_expression ?? existing.schedule_expression;
    const timezone = params.timezone ?? existing.timezone ?? undefined;

    if (!this.isScheduleChanged(params)) {
      return {
        scheduleType,
        scheduleExpression,
        timezone: existing.timezone ?? null,
        nextRunAt: existing.next_run_at ?? null,
      };
    }

    const resolved = this.scheduleExpressionService.resolveInitialSchedule({
      scheduleType,
      scheduleExpression,
      timezone,
      now: new Date(),
    });

    return {
      scheduleType,
      scheduleExpression: resolved.normalizedExpression,
      timezone: resolved.timezone,
      nextRunAt:
        existing.status === ScheduledJobStatus.ACTIVE
          ? resolved.nextRunAt
          : (existing.next_run_at ?? null),
    };
  }

  private isScheduleChanged(params: UpdateScheduledJobParams): boolean {
    return (
      params.schedule_type !== undefined ||
      params.schedule_expression !== undefined ||
      params.timezone !== undefined
    );
  }

  private resolveName(
    existing: ScheduledJob,
    params: UpdateScheduledJobParams,
  ): string {
    if (params.name === undefined) {
      return existing.name;
    }
    return this.normalizeName(params.name);
  }

  private async readLatestRunForJob(
    jobId: string,
  ): Promise<ScheduledJobRun | null> {
    const latestRuns =
      await this.scheduledJobRunRepository.findLatestByScheduledJobIds([jobId]);
    return latestRuns[0] ?? null;
  }

  private normalizeName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('name is required');
    }
    return trimmed;
  }

  private async requireScheduledJob(id: string): Promise<ScheduledJob> {
    const schedule = await this.scheduledJobRepository.findById(id);
    if (!schedule) {
      throw new NotFoundException(`Scheduled job ${id} not found`);
    }
    return schedule;
  }

  private resolveScheduleScope(scope?: ScheduledJobScope): ScheduledJobScope {
    return scope ?? ScheduledJobScope.SCOPE;
  }

  private async resolveScopeIdForCreate(params: {
    scope: ScheduledJobScope;
    scopeId?: string;
  }): Promise<string | null> {
    await Promise.resolve();
    if (params.scope === ScheduledJobScope.GLOBAL) {
      return null;
    }

    if (!params.scopeId) {
      throw new BadRequestException(
        'scopeId is required for project-scoped schedules',
      );
    }

    return params.scopeId;
  }

  private async ensureWorkflowExists(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (!workflow.is_active) {
      throw new BadRequestException(
        `Workflow ${workflowId} is inactive and cannot be scheduled`,
      );
    }
  }
}
