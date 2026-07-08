import { Test } from '@nestjs/testing';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningCandidate } from '../memory/database/entities/learning-candidate.entity';
import { RuntimeFeedbackSignalGroup } from '../runtime/database/entities/runtime-feedback-signal-group.entity';
import { LearningCandidateRepository } from '../memory/database/repositories/learning-candidate.repository';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { ToolContractRepairAdapter } from '../tool-runtime/tool-contract-repair.adapter';
import { RepairPolicyService } from '../workflow/workflow-repair/repair-policy.service';
import { WorkflowFailureClassificationService } from '../workflow/workflow-repair/workflow-failure-classification.service';
import { WorkflowFailureEvidenceCollectorService } from '../workflow/workflow-repair/workflow-failure-evidence.collector';
import { RuntimeFeedbackIngestionService } from './runtime-feedback-ingestion.service';
import { RuntimeFeedbackPolicyService } from './runtime-feedback-policy.service';
import { RuntimeFeedbackRedactionService } from './runtime-feedback-redaction.service';

describe('runtime feedback candidate creation integration', () => {
  let candidates: InMemoryLearningCandidateRepository;
  let groups: InMemoryRuntimeFeedbackGroupRepository;
  let eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };
  let evidenceCollector: { collect: ReturnType<typeof vi.fn> };
  let toolRepair: ToolContractRepairAdapter;
  let failureClassification: WorkflowFailureClassificationService;
  let ingestion: RuntimeFeedbackIngestionService;

  beforeEach(async () => {
    candidates = new InMemoryLearningCandidateRepository();
    groups = new InMemoryRuntimeFeedbackGroupRepository();
    eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
    evidenceCollector = { collect: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RuntimeFeedbackIngestionService,
        RuntimeFeedbackPolicyService,
        RuntimeFeedbackRedactionService,
        ToolContractRepairAdapter,
        WorkflowFailureClassificationService,
        RepairPolicyService,
        { provide: LearningCandidateRepository, useValue: candidates },
        { provide: RuntimeFeedbackSignalGroupRepository, useValue: groups },
        { provide: EventLedgerService, useValue: eventLedger },
        {
          provide: WorkflowFailureEvidenceCollectorService,
          useValue: evidenceCollector,
        },
      ],
    }).compile();

    toolRepair = module.get(ToolContractRepairAdapter);
    failureClassification = module.get(WorkflowFailureClassificationService);
    ingestion = module.get(RuntimeFeedbackIngestionService);
  });

  it('creates one candidate with linked feedback group diagnostics from three equivalent tool-contract repair signals', async () => {
    for (let index = 0; index < 7; index += 1) {
      await toolRepair.repair({
        toolName: 'set_job_output',
        workflowRunId: 'tool-run-1',
        jobId: 'tool-job-1',
        payload: { data: '{"decision":"accept"}' },
      });
    }

    const [candidate] = candidates.all();
    const [group] = groups.all();

    expect(candidates.all()).toHaveLength(1);
    expect(groups.all()).toHaveLength(1);
    expect(group).toEqual(
      expect.objectContaining({
        signal_type: 'tool_contract_repair',
        occurrence_count: 3,
        candidateId: candidate?.id,
        last_skipped_reason: null,
      }),
    );
    expect(candidate).toEqual(
      expect.objectContaining({
        recurrence_count: 3,
        diagnostics_json: {
          feedback_group_id: group?.id,
          dedupe_fingerprint_hash: group?.dedupe_fingerprint,
        },
      }),
    );
    expect(candidate?.signals_json).toEqual(
      expect.objectContaining({
        signal_type: 'tool_contract_repair',
        occurrence_count: 3,
        evidence: group?.evidence_json,
        examples: group?.examples_json,
      }),
    );
  });

  it('creates one candidate with linked evidence from three equivalent failure-classification signals', async () => {
    evidenceCollector.collect
      .mockResolvedValueOnce(buildFailureEvidence({ workflowRunId: 'run-1' }))
      .mockResolvedValueOnce(buildFailureEvidence({ workflowRunId: 'run-2' }))
      .mockResolvedValueOnce(buildFailureEvidence({ workflowRunId: 'run-3' }));

    await failureClassification.classifyRunFailure('run-1');
    await failureClassification.classifyRunFailure('run-2');
    await failureClassification.classifyRunFailure('run-3');

    const [candidate] = candidates.all();
    const [group] = groups.all();

    expect(candidates.all()).toHaveLength(1);
    expect(groups.all()).toHaveLength(1);
    expect(group).toEqual(
      expect.objectContaining({
        signal_type: 'failure_classification',
        occurrence_count: 3,
        candidateId: candidate?.id,
      }),
    );
    expect(group?.evidence_json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'failure_classification',
          summary: expect.stringContaining('dependency_missing'),
        }),
        expect.objectContaining({
          kind: 'event_ledger',
          id: 'event-run-1',
        }),
        expect.objectContaining({
          kind: 'event_ledger',
          id: 'event-run-2',
        }),
        expect.objectContaining({
          kind: 'event_ledger',
          id: 'event-run-3',
        }),
      ]),
    );
    expect(candidate).toEqual(
      expect.objectContaining({
        recurrence_count: 3,
        diagnostics_json: expect.objectContaining({
          feedback_group_id: group?.id,
        }),
      }),
    );
    expect(candidate?.signals_json).toEqual(
      expect.objectContaining({
        signal_type: 'failure_classification',
        evidence: group?.evidence_json,
      }),
    );
  });

  it('updates diagnostics for low-confidence signals without creating a candidate', async () => {
    await ingestion.ingest(buildSignal({ confidence: 0.5 }));
    await ingestion.ingest(
      buildSignal({
        confidence: 0.55,
        occurred_at: '2026-05-17T00:01:00.000Z',
      }),
    );
    await ingestion.ingest(
      buildSignal({
        confidence: 0.6,
        occurred_at: '2026-05-17T00:02:00.000Z',
        evidence: [
          {
            kind: 'event_ledger',
            id: 'event-3',
            summary: 'Safe later signal.',
          },
        ],
      }),
    );

    const [group] = groups.all();

    expect(candidates.all()).toEqual([]);
    expect(group).toEqual(
      expect.objectContaining({
        occurrence_count: 3,
        window_occurrence_count: 3,
        max_confidence: 0.6,
        candidateId: null,
        last_skipped_reason: 'confidence_below_threshold',
        diagnostics_json: {
          dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          latest_occurrence_at: '2026-05-17T00:02:00.000Z',
          occurrence_count: 3,
          signal_type: 'tool_contract_repair',
          skipped_reason: 'confidence_below_threshold',
          source_module: 'tool-runtime',
          window_occurrence_count: 3,
          window_started_at: '2026-05-17T00:00:00.000Z',
        },
      }),
    );
    expect(group?.evidence_json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'event-1' }),
        expect.objectContaining({ id: 'event-3' }),
      ]),
    );
    expect(JSON.stringify(group?.diagnostics_json)).not.toContain(
      'Safe later signal.',
    );
  });

  it('redacts raw secrets and tool payload summaries from candidate signals_json', async () => {
    const secretValue = 'sk-secret-value-that-must-not-leak';

    await ingestion.ingest(
      buildSignal({
        evidence: [
          {
            kind: 'event_ledger',
            id: 'event-1',
            summary: `authorization: Bearer ${secretValue}`,
          },
        ],
        examples: [{ summary: 'raw transcript follows', redacted: true }],
        dedupe_fingerprint: `tool_contract_repair|set_job_output|api_key=${secretValue}`,
      }),
    );
    await ingestion.ingest(
      buildSignal({
        evidence: [
          {
            kind: 'tool_payload',
            id: 'payload-1',
            summary: `raw job output: ${secretValue}`,
          },
        ],
        examples: [{ summary: `secret: ${secretValue}`, redacted: true }],
        dedupe_fingerprint: `tool_contract_repair|set_job_output|api_key=${secretValue}`,
        occurred_at: '2026-05-17T00:01:00.000Z',
      }),
    );
    await ingestion.ingest(
      buildSignal({
        evidence: [
          { kind: 'event_ledger', id: 'event-3', summary: 'Safe evidence.' },
        ],
        dedupe_fingerprint: `tool_contract_repair|set_job_output|api_key=${secretValue}`,
        occurred_at: '2026-05-17T00:02:00.000Z',
      }),
    );

    const [candidate] = candidates.all();
    const serializedSignals = JSON.stringify(candidate?.signals_json);

    expect(candidate).toBeDefined();
    expect(serializedSignals).not.toContain(secretValue);
    expect(serializedSignals).not.toContain('authorization: Bearer');
    expect(serializedSignals).not.toContain('raw job output');
    expect(serializedSignals).not.toContain('raw transcript follows');
    expect(serializedSignals).toContain('[REDACTED]');
    expect(candidate?.signals_json).toEqual(
      expect.objectContaining({
        dedupe_fingerprint_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});

class InMemoryLearningCandidateRepository {
  private readonly records = new Map<string, LearningCandidate>();
  private sequence = 1;

  create(data: Partial<LearningCandidate>): Promise<LearningCandidate> {
    if (
      data.fingerprint &&
      [...this.records.values()].some(
        (record) => record.fingerprint === data.fingerprint,
      )
    ) {
      throw Object.assign(new Error('duplicate candidate fingerprint'), {
        code: '23505',
      });
    }

    const now = new Date();
    const record = {
      id: `candidate-${this.sequence++}`,
      scope_type: 'global',
      scopeId: null,
      candidate_type: 'runtime_feedback',
      title: '',
      summary: '',
      fingerprint: '',
      signals_json: {},
      score: 0,
      confidence: 0,
      recurrence_count: 1,
      stage_diversity_count: 1,
      failure_reduction_relevance: 0,
      recency_decay: 1,
      source_quality_confidence: 0,
      status: 'pending',
      diagnostics_json: null,
      promoted_memory_segment_id: null,
      promoted_at: null,
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
      ...data,
    } satisfies LearningCandidate;

    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  findByFingerprint(fingerprint: string): Promise<LearningCandidate | null> {
    return Promise.resolve(
      [...this.records.values()].find(
        (record) => record.fingerprint === fingerprint,
      ) ?? null,
    );
  }

  all(): LearningCandidate[] {
    return [...this.records.values()];
  }
}

class InMemoryRuntimeFeedbackGroupRepository {
  private readonly records = new Map<string, RuntimeFeedbackSignalGroup>();
  private sequence = 1;

  findByFingerprint(
    dedupe_fingerprint: string,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    return Promise.resolve(
      [...this.records.values()].find(
        (record) => record.dedupe_fingerprint === dedupe_fingerprint,
      ) ?? null,
    );
  }

  async createGroup(
    data: Partial<RuntimeFeedbackSignalGroup>,
  ): Promise<RuntimeFeedbackSignalGroup> {
    if (
      data.dedupe_fingerprint &&
      (await this.findByFingerprint(data.dedupe_fingerprint))
    ) {
      throw Object.assign(new Error('duplicate feedback fingerprint'), {
        code: '23505',
      });
    }

    const now = new Date();
    const record = {
      id: `group-${this.sequence++}`,
      dedupe_fingerprint: '',
      signal_type: '',
      source_module: '',
      scope_type: 'global',
      scopeId: null,
      actor_json: {},
      affected_json: {},
      evidence_json: [],
      examples_json: [],
      occurrence_count: 0,
      window_occurrence_count: 0,
      max_confidence: 0,
      max_severity: 'low',
      first_seen_at: now,
      window_started_at: now,
      last_seen_at: now,
      candidateId: null,
      candidate_created_at: null,
      cooldown_until: null,
      last_skipped_reason: null,
      diagnostics_json: null,
      created_at: now,
      updated_at: now,
      ...data,
    } satisfies RuntimeFeedbackSignalGroup;

    this.records.set(record.id, record);
    return record;
  }

  updateGroup(
    id: string,
    data: Partial<RuntimeFeedbackSignalGroup>,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    const existing = this.records.get(id);

    if (!existing) {
      return Promise.resolve(null);
    }

    const updated = Object.assign(
      new RuntimeFeedbackSignalGroup(),
      existing,
      data,
      {
        updated_at: new Date(),
      },
    );
    this.records.set(id, updated);
    return Promise.resolve(updated);
  }

  incrementOccurrence(
    id: string,
    data: {
      evidence: Array<Record<string, unknown>>;
      examples: Array<Record<string, unknown>>;
      confidence: number;
      severity: string;
      lastSeenAt: Date;
      maxEvidenceItems: number;
      maxExampleItems: number;
    },
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    const existing = this.records.get(id);

    if (!existing) {
      return Promise.resolve(null);
    }

    const severityRank: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };

    const updated = Object.assign(new RuntimeFeedbackSignalGroup(), existing, {
      evidence_json: [...existing.evidence_json, ...data.evidence].slice(
        -data.maxEvidenceItems,
      ),
      examples_json: [...existing.examples_json, ...data.examples].slice(
        -data.maxExampleItems,
      ),
      occurrence_count: existing.occurrence_count + 1,
      window_occurrence_count: existing.window_occurrence_count + 1,
      max_confidence: Math.max(existing.max_confidence, data.confidence),
      max_severity:
        (severityRank[data.severity] ?? 0) >
        (severityRank[existing.max_severity] ?? 0)
          ? data.severity
          : existing.max_severity,
      last_seen_at: data.lastSeenAt,
      updated_at: new Date(),
    });

    this.records.set(id, updated);
    return Promise.resolve(updated);
  }

  updateSkippedMetadataIfCandidateMissing(
    id: string,
    data: Partial<RuntimeFeedbackSignalGroup>,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    const existing = this.records.get(id);

    if (!existing) {
      return Promise.resolve(null);
    }

    if (existing.candidateId) {
      return Promise.resolve(existing);
    }

    return this.updateGroup(id, data);
  }

  all(): RuntimeFeedbackSignalGroup[] {
    return [...this.records.values()];
  }
}

function buildSignal(
  overrides: Partial<RuntimeFeedbackSignal> = {},
): RuntimeFeedbackSignal {
  return {
    signal_type: 'tool_contract_repair',
    source_module: 'tool-runtime',
    scope: { scope_type: 'workflow_run', scope_id: 'run-1' },
    affected: {
      tool_name: 'set_job_output',
      workflow_id: 'workflow-1',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      schema_path: 'data',
      failure_class: 'string',
    },
    evidence: [
      { kind: 'event_ledger', id: 'event-1', summary: 'Safe evidence.' },
    ],
    examples: [{ summary: 'Safe example.', redacted: true }],
    confidence: 0.9,
    severity: 'medium',
    dedupe_fingerprint: 'tool_contract_repair|set_job_output|data|string',
    occurred_at: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}

function buildFailureEvidence(overrides: { workflowRunId: string }) {
  return {
    workflowRunId: overrides.workflowRunId,
    workflowId: 'workflow-1',
    jobId: `job-${overrides.workflowRunId}`,
    events: [
      {
        id: `event-${overrides.workflowRunId}`,
        domain: 'workflow',
        name: 'workflow.job.failed',
        outcome: 'failure',
        severity: 'error',
        jobId: `job-${overrides.workflowRunId}`,
        stepId: 'step-1',
        payload: { detail: 'raw event detail' },
        errorCode: 'job_failed',
        errorMessage: 'Cannot find module lodash',
        occurredAt: '2026-05-17T00:00:00.000Z',
      },
    ],
    jobOutput: null,
    errorCode: 'job_failed',
    errorMessage: 'Cannot find module lodash',
    transcriptReferences: [],
    runtimeDiagnostics: { collectionErrors: [] },
  };
}
