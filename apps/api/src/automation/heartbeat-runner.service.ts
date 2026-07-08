import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HeartbeatRunStatus } from '@nexus/core';
import { HeartbeatProfile } from './database/entities/heartbeat-profile.entity';
import { HeartbeatRun } from './database/entities/heartbeat-run.entity';
import { HeartbeatProfileRepository } from './database/repositories/heartbeat-profile.repository';
import { HeartbeatRunRepository } from './database/repositories/heartbeat-run.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import type {
  HeartbeatRunSummaryView,
  PollDueHeartbeatsResult,
} from './heartbeat.types';
import { toHeartbeatRunSummary } from './heartbeat.view';
import { WORKFLOW_ENGINE_SERVICE } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../workflow/kernel/interfaces/workflow-kernel.ports';

@Injectable()
export class HeartbeatRunnerService {
  private readonly logger = new Logger(HeartbeatRunnerService.name);

  constructor(
    private readonly heartbeatProfileRepository: HeartbeatProfileRepository,
    private readonly heartbeatRunRepository: HeartbeatRunRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngineService: IWorkflowEngineService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async runHeartbeatNow(
    profile: HeartbeatProfile,
  ): Promise<HeartbeatRunSummaryView> {
    const dueAt = new Date();
    const run = await this.heartbeatRunRepository.create({
      heartbeat_profile_id: profile.id,
      status: HeartbeatRunStatus.TRIGGERED,
      due_at: dueAt,
      triggered_at: dueAt,
      started_at: null,
      finished_at: null,
      workflow_run_id: null,
      error_code: null,
      error_message: null,
      diagnostics_json: { source: 'manual' },
    });

    return this.dispatchHeartbeatRun({
      profile,
      run,
      dueAt,
      source: 'manual',
    });
  }

  async processDueHeartbeats(params: {
    now: Date;
    batchSize: number;
  }): Promise<PollDueHeartbeatsResult> {
    const dueProfiles = await this.heartbeatProfileRepository.findDueProfiles({
      now: params.now,
      limit: params.batchSize,
    });

    let started = 0;
    let skipped = 0;

    for (const profile of dueProfiles) {
      const dispatched = await this.processDueHeartbeatProfile(
        profile,
        params.now,
      );
      if (dispatched) {
        started++;
      } else {
        skipped++;
      }
    }

    return {
      scanned: dueProfiles.length,
      started,
      skipped,
    };
  }

  private async processDueHeartbeatProfile(
    profile: HeartbeatProfile,
    now: Date,
  ): Promise<boolean> {
    const dueAt = profile.next_run_at;
    if (!dueAt) {
      return false;
    }

    const nextRunAt = this.computeNextRunAt(now, profile.interval_seconds);
    const claimed = await this.heartbeatProfileRepository.advanceNextRunIfDue({
      id: profile.id,
      dueAt,
      nextRunAt,
      lastRunAt: now,
    });
    if (!claimed) {
      return false;
    }

    const run = await this.heartbeatRunRepository.createIfNotExistsByDueKey({
      heartbeat_profile_id: profile.id,
      status: HeartbeatRunStatus.TRIGGERED,
      due_at: dueAt,
      triggered_at: now,
      started_at: null,
      finished_at: null,
      workflow_run_id: null,
      error_code: null,
      error_message: null,
      diagnostics_json: { source: 'poll' },
    });

    if (!run) {
      return false;
    }

    await this.dispatchHeartbeatRun({
      profile,
      run,
      dueAt,
      source: 'poll',
    });

    return true;
  }

  private async dispatchHeartbeatRun(params: {
    profile: HeartbeatProfile;
    run: HeartbeatRun;
    dueAt: Date;
    source: 'poll' | 'manual';
  }): Promise<HeartbeatRunSummaryView> {
    await this.heartbeatRunRepository.update(params.run.id, {
      status: HeartbeatRunStatus.RUNNING,
      started_at: new Date(),
    });

    try {
      const workflowRunId = await this.workflowEngineService.startWorkflow(
        params.profile.workflow_id,
        {
          trigger: {
            event: 'heartbeat.run',
            source: params.source,
            context: {
              scopeId: params.profile.scopeId,
              contextId: null,
              contextType: null,
              scopeNodeId: null,
              scopePath: null,
            },
            heartbeatProfileId: params.profile.id,
            heartbeatRunId: params.run.id,
            dueAt: params.dueAt.toISOString(),
          },
          payload: params.profile.payload_json,
        },
      );

      if (!workflowRunId) {
        return await this.markRunSkipped(params.profile, params.run.id);
      }

      const running = await this.heartbeatRunRepository.update(params.run.id, {
        workflow_run_id: workflowRunId,
      });
      if (!running) {
        throw new NotFoundException(`Heartbeat run ${params.run.id} not found`);
      }

      await this.eventLedger.emitBestEffort({
        domain: 'automation',
        eventName: 'automation.heartbeat.run.dispatched',
        outcome: 'success',
        context: {
          scopeId: params.profile.scopeId,
          contextId: null,
          contextType: null,
          scopeNodeId: null,
          scopePath: null,
        },
        workflowId: params.profile.workflow_id,
        workflowRunId,
        payload: {
          heartbeatProfileId: params.profile.id,
          heartbeatRunId: params.run.id,
          source: params.source,
        },
      });

      return toHeartbeatRunSummary(running);
    } catch (error) {
      return this.markRunFailed(params.profile, params.run.id, error);
    }
  }

  private async markRunSkipped(
    profile: HeartbeatProfile,
    runId: string,
  ): Promise<HeartbeatRunSummaryView> {
    const skipped = await this.heartbeatRunRepository.update(runId, {
      status: HeartbeatRunStatus.SKIPPED,
      finished_at: new Date(),
      error_code: 'workflow_not_started',
      error_message:
        'Workflow start returned no run id (likely skipped by concurrency policy)',
    });

    if (!skipped) {
      throw new NotFoundException(`Heartbeat run ${runId} not found`);
    }

    await this.eventLedger.emitBestEffort({
      domain: 'automation',
      eventName: 'automation.heartbeat.run.skipped',
      outcome: 'denied',
      context: {
        scopeId: profile.scopeId,
        contextId: null,
        contextType: null,
        scopeNodeId: null,
        scopePath: null,
      },
      workflowId: profile.workflow_id,
      payload: {
        heartbeatProfileId: profile.id,
        heartbeatRunId: runId,
        reason: 'workflow_not_started',
      },
    });

    return toHeartbeatRunSummary(skipped);
  }

  private async markRunFailed(
    profile: HeartbeatProfile,
    runId: string,
    error: unknown,
  ): Promise<HeartbeatRunSummaryView> {
    const message =
      error instanceof Error ? error.message : 'Unknown workflow start error';
    const failed = await this.heartbeatRunRepository.update(runId, {
      status: HeartbeatRunStatus.FAILED,
      finished_at: new Date(),
      error_code: 'workflow_start_failed',
      error_message: message,
    });

    if (!failed) {
      throw new NotFoundException(`Heartbeat run ${runId} not found`);
    }

    await this.eventLedger.emitBestEffort({
      domain: 'automation',
      eventName: 'automation.heartbeat.run.failed',
      outcome: 'failure',
      context: {
        scopeId: profile.scopeId,
        contextId: null,
        contextType: null,
        scopeNodeId: null,
        scopePath: null,
      },
      workflowId: profile.workflow_id,
      payload: {
        heartbeatProfileId: profile.id,
        heartbeatRunId: runId,
      },
      errorMessage: message,
    });

    this.logger.error(
      `Heartbeat profile ${profile.id} failed to dispatch: ${message}`,
    );
    return toHeartbeatRunSummary(failed);
  }

  private computeNextRunAt(now: Date, intervalSeconds: number): Date {
    return new Date(now.getTime() + intervalSeconds * 1000);
  }
}
