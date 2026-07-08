import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { EventLedger } from '../runtime/database/entities/event-ledger.entity';
import type {
  JobActivitySignal,
  JobOutputCompletionCandidate,
} from './job-output-completion-signal.reader.types';

export type { JobOutputCompletionCandidate } from './job-output-completion-signal.reader.types';

const OUTPUT_PERSISTED_DOMAIN = 'workflow';
const OUTPUT_PERSISTED_EVENT_NAME = 'workflow.agent.output_persisted';

/**
 * Reconstructs a durable, crash-safe completion candidate for a `workflow_step`
 * from the event ledger alone. A job emits `workflow.agent.output_persisted`
 * (via `set_job_output`) the moment its terminal output is durably written; that
 * survives an API restart even when the in-process completion and the
 * `workflow.agent.completed` telemetry event are lost. Paired with wall-clock
 * quiescence (the latest activity for the job), the supervisor can reconcile the
 * orphaned step to completed without waiting for the destructive 4h max-runtime
 * ceiling.
 */
@Injectable()
export class JobOutputCompletionSignalReader {
  constructor(
    @InjectRepository(EventLedger)
    private readonly repository: Repository<EventLedger>,
  ) {}

  async findCompletionCandidate(
    workflowRunId: string,
    stepId: string,
  ): Promise<JobOutputCompletionCandidate | null> {
    const persisted = await this.repository
      .createQueryBuilder('event')
      .where('event.domain = :domain', { domain: OUTPUT_PERSISTED_DOMAIN })
      .andWhere('event.event_name = :eventName', {
        eventName: OUTPUT_PERSISTED_EVENT_NAME,
      })
      .andWhere('event.workflow_run_id = :workflowRunId', { workflowRunId })
      .andWhere('event.step_id = :stepId', { stepId })
      .orderBy('event.occurred_at', 'DESC')
      .take(1)
      .getOne();

    if (!persisted) {
      return null;
    }

    const latestActivity = await this.findLatestJobActivity(
      workflowRunId,
      stepId,
    );

    const outputPersistedAtMs = persisted.occurred_at.getTime();

    return {
      outputPersistedAtMs,
      latestActivityMs: latestActivity?.latestActivityMs ?? outputPersistedAtMs,
    };
  }

  async findLatestJobActivity(
    workflowRunId: string,
    jobId: string,
  ): Promise<JobActivitySignal | null> {
    const latestActivity = await this.repository
      .createQueryBuilder('event')
      .where('event.workflow_run_id = :workflowRunId', { workflowRunId })
      .andWhere('event.job_id = :jobId', { jobId })
      .orderBy('event.occurred_at', 'DESC')
      .take(1)
      .getOne();

    return latestActivity
      ? { latestActivityMs: latestActivity.occurred_at.getTime() }
      : null;
  }
}
