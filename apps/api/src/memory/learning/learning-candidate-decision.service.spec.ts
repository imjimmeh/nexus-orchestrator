import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkActionError } from '../../common/errors/bulk-action.error';
import { LearningCandidateDecisionService } from './learning-candidate-decision.service';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { EventLedgerService } from '../../observability/event-ledger.service';

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate-1',
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'runtime_learning',
    title: 't',
    summary: 's',
    fingerprint: 'fp',
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    status: 'rejected',
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    last_seen_at: new Date('2026-06-01T00:00:00.000Z'),
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('LearningCandidateDecisionService', () => {
  const rejectById = vi.fn();
  const archiveById = vi.fn();
  const bulkReject = vi.fn();
  const bulkArchive = vi.fn();
  const findById = vi.fn();
  const emitBestEffort = vi.fn().mockResolvedValue(undefined);

  let service: LearningCandidateDecisionService;

  beforeEach(() => {
    vi.clearAllMocks();
    emitBestEffort.mockResolvedValue(undefined);
    service = new LearningCandidateDecisionService(
      {
        rejectById,
        archiveById,
        bulkReject,
        bulkArchive,
        findById,
      } as unknown as LearningCandidateRepository,
      { emitBestEffort } as unknown as EventLedgerService,
    );
  });

  it('rejects a pending candidate', async () => {
    const rejected = createCandidate({
      rejected_by: 'reviewer-1',
      rejection_reason: 'x',
    });
    rejectById.mockResolvedValue(rejected);

    const result = await service.reject('candidate-1', {
      reason: 'x',
      rejected_by: 'reviewer-1',
    });

    expect(rejectById).toHaveBeenCalledWith('candidate-1', {
      rejectedBy: 'reviewer-1',
      reason: 'x',
    });
    expect(result.status).toBe('rejected');
    expect(emitBestEffort).toHaveBeenCalled();
  });

  it('throws NotFoundException rejecting a missing candidate', async () => {
    rejectById.mockResolvedValue(null);
    findById.mockResolvedValue(null);

    await expect(service.reject('missing', { reason: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException rejecting a non-pending candidate', async () => {
    rejectById.mockResolvedValue(null);
    findById.mockResolvedValue(createCandidate({ status: 'promoted' }));

    await expect(
      service.reject('candidate-1', { reason: 'x' }),
    ).rejects.toThrow(ConflictException);
  });

  it('archives a pending candidate', async () => {
    const archived = createCandidate({
      status: 'archived',
      archived_by: 'reviewer-2',
    });
    archiveById.mockResolvedValue(archived);

    const result = await service.archive('candidate-1', {
      archived_by: 'reviewer-2',
    });

    expect(archiveById).toHaveBeenCalledWith('candidate-1', {
      archivedBy: 'reviewer-2',
      reason: null,
    });
    expect(result.status).toBe('archived');
  });

  it('bulk rejects candidates', async () => {
    const rejected = [createCandidate()];
    bulkReject.mockResolvedValue(rejected);

    const result = await service.bulkReject({
      candidate_ids: ['candidate-1'],
      reason: 'batch reason',
    });

    expect(bulkReject).toHaveBeenCalledWith(['candidate-1'], {
      rejectedBy: null,
      reason: 'batch reason',
    });
    expect(result).toHaveLength(1);
  });

  it('translates BulkActionError into ConflictException on bulk reject', async () => {
    bulkReject.mockRejectedValue(
      new BulkActionError('invalid_status', ['candidate-1']),
    );

    await expect(
      service.bulkReject({ candidate_ids: ['candidate-1'], reason: 'x' }),
    ).rejects.toThrow(ConflictException);
  });

  it('bulk archives candidates', async () => {
    const archived = [createCandidate({ status: 'archived' })];
    bulkArchive.mockResolvedValue(archived);

    const result = await service.bulkArchive({
      candidate_ids: ['candidate-1'],
    });

    expect(bulkArchive).toHaveBeenCalledWith(['candidate-1'], {
      archivedBy: null,
      reason: null,
    });
    expect(result).toHaveLength(1);
  });
});
