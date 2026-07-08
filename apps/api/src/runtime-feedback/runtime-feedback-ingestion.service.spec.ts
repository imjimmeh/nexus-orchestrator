import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { LearningCandidateRepository } from '../memory/database/repositories/learning-candidate.repository';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from './runtime-feedback-ingestion.service';
import { RuntimeFeedbackPolicyService } from './runtime-feedback-policy.service';
import { RuntimeFeedbackRedactionService } from './runtime-feedback-redaction.service';
import {
  RUNTIME_FEEDBACK_CANDIDATE_TYPE,
  RUNTIME_FEEDBACK_EVENT_NAMES,
} from './runtime-feedback.types';

interface MockGroup {
  id: string;
  dedupe_fingerprint: string;
  signal_type: string;
  source_module: string;
  scope_type: string;
  scopeId: string | null;
  actor_json: Record<string, unknown>;
  affected_json: Record<string, unknown>;
  evidence_json: Array<Record<string, unknown>>;
  examples_json: Array<Record<string, unknown>>;
  occurrence_count: number;
  window_occurrence_count: number;
  max_confidence: number;
  max_severity: string;
  first_seen_at: Date;
  window_started_at: Date;
  last_seen_at: Date;
  candidateId: string | null;
  candidate_created_at: Date | null;
  cooldown_until: Date | null;
  last_skipped_reason: string | null;
  diagnostics_json: Record<string, unknown> | null;
}

describe('RuntimeFeedbackIngestionService', () => {
  let service: RuntimeFeedbackIngestionService;
  let storedGroup: MockGroup | null;
  let groupSequence: number;
  let candidateSequence: number;
  let groups: {
    findByFingerprint: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
    incrementOccurrence: ReturnType<typeof vi.fn>;
    updateGroup: ReturnType<typeof vi.fn>;
    updateSkippedMetadataIfCandidateMissing: ReturnType<typeof vi.fn>;
  };
  let candidates: {
    create: ReturnType<typeof vi.fn>;
    findByFingerprint: ReturnType<typeof vi.fn>;
  };
  let eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    storedGroup = null;
    groupSequence = 1;
    candidateSequence = 1;
    groups = {
      findByFingerprint: vi.fn(() => Promise.resolve(storedGroup)),
      createGroup: vi.fn((data: Partial<MockGroup>) => {
        storedGroup = {
          id: `group-${groupSequence++}`,
          dedupe_fingerprint: data.dedupe_fingerprint ?? '',
          signal_type: data.signal_type ?? '',
          source_module: data.source_module ?? '',
          scope_type: data.scope_type ?? '',
          scopeId: data.scopeId ?? null,
          actor_json: data.actor_json ?? {},
          affected_json: data.affected_json ?? {},
          evidence_json: data.evidence_json ?? [],
          examples_json: data.examples_json ?? [],
          occurrence_count: data.occurrence_count ?? 0,
          window_occurrence_count: data.window_occurrence_count ?? 0,
          max_confidence: data.max_confidence ?? 0,
          max_severity: data.max_severity ?? 'low',
          first_seen_at: data.first_seen_at ?? new Date(),
          window_started_at: data.window_started_at ?? new Date(),
          last_seen_at: data.last_seen_at ?? new Date(),
          candidateId: data.candidateId ?? null,
          candidate_created_at: data.candidate_created_at ?? null,
          cooldown_until: data.cooldown_until ?? null,
          last_skipped_reason: data.last_skipped_reason ?? null,
          diagnostics_json: data.diagnostics_json ?? null,
        };
        return Promise.resolve(storedGroup);
      }),
      incrementOccurrence: vi.fn(
        (
          _id: string,
          data: {
            evidence: Array<Record<string, unknown>>;
            examples: Array<Record<string, unknown>>;
            confidence: number;
            severity: string;
            lastSeenAt: Date;
          },
        ) => {
          if (!storedGroup) {
            return Promise.resolve(null);
          }

          const severityRank: Record<string, number> = {
            low: 1,
            medium: 2,
            high: 3,
            critical: 4,
          };
          storedGroup = {
            ...storedGroup,
            evidence_json: [...storedGroup.evidence_json, ...data.evidence],
            examples_json: [...storedGroup.examples_json, ...data.examples],
            occurrence_count: storedGroup.occurrence_count + 1,
            window_occurrence_count: storedGroup.window_occurrence_count + 1,
            max_confidence: Math.max(
              storedGroup.max_confidence,
              data.confidence,
            ),
            max_severity:
              (severityRank[data.severity] ?? 0) >
              (severityRank[storedGroup.max_severity] ?? 0)
                ? data.severity
                : storedGroup.max_severity,
            last_seen_at: data.lastSeenAt,
          };
          return Promise.resolve(storedGroup);
        },
      ),
      updateGroup: vi.fn((_id: string, data: Partial<MockGroup>) => {
        if (!storedGroup) {
          return Promise.resolve(null);
        }
        storedGroup = { ...storedGroup, ...data };
        return Promise.resolve(storedGroup);
      }),
      updateSkippedMetadataIfCandidateMissing: vi.fn(
        (_id: string, data: Partial<MockGroup>) => {
          if (!storedGroup) {
            return Promise.resolve(null);
          }

          if (storedGroup.candidateId) {
            return Promise.resolve(storedGroup);
          }

          storedGroup = { ...storedGroup, ...data };
          return Promise.resolve(storedGroup);
        },
      ),
    };
    candidates = {
      create: vi.fn((data: Record<string, unknown>) =>
        Promise.resolve({
          id: `candidate-${candidateSequence++}`,
          ...data,
        }),
      ),
      findByFingerprint: vi.fn(() => Promise.resolve(null)),
    };
    eventLedger = { emitBestEffort: vi.fn(() => Promise.resolve(undefined)) };

    const module = await Test.createTestingModule({
      providers: [
        RuntimeFeedbackIngestionService,
        RuntimeFeedbackPolicyService,
        RuntimeFeedbackRedactionService,
        { provide: RuntimeFeedbackSignalGroupRepository, useValue: groups },
        { provide: LearningCandidateRepository, useValue: candidates },
        { provide: EventLedgerService, useValue: eventLedger },
      ],
    }).compile();

    service = module.get(RuntimeFeedbackIngestionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a group and skips candidate creation below frequency threshold', async () => {
    const result = await service.ingest(buildSignal());

    expect(result).toEqual({
      groupId: 'group-1',
      candidateId: null,
      promoted: false,
      skippedReason: 'frequency_below_threshold',
    });
    expect(groups.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence_count: 1,
        window_occurrence_count: 1,
        evidence_json: [
          { kind: 'event_ledger', id: 'event-1', summary: 'Safe evidence.' },
        ],
        examples_json: [{ summary: 'Safe example.', redacted: true }],
      }),
    );
    expect(
      groups.updateSkippedMetadataIfCandidateMissing,
    ).toHaveBeenLastCalledWith(
      'group-1',
      expect.objectContaining({
        last_skipped_reason: 'frequency_below_threshold',
        diagnostics_json: {
          dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          latest_occurrence_at: '2026-05-17T00:00:00.000Z',
          occurrence_count: 1,
          signal_type: 'tool_contract_repair',
          skipped_reason: 'frequency_below_threshold',
          source_module: 'tool-runtime',
          window_occurrence_count: 1,
          window_started_at: '2026-05-17T00:00:00.000Z',
        },
      }),
    );
    expect(candidates.create).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalIngested,
        payload: expect.objectContaining({ occurrence_count: 1 }),
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalSkipped,
        payload: {
          group_id: 'group-1',
          signal_type: 'tool_contract_repair',
          skipped_reason: 'frequency_below_threshold',
        },
      }),
    );
  });

  it('throws when recording a skipped reason cannot reload the group', async () => {
    groups.updateSkippedMetadataIfCandidateMissing.mockResolvedValueOnce(null);

    await expect(service.ingest(buildSignal())).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('creates exactly one pending runtime feedback candidate on the third equivalent signal', async () => {
    await service.ingest(buildSignal());
    await service.ingest(
      buildSignal({ occurred_at: '2026-05-17T00:01:00.000Z' }),
    );
    const promoted = await service.ingest(
      buildSignal({ occurred_at: '2026-05-17T00:02:00.000Z' }),
    );
    const duplicate = await service.ingest(
      buildSignal({ occurred_at: '2026-05-17T00:03:00.000Z' }),
    );

    expect(promoted).toEqual({
      groupId: 'group-1',
      candidateId: 'candidate-1',
      promoted: true,
      skippedReason: null,
    });
    expect(duplicate).toEqual({
      groupId: 'group-1',
      candidateId: 'candidate-1',
      promoted: false,
      skippedReason: 'candidate_exists',
    });
    expect(candidates.create).toHaveBeenCalledTimes(1);
    expect(candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_type: RUNTIME_FEEDBACK_CANDIDATE_TYPE,
        status: 'pending',
        recurrence_count: 3,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('delegates existing-group occurrence updates to the atomic repository method', async () => {
    await service.ingest(buildSignal());

    const result = await service.ingest(
      buildSignal({
        confidence: 0.5,
        severity: 'high',
        occurred_at: '2026-05-17T00:01:00.000Z',
        evidence: [
          { kind: 'event_ledger', id: 'event-2', summary: 'Safe later.' },
        ],
        examples: [{ summary: 'Safe later example.', redacted: true }],
      }),
    );

    expect(result).toEqual({
      groupId: 'group-1',
      candidateId: null,
      promoted: false,
      skippedReason: 'confidence_below_threshold',
    });
    expect(groups.incrementOccurrence).toHaveBeenCalledWith('group-1', {
      evidence: [
        { kind: 'event_ledger', id: 'event-2', summary: 'Safe later.' },
      ],
      examples: [{ summary: 'Safe later example.', redacted: true }],
      confidence: 0.5,
      severity: 'high',
      lastSeenAt: new Date('2026-05-17T00:01:00.000Z'),
      maxEvidenceItems: 20,
      maxExampleItems: 10,
    });
    expect(groups.updateGroup).not.toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({ occurrence_count: 2 }),
    );
    expect(storedGroup).toEqual(
      expect.objectContaining({
        occurrence_count: 2,
        window_occurrence_count: 2,
        max_confidence: 0.9,
        max_severity: 'high',
      }),
    );
  });

  it('treats candidate fingerprint unique violations as existing candidates', async () => {
    const existingCandidate = { id: 'candidate-existing' };
    const uniqueViolation = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    candidates.create.mockRejectedValueOnce(uniqueViolation);
    candidates.findByFingerprint.mockResolvedValueOnce(existingCandidate);

    await service.ingest(buildSignal());
    await service.ingest(buildSignal());
    const result = await service.ingest(buildSignal());

    expect(result).toEqual({
      groupId: 'group-1',
      candidateId: 'candidate-existing',
      promoted: false,
      skippedReason: 'candidate_exists',
    });
    expect(candidates.findByFingerprint).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(groups.updateGroup).toHaveBeenLastCalledWith(
      'group-1',
      expect.objectContaining({
        candidateId: 'candidate-existing',
        last_skipped_reason: 'candidate_exists',
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalSkipped,
        payload: {
          group_id: 'group-1',
          signal_type: 'tool_contract_repair',
          skipped_reason: 'candidate_exists',
        },
      }),
    );
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.candidateCreated,
      }),
    );
  });

  it('promotes long incoming dedupe fingerprints as 64-character hex candidate fingerprints', async () => {
    const longFingerprint = `tool:set_job_output:data:${'x'.repeat(450)}`;

    await service.ingest(buildSignal({ dedupe_fingerprint: longFingerprint }));
    await service.ingest(buildSignal({ dedupe_fingerprint: longFingerprint }));
    await service.ingest(buildSignal({ dedupe_fingerprint: longFingerprint }));

    expect(candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(candidates.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        fingerprint: expect.not.stringContaining('x'),
      }),
    );
    expect(storedGroup?.dedupe_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not expose raw unsafe dedupe text in candidates or emitted events', async () => {
    const unsafeFingerprint = 'tool:set_job_output:data:api_key=secret';

    await service.ingest(
      buildSignal({ dedupe_fingerprint: unsafeFingerprint }),
    );
    await service.ingest(
      buildSignal({ dedupe_fingerprint: unsafeFingerprint }),
    );
    await service.ingest(
      buildSignal({ dedupe_fingerprint: unsafeFingerprint }),
    );

    const candidatePayload = candidates.create.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(candidatePayload.summary).not.toContain('api_key=secret');
    expect(JSON.stringify(candidatePayload.signals_json)).not.toContain(
      'api_key=secret',
    );
    expect(JSON.stringify(candidatePayload.diagnostics_json)).not.toContain(
      'api_key=secret',
    );
    expect(JSON.stringify(eventLedger.emitBestEffort.mock.calls)).not.toContain(
      'api_key=secret',
    );
    expect(candidatePayload.signals_json).toEqual(
      expect.objectContaining({
        dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(candidatePayload.diagnostics_json).toEqual(
      expect.objectContaining({
        dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('records safe diagnostics for skipped low-confidence signals', async () => {
    const unsafeFingerprint = 'tool:set_job_output:data:api_key=secret';

    await service.ingest(
      buildSignal({
        confidence: 0.5,
        dedupe_fingerprint: unsafeFingerprint,
        evidence: [
          {
            kind: 'event_ledger',
            id: 'event-1',
            summary: 'authorization: Bearer token',
          },
        ],
        occurred_at: '2026-05-17T00:00:00.000Z',
      }),
    );
    await service.ingest(
      buildSignal({
        confidence: 0.6,
        dedupe_fingerprint: unsafeFingerprint,
        occurred_at: '2026-05-17T00:01:00.000Z',
      }),
    );

    expect(storedGroup?.diagnostics_json).toEqual({
      dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      latest_occurrence_at: '2026-05-17T00:01:00.000Z',
      occurrence_count: 2,
      signal_type: 'tool_contract_repair',
      skipped_reason: 'confidence_below_threshold',
      source_module: 'tool-runtime',
      window_occurrence_count: 2,
      window_started_at: '2026-05-17T00:00:00.000Z',
    });
    expect(JSON.stringify(storedGroup?.diagnostics_json)).not.toContain(
      'api_key=secret',
    );
    expect(JSON.stringify(storedGroup?.diagnostics_json)).not.toContain(
      'Bearer token',
    );
    expect(candidates.create).not.toHaveBeenCalled();
  });

  it('replaces skipped diagnostics with promotion-safe diagnostics when creating a candidate', async () => {
    const unsafeFingerprint = 'tool:set_job_output:data:api_key=secret';

    await service.ingest(
      buildSignal({
        dedupe_fingerprint: unsafeFingerprint,
        occurred_at: '2026-05-17T00:00:00.000Z',
      }),
    );
    await service.ingest(
      buildSignal({
        dedupe_fingerprint: unsafeFingerprint,
        occurred_at: '2026-05-17T00:01:00.000Z',
      }),
    );

    expect(storedGroup?.diagnostics_json).toEqual(
      expect.objectContaining({
        skipped_reason: 'frequency_below_threshold',
      }),
    );

    await service.ingest(
      buildSignal({
        dedupe_fingerprint: unsafeFingerprint,
        occurred_at: '2026-05-17T00:02:00.000Z',
      }),
    );

    expect(storedGroup).toEqual(
      expect.objectContaining({
        candidateId: 'candidate-1',
        last_skipped_reason: null,
        diagnostics_json: {
          dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          occurrence_count: 3,
          promoted_at: '2026-05-17T00:02:00.000Z',
          promoted_candidate_id: 'candidate-1',
          signal_type: 'tool_contract_repair',
          skipped_reason: null,
          source_module: 'tool-runtime',
          window_occurrence_count: 3,
          window_started_at: '2026-05-17T00:00:00.000Z',
        },
      }),
    );
    expect(JSON.stringify(storedGroup?.diagnostics_json)).not.toContain(
      'api_key=secret',
    );
  });

  it('does not overwrite candidate-linked groups with stale skipped diagnostics', async () => {
    const candidateLinkedGroup = {
      ...storedGroup,
      id: 'group-1',
      candidateId: 'candidate-race',
      diagnostics_json: {
        promoted_candidate_id: 'candidate-race',
        skipped_reason: null,
      },
      last_skipped_reason: null,
    } as MockGroup;
    groups.updateSkippedMetadataIfCandidateMissing.mockResolvedValueOnce(
      candidateLinkedGroup,
    );

    const result = await service.ingest(buildSignal({ confidence: 0.5 }));

    expect(result).toEqual({
      groupId: 'group-1',
      candidateId: 'candidate-race',
      promoted: false,
      skippedReason: 'candidate_exists',
    });
    expect(groups.updateGroup).not.toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({
        last_skipped_reason: 'confidence_below_threshold',
      }),
    );
    expect(candidateLinkedGroup.diagnostics_json).toEqual({
      promoted_candidate_id: 'candidate-race',
      skipped_reason: null,
    });
  });

  it('resets the occurrence window without losing lifetime count when the window expires', async () => {
    await service.ingest(
      buildSignal({ occurred_at: '2026-05-10T11:59:59.999Z' }),
    );
    await service.ingest(
      buildSignal({ occurred_at: '2026-05-11T12:00:00.000Z' }),
    );

    const result = await service.ingest(
      buildSignal({ occurred_at: '2026-05-17T12:00:00.000Z' }),
    );

    expect(result).toEqual({
      groupId: 'group-1',
      candidateId: null,
      promoted: false,
      skippedReason: 'frequency_window_expired',
    });
    expect(storedGroup).toEqual(
      expect.objectContaining({
        occurrence_count: 3,
        window_occurrence_count: 1,
        window_started_at: new Date('2026-05-17T12:00:00.000Z'),
        last_skipped_reason: 'frequency_window_expired',
      }),
    );
    expect(storedGroup?.diagnostics_json).toEqual(
      expect.objectContaining({
        occurrence_count: 3,
        skipped_reason: 'frequency_window_expired',
        window_occurrence_count: 1,
        window_started_at: '2026-05-17T12:00:00.000Z',
      }),
    );
    expect(candidates.create).not.toHaveBeenCalled();
  });

  it('stores redacted evidence and examples in the group and candidate', async () => {
    await service.ingest(
      buildSignal({
        evidence: [
          {
            kind: 'event_ledger',
            id: 'event-1',
            summary: 'authorization: Bearer token',
          },
        ],
        examples: [{ summary: 'raw transcript follows', redacted: true }],
      }),
    );
    await service.ingest(
      buildSignal({
        evidence: [
          { kind: 'event_ledger', id: 'event-2', summary: 'Safe evidence.' },
        ],
        examples: [{ summary: 'Safe example.', redacted: true }],
      }),
    );
    await service.ingest(
      buildSignal({
        evidence: [
          { kind: 'event_ledger', id: 'event-3', summary: 'password=abc123' },
        ],
        examples: [{ summary: 'secret: abc123', redacted: true }],
      }),
    );

    expect(storedGroup?.evidence_json).toEqual([
      { kind: 'event_ledger', id: 'event-1', summary: '[REDACTED]' },
      { kind: 'event_ledger', id: 'event-2', summary: 'Safe evidence.' },
      { kind: 'event_ledger', id: 'event-3', summary: '[REDACTED]' },
    ]);
    expect(storedGroup?.examples_json).toEqual([
      { summary: '[REDACTED]', redacted: true },
      { summary: 'Safe example.', redacted: true },
      { summary: '[REDACTED]', redacted: true },
    ]);
    expect(candidates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        signals_json: expect.objectContaining({
          evidence: storedGroup?.evidence_json,
          examples: storedGroup?.examples_json,
        }),
      }),
    );
    expect(JSON.stringify(candidates.create.mock.calls)).not.toContain(
      'Bearer token',
    );
    expect(JSON.stringify(candidates.create.mock.calls)).not.toContain(
      'password=abc123',
    );
    expect(JSON.stringify(candidates.create.mock.calls)).not.toContain(
      'raw transcript follows',
    );
  });

  it('emits ingested, skipped, and candidate created events with safe payloads', async () => {
    await service.ingest(buildSignal());
    await service.ingest(buildSignal());
    await service.ingest(buildSignal());

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalIngested,
        payload: {
          group_id: 'group-1',
          signal_type: 'tool_contract_repair',
          dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          occurrence_count: 3,
        },
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalSkipped,
        payload: {
          group_id: 'group-1',
          signal_type: 'tool_contract_repair',
          skipped_reason: 'frequency_below_threshold',
        },
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: RUNTIME_FEEDBACK_EVENT_NAMES.candidateCreated,
        payload: {
          group_id: 'group-1',
          candidate_id: 'candidate-1',
          signal_type: 'tool_contract_repair',
          dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }),
    );
    expect(JSON.stringify(eventLedger.emitBestEffort.mock.calls)).not.toContain(
      'Safe example.',
    );
  });
});

function buildSignal(
  overrides: Partial<RuntimeFeedbackSignal> = {},
): RuntimeFeedbackSignal {
  return {
    signal_type: 'tool_contract_repair',
    source_module: 'tool-runtime',
    scope: { scope_type: 'workflow_run', scope_id: 'run-1' },
    actor: { agent_profile: 'sysadmin' },
    affected: {
      tool_name: 'set_job_output',
      workflow_id: 'workflow-1',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      schema_path: 'data',
    },
    evidence: [
      { kind: 'event_ledger', id: 'event-1', summary: 'Safe evidence.' },
    ],
    examples: [{ summary: 'Safe example.', redacted: true }],
    confidence: 0.9,
    severity: 'medium',
    dedupe_fingerprint: 'feedback-fingerprint-1',
    occurred_at: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}
