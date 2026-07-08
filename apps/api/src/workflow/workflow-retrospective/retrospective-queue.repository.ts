import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import { extractReturningRows } from './returning-rows.helper';

/**
 * Persistence surface for the `retrospective_queue` hand-off table.
 *
 * `create` is idempotent on `workflow_run_id` (ON CONFLICT DO NOTHING via
 * `orIgnore`) so concurrent terminal events for the same run collapse to a
 * single row. `claimTopN` atomically leases the highest-interest `queued`
 * rows to the drain (`FOR UPDATE SKIP LOCKED`), flipping them to `draining`
 * so two drain ticks never analyse the same run.
 */
@Injectable()
export class RetrospectiveQueueRepository {
  constructor(
    @InjectRepository(RetrospectiveQueue)
    private readonly repository: Repository<RetrospectiveQueue>,
  ) {}

  /**
   * Idempotently insert a queue row. If a row already exists for the
   * identifier (workflow_run_id or chat_session_id), the insert is ignored and
   * the existing row is returned.
   */
  async create(data: Partial<RetrospectiveQueue>): Promise<RetrospectiveQueue> {
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(RetrospectiveQueue)
      .values(data as QueryDeepPartialEntity<RetrospectiveQueue>)
      .orIgnore()
      .execute();

    const runId = data.workflow_run_id;
    const chatSessionId = data.chat_session_id;

    if (typeof runId === 'string') {
      const row = await this.findByRunId(runId);
      if (row === null) {
        throw new Error(
          `RetrospectiveQueueRepository.create could not load row for run ${runId}.`,
        );
      }
      return row;
    }

    if (typeof chatSessionId === 'string') {
      const row = await this.findByChatSessionId(chatSessionId);
      if (row === null) {
        throw new Error(
          `RetrospectiveQueueRepository.create could not load row for chat session ${chatSessionId}.`,
        );
      }
      return row;
    }

    throw new Error(
      'RetrospectiveQueueRepository.create requires workflow_run_id or chat_session_id.',
    );
  }

  async findByRunId(workflowRunId: string): Promise<RetrospectiveQueue | null> {
    return this.repository.findOne({
      where: { workflow_run_id: workflowRunId },
    });
  }

  async findByChatSessionId(
    chatSessionId: string,
  ): Promise<RetrospectiveQueue | null> {
    return this.repository.findOne({
      where: { chat_session_id: chatSessionId },
    });
  }

  /**
   * Atomically lease up to `limit` rows in one of `statuses`, ordered by
   * priority (`bypass` > `high` > `normal` > `low`) then `interest_score`
   * DESC, flipping the claimed rows to `draining`. Skips rows already locked
   * by a concurrent drain tick.
   */
  async claimTopN(
    limit: number,
    statuses: string[],
  ): Promise<RetrospectiveQueue[]> {
    if (limit <= 0 || statuses.length === 0) {
      return [];
    }

    // TypeORM resolves an `UPDATE ... RETURNING *` to a `[rows, affectedCount]`
    // tuple on the postgres driver, NOT a bare row array — normalise it so the
    // drain iterates real rows (each with a populated id / workflow_run_id).
    const result = await this.repository.manager.query<unknown>(
      `
      UPDATE retrospective_queue
      SET status = 'draining', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM retrospective_queue
        WHERE status = ANY($1)
        ORDER BY
          CASE priority
            WHEN 'bypass' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END,
          interest_score DESC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
      `,
      [statuses, limit],
    );

    return extractReturningRows<RetrospectiveQueue>(result);
  }

  async markStatus(
    id: string,
    status: string,
    patch: Partial<RetrospectiveQueue> = {},
  ): Promise<void> {
    await this.repository.update({ id }, { ...patch, status } as Parameters<
      typeof this.repository.update
    >[1]);
  }

  async countByStatus(status: string): Promise<number> {
    return this.repository.count({ where: { status } });
  }

  async countByStatuses(statuses: string[]): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }
    return this.repository.count({ where: { status: In(statuses) } });
  }
}
