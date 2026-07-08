import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { ImprovementProposalRepository } from '../../improvement/database/repositories/improvement-proposal.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { LearningService } from './learning.service';
import { toLearningCandidateListItem } from './learning.mapper';
import { type ListLearningCandidatesRequest } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { WorkflowPersistenceService } from '../../workflow/workflow-persistence.service';

function createCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 'title',
    summary: 'summary',
    fingerprint: 'fp',
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: 'pending',
    diagnostics_json: null,
    routing_target: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    last_seen_at: new Date('2026-06-02T00:00:00.000Z'),
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('LearningService', () => {
  let service: LearningService;
  const candidatesRepo = {
    countByStatuses: vi.fn(),
    countMerged: vi.fn(),
    list: vi.fn(),
  };
  const proposals = { countByStatuses: vi.fn() };
  const eventLedger = { emitBestEffort: vi.fn() };
  const workflowEngine = { startWorkflow: vi.fn() };
  const persistence = { getWorkflowRun: vi.fn(), getWorkflowRuns: vi.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LearningService,
        { provide: LearningCandidateRepository, useValue: candidatesRepo },
        { provide: ImprovementProposalRepository, useValue: proposals },
        { provide: EventLedgerService, useValue: eventLedger },
        { provide: WorkflowEngineService, useValue: workflowEngine },
        { provide: WorkflowPersistenceService, useValue: persistence },
      ],
    }).compile();

    service = module.get(LearningService);
  });

  afterEach(() => vi.clearAllMocks());

  it('aggregates candidate and proposal totals', async () => {
    candidatesRepo.countByStatuses
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    proposals.countByStatuses
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6);
    persistence.getWorkflowRuns.mockResolvedValue([
      {
        id: 'run-1234',
        status: 'COMPLETED',
        started_at: '2026-07-06T11:59:00Z',
        completed_at: '2026-07-06T12:00:00Z',
        state_variables: {
          trigger: { trigger: 'scheduled' },
          jobs: {
            sweep: {
              output: {
                scannedScopes: '7',
                scannedObservations: 8,
                rankedCandidates: 9,
                promotedCandidates: 10,
                createdSkillProposals: 11,
              },
            },
          },
        },
      },
      { status: 'RUNNING' },
    ]);

    await expect(service.getStatus()).resolves.toMatchObject({
      enabled: true,
      sweepRunning: true,
      candidateTotals: { pending: 2, promoted: 1 },
      proposalTotals: {
        pending: 3,
        approved: 4,
        rejected: 5,
        failed: 6,
      },
      lastRun: {
        runId: 'run-1234',
        trigger: 'scheduled',
        startedAt: '2026-07-06T11:59:00Z',
        completedAt: '2026-07-06T12:00:00Z',
        scannedScopes: 7,
        scannedObservations: 8,
        rankedCandidates: 9,
        promotedCandidates: 10,
        createdSkillProposals: 11,
      },
    });
  });

  it('emits stable events for a safe manual run', async () => {
    workflowEngine.startWorkflow.mockResolvedValue('run-1234');
    persistence.getWorkflowRun.mockResolvedValue({
      status: 'COMPLETED',
      state_variables: {
        jobs: {
          sweep: {
            output: {
              scannedScopes: 1,
              scannedObservations: 2,
              rankedCandidates: 3,
              promotedCandidates: 4,
              createdSkillProposals: 5,
            },
          },
        },
      },
    });

    const result = await service.runManualSweep();

    expect(result.trigger).toBe('manual');
    expect(result.runId).toBe('run-1234');
    expect(result.promotedCandidates).toBe(4);
    expect(result.createdSkillProposals).toBe(5);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(2);

    expect(eventLedger.emitBestEffort).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningRunStarted,
        outcome: 'in_progress',
        payload: expect.objectContaining({
          runId: 'run-1234',
          trigger: 'manual',
        }),
      }),
    );

    expect(eventLedger.emitBestEffort).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningRunCompleted,
        outcome: 'success',
        payload: result,
      }),
    );
  });

  describe('listCandidates', () => {
    it('passes the full filter set through to the repository and returns the paginated envelope', async () => {
      const candidate = createCandidate({ id: 'c1' });
      candidatesRepo.list.mockResolvedValue({ data: [candidate], total: 1 });
      candidatesRepo.countMerged.mockResolvedValue(3);

      const query: ListLearningCandidatesRequest = {
        status: ['pending', 'promoted'],
        candidate_type: ['agent_capture'],
        scope_type: 'global',
        search: 'flaky',
        min_score: 0.4,
        page: 1,
        limit: 25,
        sortBy: 'score',
        sortDir: 'desc',
      };

      const result = await service.listCandidates(query);

      expect(candidatesRepo.list).toHaveBeenCalledWith({
        statuses: ['pending', 'promoted'],
        candidateTypes: ['agent_capture'],
        scopeType: 'global',
        scopeId: undefined,
        excludeMerged: true,
        search: 'flaky',
        minScore: 0.4,
        createdFrom: undefined,
        createdTo: undefined,
        page: 1,
        limit: 25,
        sortBy: 'score',
        sortDir: 'desc',
      });
      expect(result).toEqual({
        data: [expect.objectContaining({ id: 'c1' })],
        meta: {
          pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
          suppressedCount: 3,
        },
      });
    });
  });
});

describe('Learning mappers', () => {
  it('maps learning candidates using scope_type and scope_id only', () => {
    const candidate = {
      ...createCandidate({
        id: 'candidate-1',
        scope_type: 'workflow_run',
        scopeId: 'run-1',
        candidate_type: 'failure_pattern',
        title: 'Retry policy drift',
        summary: 'Candidates need better retry behavior',
        fingerprint: 'fp-1',
        status: 'pending',
        score: 0.78,
        confidence: 0.91,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-02T00:00:00.000Z'),
      }),
      // legacy source should never be surfaced by mapper output
      scope_id: 'legacy-project-1',
    } as unknown as LearningCandidate;

    const mapped = toLearningCandidateListItem(candidate);

    expect(mapped).toMatchObject({
      id: 'candidate-1',
      scope_type: 'workflow_run',
      scope_id: 'run-1',
      candidate_type: 'failure_pattern',
      title: 'Retry policy drift',
    });
    expect(mapped.scope_id).not.toBe('legacy-project-1');
  });

  it('maps global candidates with null scope_id', () => {
    const candidate = createCandidate({
      id: 'candidate-2',
      scope_type: 'global',
      scopeId: null,
      candidate_type: 'preference_gap',
      title: 'Global rule gap',
      summary: 'Cross-cutting guidance needed',
      fingerprint: 'fp-2',
      status: 'promoted',
      score: 0.5,
      confidence: 0.84,
      created_at: new Date('2026-01-03T00:00:00.000Z'),
      updated_at: new Date('2026-01-04T00:00:00.000Z'),
    });

    const mapped = toLearningCandidateListItem(candidate);

    expect(mapped.scope_type).toBe('global');
    expect(mapped.scope_id).toBeNull();
  });

  it('maps in-progress promotion candidates as pending in public list output', () => {
    const candidate = createCandidate({
      id: 'candidate-3',
      scope_type: 'workflow_run',
      scopeId: 'run-3',
      candidate_type: 'runtime_learning',
      title: 'Promotion in progress',
      summary: 'Internal promotion is in progress',
      fingerprint: 'fp-3',
      status: 'promotion_in_progress',
      score: 0.7,
      confidence: 0.8,
      created_at: new Date('2026-01-05T00:00:00.000Z'),
      updated_at: new Date('2026-01-06T00:00:00.000Z'),
    });

    const mapped = toLearningCandidateListItem(candidate);

    expect(mapped.status).toBe('pending');
  });
});
