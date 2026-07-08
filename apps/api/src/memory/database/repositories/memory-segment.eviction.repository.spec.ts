import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentEvictionRepository } from './memory-segment.eviction.repository';

// ---------------------------------------------------------------------------
// Eviction-reaper candidate query.
//
// The candidate query is intentionally distinct from the decay
// reaper's candidate query: the eviction reaper applies a
// `pinned = false` and `access_count < :minAccessCount` floor, and
// the protected-source allowlist is the eviction-specific
// `MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES` set (NOT the
// decay-specific allowlist).
//
// The empty-`protectedSources` branch MUST NOT emit a `source`
// filter — when no allowlist is configured the reaper falls
// through to the time-based filter alone.
// ---------------------------------------------------------------------------

describe('MemorySegmentEvictionRepository', () => {
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

  it('always excludes archived rows from findEvictionCandidates', async () => {
    // The eviction reaper and the follow-up decay reaper operate
    // on disjoint sets — a row the decay reaper has archived must
    // never be picked up by the eviction reaper (it would be a
    // confusing user-facing outcome — the row disappears from
    // `getMemorySegments` via the `archived_at IS NULL` default
    // filter, then suddenly emits an "evicted" event because the
    // eviction reaper re-selected it).
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentEvictionRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findEvictionCandidates({
      protectedSources: ['learning_candidate'],
      minAccessCount: 1,
      idleCutoff: new Date('2026-06-17T12:00:00.000Z'),
    });

    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    // The WHERE clause must lead with the archived_at filter so
    // the partial index `idx_memory_segments_archived_at` can
    // serve the candidate query without reading archived rows.
    expect(whereCalls[0]).toBe('segment.archived_at IS NULL');
  });

  it('applies the protected-source allowlist when one is configured', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentEvictionRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findEvictionCandidates({
      protectedSources: ['learning_candidate', 'strategic_intent'],
      minAccessCount: 2,
      idleCutoff: new Date('2026-06-17T12:00:00.000Z'),
    });

    const andWhereClauses = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(
      andWhereClauses.some((clause) =>
        clause.includes('source NOT IN (:...protectedSources)'),
      ),
    ).toBe(true);
    // The bound parameter MUST carry the full allowlist verbatim
    // so a typo / partial spread surfaces as a SQL error rather
    // than a silent over-eviction.
    const allowlistCall = queryBuilder.andWhere.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('source NOT IN (:...protectedSources)'),
    );
    expect(allowlistCall?.[1]).toEqual({
      protectedSources: ['learning_candidate', 'strategic_intent'],
    });
  });

  it('omits the source allowlist when protectedSources is empty', async () => {
    // No allowlist configured → fall through to the time-based
    // filter alone. The source allowlist clause MUST NOT be
    // added — a stray `source IS NULL` would silently over-evict
    // rows that the operator never intended to protect.
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentEvictionRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.findEvictionCandidates({
      protectedSources: [],
      minAccessCount: 1,
      idleCutoff: new Date('2026-06-17T12:00:00.000Z'),
    });

    const andWhereClauses = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(
      andWhereClauses.some((clause) =>
        clause.includes('source NOT IN (:...protectedSources)'),
      ),
    ).toBe(false);
    expect(
      andWhereClauses.some((clause) => clause.includes('source IS NULL')),
    ).toBe(false);
  });

  it('applies the composite access_count < :minAccessCount + idleCutoff filter', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new MemorySegmentEvictionRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const idleCutoff = new Date('2026-06-17T12:00:00.000Z');
    await repository.findEvictionCandidates({
      protectedSources: ['learning_candidate'],
      minAccessCount: 5,
      idleCutoff,
    });

    // The `access_count` floor pins the load-bearing-row
    // detection (a row with >= 5 reads is preserved regardless
    // of age).
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'segment.access_count < :minAccessCount',
      { minAccessCount: 5 },
    );

    const andWhereClauses = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    // The time-based filter covers BOTH branches of the
    // "touched-vs-never-touched" union: a row with
    // `last_accessed_at` set is eligible iff the column is older
    // than the cutoff; a row whose `last_accessed_at` is `NULL`
    // (pre-column-add legacy rows) is eligible iff `created_at`
    // is older than the cutoff. The union is the documented
    // contract.
    const idleClause = andWhereClauses.find((clause) =>
      clause.includes('last_accessed_at < :idleCutoff'),
    );
    expect(idleClause).toBeDefined();
    expect(idleClause).toContain('segment.last_accessed_at IS NOT NULL');
    expect(idleClause).toContain('segment.created_at < :idleCutoff');
    expect(idleClause).toContain('segment.last_accessed_at IS NULL');

    // The bound parameter MUST be the ISO-8601 string of the
    // Date (not the Date object) so the lexicographic comparison
    // is deterministic across timezones.
    const idleCall = queryBuilder.andWhere.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('last_accessed_at < :idleCutoff'),
    );
    expect(idleCall?.[1]).toEqual({ idleCutoff: idleCutoff.toISOString() });
  });
});
