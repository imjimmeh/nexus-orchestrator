import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { RuntimeFeedbackSignalGroup } from '../entities/runtime-feedback-signal-group.entity';
import { RuntimeFeedbackSignalGroupRepository } from './runtime-feedback-signal-group.repository';

type MockFeedbackGroupQueryBuilder = {
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  setParameters: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  addSelect: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  addOrderBy: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  getManyAndCount: ReturnType<typeof vi.fn>;
  getRawMany: ReturnType<typeof vi.fn>;
  getRawOne: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
};

type MockTypeOrmRepository = Pick<
  Repository<RuntimeFeedbackSignalGroup>,
  'create' | 'save' | 'findOne' | 'update' | 'createQueryBuilder'
>;

const createMockQueryBuilder = (): MockFeedbackGroupQueryBuilder => ({
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  setParameters: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue({ affected: 1 }),
  select: vi.fn().mockReturnThis(),
  addSelect: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  andWhere: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
  getRawMany: vi.fn().mockResolvedValue([]),
  getRawOne: vi.fn().mockResolvedValue(null),
  getOne: vi.fn().mockResolvedValue(null),
});

const createRepository = (
  qb: MockFeedbackGroupQueryBuilder,
  overrides: Partial<MockTypeOrmRepository> = {},
): RuntimeFeedbackSignalGroupRepository => {
  const repository: MockTypeOrmRepository = {
    create: vi.fn(),
    save: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    ...overrides,
  };

  return new RuntimeFeedbackSignalGroupRepository(
    repository as Repository<RuntimeFeedbackSignalGroup>,
  );
};

describe('RuntimeFeedbackSignalGroupRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findByFingerprint delegates to findOne by dedupe fingerprint', async () => {
    const qb = createMockQueryBuilder();
    const typeormRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const repository = createRepository(qb, typeormRepository);

    await repository.findByFingerprint('fingerprint-1');

    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { dedupe_fingerprint: 'fingerprint-1' },
    });
  });

  it('findActiveFailureClassificationGroup queries unresolved groups by class and workflow', async () => {
    const qb = createMockQueryBuilder();
    const group = createFeedbackGroup({ window_occurrence_count: 4 });
    qb.getOne = vi.fn().mockResolvedValue(group);
    const repository = createRepository(qb);

    const result = await repository.findActiveFailureClassificationGroup({
      failureClass: 'tool_contract_mismatch',
      workflowId: 'wf-uuid-1',
    });

    expect(qb.where).toHaveBeenCalledWith(
      'g.signal_type = :signalType',
      expect.objectContaining({ signalType: 'failure_classification' }),
    );
    expect(qb.andWhere).toHaveBeenCalledWith('g.candidate_id IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith(
      'g.dedupe_fingerprint LIKE :prefix',
      {
        prefix:
          'failure_classification|tool_contract_mismatch|workflow:wf-uuid-1|%',
      },
    );
    expect(result).toBe(group);
  });

  it('createGroup saves a new group', async () => {
    const qb = createMockQueryBuilder();
    const data = { dedupe_fingerprint: 'fingerprint-1' };
    const group = createFeedbackGroup(data);
    const typeormRepository = {
      create: vi.fn().mockReturnValue(group),
      save: vi.fn().mockResolvedValue(group),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.createGroup(data);

    expect(typeormRepository.create).toHaveBeenCalledWith(data);
    expect(typeormRepository.save).toHaveBeenCalledWith(group);
    expect(result).toBe(group);
  });

  it('updateGroup updates by ID and returns the reloaded group', async () => {
    const qb = createMockQueryBuilder();
    const reloaded = createFeedbackGroup({
      id: 'group-1',
      occurrence_count: 2,
    });
    const typeormRepository = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(reloaded),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.updateGroup('group-1', {
      occurrence_count: 2,
    });

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'group-1' },
      { occurrence_count: 2 },
    );
    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'group-1' },
    });
    expect(result).toBe(reloaded);
  });

  it('atomically increments occurrence fields in SQL and returns the reloaded group', async () => {
    const qb = createMockQueryBuilder();
    const lastSeenAt = new Date('2026-05-17T00:01:00.000Z');
    const reloaded = createFeedbackGroup({
      id: 'group-1',
      occurrence_count: 3,
      max_confidence: 0.9,
      max_severity: 'high',
      last_seen_at: lastSeenAt,
    });
    const typeormRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
      findOne: vi.fn().mockResolvedValue(reloaded),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.incrementOccurrence('group-1', {
      evidence: [{ kind: 'event_ledger', id: 'event-2', summary: 'later' }],
      examples: [{ summary: 'later example', redacted: true }],
      confidence: 0.9,
      severity: 'high',
      lastSeenAt,
      maxEvidenceItems: 20,
      maxExampleItems: 10,
    });

    expect(qb.update).toHaveBeenCalledWith(RuntimeFeedbackSignalGroup);
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence_count: expect.any(Function),
        window_occurrence_count: expect.any(Function),
        evidence_json: expect.any(Function),
        examples_json: expect.any(Function),
        max_confidence: expect.any(Function),
        max_severity: expect.any(Function),
        last_seen_at: lastSeenAt,
      }),
    );
    const setPayload = qb.set.mock.calls[0]?.[0] as Record<
      string,
      Date | (() => string)
    >;
    expect((setPayload.occurrence_count as () => string)()).toContain(
      'occurrence_count + 1',
    );
    expect((setPayload.window_occurrence_count as () => string)()).toContain(
      'window_occurrence_count + 1',
    );
    expect((setPayload.max_confidence as () => string)()).toContain('GREATEST');
    expect((setPayload.evidence_json as () => string)()).toContain(
      'jsonb_array_elements',
    );
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'group-1' });
    expect(qb.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceJson: JSON.stringify([
          { kind: 'event_ledger', id: 'event-2', summary: 'later' },
        ]),
        examplesJson: JSON.stringify([
          { summary: 'later example', redacted: true },
        ]),
        confidence: 0.9,
        severityRank: 3,
        severity: 'high',
        evidenceLimit: 20,
        exampleLimit: 10,
      }),
    );
    expect(qb.execute).toHaveBeenCalled();
    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'group-1' },
    });
    expect(result).toBe(reloaded);
  });

  it('updates skipped metadata only while the group has no candidate and returns the reloaded group', async () => {
    const qb = createMockQueryBuilder();
    const reloaded = createFeedbackGroup({
      diagnostics_json: { skipped_reason: 'confidence_below_threshold' },
      last_skipped_reason: 'confidence_below_threshold',
    });
    const typeormRepository = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(reloaded),
    };
    const repository = createRepository(qb, typeormRepository);

    const result = await repository.updateSkippedMetadataIfCandidateMissing(
      'group-1',
      {
        diagnostics_json: { skipped_reason: 'confidence_below_threshold' },
        last_skipped_reason: 'confidence_below_threshold',
      },
    );

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'group-1', candidateId: expect.anything() },
      {
        diagnostics_json: { skipped_reason: 'confidence_below_threshold' },
        last_skipped_reason: 'confidence_below_threshold',
      },
    );
    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'group-1' },
    });
    expect(result).toBe(reloaded);
  });

  it('listDiagnostics applies optional signal type, candidate, limit, and offset filters', async () => {
    const qb = createMockQueryBuilder();
    const rows = [createFeedbackGroup()];
    qb.getManyAndCount.mockResolvedValue([rows, 1]);
    const repository = createRepository(qb);

    const result = await repository.listDiagnostics({
      signalType: 'workflow_failure',
      candidateCreated: true,
      limit: 25,
      offset: 50,
    });

    expect(qb.orderBy).toHaveBeenCalledWith(
      'feedback_group.last_seen_at',
      'DESC',
    );
    expect(qb.offset).toHaveBeenCalledWith(50);
    expect(qb.limit).toHaveBeenCalledWith(25);
    expect(qb.andWhere).toHaveBeenCalledWith(
      'feedback_group.signal_type = :signalType',
      { signalType: 'workflow_failure' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'feedback_group.candidate_id IS NOT NULL',
    );
    expect(result).toEqual({ data: rows, total: 1 });
  });

  it('findMostRecentIdByCandidateId returns the id of the freshest group for the candidate (max_confidence tiebreak)', async () => {
    const qb = createMockQueryBuilder();
    qb.getRawOne.mockResolvedValue({ id: 'group-fresh' });
    const repository = createRepository(qb);

    const result =
      await repository.findMostRecentIdByCandidateId('candidate-1');

    expect(qb.select).toHaveBeenCalledWith('feedback_group.id', 'id');
    expect(qb.where).toHaveBeenCalledWith(
      'feedback_group.candidate_id = :candidateId',
      { candidateId: 'candidate-1' },
    );
    expect(qb.orderBy).toHaveBeenCalledWith(
      'feedback_group.last_seen_at',
      'DESC',
    );
    expect(qb.addOrderBy).toHaveBeenCalledWith(
      'feedback_group.max_confidence',
      'DESC',
    );
    expect(qb.limit).toHaveBeenCalledWith(1);
    expect(result).toBe('group-fresh');
  });

  it('findMostRecentIdByCandidateId returns null when no group is correlated with the candidate', async () => {
    const qb = createMockQueryBuilder();
    qb.getRawOne.mockResolvedValue(undefined);
    const repository = createRepository(qb);

    const result =
      await repository.findMostRecentIdByCandidateId('candidate-unknown');

    expect(result).toBeNull();
  });

  it('findMostRecentIdByCandidateId returns null when the raw row has no id field', async () => {
    const qb = createMockQueryBuilder();
    qb.getRawOne.mockResolvedValue({});
    const repository = createRepository(qb);

    const result =
      await repository.findMostRecentIdByCandidateId('candidate-1');

    expect(result).toBeNull();
  });

  it('listDiagnostics filters groups without candidates when candidateCreated is false', async () => {
    const qb = createMockQueryBuilder();
    const repository = createRepository(qb);

    await repository.listDiagnostics({
      candidateCreated: false,
      limit: 10,
      offset: 0,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'feedback_group.candidate_id IS NULL',
    );
  });

  it('listDiagnosticCounts aggregates full filtered diagnostics without pagination', async () => {
    const signalQb = createMockQueryBuilder();
    const candidateQb = createMockQueryBuilder();
    const skippedQb = createMockQueryBuilder();
    signalQb.getRawMany.mockResolvedValue([
      { signalType: 'workflow_anomaly', count: '5' },
      { signalType: 'memory_miss', count: '2' },
    ]);
    candidateQb.getRawMany.mockResolvedValue([
      { candidateCreated: true, count: '1' },
      { candidateCreated: false, count: '2' },
    ]);
    skippedQb.getRawMany.mockResolvedValue([
      { reason: 'frequency_below_threshold', count: '2' },
      { reason: 'candidate_exists', count: '1' },
    ]);
    const typeormRepository = {
      createQueryBuilder: vi
        .fn()
        .mockReturnValueOnce(signalQb)
        .mockReturnValueOnce(candidateQb)
        .mockReturnValueOnce(skippedQb),
    };
    const repository = createRepository(signalQb, typeormRepository);

    const result = await repository.listDiagnosticCounts({
      signalType: 'workflow_anomaly',
      candidateCreated: true,
    });

    expect(signalQb.select).toHaveBeenCalledWith(
      'feedback_group.signal_type',
      'signalType',
    );
    expect(signalQb.addSelect).toHaveBeenCalledWith(
      'SUM(feedback_group.occurrence_count)',
      'count',
    );
    expect(signalQb.groupBy).toHaveBeenCalledWith('feedback_group.signal_type');
    expect(signalQb.offset).not.toHaveBeenCalled();
    expect(signalQb.limit).not.toHaveBeenCalled();
    expect(signalQb.andWhere).toHaveBeenCalledWith(
      'feedback_group.signal_type = :signalType',
      { signalType: 'workflow_anomaly' },
    );
    expect(signalQb.andWhere).toHaveBeenCalledWith(
      'feedback_group.candidate_id IS NOT NULL',
    );
    expect(skippedQb.andWhere).toHaveBeenCalledWith(
      'feedback_group.last_skipped_reason IS NOT NULL',
    );
    expect(result).toEqual({
      signalCounts: [
        { signalType: 'workflow_anomaly', count: 5 },
        { signalType: 'memory_miss', count: 2 },
      ],
      candidateCounts: [
        { candidateCreated: true, count: 1 },
        { candidateCreated: false, count: 2 },
      ],
      skippedReasonCounts: [
        { reason: 'frequency_below_threshold', count: 2 },
        { reason: 'candidate_exists', count: 1 },
      ],
    });
  });
});

function createFeedbackGroup(
  overrides: Partial<RuntimeFeedbackSignalGroup> = {},
): RuntimeFeedbackSignalGroup {
  return {
    id: 'group-1',
    dedupe_fingerprint: 'fingerprint-1',
    signal_type: 'workflow_failure',
    source_module: 'workflow-runtime',
    scope_type: 'workflow_run',
    scopeId: 'run-1',
    actor_json: {},
    affected_json: {},
    evidence_json: [],
    examples_json: [],
    occurrence_count: 1,
    window_occurrence_count: 1,
    max_confidence: 0.8,
    max_severity: 'high',
    first_seen_at: new Date('2026-05-17T10:00:00.000Z'),
    window_started_at: new Date('2026-05-17T10:00:00.000Z'),
    last_seen_at: new Date('2026-05-17T10:00:00.000Z'),
    candidateId: null,
    candidate_created_at: null,
    cooldown_until: null,
    last_skipped_reason: null,
    diagnostics_json: null,
    created_at: new Date('2026-05-17T10:00:00.000Z'),
    updated_at: new Date('2026-05-17T10:00:00.000Z'),
    ...overrides,
  };
}
