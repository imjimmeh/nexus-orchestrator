import { z } from 'zod';
import { runtimeFeedbackDiagnosticsQuerySchema } from './runtime-feedback-diagnostics.service';

export type RuntimeFeedbackDiagnosticsQuery = z.infer<
  typeof runtimeFeedbackDiagnosticsQuerySchema
>;

export interface RuntimeFeedbackDiagnosticsResponse {
  total: number;
  limit: number;
  offset: number;
  signalCounts: Array<{ signalType: string; count: number }>;
  candidateCounts: Array<{ candidateCreated: boolean; count: number }>;
  skippedReasonCounts: Array<{ reason: string; count: number }>;
  recentGroups: Array<{
    id: string;
    signalType: string;
    dedupeFingerprint: string;
    occurrenceCount: number;
    windowOccurrenceCount: number;
    windowStartedAt: string;
    candidateId: string | null;
    lastSkippedReason: string | null;
    lastSeenAt: string;
  }>;
}
