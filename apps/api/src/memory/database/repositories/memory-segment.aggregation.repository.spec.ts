import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentAggregationRepository } from './memory-segment.aggregation.repository';

// ---------------------------------------------------------------------------
// Aggregation surface for the `MemoryMetricsRefreshService`.
//
// `countActiveSegmentsBySource` returns one row per distinct
// `metadata_json->>'source'` value, with rows missing a source
// coalesced to `'unknown'` and `archived_at IS NOT NULL` rows
// excluded entirely. Counts come back as `bigint` from Postgres
// and are normalised to `number` for the gauge.
// ---------------------------------------------------------------------------

describe('MemorySegmentAggregationRepository', () => {
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

  it('excludes archived rows from countActiveSegmentsBySource', async () => {
    queryBuilder.getRawMany.mockResolvedValue([]);
    const repository = new MemorySegmentAggregationRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    await repository.countActiveSegmentsBySource();

    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(whereCalls).toContain('segment.archived_at IS NULL');
  });

  it('coalesces missing / blank sources to "unknown"', async () => {
    // Postgres `getRawMany()` returns the `count` column as a
    // string (bigint). Two rows come back — one for the
    // `learning_candidate` source and one for the `'unknown'`
    // bucket that the COALESCE + NULLIF pair synthesises for
    // rows whose `metadata_json->>'source'` is `NULL` or `''`.
    queryBuilder.getRawMany.mockResolvedValue([
      { source: 'learning_candidate', count: '7' },
      { source: 'unknown', count: '3' },
    ]);
    const repository = new MemorySegmentAggregationRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const result = await repository.countActiveSegmentsBySource();

    // The SELECT projection MUST use the documented
    // `COALESCE(NULLIF(...), 'unknown')` shape — a future refactor
    // that drops the COALESCE would silently lose the
    // no-source bucket.
    expect(queryBuilder.select).toHaveBeenCalledWith(
      "COALESCE(NULLIF(segment.metadata_json ->> 'source', ''), 'unknown')",
      'source',
    );
    expect(queryBuilder.groupBy).toHaveBeenCalledWith(
      "COALESCE(NULLIF(segment.metadata_json ->> 'source', ''), 'unknown')",
    );
    expect(result).toEqual([
      { source: 'learning_candidate', count: 7 },
      { source: 'unknown', count: 3 },
    ]);
  });

  it('casts bigint → number for each row', async () => {
    // Postgres returns bigint counts as strings; the repo MUST
    // cast them to number via `Number(row.count)` so downstream
    // gauge consumers can do arithmetic without manual coercion.
    // The active-segments gauge is bounded by the segment table
    // size, well within the safe-integer range.
    queryBuilder.getRawMany.mockResolvedValue([
      { source: 'learning_candidate', count: '42' },
    ]);
    const repository = new MemorySegmentAggregationRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const result = await repository.countActiveSegmentsBySource();

    expect(result).toHaveLength(1);
    const firstRow = result[0];
    expect(firstRow).toBeDefined();
    expect(firstRow?.count).toBe(42);
    expect(typeof firstRow?.count).toBe('number');
  });

  it('returns an empty array when no segments match', async () => {
    queryBuilder.getRawMany.mockResolvedValue([]);
    const repository = new MemorySegmentAggregationRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const result = await repository.countActiveSegmentsBySource();

    expect(result).toEqual([]);
  });
});
