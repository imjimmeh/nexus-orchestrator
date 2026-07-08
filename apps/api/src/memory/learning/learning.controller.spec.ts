import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { LearningService } from './learning.service';
import { LearningController } from './learning.controller';
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  ListLearningCandidatesRequest,
  RejectLearningCandidateRequest,
} from '@nexus/core';
import type { LearningPromotionService } from './learning-promotion.service';
import type { LearningCandidateDecisionService } from './learning-candidate-decision.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';

describe('LearningController', () => {
  const getStatus = vi.fn();
  const runManualSweep = vi.fn();
  const listCandidates = vi.fn();
  const promoteCandidate = vi.fn();
  const bulkPromote = vi.fn();
  const reject = vi.fn();
  const archive = vi.fn();
  const bulkReject = vi.fn();
  const bulkArchive = vi.fn();

  let controller: LearningController;

  beforeEach(() => {
    vi.clearAllMocks();

    controller = new LearningController(
      {
        getStatus,
        runManualSweep,
        listCandidates,
      } as unknown as LearningService,
      {
        promoteCandidate,
        bulkPromote,
      } as unknown as LearningPromotionService,
      {
        reject,
        archive,
        bulkReject,
        bulkArchive,
      } as unknown as LearningCandidateDecisionService,
    );
  });

  it('returns learning status', async () => {
    const status = {
      enabled: true,
      intervalSeconds: 0,
      promotionThreshold: 0,
      proposalThreshold: 0,
      sweepRunning: false,
      candidateTotals: { pending: 0, promoted: 0 },
      proposalTotals: { pending: 0, approved: 0, rejected: 0, failed: 0 },
      lastRun: null,
    };

    getStatus.mockResolvedValue(status);

    const response = await controller.getStatus();

    expect(getStatus).toHaveBeenCalledWith();
    expect(response).toEqual({ success: true, data: status });
  });

  it('runs manual learning sweep', async () => {
    const sweepResult = {
      runId: 'run-1',
      trigger: 'manual' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      scannedScopes: 0,
      scannedObservations: 0,
      rankedCandidates: 0,
      promotedCandidates: 0,
      createdSkillProposals: 0,
    };

    runManualSweep.mockResolvedValue(sweepResult);

    const response = await controller.runManualSweep();

    expect(runManualSweep).toHaveBeenCalledWith();
    expect(response).toEqual({ success: true, data: sweepResult });
  });

  it('lists candidates for query', async () => {
    const query: ListLearningCandidatesRequest = {
      status: 'pending',
      scope_type: 'workflow_run',
      scope_id: 'workflow-run-1',
      limit: 10,
      offset: 5,
    };
    const candidates = {
      items: [],
      total: 0,
      limit: 10,
      offset: 5,
    };

    listCandidates.mockResolvedValue(candidates);

    const response = await controller.listCandidates(query);

    expect(listCandidates).toHaveBeenCalledWith(query);
    expect(response).toEqual({ success: true, data: candidates });
  });

  it('promotes a candidate and returns a sparse response', async () => {
    const policyDecision = {
      approved: true,
      code: 'approved' as const,
      reasons: ['candidate meets promotion threshold'],
    };
    promoteCandidate.mockResolvedValue({
      candidate_id: '00000000-0000-4000-8000-000000000001',
      memory_segment_id: '00000000-0000-4000-8000-000000000002',
      status: 'promoted',
      policy_decision: policyDecision,
      candidate: { id: '00000000-0000-4000-8000-000000000001' },
      memory_segment: { id: '00000000-0000-4000-8000-000000000002' },
    });

    const response = await controller.promote({
      candidate_id: '00000000-0000-4000-8000-000000000001',
      requested_by: 'admin-user',
    });

    expect(promoteCandidate).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      { requestedBy: 'admin-user' },
    );
    expect(response).toEqual({
      success: true,
      data: {
        candidate_id: '00000000-0000-4000-8000-000000000001',
        memory_segment_id: '00000000-0000-4000-8000-000000000002',
        status: 'promoted',
        policy_decision: policyDecision,
      },
    });
    expect(response.data).not.toHaveProperty('candidate');
    expect(response.data).not.toHaveProperty('memory_segment');
  });

  it('rejects a candidate', async () => {
    const id = '6f3e2e48-b8a9-4e30-890a-995acbaac768';
    const body: RejectLearningCandidateRequest = { reason: 'Not useful' };
    const candidate = { id, status: 'rejected' };
    reject.mockResolvedValue(candidate);

    const response = await controller.reject(id, body);

    expect(reject).toHaveBeenCalledWith(id, body);
    expect(response).toEqual({ success: true, data: candidate });
  });

  it('archives a candidate', async () => {
    const id = '6f3e2e48-b8a9-4e30-890a-995acbaac768';
    const body: ArchiveLearningCandidateRequest = {};
    const candidate = { id, status: 'archived' };
    archive.mockResolvedValue(candidate);

    const response = await controller.archive(id, body);

    expect(archive).toHaveBeenCalledWith(id, body);
    expect(response).toEqual({ success: true, data: candidate });
  });

  it('bulk rejects candidates', async () => {
    const body: BulkRejectLearningCandidatesRequest = {
      candidate_ids: ['c1'],
      reason: 'stale batch',
    };
    bulkReject.mockResolvedValue([{ id: 'c1', status: 'rejected' }]);

    const response = await controller.bulkReject(body);

    expect(bulkReject).toHaveBeenCalledWith(body);
    expect(response.success).toBe(true);
    expect(response.data).toHaveLength(1);
  });

  it('bulk archives candidates', async () => {
    const body: BulkArchiveLearningCandidatesRequest = {
      candidate_ids: ['c1'],
    };
    bulkArchive.mockResolvedValue([{ id: 'c1', status: 'archived' }]);

    const response = await controller.bulkArchive(body);

    expect(bulkArchive).toHaveBeenCalledWith(body);
    expect(response.data).toHaveLength(1);
  });

  it('bulk promotes candidates', async () => {
    const body: BulkPromoteLearningCandidatesRequest = {
      candidate_ids: ['c1'],
    };
    bulkPromote.mockResolvedValue([
      { candidateId: 'c1', result: { status: 'promoted' } },
    ]);

    const response = await controller.bulkPromote(body);

    expect(bulkPromote).toHaveBeenCalledWith(['c1'], {
      requestedBy: undefined,
    });
    expect(response.data).toHaveLength(1);
  });

  it('bulk promotes candidates and returns sparse results', async () => {
    const body: BulkPromoteLearningCandidatesRequest = {
      candidate_ids: ['c1', 'c2'],
    };
    const policyDecision = {
      approved: true,
      code: 'approved' as const,
      reasons: ['candidate meets promotion threshold'],
    };
    bulkPromote.mockResolvedValue([
      {
        candidateId: 'c1',
        result: {
          candidate_id: '00000000-0000-4000-8000-000000000001',
          memory_segment_id: '00000000-0000-4000-8000-000000000002',
          status: 'promoted',
          policy_decision: policyDecision,
          candidate: { id: '00000000-0000-4000-8000-000000000001' },
          memory_segment: { id: '00000000-0000-4000-8000-000000000002' },
        },
      },
      { candidateId: 'c2', error: 'candidate not found' },
    ]);

    const response = await controller.bulkPromote(body);

    expect(response.data).toHaveLength(2);
    expect(response.data[0].result).toEqual({
      candidate_id: '00000000-0000-4000-8000-000000000001',
      memory_segment_id: '00000000-0000-4000-8000-000000000002',
      status: 'promoted',
      policy_decision: policyDecision,
    });
    expect(response.data[0].result).not.toHaveProperty('candidate');
    expect(response.data[0].result).not.toHaveProperty('memory_segment');
    expect(response.data[1]).toEqual({
      candidateId: 'c2',
      error: 'candidate not found',
    });
  });

  it('uses JwtAuthGuard and PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      LearningController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });
});
