import { Test } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type {
  InternalToolExecutionContext,
  RuntimeRecordLearningBody,
} from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RecordLearningHandler } from '../../workflow/workflow-internal-tools/handlers/record-learning.handler';
import { WorkflowInternalToolsModule } from '../../workflow/workflow-internal-tools/workflow-internal-tools.module';
import { LearningModule } from './learning.module';
import { RecordLearningService } from './record-learning.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { EmbeddingWriteEnqueueService } from '../signals/embedding-write-enqueue.service';
import { MemoryContentScannerService } from '../memory-content-scanner.service';

type CandidateRepositoryMock = {
  findByFingerprint: Mock<(...args: any[]) => Promise<any>>;
  create: Mock<(...args: any[]) => any>;
  countByStatuses: Mock<(...args: any[]) => Promise<any>>;
  updateById: Mock<(...args: any[]) => Promise<any>>;
};

describe('RecordLearningService', () => {
  let service: RecordLearningService;
  let candidates: CandidateRepositoryMock;
  const eventLedger = { emitBestEffort: vi.fn() };
  const workflowEngine = { startWorkflow: vi.fn() };

  beforeEach(async () => {
    candidates = {
      findByFingerprint: vi.fn(),
      create: vi.fn(),
      countByStatuses: vi.fn(),
      updateById: vi.fn(),
    };
    candidates.countByStatuses.mockResolvedValue(0);
    // Faithful reinforcement stub: the real `updateById` re-reads the full
    // row, so unchanged fields (e.g. the fingerprint) survive. The dedupe
    // path patches the candidate returned by `findByFingerprint`, so look
    // it up by id and merge the patch to preserve that invariant.
    candidates.updateById.mockImplementation(
      async (id: string, patch: Partial<LearningCandidate>) => {
        const existing = await findCandidateById(candidates, id);
        const base = existing ?? buildCandidate({ id });
        return { ...base, id, ...patch };
      },
    );

    const module = await Test.createTestingModule({
      providers: [
        RecordLearningService,
        { provide: LearningCandidateRepository, useValue: candidates },
        { provide: EventLedgerService, useValue: eventLedger },
        { provide: WorkflowEngineService, useValue: workflowEngine },
        {
          provide: EmbeddingWriteEnqueueService,
          useValue: { enqueueOwner: vi.fn() },
        },
        {
          provide: MemoryContentScannerService,
          useValue: { scanContent: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(RecordLearningService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending candidate with neutral scope and required fields', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );

    const result = await service.recordLearning(buildContext(), buildParams());

    const created = candidates.create.mock
      .calls[0]?.[0] as Partial<LearningCandidate>;
    expect(candidates.findByFingerprint).toHaveBeenCalledWith(
      created.fingerprint,
    );
    expect(created).toEqual(
      expect.objectContaining({
        scope_type: 'workflow_run',
        scopeId: 'run-123',
        candidate_type: 'runtime_learning',
        summary:
          'Prefer deterministic workflow repair plans with cited evidence.',
        score: 0.72,
        confidence: 0.72,
        status: 'pending',
      }),
    );
    expect(created.title).toBe(
      'Prefer deterministic workflow repair plans with cited evidence.',
    );
    expect(created.title?.length).toBeLessThanOrEqual(220);
    expect(created.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-new',
      created: true,
      fingerprint: created.fingerprint,
    });
  });

  it('returns candidate identity without a memory segment id', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );

    const result = await service.recordLearning(buildContext(), buildParams());

    expect(result).toEqual(
      expect.objectContaining({
        status: 'pending',
        candidate_id: 'candidate-new',
        created: true,
      }),
    );
    expect(result).not.toHaveProperty('memory_segment_id');
    expect(result).not.toHaveProperty('memorySegmentId');
  });

  it('reuses an existing candidate for stable dedupe, reinforces it, and does not emit an event', async () => {
    candidates.findByFingerprint.mockImplementation((fingerprint: string) =>
      Promise.resolve(
        buildCandidate({
          id: 'candidate-existing',
          fingerprint,
          recurrence_count: 3,
        }),
      ),
    );

    const result = await service.recordLearning(buildContext(), buildParams());

    expect(candidates.create).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    // Exact-fingerprint duplicate must reinforce the existing row, not insert.
    expect(candidates.updateById).toHaveBeenCalledWith(
      'candidate-existing',
      expect.objectContaining({
        recurrence_count: 4,
        last_seen_at: expect.any(Date),
      }),
    );
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-existing',
      created: false,
      fingerprint: candidates.findByFingerprint.mock.calls[0]?.[0],
    });
  });

  it('emits candidate-created event only for new candidates with a safe payload', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );

    await service.recordLearning(buildContext(), buildParams());

    const fingerprint = candidates.create.mock.calls[0]?.[0].fingerprint;
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateCreated,
      outcome: 'success',
      workflowRunId: 'run-123',
      jobId: 'job-456',
      payload: {
        candidate_id: 'candidate-new',
        fingerprint,
        scope_type: 'workflow_run',
        scope_id: 'run-123',
        confidence: 0.72,
        evidence_count: 1,
        tag_count: 2,
      },
    });
    const payload = eventLedger.emitBestEffort.mock.calls[0]?.[0].payload;
    expect(payload).not.toHaveProperty('lesson');
    expect(payload).not.toHaveProperty('evidence');
    expect(payload).not.toHaveProperty('tags');
  });

  it('stores confidence and provenance from the internal tool context in signals_json', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );

    await service.recordLearning(buildContext(), buildParams());

    expect(candidates.create.mock.calls[0]?.[0].signals_json).toEqual({
      lesson: 'Prefer deterministic workflow repair plans with cited evidence.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Repair planning improved when evidence was cited.',
        },
      ],
      tags: ['repair', 'workflow'],
      confidence: 0.72,
      provenance: {
        workflowRunId: 'run-123',
        jobId: 'job-456',
        scopeId: 'runtime-scope-789',
        userId: 'user-abc',
        agentProfileName: 'repair-agent',
      },
      source: {
        tool: 'record_learning',
        candidate_type: 'runtime_learning',
      },
    });
  });

  it('dedupes learning records with the same evidence in different order', async () => {
    let storedFingerprint: string | undefined;
    candidates.findByFingerprint.mockImplementation((fingerprint: string) => {
      if (storedFingerprint === fingerprint) {
        return Promise.resolve(
          buildCandidate({ id: 'candidate-existing', fingerprint }),
        );
      }

      return Promise.resolve(null);
    });
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) => {
      storedFingerprint = data.fingerprint;
      return buildCandidate({ id: 'candidate-new', ...data });
    });

    const first = await service.recordLearning(
      buildContext(),
      buildParams({
        evidence: [
          {
            kind: 'job_output',
            id: 'job-456',
            summary: 'Job output included cited repair evidence.',
          },
          {
            kind: 'workflow_run',
            id: 'run-123',
            summary: 'Repair planning improved when evidence was cited.',
          },
        ],
      }),
    );
    const second = await service.recordLearning(
      buildContext(),
      buildParams({
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-123',
            summary: 'Repair planning improved when evidence was cited.',
          },
          {
            kind: 'job_output',
            id: 'job-456',
            summary: 'Job output included cited repair evidence.',
          },
        ],
      }),
    );

    expect(first.created).toBe(true);
    expect(second).toEqual({
      status: 'pending',
      candidate_id: 'candidate-existing',
      created: false,
      fingerprint: first.fingerprint,
    });
    expect(candidates.create).toHaveBeenCalledTimes(1);
  });

  it('returns an existing candidate when create loses a unique fingerprint race', async () => {
    candidates.findByFingerprint
      .mockResolvedValueOnce(null)
      .mockImplementation((fingerprint: string) =>
        Promise.resolve(
          buildCandidate({ id: 'candidate-existing', fingerprint }),
        ),
      );
    candidates.create.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
        },
      ),
    );

    const result = await service.recordLearning(buildContext(), buildParams());

    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-existing',
      created: false,
      fingerprint: candidates.findByFingerprint.mock.calls[0]?.[0],
    });
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('rethrows unique fingerprint races when the existing candidate cannot be reread', async () => {
    const duplicateError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      { code: '23505' },
    );
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockRejectedValue(duplicateError);

    await expect(
      service.recordLearning(buildContext(), buildParams()),
    ).rejects.toBe(duplicateError);
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('triggers memory learning sweep workflow if pending candidate count reaches 10', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );
    candidates.countByStatuses.mockResolvedValue(10);
    workflowEngine.startWorkflow.mockResolvedValue('run-999');

    await service.recordLearning(buildContext(), buildParams());

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'memory_learning_sweep',
      {
        trigger: 'threshold',
        pendingCount: 10,
      },
    );
  });

  it('does not trigger memory learning sweep workflow if pending candidate count is less than 10', async () => {
    candidates.findByFingerprint.mockResolvedValue(null);
    candidates.create.mockImplementation((data: Partial<LearningCandidate>) =>
      buildCandidate({ id: 'candidate-new', ...data }),
    );
    candidates.countByStatuses.mockResolvedValue(9);

    await service.recordLearning(buildContext(), buildParams());

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });
});

describe('RecordLearningHandler delegation', () => {
  it('delegates runtime learning records to RecordLearningService', async () => {
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-new',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const handler = new RecordLearningHandler({
      recordLearning,
    } as Pick<
      RecordLearningService,
      'recordLearning'
    > as RecordLearningService);
    const context = buildContext();
    const params = buildParams();

    const result = await handler.recordLearning(context, params);

    expect(recordLearning).toHaveBeenCalledWith(context, params);
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-new',
      created: true,
      fingerprint: 'fingerprint-1',
    });
  });
});

describe('LearningModule record learning registration', () => {
  it('registers RecordLearningService as a provider', () => {
    const providers = Reflect.getMetadata('providers', LearningModule);

    expect(providers).toContain(RecordLearningService);
  });

  it('does not mark LearningModule as global', () => {
    expect(
      Reflect.getMetadata('__module:global__', LearningModule),
    ).toBeUndefined();
  });

  it('is explicitly imported by WorkflowInternalToolsModule', () => {
    const imports = Reflect.getMetadata('imports', WorkflowInternalToolsModule);

    expect(imports).toContain(LearningModule);
  });
});

function buildContext(): InternalToolExecutionContext {
  return {
    workflowRunId: 'run-123',
    jobId: 'job-456',
    scopeId: 'runtime-scope-789',
    userId: 'user-abc',
    agentProfileName: 'repair-agent',
  };
}

function buildParams(
  overrides: Partial<RuntimeRecordLearningBody> = {},
): RuntimeRecordLearningBody {
  return {
    workflow_run_id: 'run-123',
    job_id: 'job-456',
    scope_type: 'workflow_run',
    scope_id: 'run-123',
    lesson: 'Prefer deterministic workflow repair plans with cited evidence.',
    evidence: [
      {
        kind: 'workflow_run',
        id: 'run-123',
        summary: 'Repair planning improved when evidence was cited.',
      },
    ],
    confidence: 0.72,
    tags: ['repair', 'workflow'],
    ...overrides,
  };
}

/**
 * Resolve the candidate a previous `findByFingerprint` call returned so the
 * `updateById` reinforcement stub can preserve unchanged fields (fingerprint,
 * scope) the way the real re-reading repository does.
 */
async function findCandidateById(
  candidates: CandidateRepositoryMock,
  id: string,
): Promise<LearningCandidate | null> {
  for (const result of candidates.findByFingerprint.mock.results) {
    if (result.type !== 'return') {
      continue;
    }
    const candidate = (await result.value) as LearningCandidate | null;
    if (candidate?.id === id) {
      return candidate;
    }
  }
  return null;
}

function buildCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'workflow_run',
    scopeId: 'run-123',
    candidate_type: 'runtime_learning',
    title: 'Prefer deterministic workflow repair plans with cited evidence.',
    summary: 'Prefer deterministic workflow repair plans with cited evidence.',
    fingerprint: 'a'.repeat(64),
    signals_json: {},
    score: 0.72,
    confidence: 0.72,
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
    first_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    last_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}
