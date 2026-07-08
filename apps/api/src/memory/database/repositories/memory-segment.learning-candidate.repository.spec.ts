import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentLearningCandidateRepository } from './memory-segment.learning-candidate.repository';

// ---------------------------------------------------------------------------
// `learning_candidate`-shaped repository methods.
//
// `findLearningCandidateSegment` is the promotion-write hot path
// and is intentionally EXEMPT from the `archived_at IS NULL`
// default — an archived candidate MUST surface so the caller can
// react (re-promote, skip, etc.). The other methods follow their
// own documented archived_at rules:
//   - `findPromotedSegmentsByScope` defaults to `archived_at IS NULL`
//     (opt-in via `includeArchived: true`).
//   - `countPromotedSegmentsCreatedSince` does NOT apply the filter
//     — archived rows that were promoted in the window still count
//     toward the cost-per-promoted-memory denominator.
//   - `findProvisionalPastProbation` requires `archived_at IS NULL`
//     (a decayed/evicted/superseded row is never re-evaluated).
// ---------------------------------------------------------------------------

describe('MemorySegmentLearningCandidateRepository', () => {
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

  it('finds learning candidate memory segments by authoritative metadata', async () => {
    const segment = { id: 'memory-1' } as MemorySegment;
    queryBuilder.getOne.mockResolvedValue(segment);
    const repository = new MemorySegmentLearningCandidateRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    });

    const result = await repository.findLearningCandidateSegment(
      'workflow_run',
      'run-1',
      'candidate-1',
    );

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'segment.entity_type = :entityType',
      { entityType: 'workflow_run' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'segment.entity_id = :entityId',
      { entityId: 'run-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'segment.memory_type = :memoryType',
      { memoryType: 'fact' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "segment.metadata_json ->> 'source' = :source",
      { source: 'learning_candidate' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "segment.metadata_json ->> 'learning_candidate_id' = :learningCandidateId",
      { learningCandidateId: 'candidate-1' },
    );
    expect(result).toBe(segment);
  });

  it('always surfaces learning_candidate segments regardless of archived_at (exempt)', async () => {
    // The promotion-write hot path needs to surface an archived
    // candidate so the caller can react (re-promote, skip, etc.).
    // The archived_at filter MUST NOT be added — mirroring a
    // null for an archived row would be a silent correctness bug.
    const segment = { id: 'memory-1' } as MemorySegment;
    queryBuilder.getOne.mockResolvedValue(segment);
    const repository = new MemorySegmentLearningCandidateRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<MemorySegment>);

    const result = await repository.findLearningCandidateSegment(
      'workflow_run',
      'run-1',
      'candidate-1',
    );

    expect(result).toBe(segment);
    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(whereCalls).not.toContain('segment.archived_at IS NULL');
    expect(andWhereCalls).not.toContain('segment.archived_at IS NULL');
  });

  // -----------------------------------------------------------------
  // findPromotedSegmentsByScope
  // -----------------------------------------------------------------

  describe('findPromotedSegmentsByScope', () => {
    it('queries for promoted learning_candidate fact segments within scope', async () => {
      const segment = { id: 'memory-1' } as MemorySegment;
      queryBuilder.getMany.mockResolvedValue([segment]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        query: 'cited repair evidence',
        limit: 5,
      });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'seg.entity_type = :entityType',
        { entityType: 'workflow_run' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "seg.metadata_json ->> 'source' = :src",
        { src: 'learning_candidate' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "seg.memory_type = 'fact'",
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'seg.entity_id = :entityId',
        { entityId: 'run-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'seg.content ILIKE :q',
        { q: '%cited repair evidence%' },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'seg.updated_at',
        'DESC',
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual([segment]);
    });

    it('omits the entity_id filter when entity_id is not provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).not.toContain('seg.entity_id = :entityId');
      expect(andWhereCalls).not.toContain('seg.content ILIKE :q');
    });

    it('defaults the limit to 25 when none is provided', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
        entity_id: 'run-1',
      });

      expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    });

    it('omits the content search filter when query is blank', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        query: '   ',
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).not.toContain('seg.content ILIKE :q');
    });

    it('hides archived promoted segments by default', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
        entity_id: 'run-1',
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).toContain('seg.archived_at IS NULL');
    });

    it('surfaces archived promoted segments when includeArchived is set', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findPromotedSegmentsByScope({
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        includeArchived: true,
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).not.toContain('seg.archived_at IS NULL');
    });
  });

  // -----------------------------------------------------------------
  // listPromotedSegmentsAfter (control-plane PromotedLessonsCard)
  // -----------------------------------------------------------------

  describe('listPromotedSegmentsAfter', () => {
    it('queries promoted learning_candidate fact segments created at/after since, system-wide', async () => {
      const segments = [{ id: 'memory-1' }] as MemorySegment[];
      queryBuilder.getMany.mockResolvedValue(segments);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const since = new Date('2026-06-01T00:00:00.000Z');
      const result = await repository.listPromotedSegmentsAfter({ since });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        "segment.metadata_json ->> 'source' = :src",
        { src: 'learning_candidate' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "segment.memory_type = 'fact'",
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.created_at >= :since',
        { since },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'segment.created_at',
        'DESC',
      );
      // Default limit MUST be 50 — a typo here would silently
      // under- or over-fetch the control-plane card.
      expect(queryBuilder.limit).toHaveBeenCalledWith(50);
      expect(result).toEqual(segments);
    });

    it('does NOT add an entity_type or entity_id filter (system-wide view)', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.listPromotedSegmentsAfter({
        since: new Date('2026-06-01T00:00:00.000Z'),
      });

      const whereCalls = queryBuilder.where.mock.calls.map(
        (call) => call[0] as string,
      );
      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(whereCalls).not.toContain('segment.entity_type = :entityType');
      expect(andWhereCalls).not.toContain('segment.entity_type = :entityType');
      expect(whereCalls).not.toContain('segment.entity_id = :entityId');
      expect(andWhereCalls).not.toContain('segment.entity_id = :entityId');
    });

    it('honors a caller-supplied limit and orders created_at DESC', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.listPromotedSegmentsAfter({
        since: new Date('2026-06-01T00:00:00.000Z'),
        limit: 10,
      });

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'segment.created_at',
        'DESC',
      );
    });

    it('hides archived promoted segments by default', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.listPromotedSegmentsAfter({
        since: new Date('2026-06-01T00:00:00.000Z'),
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).toContain('segment.archived_at IS NULL');
    });

    it('surfaces archived promoted segments when includeArchived is set', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.listPromotedSegmentsAfter({
        since: new Date('2026-06-01T00:00:00.000Z'),
        includeArchived: true,
      });

      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(andWhereCalls).not.toContain('segment.archived_at IS NULL');
    });

    it('pins the source filter to "learning_candidate" (regression)', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.listPromotedSegmentsAfter({
        since: new Date('2026-06-01T00:00:00.000Z'),
      });

      const whereArg = (queryBuilder.where.mock.calls[0]?.[1] ?? {}) as {
        src?: string;
      };
      // A typo here would silently empty the control-plane card —
      // pin the documented constant.
      expect(whereArg.src).toBe('learning_candidate');
    });
  });

  // -----------------------------------------------------------------
  // countPromotedSegmentsCreatedSince (EPIC-212 Phase-3 Task 6)
  // -----------------------------------------------------------------

  describe('countPromotedSegmentsCreatedSince', () => {
    it('filters on created_at >= :windowStart', async () => {
      queryBuilder.getCount.mockResolvedValue(7);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const windowStart = new Date('2026-06-01T00:00:00.000Z');
      const result =
        await repository.countPromotedSegmentsCreatedSince(windowStart);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        "segment.metadata_json ->> 'source' = :src",
        { src: 'learning_candidate' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.created_at >= :windowStart',
        { windowStart },
      );
      expect(result).toBe(7);
    });

    it('pins the source filter to "learning_candidate"', async () => {
      queryBuilder.getCount.mockResolvedValue(0);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.countPromotedSegmentsCreatedSince(
        new Date('2026-06-01T00:00:00.000Z'),
      );

      const whereCalls = queryBuilder.where.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(whereCalls).toContain("segment.metadata_json ->> 'source' = :src");
      // The source string MUST be the documented 'learning_candidate'
      // constant — a typo here would silently zero the
      // cost-per-promoted-memory denominator.
      const sourceArg = (queryBuilder.where.mock.calls[0]?.[1] ?? {}) as {
        src?: string;
      };
      expect(sourceArg.src).toBe('learning_candidate');
    });

    it('does NOT add an archived_at filter (archived rows still count)', async () => {
      queryBuilder.getCount.mockResolvedValue(3);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.countPromotedSegmentsCreatedSince(
        new Date('2026-06-01T00:00:00.000Z'),
      );

      const whereCalls = queryBuilder.where.mock.calls.map(
        (call) => call[0] as string,
      );
      const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      // Archived rows that were promoted in the window still count
      // toward the cost-per-promoted-memory denominator. The
      // filter is intentionally absent.
      expect(whereCalls).not.toContain('segment.archived_at IS NULL');
      expect(andWhereCalls).not.toContain('segment.archived_at IS NULL');
    });
  });

  // -----------------------------------------------------------------
  // findProvisionalPastProbation (EPIC-212 Phase-3 Task 7)
  // -----------------------------------------------------------------

  describe('findProvisionalPastProbation', () => {
    it('filters on governance_state = provisional AND archived_at IS NULL AND probation_until < now', async () => {
      const segments = [{ id: 'memory-1' }] as MemorySegment[];
      queryBuilder.getMany.mockResolvedValue(segments);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const now = new Date('2026-06-20T00:00:00.000Z');
      const result = await repository.findProvisionalPastProbation(now);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'segment.governance_state = :state',
        { state: 'provisional' },
      );
      // The bound parameter must be the ISO-8601 string of `now`
      // (not the Date object) so PostgreSQL's `::timestamptz` cast
      // produces a deterministic comparison.
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'segment.archived_at IS NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "(segment.metadata_json ->> 'probation_until')::timestamptz < :now::timestamptz",
        { now: now.toISOString() },
      );
      expect(result).toBe(segments);
    });

    it('uses the documented "provisional" governance_state value (regression)', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findProvisionalPastProbation(new Date());

      const whereArg = (queryBuilder.where.mock.calls[0]?.[1] ?? {}) as {
        state?: string;
      };
      // A typo here would silently never match anything — pin the
      // exact governance_state constant the evaluator service
      // stamps onto auto-promotions.
      expect(whereArg.state).toBe('provisional');
    });

    it('returns an empty array when no provisional rows are past probation', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentLearningCandidateRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      const result = await repository.findProvisionalPastProbation(new Date());

      expect(result).toEqual([]);
    });
  });
});
