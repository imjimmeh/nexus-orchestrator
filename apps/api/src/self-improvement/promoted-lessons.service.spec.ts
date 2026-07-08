import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySegment } from '../memory/database/entities/memory-segment.entity';
import type { LearningCandidate } from '../memory/database/entities/learning-candidate.entity';
import type { WorkflowSkillBinding } from '../workflow/workflow-skill-bindings/workflow-skill-binding.entity';
import { PromotedLessonsService } from './promoted-lessons.service';
import { promotedLessonsQuerySchema } from './promoted-lessons.service.types';

// ---------------------------------------------------------------------------
// `PromotedLessonsService` is the single read-side service for the
// apps/web control plane `PromotedLessonsCard` + `SkillBindingUsageCard`.
// The service is intentionally thin — all filter / order / limit
// semantics live on the repositories. The service is responsible for:
//   1. Computing the default `since` window when the query is empty.
//   2. Loading the candidate + signal-group metadata per promoted segment
//      (with defensive skipping for malformed rows).
//   3. Loading the active bindings and computing per-binding `reuseCount7d`.
// Tests focus on the service's wiring — repos are mocked, no live DB.
// `since` is parsed through the Zod schema first because the service
// boundary contract is `Date | undefined` (validation is the
// controller's job — `ZodQuery` in the route handler).
// ---------------------------------------------------------------------------

describe('PromotedLessonsService', () => {
  const listPromotedSegmentsAfter = vi.fn();
  const listActive = vi.fn();
  const findByIdCandidate = vi.fn();
  const findMostRecentIdByCandidateId = vi.fn();
  const countSkillAssignmentReuseSince = vi.fn();

  const createdAtBase = new Date('2026-07-01T12:00:00.000Z').getTime();

  function makeSegment(overrides: Partial<MemorySegment> = {}): MemorySegment {
    return {
      id: 'segment-1',
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      content: 'promoted lesson content',
      memory_type: 'fact',
      metadata_json: {
        source: 'learning_candidate',
        learning_candidate_id: 'candidate-1',
      },
      created_at: new Date(createdAtBase),
      updated_at: new Date(createdAtBase),
      archived_at: null,
      ...overrides,
    } as unknown as MemorySegment;
  }

  function makeCandidate(
    overrides: Partial<LearningCandidate> = {},
  ): LearningCandidate {
    return {
      id: 'candidate-1',
      title: 'cited repair evidence',
      confidence: 0.75,
      promoted_at: new Date('2026-07-01T11:55:00.000Z'),
      signals_json: { workflow_skill_binding_ids: ['binding-1', 'binding-2'] },
      ...overrides,
    } as unknown as LearningCandidate;
  }

  function makeBinding(
    overrides: Partial<WorkflowSkillBinding> = {},
  ): WorkflowSkillBinding {
    return {
      id: 'binding-1',
      workflow_name: 'repair-runner',
      step_id: null,
      skill_name: 'fix-merge-conflicts',
      provenance: { source: 'improvement_proposal' },
      created_at: new Date('2026-07-01T08:00:00.000Z'),
      updated_at: new Date('2026-07-01T08:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildService(): PromotedLessonsService {
    return new PromotedLessonsService(
      { listPromotedSegmentsAfter } as never,
      { findById: findByIdCandidate } as never,
      { findMostRecentIdByCandidateId } as never,
      { listActive } as never,
      { countSkillAssignmentReuseSince } as never,
    );
  }

  it('returns the default since window of 7 days when no `since` is provided', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    listActive.mockResolvedValue([]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);
    const service = buildService();

    const query = promotedLessonsQuerySchema.parse({});
    const result = await service.getPromotedLessons(query);

    expect(listPromotedSegmentsAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        since: new Date('2026-07-01T12:00:00.000Z'),
        limit: 50,
      }),
    );
    expect(listActive).toHaveBeenCalledWith({ limit: 200 });
    expect(result).toEqual({ promoted: [], bindings: [] });
  });

  it('maps promoted segments into the documented response shape with signal + confidence + binding ids', async () => {
    const segment = makeSegment();
    listPromotedSegmentsAfter.mockResolvedValue([segment]);
    listActive.mockResolvedValue([]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);
    findByIdCandidate.mockResolvedValue(makeCandidate());
    findMostRecentIdByCandidateId.mockResolvedValue('signal-group-1');

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    const result = await service.getPromotedLessons(query);

    expect(findByIdCandidate).toHaveBeenCalledWith('candidate-1');
    expect(findMostRecentIdByCandidateId).toHaveBeenCalledWith('candidate-1');
    expect(result.promoted).toEqual([
      {
        id: 'segment-1',
        sourceSignalId: 'signal-group-1',
        promotedAt: '2026-07-01T12:00:00.000Z',
        confidence: 0.75,
        workflowSkillBindingIds: ['binding-1', 'binding-2'],
      },
    ]);
  });

  it('falls back to null confidence when the candidate row is missing', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([makeSegment()]);
    listActive.mockResolvedValue([]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);
    findByIdCandidate.mockResolvedValue(null);
    findMostRecentIdByCandidateId.mockResolvedValue(null);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    const result = await service.getPromotedLessons(query);

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]?.confidence).toBe(0);
    expect(result.promoted[0]?.sourceSignalId).toBeNull();
    expect(result.promoted[0]?.workflowSkillBindingIds).toEqual([]);
  });

  it('skips promoted segments whose metadata is missing the learning_candidate_id', async () => {
    const malformed = makeSegment({
      id: 'segment-bad',
      metadata_json: { source: 'learning_candidate' },
    });
    listPromotedSegmentsAfter.mockResolvedValue([malformed]);
    listActive.mockResolvedValue([]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    const result = await service.getPromotedLessons(query);

    expect(result.promoted).toEqual([]);
    expect(findByIdCandidate).not.toHaveBeenCalled();
    expect(findMostRecentIdByCandidateId).not.toHaveBeenCalled();
  });

  it('maps workflow-scoped bindings to mostSpecificSource=workflow and an empty stepIds list', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    const binding = makeBinding({ id: 'binding-1', step_id: null });
    listActive.mockResolvedValue([binding]);
    countSkillAssignmentReuseSince.mockResolvedValue(3);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    const result = await service.getPromotedLessons(query);

    expect(result.bindings).toEqual([
      {
        id: 'binding-1',
        mostSpecificSource: 'workflow',
        reuseCount7d: 3,
        workflowStepIds: [],
      },
    ]);
  });

  it('maps step-scoped bindings to mostSpecificSource=step and a single-element stepIds list', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    const binding = makeBinding({
      id: 'binding-step',
      step_id: 'step-alpha',
    });
    listActive.mockResolvedValue([binding]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    const result = await service.getPromotedLessons(query);

    expect(result.bindings).toEqual([
      {
        id: 'binding-step',
        mostSpecificSource: 'step',
        reuseCount7d: 0,
        workflowStepIds: ['step-alpha'],
      },
    ]);
  });

  it('queries skill_assignment reuse with the documented kind/window/payload filter (step-scoped binding)', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    const binding = makeBinding({
      id: 'binding-step',
      step_id: 'step-alpha',
      skill_name: 'fix-merge-conflicts',
      workflow_name: 'repair-runner',
    });
    listActive.mockResolvedValue([binding]);
    countSkillAssignmentReuseSince.mockResolvedValue(7);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    await service.getPromotedLessons(query);

    expect(countSkillAssignmentReuseSince).toHaveBeenCalledWith({
      since: expect.any(Date),
      skillName: 'fix-merge-conflicts',
      workflowName: 'repair-runner',
      stepId: 'step-alpha',
    });
  });

  it('queries skill_assignment reuse with a null stepId for workflow-scoped bindings', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    const binding = makeBinding({
      id: 'binding-wf',
      step_id: null,
      skill_name: 'fix-merge-conflicts',
      workflow_name: 'repair-runner',
    });
    listActive.mockResolvedValue([binding]);
    countSkillAssignmentReuseSince.mockResolvedValue(1);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    await service.getPromotedLessons(query);

    expect(countSkillAssignmentReuseSince).toHaveBeenCalledWith({
      since: expect.any(Date),
      skillName: 'fix-merge-conflicts',
      workflowName: 'repair-runner',
      stepId: null,
    });
  });

  it('rejects an invalid `since` value before reaching the repositories (Zod)', () => {
    expect(() => promotedLessonsQuerySchema.parse({ since: 'abc' })).toThrow();
  });

  it('rejects an empty `since` value (Zod regex)', () => {
    expect(() => promotedLessonsQuerySchema.parse({ since: '' })).toThrow();
  });

  it('accepts a 30-minute `since` value and feeds a 30-minute-old `since` Date to the repos', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    listActive.mockResolvedValue([]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '30m' });
    await service.getPromotedLessons(query);

    expect(listPromotedSegmentsAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        since: new Date('2026-07-08T11:30:00.000Z'),
        limit: 50,
      }),
    );
    expect(listActive).toHaveBeenCalledWith({ limit: 200 });
  });

  it('issues a fresh reuse count per binding (no shared mutable state)', async () => {
    listPromotedSegmentsAfter.mockResolvedValue([]);
    listActive.mockResolvedValue([
      makeBinding({ id: 'b1', step_id: null }),
      makeBinding({ id: 'b2', step_id: 'step-a' }),
    ]);
    countSkillAssignmentReuseSince.mockResolvedValue(0);

    const service = buildService();
    const query = promotedLessonsQuerySchema.parse({ since: '7d' });
    await service.getPromotedLessons(query);

    expect(countSkillAssignmentReuseSince).toHaveBeenCalledTimes(2);
  });
});
