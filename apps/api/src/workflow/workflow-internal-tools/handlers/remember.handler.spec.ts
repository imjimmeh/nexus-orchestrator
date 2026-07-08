import type { IMemorySegment, InternalToolExecutionContext } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../../../memory/database/entities/learning-candidate.entity';
import type { LearningCandidateRepository } from '../../../memory/database/repositories/learning-candidate.repository';
import { RecordLearningService } from '../../../memory/learning/record-learning.service';
import type { EventLedgerService } from '../../../observability/event-ledger.service';
import { RememberHandler } from './remember.handler';

describe('RememberHandler', () => {
  function buildRememberHandler(settingsValue?: number) {
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
    const settings = createSettingsMock(settingsValue);
    // Stub the guard to always proceed — budget/near-dup enforcement is tested
    // in remember-write-guard.service.spec.ts in isolation.
    const writeGuard = {
      checkBudgetAndNearDup: vi.fn().mockResolvedValue({ action: 'proceed' }),
    };
    const handler = new RememberHandler(
      recordLearning,
      writeGuard as never,
      settings as never,
      { findById: vi.fn().mockResolvedValue(null) } as never, // runRepo
      { findById: vi.fn().mockResolvedValue(null) } as never, // workflowRepo
    );

    return { handler, candidates, candidateRepository, settings };
  }

  it('resolves project scope to context.scopeId', async () => {
    const { handler, candidateRepository } = buildRememberHandler();
    const context = buildContext();

    await handler.remember(context, {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: ['tdd'],
      origin: 'discovery',
    });

    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope_type: 'project',
        scopeId: context.scopeId,
      }),
    );
  });

  it('resolves global scope to null scope_id', async () => {
    const { handler, candidateRepository } = buildRememberHandler();
    const context = buildContext();

    await handler.remember(context, {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'global',
      tags: [],
      origin: 'discovery',
    });

    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope_type: 'global',
        scopeId: null,
      }),
    );
  });

  it('sets candidate_type to agent_capture with high source_quality_confidence', async () => {
    const { handler, candidateRepository } = buildRememberHandler();

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
    });

    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_type: 'agent_capture',
        source_quality_confidence: 0.9,
      }),
    );
  });

  it('sets human_approved_at to a Date when origin is user_request', async () => {
    const { handler, candidateRepository } = buildRememberHandler();

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'user_request',
    });

    const createCall = (candidateRepository.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { human_approved_at: unknown };
    expect(createCall.human_approved_at).toBeInstanceOf(Date);
  });

  it('sets human_approved_at to null when origin is discovery', async () => {
    const { handler, candidateRepository } = buildRememberHandler();

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
    });

    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        human_approved_at: null,
      }),
    );
  });

  it('returns created:false for an exact-fingerprint duplicate without re-inserting', async () => {
    const { handler, candidates } = buildRememberHandler();
    const params = {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact' as const,
      scope: 'project' as const,
      tags: ['tdd'],
      origin: 'discovery' as const,
    };

    const first = await handler.remember(buildContext(), params);
    expect(first).toMatchObject({ created: true });
    expect(candidates.size).toBe(1);

    const second = await handler.remember(buildContext(), params);
    expect(second).toMatchObject({
      created: false,
      candidate_id: first.candidate_id,
    });
    expect(candidates.size).toBe(1);
  });

  it('records source.tool as remember in signals_json', async () => {
    const { handler, candidateRepository } = buildRememberHandler();

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
    });

    const createCall = (candidateRepository.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      signals_json: { source: { tool: string }; provenance: unknown };
    };
    expect(createCall.signals_json.source.tool).toBe('remember');
  });

  it('stores agentProfileName provenance exactly once (no top-level duplication)', async () => {
    const { handler, candidateRepository } = buildRememberHandler();

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
    });

    const createCall = (candidateRepository.create as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      signals_json: Record<string, unknown> & {
        provenance: { agentProfileName?: string };
      };
    };
    // captured_by lives in provenance.agentProfileName only — not duplicated
    // at the top level of signals_json.
    expect(createCall.signals_json.provenance.agentProfileName).toBe(
      'repair-agent',
    );
    expect(createCall.signals_json).not.toHaveProperty('captured_by');
    expect(createCall.signals_json).not.toHaveProperty('workflow_run_id');
    expect(createCall.signals_json).not.toHaveProperty('job_id');
    expect(createCall.signals_json).toMatchObject({
      memory_type: 'fact',
      origin: 'discovery',
    });
  });

  it('defaults confidence from the memory_capture_default_confidence setting', async () => {
    const { handler, candidateRepository, settings } =
      buildRememberHandler(0.42);

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
    });

    expect(settings.get).toHaveBeenCalledWith(
      'memory_capture_default_confidence',
      0.6,
    );
    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.42 }),
    );
  });

  it('prefers an explicit confidence over the setting default', async () => {
    const { handler, candidateRepository, settings } =
      buildRememberHandler(0.42);

    await handler.remember(buildContext(), {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact',
      scope: 'project',
      tags: [],
      origin: 'discovery',
      confidence: 0.95,
    });

    expect(settings.get).not.toHaveBeenCalled();
    expect(candidateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.95 }),
    );
  });

  it('reinforces an exact-fingerprint duplicate by advancing last_seen_at and recurrence_count', async () => {
    const { handler, candidates, candidateRepository } = buildRememberHandler();
    const params = {
      content: 'Always write tests before implementing the feature code.',
      memory_type: 'fact' as const,
      scope: 'project' as const,
      tags: ['tdd'],
      origin: 'discovery' as const,
    };

    const first = await handler.remember(buildContext(), params);
    const original = candidates.get(first.candidate_id as string)!;
    const originalRecurrence = original.recurrence_count;
    const originalLastSeen = original.last_seen_at;

    const second = await handler.remember(buildContext(), params);

    expect(second).toMatchObject({ created: false });
    expect(candidates.size).toBe(1);
    expect(candidateRepository.updateById).toHaveBeenCalledWith(
      first.candidate_id,
      expect.objectContaining({
        recurrence_count: originalRecurrence + 1,
        last_seen_at: expect.any(Date),
      }),
    );
    const reinforced = candidates.get(first.candidate_id as string)!;
    expect(reinforced.recurrence_count).toBe(originalRecurrence + 1);
    expect(reinforced.last_seen_at.getTime()).toBeGreaterThanOrEqual(
      originalLastSeen.getTime(),
    );
  });
});

describe('RememberHandler scope resolution (Epic C)', () => {
  function makeRememberHarness() {
    const recordLearning = vi
      .fn()
      .mockResolvedValue({ created: true, candidate_id: 'c1' });
    const runRepo = {
      findById: vi.fn().mockResolvedValue({ workflow_id: 'wf-uuid' }),
    };
    const workflowRepo = {
      findById: vi
        .fn()
        .mockResolvedValue({ id: 'wf-uuid', name: 'implement_and_commit' }),
    };
    const handler = new RememberHandler(
      { recordLearning } as never, // recordLearningService
      {
        checkBudgetAndNearDup: vi.fn().mockResolvedValue({ action: 'proceed' }),
      } as never, // rememberWriteGuard
      { get: vi.fn().mockResolvedValue(0.6) } as never, // settings
      runRepo as never, // runRepo (Epic C)
      workflowRepo as never, // workflowRepo (Epic C)
    );
    return { handler, recordLearning, runRepo, workflowRepo };
  }

  const content =
    'Always run nest build, never tsc, for the api workspace output.';

  it("scope 'agent' resolves scope_id from context.agentProfileName", async () => {
    const { handler, recordLearning } = makeRememberHarness();

    await handler.remember(
      {
        workflowRunId: 'run-1',
        agentProfileName: 'implementer-agent',
        scopeId: 'proj-1',
      },
      {
        content,
        scope: 'agent',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: 'agent',
        scope_id: 'implementer-agent',
      }),
      expect.anything(),
    );
  });

  it("scope 'workflow' resolves scope_id to the run's workflow definition name", async () => {
    const { handler, recordLearning, runRepo } = makeRememberHarness();

    await handler.remember(
      {
        workflowRunId: 'run-1',
        agentProfileName: 'implementer-agent',
        scopeId: 'proj-1',
      },
      {
        content,
        scope: 'workflow',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(runRepo.findById).toHaveBeenCalledWith('run-1');
    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: 'workflow',
        scope_id: 'implement_and_commit',
      }),
      expect.anything(),
    );
  });

  it('returns created:false scope_unresolvable instead of writing when the id cannot be resolved', async () => {
    const { handler, recordLearning } = makeRememberHarness();

    const result = await handler.remember(
      { workflowRunId: 'run-1', scopeId: 'proj-1' }, // no agentProfileName
      {
        content,
        scope: 'agent',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(result).toEqual({
      created: false,
      reason: 'scope_unresolvable',
      scope: 'agent',
    });
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('returns created:false scope_unresolvable for workflow scope when the run has no workflow_id', async () => {
    const { handler, recordLearning, runRepo } = makeRememberHarness();
    runRepo.findById.mockResolvedValueOnce({ workflow_id: undefined });

    const result = await handler.remember(
      { workflowRunId: 'run-1', scopeId: 'proj-1' },
      {
        content,
        scope: 'workflow',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(result).toEqual({
      created: false,
      reason: 'scope_unresolvable',
      scope: 'workflow',
    });
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it("scope 'project' keeps today's behavior (context.scopeId)", async () => {
    const { handler, recordLearning } = makeRememberHarness();

    await handler.remember(
      { workflowRunId: 'run-1', scopeId: 'proj-1' },
      {
        content,
        scope: 'project',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: 'project', scope_id: 'proj-1' }),
      expect.anything(),
    );
  });

  // Precedence pin (FU-15): scope resolution now runs BEFORE the budget/near-dup
  // guard (the guard must key its pending-candidate bucket on the resolved
  // (scope_type, scope_id) pair). So when a write is BOTH unrecordable (scope
  // unresolvable) AND would otherwise be budget-exhausted / a near-duplicate,
  // the caller gets `scope_unresolvable` — the more fundamental problem — and
  // the guard is never consulted. This is the intended, documented behavior:
  // a write with no resolvable scope cannot be recorded regardless of budget.
  it('returns scope_unresolvable (not budget_exhausted/near_duplicate) when the scope is unresolvable AND the guard would have blocked', async () => {
    const recordLearning = vi.fn();
    // Guard would block (budget exhausted) — but must never be reached because
    // scope resolution fails first.
    const checkBudgetAndNearDup = vi
      .fn()
      .mockResolvedValue({ action: 'budget_exhausted' });
    const runRepo = {
      findById: vi.fn().mockResolvedValue({ workflow_id: undefined }),
    };
    const workflowRepo = { findById: vi.fn() };
    const handler = new RememberHandler(
      { recordLearning } as never,
      { checkBudgetAndNearDup } as never,
      { get: vi.fn().mockResolvedValue(0.6) } as never,
      runRepo as never,
      workflowRepo as never,
    );

    const result = await handler.remember(
      { workflowRunId: 'run-1', scopeId: 'proj-1' },
      {
        content,
        scope: 'workflow',
        memory_type: 'fact',
        tags: [],
        origin: 'discovery',
      },
    );

    expect(result).toEqual({
      created: false,
      reason: 'scope_unresolvable',
      scope: 'workflow',
    });
    // Guard never consulted — resolution short-circuits first.
    expect(checkBudgetAndNearDup).not.toHaveBeenCalled();
    expect(recordLearning).not.toHaveBeenCalled();
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

function copyCandidate(
  candidate: LearningCandidate,
  overrides: Partial<LearningCandidate>,
): LearningCandidate {
  return Object.assign(buildCandidate(), candidate, overrides);
}

/**
 * Minimal `SystemSettingsService` mock for the handler spec. The
 * `remember` path resolves `memory_capture_default_confidence` via
 * `settings.get(key, fallback)`; when `value` is supplied the mock
 * returns it, otherwise it echoes the caller-provided fallback so the
 * pre-existing handler tests (which never call `remember`) are
 * unaffected.
 */
function createSettingsMock(value?: number) {
  return {
    get: vi.fn(async (_key: string, fallback: unknown) =>
      value === undefined ? (fallback as number) : value,
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

const SEGMENT_FIXTURE_UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-9222-222222222222',
  '33333333-3333-4333-a333-333333333333',
  '44444444-4444-4444-b444-444444444444',
  '55555555-5555-4555-8555-555555555555',
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
