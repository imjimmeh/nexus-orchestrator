import type { IMemorySegment, InternalToolExecutionContext } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../../../memory/database/entities/learning-candidate.entity';
import type { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import type { MemorySegmentCrudRepository } from '../../../memory/database/repositories/memory-segment.crud.repository';
import type { MemorySegmentLearningCandidateRepository } from '../../../memory/database/repositories/memory-segment.learning-candidate.repository';
import { LearningPromotionPolicyService } from '../../../memory/learning/learning-promotion-policy.service';
import { LearningPromotionService } from '../../../memory/learning/learning-promotion.service';
import { RecordLearningService } from '../../../memory/learning/record-learning.service';
import type { MemoryManagerService } from '../../../memory/memory-manager.service';
import type { EventLedgerService } from '../../../observability/event-ledger.service';
import { QueryMemoryHandler } from './query-memory.handler';
import { RecordLearningHandler } from './record-learning.handler';

describe('QueryMemoryHandler learning writeback flow', () => {
  it('records only a learning candidate until explicit promotion makes it queryable', async () => {
    const candidates = new Map<string, LearningCandidate>();
    const segments: IMemorySegment[] = [];
    const candidateRepository = createCandidateRepository(candidates);
    const memoryManager = createMemoryManager(segments);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('run-123'),
    };
    const recordLearning = new RecordLearningService(
      candidateRepository as unknown as LearningCandidateRepository,
      eventLedger as unknown as EventLedgerService,
      workflowEngine as any,
      { enqueueOwner: vi.fn() } as any,
      { scanContent: vi.fn() },
    );
    const promotion = createLearningPromotionService(
      candidateRepository,
      createMemorySegmentRepository(segments),
      memoryManager,
      eventLedger,
    );
    const recordLearningHandler = new RecordLearningHandler(recordLearning);
    const queryMemoryHandler = new QueryMemoryHandler(
      memoryManager as unknown as MemoryManagerService,
      createFeedbackServiceMock(),
    );

    const recordLearningPayload = {
      scope_type: 'workflow_run',
      scope_id: 'run-123',
      lesson: 'Prefer cited repair evidence before changing workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Cited evidence reduced repair ambiguity.',
        },
      ],
      confidence: 0.78,
      tags: ['repair', 'evidence'],
    };

    const recorded = await recordLearningHandler.recordLearning(
      buildContext(),
      recordLearningPayload,
    );

    expect(recorded).toEqual(
      expect.objectContaining({
        status: 'pending',
        candidate_id: 'candidate-1',
        created: true,
      }),
    );
    expect(segments).toHaveLength(0);

    const reused = await recordLearningHandler.recordLearning(
      buildContext(),
      recordLearningPayload,
    );

    expect(reused).toEqual(
      expect.objectContaining({
        status: 'pending',
        candidate_id: 'candidate-1',
        created: false,
      }),
    );
    expect(candidates.size).toBe(1);
    expect(segments).toHaveLength(0);

    const beforePromotion = await queryMemoryHandler.queryMemory(
      buildContext(),
      {
        entity_type: 'workflow_run',
        entity_id: 'run-123',
      },
    );
    expect(beforePromotion).toEqual(
      expect.objectContaining({
        entity_type: 'workflow_run',
        entity_id: 'run-123',
        query: null,
        memory_type: null,
        count: 0,
        segments: [],
      }),
    );
    expect(beforePromotion).not.toHaveProperty('learning');

    await promotion.promoteCandidate('candidate-1');

    const afterPromotion = await queryMemoryHandler.queryMemory(
      buildContext(),
      {
        entity_type: 'workflow_run',
        entity_id: 'run-123',
        query: 'cited repair evidence',
      },
    );
    expect(afterPromotion).toEqual(
      expect.objectContaining({
        entity_type: 'workflow_run',
        entity_id: 'run-123',
        query: 'cited repair evidence',
        memory_type: null,
        count: 1,
        segments: [
          expect.objectContaining({
            id: '11111111-1111-4111-8111-111111111111',
            entity_type: 'workflow_run',
            entity_id: 'run-123',
            content:
              'Prefer cited repair evidence before changing workflow behavior.',
            memory_type: 'fact',
            metadata: expect.objectContaining({
              source: 'learning_candidate',
            }),
          }),
        ],
      }),
    );
    expect(afterPromotion).not.toHaveProperty('learning');
  });

  it('returns promoted lessons under the learning key when include_learning is true', async () => {
    const candidates = new Map<string, LearningCandidate>();
    const segments: IMemorySegment[] = [];
    const candidateRepository = createCandidateRepository(candidates);
    const memoryManager = createMemoryManager(segments);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('run-123'),
    };
    const recordLearning = new RecordLearningService(
      candidateRepository as unknown as LearningCandidateRepository,
      eventLedger as unknown as EventLedgerService,
      workflowEngine as any,
      { enqueueOwner: vi.fn() } as any,
      { scanContent: vi.fn() },
    );
    const promotion = createLearningPromotionService(
      candidateRepository,
      createMemorySegmentRepository(segments),
      memoryManager,
      eventLedger,
    );
    const recordLearningHandler = new RecordLearningHandler(recordLearning);
    const queryMemoryHandler = new QueryMemoryHandler(
      memoryManager as unknown as MemoryManagerService,
      createFeedbackServiceMock(),
    );

    await recordLearningHandler.recordLearning(buildContext(), {
      scope_type: 'workflow_run',
      scope_id: 'run-123',
      lesson: 'Cite evidence before mutating workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Evidence-first repairs reduce ambiguity.',
        },
      ],
      confidence: 0.78,
      tags: ['repair', 'evidence'],
    });
    await promotion.promoteCandidate('candidate-1');

    const result = await queryMemoryHandler.queryMemory(buildContext(), {
      entity_type: 'workflow_run',
      entity_id: 'run-123',
      include_learning: true,
    });

    expect(result.learning).toEqual({
      query: '',
      count: 1,
      segments: [
        expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
          entity_type: 'workflow_run',
          entity_id: 'run-123',
          memory_type: 'fact',
          metadata: expect.objectContaining({
            source: 'learning_candidate',
            learning_candidate_id: 'candidate-1',
          }),
        }),
      ],
    });
    expect(memoryManager.searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-123',
    });
  });

  it('flattens provenance, confidence, source, and promotion policy into top-level fields on every projection', async () => {
    const candidates = new Map<string, LearningCandidate>();
    const segments: IMemorySegment[] = [];
    const candidateRepository = createCandidateRepository(candidates);
    const memoryManager = createMemoryManager(segments);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('run-123'),
    };
    const recordLearning = new RecordLearningService(
      candidateRepository as unknown as LearningCandidateRepository,
      eventLedger as unknown as EventLedgerService,
      workflowEngine as any,
      { enqueueOwner: vi.fn() } as any,
      { scanContent: vi.fn() },
    );
    const promotion = createLearningPromotionService(
      candidateRepository,
      createMemorySegmentRepository(segments),
      memoryManager,
      eventLedger,
    );
    const recordLearningHandler = new RecordLearningHandler(recordLearning);
    const queryMemoryHandler = new QueryMemoryHandler(
      memoryManager as unknown as MemoryManagerService,
      createFeedbackServiceMock(),
    );

    // Pre-existing non-promoted segment with no promoted metadata fields.
    const memoryManagerWithSegments = memoryManager as unknown as {
      createMemorySegment: (
        entityType: string,
        entityId: string,
        content: string,
        memoryType?: 'preference' | 'fact' | 'history',
        metadata?: Record<string, unknown> | null,
      ) => Promise<IMemorySegment>;
    };
    await memoryManagerWithSegments.createMemorySegment(
      'workflow_run',
      'run-123',
      'Generic preference',
      'preference',
      { source: 'user_input' },
    );
    // Pre-existing promoted lesson with full promoted metadata.
    await recordLearningHandler.recordLearning(buildContext(), {
      scope_type: 'workflow_run',
      scope_id: 'run-123',
      lesson: 'Cite evidence before mutating workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Evidence-first repairs reduce ambiguity.',
        },
      ],
      confidence: 0.85,
      tags: ['repair', 'evidence'],
    });
    await promotion.promoteCandidate('candidate-1');

    const result = (await queryMemoryHandler.queryMemory(buildContext(), {
      entity_type: 'workflow_run',
      entity_id: 'run-123',
      include_learning: true,
    })) as {
      segments: Array<Record<string, unknown>>;
      learning: {
        segments: Array<Record<string, unknown>>;
      };
    };

    const promotedFromSegments = result.segments.find(
      (segment) => segment.id === '22222222-2222-4222-9222-222222222222',
    );
    const promotedFromLearning = result.learning.segments.find(
      (segment) => segment.id === '22222222-2222-4222-9222-222222222222',
    );
    const preference = result.segments.find(
      (segment) => segment.id === '11111111-1111-4111-8111-111111111111',
    );

    expect(promotedFromSegments).toMatchObject({
      confidence: 0.85,
      source: 'learning_candidate',
      metadata_json: expect.objectContaining({
        promotion_policy: expect.objectContaining({ approved: true }),
      }),
    });
    expect(promotedFromLearning).toMatchObject({
      confidence: 0.85,
      source: 'learning_candidate',
      metadata_json: expect.objectContaining({
        promotion_policy: expect.objectContaining({ approved: true }),
      }),
    });
    expect(preference).toMatchObject({
      confidence: null,
      source: 'user_input',
      metadata_json: expect.objectContaining({
        source: 'user_input',
      }),
    });
  });

  it('passes the user query through to the promoted-lesson lookup', async () => {
    const candidates = new Map<string, LearningCandidate>();
    const segments: IMemorySegment[] = [];
    const candidateRepository = createCandidateRepository(candidates);
    const memoryManager = createMemoryManager(segments);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('run-123'),
    };
    const recordLearning = new RecordLearningService(
      candidateRepository as unknown as LearningCandidateRepository,
      eventLedger as unknown as EventLedgerService,
      workflowEngine as any,
      { enqueueOwner: vi.fn() } as any,
      { scanContent: vi.fn() },
    );
    const promotion = createLearningPromotionService(
      candidateRepository,
      createMemorySegmentRepository(segments),
      memoryManager,
      eventLedger,
    );
    const recordLearningHandler = new RecordLearningHandler(recordLearning);
    const queryMemoryHandler = new QueryMemoryHandler(
      memoryManager as unknown as MemoryManagerService,
      createFeedbackServiceMock(),
    );

    await recordLearningHandler.recordLearning(buildContext(), {
      scope_type: 'workflow_run',
      scope_id: 'run-123',
      lesson: 'Cite evidence before mutating workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Evidence-first repairs reduce ambiguity.',
        },
      ],
      confidence: 0.78,
      tags: ['repair', 'evidence'],
    });
    await promotion.promoteCandidate('candidate-1');

    await queryMemoryHandler.queryMemory(buildContext(), {
      entity_type: 'workflow_run',
      entity_id: 'run-123',
      query: 'cite evidence',
      include_learning: true,
    });

    expect(memoryManager.searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-123',
      query: 'cite evidence',
    });
  });

  it('returns null for learning when the promoted-lesson lookup throws', async () => {
    const candidates = new Map<string, LearningCandidate>();
    const segments: IMemorySegment[] = [];
    const candidateRepository = createCandidateRepository(candidates);
    const memoryManager = createMemoryManager(segments);
    memoryManager.searchPromotedLessonsByScope = vi
      .fn()
      .mockRejectedValueOnce(new Error('postgres unavailable'));
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('run-123'),
    };
    const recordLearning = new RecordLearningService(
      candidateRepository as unknown as LearningCandidateRepository,
      eventLedger as unknown as EventLedgerService,
      workflowEngine as any,
      { enqueueOwner: vi.fn() } as any,
      { scanContent: vi.fn() },
    );
    const promotion = createLearningPromotionService(
      candidateRepository,
      createMemorySegmentRepository(segments),
      memoryManager,
      eventLedger,
    );
    const recordLearningHandler = new RecordLearningHandler(recordLearning);
    const queryMemoryHandler = new QueryMemoryHandler(
      memoryManager as unknown as MemoryManagerService,
      createFeedbackServiceMock(),
    );

    await recordLearningHandler.recordLearning(buildContext(), {
      scope_type: 'workflow_run',
      scope_id: 'run-123',
      lesson: 'Cite evidence before mutating workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Evidence-first repairs reduce ambiguity.',
        },
      ],
      confidence: 0.78,
      tags: ['repair', 'evidence'],
    });
    await promotion.promoteCandidate('candidate-1');

    const result = await queryMemoryHandler.queryMemory(buildContext(), {
      entity_type: 'workflow_run',
      entity_id: 'run-123',
      include_learning: true,
    });

    expect(result.learning).toBeNull();
    expect(result.count).toBe(1);
    expect(result.segments).toHaveLength(1);
  });

  describe('queryMemory provenance projection', () => {
    const sourceDecisionId = 'aaaa1111-4111-4111-8111-111111111111';
    const learningCandidateId = 'bbbb2222-4222-4222-9222-222222222222';
    const workflowRunId = 'cccc3333-4333-4333-a333-333333333333';
    const jobId = 'dddd4444-4444-4444-b444-444444444444';
    const entityId = 'project-1';
    const segmentId = 'eeee5555-4555-4555-8555-555555555555';
    const factSegmentId = 'ffff6666-4666-4666-8666-666666666666';
    const createdAt = new Date('2026-05-16T09:00:00.000Z');
    const lastAccessedAt = new Date('2026-05-16T10:00:00.000Z');

    function buildLearningCandidateSegmentFixture(
      overrides: Partial<IMemorySegment> = {},
    ): IMemorySegment {
      return {
        id: segmentId,
        entity_type: 'Project',
        entity_id: entityId,
        memory_type: 'fact',
        content: 'Use caution when X',
        version: 1,
        source: 'learning_candidate',
        metadata_json: {
          source: 'learning_candidate',
          source_decision_id: sourceDecisionId,
          confidence: 0.87,
          learning_candidate_id: learningCandidateId,
          agent_profile_name: 'senior_dev',
          workflow_run_id: workflowRunId,
          job_id: jobId,
        },
        last_accessed_at: lastAccessedAt,
        created_at: createdAt,
        updated_at: createdAt,
        ...overrides,
      };
    }

    function buildFactSegmentFixture(
      overrides: Partial<IMemorySegment> = {},
    ): IMemorySegment {
      return {
        id: factSegmentId,
        entity_type: 'Project',
        entity_id: entityId,
        memory_type: 'fact',
        content: 'The user prefers weekly status emails.',
        version: 1,
        source: 'fact',
        metadata_json: {
          source: 'fact',
          source_decision_id: sourceDecisionId,
          confidence: 0.72,
          workflow_run_id: workflowRunId,
          job_id: jobId,
        },
        last_accessed_at: lastAccessedAt,
        created_at: createdAt,
        updated_at: createdAt,
        ...overrides,
      };
    }

    function buildProvenanceFixtureManager(
      segmentsToReturn: IMemorySegment[],
    ): {
      getMemorySegments: ReturnType<typeof vi.fn>;
      searchMemory: ReturnType<typeof vi.fn>;
      searchPromotedLessonsByScope: ReturnType<typeof vi.fn>;
    } {
      return {
        getMemorySegments: vi.fn(async () => segmentsToReturn),
        searchMemory: vi.fn(async () => segmentsToReturn),
        searchPromotedLessonsByScope: vi.fn(async () => []),
      };
    }

    it('projects provenance, confidence, and metadata_json for a learning_candidate segment', async () => {
      const memoryManager = buildProvenanceFixtureManager([
        buildLearningCandidateSegmentFixture(),
      ]);

      const handler = new QueryMemoryHandler(
        memoryManager as unknown as MemoryManagerService,
        createFeedbackServiceMock(),
      );

      const response = (await handler.queryMemory(buildContext(), {
        entity_type: 'Project',
        entity_id: entityId,
        include_provenance: true,
      })) as {
        segments: Array<
          Record<string, unknown> & {
            provenance: Record<string, unknown> | null;
            metadata_json: Record<string, unknown> | null;
          }
        >;
      };

      expect(response.segments).toHaveLength(1);
      const segment = response.segments[0];
      expect(segment.provenance).toEqual(
        expect.objectContaining({
          source_decision_id: sourceDecisionId,
          workflow_run_id: workflowRunId,
          job_id: jobId,
          agent_profile: 'senior_dev',
          learning_candidate_id: learningCandidateId,
        }),
      );
      expect(segment.confidence).toBe(0.87);
      expect(segment.metadata_json).toEqual(
        expect.objectContaining({
          source: 'learning_candidate',
          source_decision_id: sourceDecisionId,
          confidence: 0.87,
          learning_candidate_id: learningCandidateId,
          agent_profile_name: 'senior_dev',
          workflow_run_id: workflowRunId,
          job_id: jobId,
        }),
      );
    });

    it('projects provenance for a fact source segment', async () => {
      const memoryManager = buildProvenanceFixtureManager([
        buildFactSegmentFixture(),
      ]);

      const handler = new QueryMemoryHandler(
        memoryManager as unknown as MemoryManagerService,
        createFeedbackServiceMock(),
      );

      const response = (await handler.queryMemory(buildContext(), {
        entity_type: 'Project',
        entity_id: entityId,
      })) as {
        segments: Array<
          Record<string, unknown> & {
            provenance: Record<string, unknown> | null;
          }
        >;
      };

      expect(response.segments).toHaveLength(1);
      const segment = response.segments[0];
      expect(segment.provenance).not.toBeNull();
      expect(segment.provenance).toEqual(
        expect.objectContaining({
          source_decision_id: sourceDecisionId,
          workflow_run_id: workflowRunId,
          job_id: jobId,
        }),
      );
      expect(segment.source).toBe('fact');
    });

    it('strips provenance when include_provenance is false', async () => {
      const memoryManager = buildProvenanceFixtureManager([
        buildLearningCandidateSegmentFixture(),
      ]);

      const handler = new QueryMemoryHandler(
        memoryManager as unknown as MemoryManagerService,
        createFeedbackServiceMock(),
      );

      const response = (await handler.queryMemory(buildContext(), {
        entity_type: 'Project',
        entity_id: entityId,
        include_provenance: false,
      })) as {
        segments: Array<
          Record<string, unknown> & {
            provenance: unknown;
          }
        >;
      };

      expect(response.segments).toHaveLength(1);
      expect(response.segments[0].provenance).toBeNull();
      // Confidence and metadata_json are still populated even when
      // provenance is suppressed, so agents can still weight segments.
      expect((response.segments[0] as Record<string, unknown>).confidence).toBe(
        0.87,
      );
      expect(
        (response.segments[0] as Record<string, unknown>).metadata_json,
      ).toEqual(
        expect.objectContaining({
          learning_candidate_id: learningCandidateId,
        }),
      );
    });

    it('defaults include_provenance to true so learning_candidate segments carry provenance', async () => {
      const memoryManager = buildProvenanceFixtureManager([
        buildLearningCandidateSegmentFixture(),
      ]);

      const handler = new QueryMemoryHandler(
        memoryManager as unknown as MemoryManagerService,
        createFeedbackServiceMock(),
      );

      // No `include_provenance` provided — default should populate provenance.
      const response = (await handler.queryMemory(buildContext(), {
        entity_type: 'Project',
        entity_id: entityId,
      })) as {
        segments: Array<
          Record<string, unknown> & {
            provenance: Record<string, unknown> | null;
          }
        >;
      };

      expect(response.segments).toHaveLength(1);
      const segment = response.segments[0];
      expect(segment.provenance).not.toBeNull();
      expect(segment.provenance).toEqual(
        expect.objectContaining({
          source_decision_id: sourceDecisionId,
          workflow_run_id: workflowRunId,
        }),
      );
    });
  });
});

function createCandidateRepository(candidates: Map<string, LearningCandidate>) {
  return {
    findByFingerprint: vi.fn((fingerprint: string) =>
      Promise.resolve(
        Array.from(candidates.values()).find(
          (candidate) => candidate.fingerprint === fingerprint,
        ) ?? null,
      ),
    ),
    create: vi.fn((data: Partial<LearningCandidate>) => {
      const candidate = buildCandidate({
        ...data,
        id: `candidate-${candidates.size + 1}`,
      });
      candidates.set(candidate.id, candidate);
      return Promise.resolve(candidate);
    }),
    findById: vi.fn((id: string) =>
      Promise.resolve(candidates.get(id) ?? null),
    ),
    claimPendingPromotion: vi.fn((id: string) => {
      const candidate = candidates.get(id);
      if (
        !candidate ||
        !['pending', 'promotion_in_progress'].includes(candidate.status)
      ) {
        return Promise.resolve(null);
      }
      const claimed = copyCandidate(candidate, {
        status: 'promotion_in_progress',
      });
      candidates.set(id, claimed);
      return Promise.resolve(claimed);
    }),
    releasePromotionClaim: vi.fn((id: string) => {
      const candidate = candidates.get(id);
      if (candidate?.status === 'promotion_in_progress') {
        candidates.set(id, copyCandidate(candidate, { status: 'pending' }));
      }
      return Promise.resolve(undefined);
    }),
    markPromotedIfClaimed: vi.fn(
      (id: string, memorySegmentId: string, promotedAt: Date) => {
        const candidate = candidates.get(id);
        if (candidate?.status !== 'promotion_in_progress') {
          return Promise.resolve(null);
        }
        const promoted = copyCandidate(candidate, {
          status: 'promoted',
          promoted_memory_segment_id: memorySegmentId,
          promoted_at: promotedAt,
        });
        candidates.set(id, promoted);
        return Promise.resolve(promoted);
      },
    ),
    countByStatuses: vi.fn(() => Promise.resolve(0)),
    updateById: vi.fn((id: string, patch: Partial<LearningCandidate>) => {
      const existing = candidates.get(id);
      if (!existing) {
        return Promise.resolve(null);
      }
      const updated = copyCandidate(existing, patch);
      candidates.set(id, updated);
      return Promise.resolve(updated);
    }),
  };
}

/**
 * Minimal `MemorySegmentFeedbackService` mock for the
 * pre-existing queryMemory handler spec (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 3).
 *
 * The pre-existing tests exercise the pure-read path and do
 * NOT cast a `feedback` vote; the mock therefore returns an
 * empty `Map` from `computeUsefulnessForSegments` so the
 * `usefulness` field defaults to `null` on every projected
 * segment, matching the backfill-safe shape the handler
 * returns when the `memory_segment_feedback` table has no
 * rows for the segment ids in the rolling window.
 *
 * The `recordFeedback` mock resolves with a fabricated row
 * that the existing tests do not exercise (no test calls
 * `queryMemory` with a `feedback` block today). The shape
 * matches the `MemorySegmentFeedback` entity constructor
 * so any future test that DOES cast a vote does not have
 * to re-mock the service.
 */
function createFeedbackServiceMock() {
  return {
    recordFeedback: vi.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000000',
      segment_id: '00000000-0000-4000-8000-000000000000',
      query_id: 'query-id',
      agent_profile_id: 'repair-agent',
      workflow_run_id: 'run-123',
      useful: true,
      reason: null,
      created_at: new Date('2026-05-16T00:00:00.000Z'),
    })),
    computeUsefulnessForSegment: vi.fn(async () => ({
      usefulness: null,
      sampleSize: 0,
    })),
    computeUsefulnessForSegments: vi.fn(async () => new Map()),
  };
}

function copyCandidate(
  candidate: LearningCandidate,
  overrides: Partial<LearningCandidate>,
): LearningCandidate {
  return Object.assign(buildCandidate(), candidate, overrides);
}

function createMemorySegmentRepository(
  segments: IMemorySegment[],
): Partial<MemorySegmentLearningCandidateRepository> {
  return {
    findLearningCandidateSegment: vi.fn(
      (entityType: string, entityId: string, candidateId: string) =>
        Promise.resolve(
          segments.find(
            (segment) =>
              segment.entity_type === entityType &&
              segment.entity_id === entityId &&
              segment.metadata_json?.learning_candidate_id === candidateId,
          ) ?? null,
        ),
    ),
  };
}

function createLearningPromotionService(
  candidateRepository: ReturnType<typeof createCandidateRepository>,
  memorySegmentRepository: ReturnType<typeof createMemorySegmentRepository>,
  memoryManager: ReturnType<typeof createMemoryManager>,
  eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> },
): LearningPromotionService {
  return new LearningPromotionService(
    candidateRepository as unknown as LearningCandidateRepository,
    memorySegmentRepository as unknown as MemorySegmentCrudRepository,
    memorySegmentRepository as unknown as MemorySegmentLearningCandidateRepository,
    memoryManager as unknown as MemoryManagerService,
    new LearningPromotionPolicyService(),
    eventLedger as unknown as EventLedgerService,
    { get: vi.fn(async (_key, def) => def) } as any,
    {
      recordBackendRead: vi.fn(),
      recordBackendWrite: vi.fn(),
      recordBackendFallback: vi.fn(),
      recordDistillationCompleted: vi.fn(),
      recordLearningPromoted: vi.fn(),
      setActiveSegments: vi.fn(),
      snapshot: vi.fn(),
    } as any,
    {
      recordMemoryBackendRead: vi.fn(),
      recordMemoryBackendWrite: vi.fn(),
      setMemoryBackendActiveSegments: vi.fn(),
      recordMemoryBackendFallback: vi.fn(),
      recordDistillationCompleted: vi.fn(),
      recordLearningPromoted: vi.fn(),
    } as any,
  );
}

const SEGMENT_FIXTURE_UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-9222-222222222222',
  '33333333-3333-4333-a333-333333333333',
  '44444444-4444-4444-b444-444444444444',
  '55555555-4555-4555-8555-555555555555',
  '66666666-4666-4666-8666-666666666666',
];

function nextSegmentFixtureId(segments: IMemorySegment[]): string {
  const index = segments.length;
  const fixture =
    SEGMENT_FIXTURE_UUIDS[index] ??
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  return fixture;
}

function createMemoryManager(segments: IMemorySegment[]) {
  return {
    createMemorySegment: vi.fn(
      (
        entityType: string,
        entityId: string,
        content: string,
        memoryType: 'preference' | 'fact' | 'history' = 'fact',
        metadata: Record<string, unknown> | null = null,
      ) => {
        const segment: IMemorySegment = {
          id: nextSegmentFixtureId(segments),
          entity_type: entityType,
          entity_id: entityId,
          content,
          memory_type: memoryType,
          version: 1,
          metadata_json: metadata,
          created_at: new Date('2026-05-16T00:00:00.000Z'),
          updated_at: new Date('2026-05-16T00:00:00.000Z'),
        };
        segments.push(segment);
        return Promise.resolve(segment);
      },
    ),
    getMemorySegments: vi.fn(
      (
        entityType: string,
        entityId: string,
        filters?: { memory_type?: 'preference' | 'fact' | 'history' },
      ) =>
        Promise.resolve(
          segments.filter(
            (segment) =>
              segment.entity_type === entityType &&
              segment.entity_id === entityId &&
              (!filters?.memory_type ||
                segment.memory_type === filters.memory_type),
          ),
        ),
    ),
    searchMemory: vi.fn(
      (entityType: string, entityId: string, query: string) => {
        const normalizedQuery = query.toLowerCase();
        return Promise.resolve(
          segments.filter(
            (segment) =>
              segment.entity_type === entityType &&
              segment.entity_id === entityId &&
              segment.content.toLowerCase().includes(normalizedQuery),
          ),
        );
      },
    ),
    searchPromotedLessonsByScope: vi.fn(
      (opts: {
        entity_type: string;
        entity_id?: string;
        query?: string;
        limit?: number;
      }) => {
        const normalizedQuery = opts.query?.toLowerCase();
        return Promise.resolve(
          segments.filter(
            (segment) =>
              segment.entity_type === opts.entity_type &&
              (opts.entity_id === undefined ||
                segment.entity_id === opts.entity_id) &&
              segment.metadata_json?.source === 'learning_candidate' &&
              segment.memory_type === 'fact' &&
              (normalizedQuery === undefined ||
                segment.content.toLowerCase().includes(normalizedQuery)),
          ),
        );
      },
    ),
  };
}

function buildContext(): InternalToolExecutionContext {
  return {
    workflowRunId: 'run-123',
    jobId: 'job-456',
    scopeId: 'runtime-scope-789',
    userId: 'user-abc',
    agentProfileName: 'repair-agent',
  };
}

function buildCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'workflow_run',
    scopeId: 'run-123',
    candidate_type: 'runtime_learning',
    title: 'Prefer cited repair evidence before changing workflow behavior.',
    summary: 'Prefer cited repair evidence before changing workflow behavior.',
    fingerprint: 'a'.repeat(64),
    signals_json: {
      lesson: 'Prefer cited repair evidence before changing workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-123',
          summary: 'Cited evidence reduced repair ambiguity.',
        },
      ],
      tags: ['repair', 'evidence'],
      confidence: 0.78,
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
    },
    score: 0.78,
    confidence: 0.78,
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
    first_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    last_seen_at: new Date('2026-05-16T00:00:00.000Z'),
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}
