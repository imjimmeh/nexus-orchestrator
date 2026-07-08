import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { StepSessionCheckpointEntity } from './step-session-checkpoint.entity.js';
import type { RecordCheckpointInput } from './step-session-checkpoint.types.js';
import type {
  HarnessSessionRef,
  HarnessId,
  SessionCheckpointPhase,
} from '@nexus/core';

/**
 * Persistence and query layer for {@link StepSessionCheckpointEntity} records.
 * Domain-neutral: deals only in execution, run, step, and session identifiers.
 */
@Injectable()
export class StepSessionCheckpointRepository {
  constructor(
    @InjectRepository(StepSessionCheckpointEntity)
    private readonly repo: Repository<StepSessionCheckpointEntity>,
  ) {}

  async record(
    input: RecordCheckpointInput,
  ): Promise<StepSessionCheckpointEntity> {
    const entity = this.repo.create({
      execution_id: input.executionId,
      workflow_run_id: input.workflowRunId,
      step_id: input.stepId,
      engine: input.engine,
      phase: input.phase,
      call_seq: input.callSeq,
      session_ref: input.sessionRef ?? null,
      resume_node_id: input.resumeNodeId ?? null,
      transcript_locator: input.transcriptLocator ?? null,
      tool_name: input.toolName ?? null,
      idempotency_key: input.idempotencyKey ?? null,
    });
    return this.repo.save(entity);
  }

  async findLatest(
    workflowRunId: string,
    stepId: string,
  ): Promise<StepSessionCheckpointEntity | null> {
    return this.repo.findOne({
      where: { workflow_run_id: workflowRunId, step_id: stepId },
      order: { call_seq: 'DESC', created_at: 'DESC' },
    });
  }

  async recordCheckpoint(input: {
    run_id: string;
    job_id: string;
    execution_id?: string;
    session_tree_id: string;
    session_ref: HarnessSessionRef;
    engine: HarnessId;
    phase: SessionCheckpointPhase;
  }): Promise<void> {
    const latest = await this.repo.findOne({
      where: { workflow_run_id: input.run_id, step_id: input.job_id },
      order: { call_seq: 'DESC' },
    });
    const nextCallSeq = latest ? latest.call_seq + 1 : 0;

    await this.repo.insert({
      execution_id: input.execution_id ?? input.run_id,
      workflow_run_id: input.run_id,
      step_id: input.job_id,
      engine: input.engine,
      phase: input.phase,
      call_seq: nextCallSeq,
      session_ref: input.session_ref,
    });
  }

  async hasResultFor(
    workflowRunId: string,
    stepId: string,
    callSeq: number,
  ): Promise<boolean> {
    const count = await this.repo.count({
      where: {
        workflow_run_id: workflowRunId,
        step_id: stepId,
        call_seq: callSeq,
        phase: 'result',
      },
    });
    return count > 0;
  }
}
