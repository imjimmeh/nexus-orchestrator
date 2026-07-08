import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  RejectLearningCandidateRequest,
} from '@nexus/core';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { BulkActionError } from '../../common/errors/bulk-action.error';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { toLearningCandidateListItem } from './learning.mapper';
import type { LearningCandidateListItem } from './learning.types';

@Injectable()
export class LearningCandidateDecisionService {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async reject(
    id: string,
    dto: RejectLearningCandidateRequest,
  ): Promise<LearningCandidateListItem> {
    const rejectedBy = dto.rejected_by ?? null;
    const updated = await this.candidates.rejectById(id, {
      rejectedBy,
      reason: dto.reason,
    });

    if (!updated) {
      return this.throwDecisionMiss(id);
    }

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateRejected,
      outcome: 'success',
      payload: { candidateId: updated.id, rejected_by: updated.rejected_by },
    });

    return toLearningCandidateListItem(updated);
  }

  async archive(
    id: string,
    dto: ArchiveLearningCandidateRequest,
  ): Promise<LearningCandidateListItem> {
    const archivedBy = dto.archived_by ?? null;
    const updated = await this.candidates.archiveById(id, {
      archivedBy,
      reason: dto.reason ?? null,
    });

    if (!updated) {
      return this.throwDecisionMiss(id);
    }

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateArchived,
      outcome: 'success',
      payload: { candidateId: updated.id, archived_by: updated.archived_by },
    });

    return toLearningCandidateListItem(updated);
  }

  async bulkReject(
    dto: BulkRejectLearningCandidatesRequest,
  ): Promise<LearningCandidateListItem[]> {
    const rejectedBy = dto.rejected_by ?? null;
    const updated = await this.runBulk(() =>
      this.candidates.bulkReject(dto.candidate_ids, {
        rejectedBy,
        reason: dto.reason,
      }),
    );

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateRejected,
      outcome: 'success',
      payload: {
        candidateIds: dto.candidate_ids,
        rejected_by: rejectedBy,
        bulk: true,
      },
    });

    return updated.map((candidate) => toLearningCandidateListItem(candidate));
  }

  async bulkArchive(
    dto: BulkArchiveLearningCandidatesRequest,
  ): Promise<LearningCandidateListItem[]> {
    const archivedBy = dto.archived_by ?? null;
    const updated = await this.runBulk(() =>
      this.candidates.bulkArchive(dto.candidate_ids, {
        archivedBy,
        reason: dto.reason ?? null,
      }),
    );

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateArchived,
      outcome: 'success',
      payload: {
        candidateIds: dto.candidate_ids,
        archived_by: archivedBy,
        bulk: true,
      },
    });

    return updated.map((candidate) => toLearningCandidateListItem(candidate));
  }

  private async runBulk<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BulkActionError) {
        throw new ConflictException(
          `Bulk action failed (${error.code}) for candidate(s): ${error.ids.join(', ')}`,
        );
      }
      throw error;
    }
  }

  private async throwDecisionMiss(id: string): Promise<never> {
    const candidate = await this.candidates.findById(id);
    if (!candidate) {
      throw new NotFoundException(`Learning candidate ${id} not found`);
    }

    throw new ConflictException(`Learning candidate ${id} is not pending`);
  }
}
