import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentDriftRepository } from './memory-segment.drift.repository';

// ---------------------------------------------------------------------------
// Drift-detection candidate query.
//
// Greenfield test surface — the nightly
// `MemoryDriftDetectionService` (work item
// 0cead042-e823-4e26-9386-02042252ffb0) is currently gated behind
// the `memory_drift_detection_enabled` setting (default off) and
// has no production consumer, but the candidate query is a
// load-bearing primitive that MUST stay wired so the gate can be
// flipped without a code change.
//
// A row is a drift candidate when ALL of the following hold:
//   - `archived_at IS NULL` (already-archived rows are never
//     re-candidates).
//   - `drift_detected_at IS NULL` (rows the detector has already
//     flagged are excluded — the detector is idempotent).
//   - OR, when `recheckAfterMs` is supplied:
//     `drift_detected_at < now - recheckAfterMs` (rows that were
//     drifted longer ago than the recheck window are eligible for
//     a re-pass).
//
// The partial index
// `idx_memory_segments_drift_detected_at_unset` (`WHERE
// drift_detected_at IS NULL`) targets the "never-drifted" set the
// detector hits most often.
// ---------------------------------------------------------------------------

describe('MemorySegmentDriftRepository', () => {
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getOne: vi.fn(),
    getMany: vi.fn(),
    getRawMany: vi.fn(),
    getCount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always excludes archived rows from findDriftCandidates', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentDriftRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findDriftCandidates();

    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(whereCalls[0]).toBe('segment.archived_at IS NULL');
  });

  it('uses the default drift_detected_at IS NULL branch when recheckAfterMs is not supplied', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentDriftRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findDriftCandidates();

    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    // Default branch: only un-drifted rows. The partial index
    // `idx_memory_segments_drift_detected_at_unset` is the
    // planner-friendly form of this branch.
    expect(andWhereCalls).toContain('segment.drift_detected_at IS NULL');
    // The OR-with-recheck-cutoff branch MUST NOT appear when
    // `recheckAfterMs` is not supplied.
    expect(
      andWhereCalls.some((clause) =>
        clause.includes('drift_detected_at < :recheckCutoff'),
      ),
    ).toBe(false);
    // Defensive — sanity check the leading WHERE clause was the
    // archived_at filter, not the drift filter.
    expect(whereCalls[0]).toBe('segment.archived_at IS NULL');
  });

  it('uses the OR-with-recheck-cutoff branch when recheckAfterMs is supplied', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentDriftRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const now = new Date('2026-06-20T00:00:00.000Z');
    const recheckAfterMs = 24 * 60 * 60 * 1000; // 1 day
    await repository.findDriftCandidates({ now, recheckAfterMs });

    const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    // Recheck window supplied → the OR branch (un-drifted OR
    // drifted older than the cutoff) is added.
    expect(
      andWhereCalls.some(
        (clause) =>
          clause.includes('drift_detected_at IS NULL') &&
          clause.includes('drift_detected_at < :recheckCutoff'),
      ),
    ).toBe(true);
    // The plain `drift_detected_at IS NULL` branch alone MUST NOT
    // appear — the OR branch supersedes it.
    expect(andWhereCalls).not.toContain('segment.drift_detected_at IS NULL');

    // The `recheckCutoff` parameter MUST be computed
    // application-side as `now - recheckAfterMs` (ISO-8601) so
    // the SQL plan stays parameter-bound and the `now` value
    // used in tests is honoured deterministically.
    const recheckCall = queryBuilder.andWhere.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('drift_detected_at < :recheckCutoff'),
    );
    const expectedCutoff = new Date(
      now.getTime() - recheckAfterMs,
    ).toISOString();
    expect(recheckCall?.[1]).toEqual({ recheckCutoff: expectedCutoff });
  });

  it('honours the optional limit parameter', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentDriftRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findDriftCandidates({ limit: 50 });

    expect(queryBuilder.limit).toHaveBeenCalledWith(50);
  });

  it('does not call limit when limit is not supplied', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentDriftRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findDriftCandidates();

    expect(queryBuilder.limit).not.toHaveBeenCalled();
  });
});
