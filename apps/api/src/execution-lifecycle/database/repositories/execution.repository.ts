import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ExecutionEntity } from '../entities/execution.entity';
import type {
  ExecutionFailureReason,
  ExecutionKind,
  ExecutionState,
} from '../../execution-lifecycle.contracts';
import {
  isLegalTransition,
  isTerminalState,
  TERMINAL_EXECUTION_STATES,
} from '../../execution-transition.helpers';
import type {
  OwnerLeaseParams,
  ResolvedConfigPatch,
} from './execution.repository.types';

interface TransitionPatch {
  failure_reason?: ExecutionFailureReason | null;
  error_message?: string | null;
  container_id?: string | null;
  last_heartbeat_at?: Date | null;
}

@Injectable()
export class ExecutionRepository {
  private readonly logger = new Logger(ExecutionRepository.name);

  constructor(
    @InjectRepository(ExecutionEntity)
    private readonly repository: Repository<ExecutionEntity>,
  ) {}

  async findById(id: string): Promise<ExecutionEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findManyByIds(ids: string[]): Promise<ExecutionEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.repository.find({ where: { id: In(ids) } });
  }

  async findByContainerId(
    containerId: string,
    kind?: ExecutionKind,
  ): Promise<ExecutionEntity | null> {
    return this.repository.findOne({
      where: kind
        ? { container_id: containerId, kind }
        : { container_id: containerId },
    });
  }

  async findNonTerminal(): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: { state: Not(In(TERMINAL_EXECUTION_STATES)) },
    });
  }

  async claimOwnerLease(params: OwnerLeaseParams): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(ExecutionEntity)
      .set({
        owner_instance_id: params.ownerInstanceId,
        owner_lease_expires_at: params.leaseExpiresAt,
        last_progress_at: params.now,
      })
      .where('id = :executionId', { executionId: params.executionId })
      .andWhere('state NOT IN (:...terminalStates)', {
        terminalStates: TERMINAL_EXECUTION_STATES,
      })
      .andWhere(
        '(owner_instance_id IS NULL OR owner_instance_id = :ownerInstanceId OR owner_lease_expires_at < :now)',
        { ownerInstanceId: params.ownerInstanceId, now: params.now },
      )
      .execute();

    return result.affected === 1;
  }

  async renewOwnerLease(params: OwnerLeaseParams): Promise<boolean> {
    const result = await this.repository.update(
      {
        id: params.executionId,
        owner_instance_id: params.ownerInstanceId,
        state: Not(In(TERMINAL_EXECUTION_STATES)),
      },
      {
        owner_lease_expires_at: params.leaseExpiresAt,
        last_progress_at: params.now,
      },
    );

    return result.affected === 1;
  }

  async releaseOwnerLease(
    executionId: string,
    ownerInstanceId: string,
  ): Promise<void> {
    await this.repository.update(
      { id: executionId, owner_instance_id: ownerInstanceId },
      { owner_instance_id: null, owner_lease_expires_at: null },
    );
  }

  async findExpiredOwnerLeases(now: Date): Promise<ExecutionEntity[]> {
    return this.repository
      .createQueryBuilder('execution')
      .where('execution.state NOT IN (:...terminalStates)', {
        terminalStates: TERMINAL_EXECUTION_STATES,
      })
      .andWhere('execution.owner_lease_expires_at IS NOT NULL')
      .andWhere('execution.owner_lease_expires_at < :now', { now })
      .getMany();
  }

  /** Non-terminal executions with a live container, eligible for freezing. */
  async findFreezeCandidates(
    kinds: readonly ExecutionKind[],
  ): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: {
        state: Not(In(TERMINAL_EXECUTION_STATES)),
        kind: In(kinds),
        container_id: Not(IsNull()),
        frozen: false,
      },
    });
  }

  /** Executions flagged frozen by a prior shutdown, to resume on boot. */
  async findFrozen(): Promise<ExecutionEntity[]> {
    return this.repository.find({ where: { frozen: true } });
  }

  async markFrozen(id: string, reason: string, pausedAt: Date): Promise<void> {
    await this.repository.update(
      { id },
      { frozen: true, paused_at: pausedAt, pause_reason: reason },
    );
  }

  async clearFrozen(id: string, resumedAt: Date): Promise<void> {
    await this.repository.update(
      { id },
      {
        frozen: false,
        paused_at: null,
        pause_reason: null,
        last_heartbeat_at: resumedAt,
      },
    );
  }

  async findByWorkflowRunAndJob(
    workflowRunId: string,
    jobId: string,
  ): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: { workflow_run_id: workflowRunId, context_id: jobId },
    });
  }

  async findRunningStepByRunAndContext(
    workflowRunId: string,
    contextId: string,
  ): Promise<ExecutionEntity | null> {
    return this.repository.findOne({
      where: {
        kind: 'workflow_step',
        workflow_run_id: workflowRunId,
        context_id: contextId,
        state: In(['provisioning', 'running']),
        terminal_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }

  async findByWorkflowRun(workflowRunId: string): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: { workflow_run_id: workflowRunId },
      order: { created_at: 'ASC' },
    });
  }

  async findNonTerminalSubagentsByRun(
    workflowRunId: string,
  ): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: {
        workflow_run_id: workflowRunId,
        kind: 'subagent',
        state: Not(In(TERMINAL_EXECUTION_STATES)),
      },
    });
  }

  async findRunIdsWithNonTerminalSubagents(): Promise<string[]> {
    const rows = await this.repository.find({
      where: {
        kind: 'subagent',
        state: Not(In(TERMINAL_EXECUTION_STATES)),
      },
      select: { workflow_run_id: true },
    });
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of rows) {
      if (row.workflow_run_id && !seen.has(row.workflow_run_id)) {
        seen.add(row.workflow_run_id);
        result.push(row.workflow_run_id);
      }
    }
    return result;
  }

  async updateResolvedConfig(
    id: string,
    patch: ResolvedConfigPatch,
  ): Promise<void> {
    await this.repository.update({ id }, patch);
  }

  async create(data: Partial<ExecutionEntity>): Promise<ExecutionEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async applyTransition(
    id: string,
    to: ExecutionState,
    patch: TransitionPatch = {},
  ): Promise<ExecutionEntity | null> {
    const row = await this.findById(id);
    if (!row) {
      this.logger.warn(
        `Rejected execution transition for ${id}: row not found (target state ${to})`,
      );
      return null;
    }
    if (!isLegalTransition(row.state, to)) {
      this.logger.warn(
        `Rejected illegal execution transition for ${id}: ${row.state} -> ${to}`,
      );
      return null;
    }
    row.state = to;
    if (patch.failure_reason !== undefined)
      row.failure_reason = patch.failure_reason;
    if (patch.error_message !== undefined)
      row.error_message = patch.error_message;
    if (patch.container_id !== undefined) row.container_id = patch.container_id;
    if (patch.last_heartbeat_at !== undefined)
      row.last_heartbeat_at = patch.last_heartbeat_at;
    if (isTerminalState(to)) {
      row.terminal_at = new Date();
    }
    return this.repository.save(row);
  }
}
