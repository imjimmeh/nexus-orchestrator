import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HeartbeatProfile } from './database/entities/heartbeat-profile.entity';
import { HeartbeatProfileRepository } from './database/repositories/heartbeat-profile.repository';
import { HeartbeatRunRepository } from './database/repositories/heartbeat-run.repository';
import { HeartbeatRunnerService } from './heartbeat-runner.service';
import { WORKFLOW_DEFINITION_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowDefinitionRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  CreateHeartbeatProfileParams,
  HeartbeatPagination,
  HeartbeatProfileSummaryView,
  HeartbeatRunSummaryView,
  ListHeartbeatProfilesResult,
  ListHeartbeatRunsResult,
  PollDueHeartbeatsResult,
  UpdateHeartbeatProfileParams,
} from './heartbeat.types';
import {
  toHeartbeatProfileSummary,
  toHeartbeatRunSummary,
} from './heartbeat.view';

@Injectable()
export class HeartbeatService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository: IWorkflowDefinitionRepository,
    private readonly heartbeatProfileRepository: HeartbeatProfileRepository,
    private readonly heartbeatRunRepository: HeartbeatRunRepository,
    private readonly heartbeatRunner: HeartbeatRunnerService,
  ) {}

  async listHeartbeatProfiles(params: {
    scopeId: string;
    pagination: HeartbeatPagination;
  }): Promise<ListHeartbeatProfilesResult> {
    const { data, total } = await this.heartbeatProfileRepository.findByScopeId(
      params.scopeId,
      params.pagination,
    );

    const latestRuns =
      await this.heartbeatRunRepository.findLatestByHeartbeatProfileIds(
        data.map((item) => item.id),
      );
    const runMap = new Map(
      latestRuns.map((run) => [run.heartbeat_profile_id, run]),
    );

    return {
      items: data.map((profile) =>
        toHeartbeatProfileSummary(profile, runMap.get(profile.id) ?? null),
      ),
      total,
      limit: params.pagination.limit,
      offset: params.pagination.offset,
    };
  }

  async getHeartbeatProfile(id: string): Promise<HeartbeatProfileSummaryView> {
    const profile = await this.requireHeartbeatProfile(id);
    const latestRuns =
      await this.heartbeatRunRepository.findLatestByHeartbeatProfileIds([id]);
    return toHeartbeatProfileSummary(profile, latestRuns[0] ?? null);
  }

  async createHeartbeatProfile(
    params: CreateHeartbeatProfileParams,
  ): Promise<HeartbeatProfileSummaryView> {
    await this.ensureWorkflowExists(params.workflow_id);

    const intervalSeconds = this.normalizeInterval(params.interval_seconds);
    const enabled = params.enabled ?? true;
    const created = await this.heartbeatProfileRepository.create({
      scopeId: params.scopeId,
      name: this.normalizeName(params.name),
      enabled,
      interval_seconds: intervalSeconds,
      workflow_id: params.workflow_id,
      payload_json: params.payload_json ?? {},
      next_run_at: enabled
        ? this.computeNextRunAt(new Date(), intervalSeconds)
        : null,
      last_run_at: null,
      created_by: params.created_by ?? null,
      updated_by: params.created_by ?? null,
    });

    return toHeartbeatProfileSummary(created, null);
  }

  async updateHeartbeatProfile(
    id: string,
    params: UpdateHeartbeatProfileParams,
  ): Promise<HeartbeatProfileSummaryView> {
    const existing = await this.requireHeartbeatProfile(id);
    const workflowId = await this.resolveWorkflowId(
      params.workflow_id,
      existing.workflow_id,
    );
    const intervalSeconds = this.resolveIntervalSeconds(
      params.interval_seconds,
      existing.interval_seconds,
    );
    const enabled = params.enabled ?? existing.enabled;
    const nextRunAt = this.resolveNextRunAt({
      enabled,
      requestedEnabled: params.enabled,
      requestedIntervalSeconds: params.interval_seconds,
      existingNextRunAt: existing.next_run_at,
      intervalSeconds,
    });

    const updated = await this.heartbeatProfileRepository.update(id, {
      name:
        params.name !== undefined
          ? this.normalizeName(params.name)
          : existing.name,
      enabled,
      interval_seconds: intervalSeconds,
      workflow_id: workflowId,
      payload_json: params.payload_json ?? existing.payload_json,
      next_run_at: nextRunAt,
      updated_by: params.updated_by ?? existing.updated_by,
    });

    if (!updated) {
      throw new NotFoundException(`Heartbeat profile ${id} not found`);
    }

    const latestRuns =
      await this.heartbeatRunRepository.findLatestByHeartbeatProfileIds([id]);
    return toHeartbeatProfileSummary(updated, latestRuns[0] ?? null);
  }

  async runHeartbeatNow(id: string): Promise<HeartbeatRunSummaryView> {
    const profile = await this.requireHeartbeatProfile(id);
    return this.heartbeatRunner.runHeartbeatNow(profile);
  }

  async deleteHeartbeatProfile(id: string): Promise<void> {
    await this.requireHeartbeatProfile(id);
    await this.heartbeatProfileRepository.remove(id);
  }

  async listHeartbeatRuns(
    id: string,
    pagination: HeartbeatPagination,
  ): Promise<ListHeartbeatRunsResult> {
    await this.requireHeartbeatProfile(id);
    const { data, total } =
      await this.heartbeatRunRepository.findByHeartbeatProfileId(
        id,
        pagination,
      );

    return {
      items: data.map((run) => toHeartbeatRunSummary(run)),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async processDueHeartbeats(params: {
    now: Date;
    batchSize: number;
  }): Promise<PollDueHeartbeatsResult> {
    return this.heartbeatRunner.processDueHeartbeats(params);
  }

  private async requireHeartbeatProfile(id: string): Promise<HeartbeatProfile> {
    const profile = await this.heartbeatProfileRepository.findById(id);
    if (!profile) {
      throw new NotFoundException(`Heartbeat profile ${id} not found`);
    }

    return profile;
  }

  private async resolveWorkflowId(
    requestedWorkflowId: string | undefined,
    fallbackWorkflowId: string,
  ): Promise<string> {
    if (!requestedWorkflowId) {
      return fallbackWorkflowId;
    }

    await this.ensureWorkflowExists(requestedWorkflowId);
    return requestedWorkflowId;
  }

  private resolveIntervalSeconds(
    requestedIntervalSeconds: number | undefined,
    fallbackIntervalSeconds: number,
  ): number {
    if (requestedIntervalSeconds === undefined) {
      return fallbackIntervalSeconds;
    }

    return this.normalizeInterval(requestedIntervalSeconds);
  }

  private resolveNextRunAt(params: {
    enabled: boolean;
    requestedEnabled: boolean | undefined;
    requestedIntervalSeconds: number | undefined;
    existingNextRunAt: Date | null | undefined;
    intervalSeconds: number;
  }): Date | null {
    if (!params.enabled) {
      return null;
    }

    const shouldRecomputeNextRunAt =
      params.requestedEnabled === true ||
      params.requestedIntervalSeconds !== undefined ||
      (params.existingNextRunAt === null && params.enabled);

    return shouldRecomputeNextRunAt
      ? this.computeNextRunAt(new Date(), params.intervalSeconds)
      : (params.existingNextRunAt ?? null);
  }

  private normalizeName(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('name is required');
    }
    return trimmed;
  }

  private normalizeInterval(value: number): number {
    if (!Number.isFinite(value) || value < 10) {
      throw new BadRequestException('interval_seconds must be at least 10');
    }

    return Math.floor(value);
  }

  private computeNextRunAt(now: Date, intervalSeconds: number): Date {
    return new Date(now.getTime() + intervalSeconds * 1000);
  }

  private async ensureWorkflowExists(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (!workflow.is_active) {
      throw new BadRequestException(
        `Workflow ${workflowId} is inactive and cannot be used for heartbeat`,
      );
    }
  }
}
