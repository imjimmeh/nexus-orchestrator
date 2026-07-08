import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AgentAwaitStatus,
  HarnessSessionRef,
  SatisfiedChild,
} from '@nexus/core';
import { AgentAwaitEntity } from './agent-await.entity';
import type { CreateAgentAwaitInput } from './agent-await.types';

const WAITING: AgentAwaitStatus = 'WAITING';
const NON_TERMINAL_STATUSES: readonly AgentAwaitStatus[] = [
  'WAITING',
  'RESUMING',
] as const;

/**
 * Persistence and query layer for {@link AgentAwaitEntity} durable await records.
 * Domain-neutral: deals only in run, step, and session identifiers.
 */
@Injectable()
export class AgentAwaitRepository {
  constructor(
    @InjectRepository(AgentAwaitEntity)
    private readonly repository: Repository<AgentAwaitEntity>,
  ) {}

  async create(input: CreateAgentAwaitInput): Promise<AgentAwaitEntity> {
    const entity = this.repository.create({
      parent_run_id: input.parentRunId,
      parent_step_id: input.parentStepId,
      parent_session_tree_id: input.parentSessionTreeId ?? null,
      awaited_run_ids: input.awaitedRunIds,
      satisfied_run_ids: [],
      status: WAITING,
      resume_node_id: input.resumeNodeId ?? null,
    });

    return this.repository.save(entity);
  }

  async findById(id: string): Promise<AgentAwaitEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByParentRun(parentRunId: string): Promise<AgentAwaitEntity[]> {
    return this.repository.find({
      where: { parent_run_id: parentRunId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Returns WAITING awaits whose `awaited_run_ids` array contains the given
   * child run id, using a Postgres JSONB containment (`@>`) query.
   */
  async findWaitingByAwaitedChild(
    childRunId: string,
  ): Promise<AgentAwaitEntity[]> {
    return this.repository
      .createQueryBuilder('await')
      .where('await.status = :status', { status: WAITING })
      .andWhere('await.awaited_run_ids @> :child', {
        child: JSON.stringify([childRunId]),
      })
      .getMany();
  }

  /**
   * Appends `child` to `satisfied_run_ids` if a satisfied entry for the same
   * `runId` is not already present. Idempotent read-modify-write.
   */
  async markSatisfied(id: string, child: SatisfiedChild): Promise<void> {
    const entity = await this.findById(id);
    if (!entity) {
      return;
    }

    const alreadySatisfied = entity.satisfied_run_ids.some(
      (satisfied) => satisfied.runId === child.runId,
    );
    if (alreadySatisfied) {
      return;
    }

    entity.satisfied_run_ids = [...entity.satisfied_run_ids, child];
    await this.repository.save(entity);
  }

  /**
   * Atomically transitions an await from `from` to `to`. Returns true iff
   * exactly one row matched (i.e. the await was in the expected `from` state).
   */
  async compareAndSetStatus(
    id: string,
    from: AgentAwaitStatus,
    to: AgentAwaitStatus,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(AgentAwaitEntity)
      .set({ status: to })
      .where('id = :id', { id })
      .andWhere('status = :from', { from })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  /**
   * Persists the engine-produced session reference on the WAITING await for the
   * given parent run. Called after the suspending container step completes so
   * the resume path can carry the `HarnessSessionRef` back to the engine.
   * No-ops when no WAITING await exists for this run.
   */
  async updateParentSessionRef(
    parentRunId: string,
    ref: HarnessSessionRef,
  ): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(AgentAwaitEntity)
      .set({ parent_session_ref: ref })
      .where('parent_run_id = :parentRunId', { parentRunId })
      .andWhere('status = :status', { status: 'WAITING' })
      .execute();
  }

  /**
   * Cancels every non-terminal (`WAITING`/`RESUMING`) await parked on the given
   * parent run. Called when the parent run reaches a terminal state so the
   * reconciler and child-terminal listener can no longer resume — and thereby
   * resurrect — a run the user has already cancelled. Returns the number of
   * awaits transitioned. No-ops when none are open.
   */
  async cancelOpenForParentRun(parentRunId: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(AgentAwaitEntity)
      .set({ status: 'CANCELLED' })
      .where('parent_run_id = :parentRunId', { parentRunId })
      .andWhere('status IN (:...statuses)', {
        statuses: [...NON_TERMINAL_STATUSES],
      })
      .execute();

    return result.affected ?? 0;
  }

  async findNonTerminal(): Promise<AgentAwaitEntity[]> {
    return this.repository
      .createQueryBuilder('await')
      .where('await.status IN (:...statuses)', {
        statuses: [...NON_TERMINAL_STATUSES],
      })
      .getMany();
  }
}
