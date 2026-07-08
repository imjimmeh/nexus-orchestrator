/**
 * Unit tests for `RetrospectiveQueueRepository.claimTopN`.
 *
 * Regression for the 2026-06-29 windowed-drain bug: TypeORM's `manager.query`
 * resolves an `UPDATE ... RETURNING *` to a `[rows, affectedCount]` tuple, not
 * a bare row array. `claimTopN` previously returned the tuple, so the drain
 * iterated the rows-array and the count as if each were a row — every claimed
 * row reached the digest with an undefined `workflow_run_id` and was never
 * marked terminal (stuck in `draining`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';

function row(id: string, runId: string): RetrospectiveQueue {
  return {
    id,
    workflow_run_id: runId,
    scope_id: null,
    terminal_status: 'failed',
    interest_score: 0.7,
    priority: 'high',
    status: 'draining',
    signals_json: {},
    enqueued_at: new Date(),
    drained_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('RetrospectiveQueueRepository.claimTopN', () => {
  let query: ReturnType<typeof vi.fn>;
  let repo: RetrospectiveQueueRepository;

  beforeEach(() => {
    query = vi.fn();
    repo = new RetrospectiveQueueRepository({
      manager: { query },
    } as unknown as Repository<RetrospectiveQueue>);
  });

  it('returns the real rows (not the [rows, count] tuple) for a RETURNING write', async () => {
    const rowA = row('id-a', 'run-a');
    const rowB = row('id-b', 'run-b');
    // The shape the postgres driver actually returns.
    query.mockResolvedValue([[rowA, rowB], 2]);

    const claimed = await repo.claimTopN(5, ['queued']);

    expect(claimed).toHaveLength(2);
    expect(claimed[0].id).toBe('id-a');
    expect(claimed[0].workflow_run_id).toBe('run-a');
    expect(claimed[1].workflow_run_id).toBe('run-b');
    // No element is the affected-count number or the rows-array wrapper.
    for (const claimedRow of claimed) {
      expect(typeof claimedRow.workflow_run_id).toBe('string');
    }
  });

  it('returns [] when the RETURNING write matched no rows ([[], 0])', async () => {
    query.mockResolvedValue([[], 0]);
    expect(await repo.claimTopN(5, ['queued'])).toEqual([]);
  });

  it('short-circuits without querying for a non-positive limit or empty statuses', async () => {
    expect(await repo.claimTopN(0, ['queued'])).toEqual([]);
    expect(await repo.claimTopN(5, [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
