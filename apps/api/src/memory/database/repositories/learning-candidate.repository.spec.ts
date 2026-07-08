import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { LearningCandidate } from '../entities/learning-candidate.entity';
import { LearningCandidateRepository } from './learning-candidate.repository';

type MockCandidateQueryBuilder = {
  orderBy: ReturnType<typeof vi.fn>;
  addOrderBy: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
};

type MockLearningCandidateRepository = Pick<
  Repository<LearningCandidate>,
  'createQueryBuilder' | 'findOne' | 'update' | 'count'
>;

const createMockCandidateQueryBuilder = (): MockCandidateQueryBuilder => ({
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  andWhere: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getCount: vi.fn().mockResolvedValue(0),
  getMany: vi.fn().mockResolvedValue([]),
});

const createRepository = (
  qb: MockCandidateQueryBuilder,
  overrides: Partial<MockLearningCandidateRepository> = {},
): LearningCandidateRepository => {
  const repository: MockLearningCandidateRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    findOne: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    ...overrides,
  };

  return new LearningCandidateRepository(
    repository as Repository<LearningCandidate>,
  );
};

describe('LearningCandidateRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters candidates by neutral scope', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({
      scopeType: 'workflow_run',
      scopeId: 'run-1',
      limit: 25,
      page: 1,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'candidate.scope_type = :scopeType',
      { scopeType: 'workflow_run' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('candidate.scope_id = :scopeId', {
      scopeId: 'run-1',
    });
  });

  it('does not exclude merged candidates by default', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ limit: 25, page: 1 });

    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'candidate.status != :merged',
      { merged: 'merged' },
    );
  });

  it('excludes merged candidates only when excludeMerged is set', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ excludeMerged: true, limit: 25, page: 1 });

    expect(qb.andWhere).toHaveBeenCalledWith('candidate.status != :merged', {
      merged: 'merged',
    });
  });

  it('sorts by score descending by default', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 1, limit: 25 });

    expect(qb.orderBy).toHaveBeenCalledWith('candidate.score', 'DESC');
  });

  it('sorts by an allowed column when requested', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({
      page: 1,
      limit: 25,
      sortBy: 'created_at',
      sortDir: 'asc',
    });

    expect(qb.orderBy).toHaveBeenCalledWith('candidate.created_at', 'ASC');
  });

  it('ignores a sort column outside the allowlist', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 1, limit: 25, sortBy: 'signals_json' });

    expect(qb.orderBy).toHaveBeenCalledWith('candidate.score', 'DESC');
  });

  it('adds updated_at tiebreaker when using default sort', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 1, limit: 25 });

    expect(qb.orderBy).toHaveBeenCalledWith('candidate.score', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('candidate.updated_at', 'DESC');
  });

  it('does not add updated_at tiebreaker when sortBy is explicitly specified', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({
      page: 1,
      limit: 25,
      sortBy: 'created_at',
      sortDir: 'asc',
    });

    expect(qb.orderBy).toHaveBeenCalledWith('candidate.created_at', 'ASC');
    expect(qb.addOrderBy).not.toHaveBeenCalled();
  });

  it('applies the shared search clause across title and summary', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 1, limit: 25, search: 'flaky test' });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(candidate.title ILIKE :searchTerm OR candidate.summary ILIKE :searchTerm)',
      { searchTerm: '%flaky test%' },
    );
  });

  it('filters by candidate_type', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({
      page: 1,
      limit: 25,
      candidateTypes: ['agent_capture', 'runtime_learning'],
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'candidate.candidate_type IN (:...candidateTypes)',
      { candidateTypes: ['agent_capture', 'runtime_learning'] },
    );
  });

  it('filters by a minimum score', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 1, limit: 25, minScore: 0.6 });

    expect(qb.andWhere).toHaveBeenCalledWith('candidate.score >= :minScore', {
      minScore: 0.6,
    });
  });

  it('filters by a created_at date range', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-06-30T00:00:00.000Z');

    await repository.list({
      page: 1,
      limit: 25,
      createdFrom: from,
      createdTo: to,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'candidate.created_at >= :createdFrom',
      {
        createdFrom: from,
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'candidate.created_at <= :createdTo',
      {
        createdTo: to,
      },
    );
  });

  it('clamps page size and computes the offset via applyPagination', async () => {
    const qb = createMockCandidateQueryBuilder();
    const repository = createRepository(qb);

    await repository.list({ page: 3, limit: 500 });

    expect(qb.take).toHaveBeenCalledWith(100);
    expect(qb.skip).toHaveBeenCalledWith(200);
  });

  it('counts merged candidates', async () => {
    const qb = createMockCandidateQueryBuilder();
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      count: vi.fn().mockResolvedValue(7),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.countMerged();

    expect(typeormRepository.count).toHaveBeenCalledWith({
      where: { status: 'merged' },
    });
    expect(result).toBe(7);
  });

  it('claims only unpromoted pending candidates before promotion work starts', async () => {
    const qb = createMockCandidateQueryBuilder();
    const claimedAt = new Date('2026-05-16T12:00:00.000Z');
    const claimed = createCandidate({ status: 'promotion_in_progress' });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(claimed),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.claimPendingPromotion('candidate-1', {
      claimedAt,
    });

    expect(typeormRepository.update).toHaveBeenCalledWith(
      {
        id: 'candidate-1',
        status: 'pending',
        promoted_memory_segment_id: expect.any(Object),
        promoted_at: expect.any(Object),
      },
      { status: 'promotion_in_progress', updated_at: claimedAt },
    );
    expect(result).toBe(claimed);
  });

  it('returns null when a pending promotion claim does not affect a row', async () => {
    const qb = createMockCandidateQueryBuilder();
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn(),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.claimPendingPromotion('candidate-1');

    expect(result).toBeNull();
    expect(typeormRepository.findOne).not.toHaveBeenCalled();
  });

  it('claims stale in-progress candidates when a stale cutoff is provided', async () => {
    const qb = createMockCandidateQueryBuilder();
    const staleBefore = new Date('2026-05-16T11:45:00.000Z');
    const claimedAt = new Date('2026-05-16T12:00:00.000Z');
    const claimed = createCandidate({ status: 'promotion_in_progress' });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi
        .fn()
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(claimed),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.claimPendingPromotion('candidate-1', {
      staleBefore,
      claimedAt,
    });

    expect(typeormRepository.update).toHaveBeenNthCalledWith(
      2,
      {
        id: 'candidate-1',
        status: 'promotion_in_progress',
        promoted_memory_segment_id: expect.any(Object),
        promoted_at: expect.any(Object),
        updated_at: expect.any(Object),
      },
      { status: 'promotion_in_progress', updated_at: claimedAt },
    );
    expect(result).toBe(claimed);
  });

  it('does not claim non-stale in-progress candidates without a stale cutoff', async () => {
    const qb = createMockCandidateQueryBuilder();
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn(),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.claimPendingPromotion('candidate-1');

    expect(typeormRepository.update).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('does not claim in-progress candidates newer than the stale cutoff', async () => {
    const qb = createMockCandidateQueryBuilder();
    const staleBefore = new Date('2026-05-16T11:45:00.000Z');
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn(),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.claimPendingPromotion('candidate-1', {
      staleBefore,
    });

    expect(typeormRepository.update).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
    expect(typeormRepository.findOne).not.toHaveBeenCalled();
  });

  it('marks only claimed candidates as promoted', async () => {
    const qb = createMockCandidateQueryBuilder();
    const claimedAt = new Date('2026-05-16T11:59:59.000Z');
    const promotedAt = new Date('2026-05-16T12:00:00.000Z');
    const promoted = createCandidate({
      status: 'promoted',
      promoted_memory_segment_id: 'memory-1',
      promoted_at: promotedAt,
    });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(promoted),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.markPromotedIfClaimed(
      'candidate-1',
      'memory-1',
      promotedAt,
      claimedAt,
    );

    expect(typeormRepository.update).toHaveBeenCalledWith(
      {
        id: 'candidate-1',
        status: 'promotion_in_progress',
        updated_at: claimedAt,
      },
      {
        status: 'promoted',
        promoted_memory_segment_id: 'memory-1',
        promoted_at: promotedAt,
      },
    );
    expect(result).toBe(promoted);
  });

  it('releases a promotion claim only when no promoted memory exists', async () => {
    const qb = createMockCandidateQueryBuilder();
    const claimedAt = new Date('2026-05-16T12:00:00.000Z');
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn(),
    };
    const repository = createRepository(qb, typeormRepository);

    await repository.releasePromotionClaim('candidate-1', claimedAt);

    expect(typeormRepository.update).toHaveBeenCalledWith(
      {
        id: 'candidate-1',
        status: 'promotion_in_progress',
        promoted_memory_segment_id: expect.any(Object),
        promoted_at: expect.any(Object),
        updated_at: claimedAt,
      },
      { status: 'pending' },
    );
  });

  it('rejects a pending candidate and stamps the audit fields', async () => {
    const qb = createMockCandidateQueryBuilder();
    const rejected = createCandidate({ status: 'rejected' });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(rejected),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.rejectById('candidate-1', {
      rejectedBy: 'reviewer-1',
      reason: 'Not useful',
    });

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'candidate-1', status: 'pending' },
      expect.objectContaining({
        status: 'rejected',
        rejected_by: 'reviewer-1',
        rejection_reason: 'Not useful',
      }),
    );
    expect(result).toBe(rejected);
  });

  it('returns null rejecting a candidate that is not pending', async () => {
    const qb = createMockCandidateQueryBuilder();
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn(),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.rejectById('candidate-1', {
      rejectedBy: null,
      reason: 'Not useful',
    });

    expect(result).toBeNull();
    expect(typeormRepository.findOne).not.toHaveBeenCalled();
  });

  it('archives a pending candidate with an optional reason', async () => {
    const qb = createMockCandidateQueryBuilder();
    const archived = createCandidate({ status: 'archived' });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(archived),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.archiveById('candidate-1', {
      archivedBy: 'reviewer-1',
      reason: null,
    });

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'candidate-1', status: 'pending' },
      expect.objectContaining({
        status: 'archived',
        archived_by: 'reviewer-1',
      }),
    );
    expect(result).toBe(archived);
  });

  it('bulk rejects candidates transactionally', async () => {
    const pending = [
      createCandidate({ id: 'c1', status: 'pending' }),
      createCandidate({ id: 'c2', status: 'pending' }),
    ];
    const rejected = [
      createCandidate({
        id: 'c1',
        status: 'rejected',
        rejected_by: 'reviewer-1',
        rejected_at: new Date('2026-06-15T00:00:00.000Z'),
        rejection_reason: 'stale batch',
      }),
      createCandidate({
        id: 'c2',
        status: 'rejected',
        rejected_by: 'reviewer-1',
        rejected_at: new Date('2026-06-15T00:00:00.000Z'),
        rejection_reason: 'stale batch',
      }),
    ];
    const manager = {
      find: vi
        .fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(rejected),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repository = new LearningCandidateRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<LearningCandidate>);

    const result = await repository.bulkReject(['c1', 'c2'], {
      rejectedBy: 'reviewer-1',
      reason: 'stale batch',
    });

    expect(manager.update).toHaveBeenCalledWith(
      LearningCandidate,
      { id: expect.anything() },
      expect.objectContaining({
        status: 'rejected',
        rejection_reason: 'stale batch',
      }),
    );
    expect(result).toEqual(rejected);
    expect(result.every((candidate) => candidate.status === 'rejected')).toBe(
      true,
    );
  });

  it('throws BulkActionError("not_found") when a bulk-reject id does not exist', async () => {
    const manager = {
      find: vi
        .fn()
        .mockResolvedValue([createCandidate({ id: 'c1', status: 'pending' })]),
      update: vi.fn(),
    };
    const repository = new LearningCandidateRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<LearningCandidate>);

    await expect(
      repository.bulkReject(['c1', 'c2'], { rejectedBy: null, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found', ids: ['c2'] });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('throws BulkActionError("invalid_status") when a bulk-reject candidate is not pending', async () => {
    const manager = {
      find: vi
        .fn()
        .mockResolvedValue([createCandidate({ id: 'c1', status: 'promoted' })]),
      update: vi.fn(),
    };
    const repository = new LearningCandidateRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<LearningCandidate>);

    await expect(
      repository.bulkReject(['c1'], { rejectedBy: null, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid_status', ids: ['c1'] });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('bulk archives candidates transactionally', async () => {
    const pending = [createCandidate({ id: 'c1', status: 'pending' })];
    const archived = [
      createCandidate({
        id: 'c1',
        status: 'archived',
        archived_by: null,
        archived_at: new Date('2026-06-15T00:00:00.000Z'),
        archive_reason: 'superseded',
      }),
    ];
    const manager = {
      find: vi
        .fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(archived),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repository = new LearningCandidateRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<LearningCandidate>);

    const result = await repository.bulkArchive(['c1'], {
      archivedBy: null,
      reason: 'superseded',
    });

    expect(manager.update).toHaveBeenCalledWith(
      LearningCandidate,
      { id: expect.anything() },
      expect.objectContaining({
        status: 'archived',
        archive_reason: 'superseded',
      }),
    );
    expect(result).toEqual(archived);
    expect(result.every((candidate) => candidate.status === 'archived')).toBe(
      true,
    );
  });
});

function createCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'workflow',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 'Prefer deterministic tests',
    summary: 'Prefer deterministic tests.',
    fingerprint: 'fingerprint-1',
    signals_json: {},
    score: 0.8,
    confidence: 0.8,
    recurrence_count: 1,
    stage_diversity_count: 1,
    routing_target: null,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    last_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}
