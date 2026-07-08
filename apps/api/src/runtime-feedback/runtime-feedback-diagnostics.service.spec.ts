import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeFeedbackSignalGroup } from '../runtime/database/entities/runtime-feedback-signal-group.entity';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { RuntimeFeedbackDiagnosticsService } from './runtime-feedback-diagnostics.service';

describe('RuntimeFeedbackDiagnosticsService', () => {
  const listDiagnostics = vi.fn();
  const listDiagnosticCounts = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns sparse diagnostics grouped by signal type, candidate state, and skipped reason', async () => {
    listDiagnostics.mockResolvedValue({
      data: [
        createFeedbackGroup({
          id: 'group-1',
          dedupe_fingerprint: 'fingerprint-a',
          signal_type: 'workflow_anomaly',
          occurrence_count: 4,
          window_occurrence_count: 2,
          window_started_at: new Date('2026-05-17T09:00:00.000Z'),
          candidateId: 'candidate-1',
          candidate_created_at: new Date('2026-05-17T10:00:00.000Z'),
          last_skipped_reason: 'candidate_exists',
          last_seen_at: new Date('2026-05-17T10:05:00.000Z'),
          evidence_json: [{ summary: 'raw evidence must not leak' }],
          examples_json: [{ summary: 'raw example must not leak' }],
          diagnostics_json: { raw: true },
        }),
        createFeedbackGroup({
          id: 'group-2',
          dedupe_fingerprint: 'fingerprint-b',
          signal_type: 'memory_miss',
          occurrence_count: 2,
          candidateId: null,
          candidate_created_at: null,
          last_skipped_reason: 'frequency_below_threshold',
          last_seen_at: new Date('2026-05-17T10:04:00.000Z'),
        }),
        createFeedbackGroup({
          id: 'group-3',
          dedupe_fingerprint: 'fingerprint-c',
          signal_type: 'workflow_anomaly',
          occurrence_count: 1,
          candidateId: null,
          candidate_created_at: null,
          last_skipped_reason: 'frequency_below_threshold',
          last_seen_at: new Date('2026-05-17T10:03:00.000Z'),
        }),
      ],
      total: 3,
    });
    listDiagnosticCounts.mockResolvedValue({
      signalCounts: [
        { signalType: 'workflow_anomaly', count: 5 },
        { signalType: 'memory_miss', count: 2 },
      ],
      candidateCounts: [
        { candidateCreated: true, count: 1 },
        { candidateCreated: false, count: 2 },
      ],
      skippedReasonCounts: [
        { reason: 'frequency_below_threshold', count: 2 },
        { reason: 'candidate_exists', count: 1 },
      ],
    });
    const service = await createService();

    const result = await service.getDiagnostics({ limit: 10, offset: 0 });

    expect(listDiagnostics).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(listDiagnosticCounts).toHaveBeenCalledWith({});
    expect(result).toEqual({
      total: 3,
      limit: 10,
      offset: 0,
      signalCounts: [
        { signalType: 'workflow_anomaly', count: 5 },
        { signalType: 'memory_miss', count: 2 },
      ],
      candidateCounts: [
        { candidateCreated: true, count: 1 },
        { candidateCreated: false, count: 2 },
      ],
      skippedReasonCounts: [
        { reason: 'frequency_below_threshold', count: 2 },
        { reason: 'candidate_exists', count: 1 },
      ],
      recentGroups: [
        {
          id: 'group-1',
          signalType: 'workflow_anomaly',
          dedupeFingerprint: 'fingerprint-a',
          occurrenceCount: 4,
          windowOccurrenceCount: 2,
          windowStartedAt: '2026-05-17T09:00:00.000Z',
          candidateId: 'candidate-1',
          lastSkippedReason: 'candidate_exists',
          lastSeenAt: '2026-05-17T10:05:00.000Z',
        },
        {
          id: 'group-2',
          signalType: 'memory_miss',
          dedupeFingerprint: 'fingerprint-b',
          occurrenceCount: 2,
          windowOccurrenceCount: 1,
          windowStartedAt: '2026-05-17T10:00:00.000Z',
          candidateId: null,
          lastSkippedReason: 'frequency_below_threshold',
          lastSeenAt: '2026-05-17T10:04:00.000Z',
        },
        {
          id: 'group-3',
          signalType: 'workflow_anomaly',
          dedupeFingerprint: 'fingerprint-c',
          occurrenceCount: 1,
          windowOccurrenceCount: 1,
          windowStartedAt: '2026-05-17T10:00:00.000Z',
          candidateId: null,
          lastSkippedReason: 'frequency_below_threshold',
          lastSeenAt: '2026-05-17T10:03:00.000Z',
        },
      ],
    });
    expect(result.recentGroups[0]).not.toHaveProperty('evidence_json');
    expect(result.recentGroups[0]).not.toHaveProperty('examples_json');
    expect(result.recentGroups[0]).not.toHaveProperty('diagnostics_json');
  });

  it('passes optional filters through to repository diagnostics', async () => {
    listDiagnostics.mockResolvedValue({ data: [], total: 0 });
    listDiagnosticCounts.mockResolvedValue({
      signalCounts: [],
      candidateCounts: [],
      skippedReasonCounts: [],
    });
    const service = await createService();

    await service.getDiagnostics({
      signalType: 'memory_miss',
      candidateCreated: false,
      limit: 25,
      offset: 50,
    });

    expect(listDiagnostics).toHaveBeenCalledWith({
      signalType: 'memory_miss',
      candidateCreated: false,
      limit: 25,
      offset: 50,
    });
    expect(listDiagnosticCounts).toHaveBeenCalledWith({
      signalType: 'memory_miss',
      candidateCreated: false,
    });
  });

  async function createService(): Promise<RuntimeFeedbackDiagnosticsService> {
    const module = await Test.createTestingModule({
      providers: [
        RuntimeFeedbackDiagnosticsService,
        {
          provide: RuntimeFeedbackSignalGroupRepository,
          useValue: { listDiagnostics, listDiagnosticCounts },
        },
      ],
    }).compile();

    return module.get(RuntimeFeedbackDiagnosticsService);
  }
});

function createFeedbackGroup(
  overrides: Partial<RuntimeFeedbackSignalGroup> = {},
): RuntimeFeedbackSignalGroup {
  return {
    id: 'group-1',
    dedupe_fingerprint: 'fingerprint-1',
    signal_type: 'workflow_anomaly',
    source_module: 'workflow-runtime',
    scope_type: 'workflow_run',
    scopeId: 'run-1',
    actor_json: {},
    affected_json: {},
    evidence_json: [],
    examples_json: [],
    occurrence_count: 1,
    window_occurrence_count: 1,
    max_confidence: 0.8,
    max_severity: 'high',
    first_seen_at: new Date('2026-05-17T10:00:00.000Z'),
    window_started_at: new Date('2026-05-17T10:00:00.000Z'),
    last_seen_at: new Date('2026-05-17T10:00:00.000Z'),
    candidateId: null,
    candidate_created_at: null,
    cooldown_until: null,
    last_skipped_reason: null,
    diagnostics_json: null,
    created_at: new Date('2026-05-17T10:00:00.000Z'),
    updated_at: new Date('2026-05-17T10:00:00.000Z'),
    ...overrides,
  };
}
