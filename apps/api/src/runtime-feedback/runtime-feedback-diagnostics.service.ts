import { Injectable } from '@nestjs/common';
import { runtimeFeedbackSignalTypeSchema } from '@nexus/core';
import { z } from 'zod';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import type {
  RuntimeFeedbackDiagnosticsQuery,
  RuntimeFeedbackDiagnosticsResponse,
} from './runtime-feedback-diagnostics.types';

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;
const MAX_LIMIT = 100;

const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
}, z.boolean());

export const runtimeFeedbackDiagnosticsQuerySchema = z
  .object({
    signalType: runtimeFeedbackSignalTypeSchema.optional(),
    candidateCreated: booleanQuerySchema.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(DEFAULT_OFFSET),
  })
  .strict();

export class RuntimeFeedbackDiagnosticsQueryDto implements RuntimeFeedbackDiagnosticsQuery {
  static readonly schema = runtimeFeedbackDiagnosticsQuerySchema;

  signalType?: RuntimeFeedbackDiagnosticsQuery['signalType'];

  candidateCreated?: RuntimeFeedbackDiagnosticsQuery['candidateCreated'];

  limit: RuntimeFeedbackDiagnosticsQuery['limit'] = DEFAULT_LIMIT;

  offset: RuntimeFeedbackDiagnosticsQuery['offset'] = DEFAULT_OFFSET;
}

@Injectable()
export class RuntimeFeedbackDiagnosticsService {
  constructor(private readonly groups: RuntimeFeedbackSignalGroupRepository) {}

  async getDiagnostics(
    query: RuntimeFeedbackDiagnosticsQuery,
  ): Promise<RuntimeFeedbackDiagnosticsResponse> {
    const countFilters = {
      signalType: query.signalType,
      candidateCreated: query.candidateCreated,
    };
    const [{ data, total }, counts] = await Promise.all([
      this.groups.listDiagnostics(query),
      this.groups.listDiagnosticCounts(countFilters),
    ]);

    return {
      total,
      limit: query.limit,
      offset: query.offset,
      signalCounts: counts.signalCounts,
      candidateCounts: counts.candidateCounts,
      skippedReasonCounts: counts.skippedReasonCounts,
      recentGroups: data.map((group) => ({
        id: group.id,
        signalType: group.signal_type,
        dedupeFingerprint: group.dedupe_fingerprint,
        occurrenceCount: group.occurrence_count,
        windowOccurrenceCount: group.window_occurrence_count,
        windowStartedAt: group.window_started_at.toISOString(),
        candidateId: group.candidateId,
        lastSkippedReason: group.last_skipped_reason,
        lastSeenAt: group.last_seen_at.toISOString(),
      })),
    };
  }
}
