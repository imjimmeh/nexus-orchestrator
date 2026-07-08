import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import {
  MemorySegmentPostmortemRepository,
  POSTMORTEM_SOURCE,
} from './memory-segment.postmortem.repository';

// ---------------------------------------------------------------------------
// Postmortem writeback lookups (work item 5743ac93).
//
// The follow-up `WorkflowFailurePostmortemListener` (milestone 2 of
// 5743ac93-456d-41b3-ae5b-0ca2554318da) drives two read paths:
//
//   1. `findByMetadataKey` — a single-row lookup used to dedup a
//      postmortem write per `workflow_run_id` (the listener MUST
//      NOT re-emit a postmortem for the same run, otherwise the
//      `success` counter inflates and a duplicate
//      `memory.workflow.postmortem_recorded.v1` event fires).
//   2. `countPostmortemsByFailureClass` — the threshold-aggregation
//      input for milestone 3 of the same work item, which
//      auto-proposes a `learning_candidate` after the configured
//      number of postmortems share the same `failure_class` for
//      the same project within the configured window.
//
// Both methods default to `archived_at IS NULL` so the
// `MemoryDecayReaper` (work item 3d7fb798) cannot accidentally
// resurrect an archived row or inflate the threshold count with
// decayed entries.
// ---------------------------------------------------------------------------

describe('MemorySegmentPostmortemRepository', () => {
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

  it('pins the POSTMORTEM_SOURCE constant to "workflow_failure_postmortem"', () => {
    // Pinned so the listener write path and the
    // threshold-aggregation read path stay in lockstep. A typo
    // in either would silently break the duplicate-detection +
    // occurrence-threshold features.
    expect(POSTMORTEM_SOURCE).toBe('workflow_failure_postmortem');
  });

  describe('findByMetadataKey', () => {
    it('returns the matching segment with the default archived_at filter', async () => {
      const segment = { id: 'memory-1' } as MemorySegment;
      queryBuilder.getOne.mockResolvedValue(segment);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.findByMetadataKey(
        'workflow_run_id',
        'run-1',
      );

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'segment.metadata_json ->> :key = :value',
        { key: 'workflow_run_id', value: 'run-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.archived_at IS NULL',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'segment.created_at',
        'DESC',
      );
      expect(result).toBe(segment);
    });

    it('returns null when no match is found', async () => {
      queryBuilder.getOne.mockResolvedValue(null);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.findByMetadataKey(
        'workflow_run_id',
        'run-missing',
      );

      expect(result).toBeNull();
    });

    it('honours includeArchived: true by dropping the archived_at filter', async () => {
      queryBuilder.getOne.mockResolvedValue(null);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findByMetadataKey('workflow_run_id', 'run-1', {
        includeArchived: true,
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).not.toContain('segment.archived_at IS NULL');
    });

    it('honours entityType and entityId scoping', async () => {
      queryBuilder.getOne.mockResolvedValue(null);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findByMetadataKey('workflow_run_id', 'run-1', {
        entityType: 'project',
        entityId: 'project-1',
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.entity_type = :entityType',
        { entityType: 'project' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.entity_id = :entityId',
        { entityId: 'project-1' },
      );
      // The default `archived_at IS NULL` filter MUST still be
      // present so a postmortem for project-A does not surface
      // as a duplicate when the listener is processing project-B.
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.archived_at IS NULL',
      );
    });
  });

  describe('countPostmortemsByFailureClass', () => {
    it('returns the right count for matched segments', async () => {
      queryBuilder.getCount.mockResolvedValue(4);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.countPostmortemsByFailureClass(
        'project',
        'project-1',
        'dependency_missing',
        '2026-05-01T00:00:00.000Z',
      );

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'segment.entity_type = :entityType',
        { entityType: 'project' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.entity_id = :entityId',
        { entityId: 'project-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "segment.metadata_json ->> 'source' = :source",
        { source: 'workflow_failure_postmortem' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "segment.metadata_json ->> 'failure_class' = :failureClass",
        { failureClass: 'dependency_missing' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "segment.metadata_json ->> 'occurred_at' >= :sinceIso",
        { sinceIso: '2026-05-01T00:00:00.000Z' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.archived_at IS NULL',
      );
      expect(result).toBe(4);
    });

    it('excludes archived segments via the unconditional archived_at IS NULL filter', async () => {
      queryBuilder.getCount.mockResolvedValue(0);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.countPostmortemsByFailureClass(
        'project',
        'project-1',
        'dependency_missing',
        '2026-05-01T00:00:00.000Z',
      );

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      // The archived filter is unconditional — the method has no
      // `includeArchived` escape hatch, on purpose: a decayed
      // postmortem must never contribute to the occurrence
      // threshold.
      expect(andWhereCalls).toContain('segment.archived_at IS NULL');
    });

    it('returns 0 when no segments match', async () => {
      queryBuilder.getCount.mockResolvedValue(0);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.countPostmortemsByFailureClass(
        'project',
        'project-1',
        'ambiguous_failure',
        '2026-05-01T00:00:00.000Z',
      );

      expect(result).toBe(0);
    });

    it('anchors the occurrence window on metadata_json.occurred_at (not created_at)', async () => {
      queryBuilder.getCount.mockResolvedValue(1);
      const repository = new MemorySegmentPostmortemRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.countPostmortemsByFailureClass(
        'project',
        'project-1',
        'dependency_missing',
        '2026-05-01T00:00:00.000Z',
      );

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      // Anchoring on `occurred_at` (not `created_at`) so an
      // operator-driven backfill that re-uses an older
      // `occurred_at` timestamp still falls out of the window
      // correctly.
      expect(andWhereCalls).toContain(
        "segment.metadata_json ->> 'occurred_at' >= :sinceIso",
      );
      expect(andWhereCalls).not.toContain('segment.created_at >= :sinceIso');
    });
  });
});
