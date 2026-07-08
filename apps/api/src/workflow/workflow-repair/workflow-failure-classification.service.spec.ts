import { runtimeFeedbackSignalSchema } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import { WorkflowFailureEvidenceCollectorService } from './workflow-failure-evidence.collector';
import { RepairPolicyService } from './repair-policy.service';
import {
  FAILURE_CLASSIFICATION_AUDIT_EVENT,
  type FailureClassificationDecision,
  type NormalizedFailureEvidence,
} from './failure-classification.types';

describe('WorkflowFailureClassificationService', () => {
  const collector = {
    collect: vi.fn(),
  };
  const policy = new RepairPolicyService();
  const eventLedger = {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };
  const runtimeFeedback = {
    ingest: vi.fn().mockResolvedValue(undefined),
  };

  let service: WorkflowFailureClassificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowFailureClassificationService(
      collector as unknown as WorkflowFailureEvidenceCollectorService,
      policy,
      eventLedger as unknown as EventLedgerService,
      runtimeFeedback as unknown as RuntimeFeedbackIngestionService,
    );
  });

  it('emits an info success audit event for allowed classifications', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence({ errorMessage: 'Cannot find module lodash' }),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision).toMatchObject({
      class: 'dependency_missing',
      eligibility: 'allow',
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: FAILURE_CLASSIFICATION_AUDIT_EVENT,
        workflowRunId: 'run-1',
        workflowId: 'workflow-1',
        jobId: 'job-1',
        stepId: 'step-1',
        outcome: 'success',
        severity: 'info',
        errorCode: 'failure_classification_dependency_missing',
        errorMessage: decision.reason,
      }),
    );
  });

  it('emits a warn denied audit event for policy denied classifications', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence({ errorMessage: 'OPENAI_API_KEY is missing' }),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision).toMatchObject({
      class: 'credential_missing',
      eligibility: 'deny',
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'denied',
        severity: 'warn',
        errorCode: 'failure_classification_credential_missing',
        errorMessage: decision.reason,
      }),
    );
  });

  it('emits a warn success audit event for human-required classifications', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence({ errorMessage: 'set_job_output requires data object' }),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision).toMatchObject({
      class: 'tool_contract_mismatch',
      eligibility: 'human_required',
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        severity: 'warn',
        errorCode: 'failure_classification_tool_contract_mismatch',
        errorMessage: decision.reason,
      }),
    );
  });

  it('summarizes evidence counts without leaking raw secret-bearing payloads', async () => {
    const secretValue = 'sk-secret-value-that-must-not-leak';
    collector.collect.mockResolvedValueOnce(
      evidence({
        errorMessage: 'OPENAI_API_KEY is missing',
        events: [
          {
            id: 'event-1',
            domain: 'workflow',
            name: 'workflow.job.failed',
            outcome: 'failure',
            severity: 'error',
            jobId: 'job-1',
            stepId: 'step-1',
            payload: { stdout: secretValue },
            errorCode: 'missing_secret',
            errorMessage: `token ${secretValue} failed`,
            occurredAt: '2026-04-28T00:00:00.000Z',
          },
        ],
        jobOutput: { apiKey: secretValue },
        transcriptReferences: [
          {
            kind: 'session_tree',
            sessionTreeId: 'session-tree-1',
            eventIndex: 0,
            summary: `agent printed ${secretValue}`,
          },
        ],
      }),
    );

    const decision = await service.classifyRunFailure('run-1');

    const auditEvent = eventLedger.emitBestEffort.mock.calls[0]?.[0];
    expect(auditEvent.payload).toMatchObject({
      decision: {
        ...decision,
        evidenceReferences: expect.arrayContaining([
          expect.objectContaining({
            kind: 'session_tree',
            summary: 'Session transcript failure reference captured.',
          }),
        ]),
      },
      evidenceSummary: {
        eventCount: 1,
        transcriptReferenceCount: 1,
        hasJobOutput: true,
        runtimeDiagnosticCollectionErrorCount: 0,
      },
    });
    expect(JSON.stringify(auditEvent.payload)).not.toContain(secretValue);
  });

  it.each([
    [
      'dependency_missing',
      evidence({ errorMessage: 'Cannot find module lodash' }),
    ],
    [
      'config_missing_local',
      evidence({ errorMessage: 'missing local config .nexusrc' }),
    ],
    [
      'runtime_artifact_stale',
      evidence({
        errorMessage: 'runtime mount failed',
        runtimeDiagnostics: {
          collectionErrors: [],
          hostMounts: { missingHostPaths: ['G:/safe/path'] },
        },
      }),
    ],
    ['unknown', evidence({ errorMessage: 'unexpected worker exit' })],
  ])(
    'ingests runtime feedback after audit emission for durable %s classifications',
    async (expectedFeedbackClass, failureEvidence) => {
      collector.collect.mockResolvedValueOnce(failureEvidence);

      const decision = await service.classifyRunFailure('run-1');

      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
      expect(
        eventLedger.emitBestEffort.mock.invocationCallOrder[0],
      ).toBeLessThan(runtimeFeedback.ingest.mock.invocationCallOrder[0] ?? 0);

      const signal = runtimeFeedbackSignalSchema.parse(
        runtimeFeedback.ingest.mock.calls[0]?.[0],
      );

      expect(signal.signal_type).toBe('failure_classification');
      expect(signal.source_module).toBe('workflow-repair');
      expect(signal.scope).toEqual({
        scope_type: 'workflow_run',
        scope_id: 'run-1',
      });
      expect(signal.affected).toEqual(
        expect.objectContaining({
          workflow_id: 'workflow-1',
          workflow_run_id: 'run-1',
          job_id: 'job-1',
          failure_class: expectedFeedbackClass,
        }),
      );
      expect(signal.confidence).toBe(decision.confidence);
      expect(signal.severity).toMatch(/^(low|medium|high|critical)$/);
      expect(signal.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'failure_classification',
            summary: expect.stringContaining(expectedFeedbackClass),
          }),
        ]),
      );
      expect(signal.examples).toEqual([
        expect.objectContaining({
          redacted: true,
          summary: expect.stringContaining(expectedFeedbackClass),
        }),
      ]);
      expect(signal.dedupe_fingerprint).toContain(expectedFeedbackClass);
      expect(signal.dedupe_fingerprint).toContain('workflow:workflow-1');
      expect(signal.dedupe_fingerprint).not.toContain('run:run-1');
      expect(signal.dedupe_fingerprint).not.toContain('job:job-1');
    },
  );

  it('builds the same feedback dedupe fingerprint for repeated durable classifications across runs', async () => {
    collector.collect
      .mockResolvedValueOnce(
        evidence({
          workflowRunId: 'run-1',
          errorMessage: 'Cannot find module lodash',
          events: [
            failedEvent({
              id: 'event-1',
              jobId: 'job-run-1',
              errorMessage: 'Cannot find module lodash',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        evidence({
          workflowRunId: 'run-2',
          jobId: 'job-run-2',
          errorMessage: 'Cannot find module lodash',
          events: [
            failedEvent({
              id: 'event-2',
              jobId: 'job-run-2',
              errorMessage: 'Cannot find module lodash',
            }),
          ],
        }),
      );

    await service.classifyRunFailure('run-1');
    await service.classifyRunFailure('run-2');

    const firstSignal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );
    const secondSignal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[1]?.[0],
    );

    expect(firstSignal.affected?.workflow_run_id).toBe('run-1');
    expect(secondSignal.affected?.workflow_run_id).toBe('run-2');
    expect(firstSignal.dedupe_fingerprint).toBe(
      secondSignal.dedupe_fingerprint,
    );
    expect(firstSignal.dedupe_fingerprint).not.toContain('run-1');
    expect(firstSignal.dedupe_fingerprint).not.toContain('run-2');
    expect(firstSignal.dedupe_fingerprint).not.toContain('job-run-1');
    expect(firstSignal.dedupe_fingerprint).not.toContain('job-run-2');
  });

  it('uses event job-id fallback for feedback traceability without adding it to dedupe', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence({
        jobId: undefined,
        events: [
          failedEvent({
            id: 'event-1',
            jobId: 'event-job-1',
            errorMessage: 'Cannot find module lodash',
          }),
        ],
      }),
    );

    await service.classifyRunFailure('run-1');

    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(signal.affected?.job_id).toBe('event-job-1');
    expect(signal.dedupe_fingerprint).not.toContain('event-job-1');
  });

  it.each([
    [
      'credential_missing',
      evidence({ errorMessage: 'OPENAI_API_KEY is missing' }),
    ],
    [
      'tool_contract_mismatch',
      evidence({ errorMessage: 'set_job_output requires data object' }),
    ],
  ])(
    'does not ingest runtime feedback for non-durable %s classifications',
    async (_expectedClass, failureEvidence) => {
      collector.collect.mockResolvedValueOnce(failureEvidence);

      await service.classifyRunFailure('run-1');

      expect(runtimeFeedback.ingest).not.toHaveBeenCalled();
    },
  );

  it('sanitizes transcript references and raw payloads from feedback signal fields', async () => {
    const secretValue = 'sk-secret-value-that-must-not-leak';
    collector.collect.mockResolvedValueOnce(
      evidence({
        errorMessage: 'Cannot find module lodash',
        events: [
          {
            id: 'event-1',
            domain: 'workflow',
            name: 'workflow.job.failed',
            outcome: 'failure',
            severity: 'error',
            jobId: 'job-1',
            stepId: 'step-1',
            payload: { stdout: secretValue, toolOutput: 'raw tool output' },
            errorCode: 'job_failed',
            errorMessage: `module failed with ${secretValue}`,
            occurredAt: '2026-04-28T00:00:00.000Z',
          },
        ],
        jobOutput: { apiKey: secretValue, transcript: 'raw prompt body' },
        transcriptReferences: [
          {
            kind: 'session_tree',
            sessionTreeId: 'session-tree-1',
            eventIndex: 0,
            summary: `agent transcript included ${secretValue}`,
          },
        ],
      }),
    );

    await service.classifyRunFailure('run-1');

    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );
    const persistedFeedbackFields = JSON.stringify({
      evidence: signal.evidence,
      examples: signal.examples,
      dedupe_fingerprint: signal.dedupe_fingerprint,
    });

    expect(persistedFeedbackFields).not.toContain(secretValue);
    expect(persistedFeedbackFields).not.toContain('raw tool output');
    expect(persistedFeedbackFields).not.toContain('raw prompt body');
    expect(persistedFeedbackFields).not.toContain('agent transcript included');
    expect(signal.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'session_tree',
          id: 'session-tree-1',
          summary: 'Session transcript failure reference captured.',
        }),
      ]),
    );
  });

  it('attaches the actual failure-evidence message to the decision', async () => {
    const violation =
      'Split coverage validation failed for 439b8258: acceptance criteria ' +
      'duplicated across children: AC-1, AC-2';
    collector.collect.mockResolvedValueOnce(
      evidence({
        errorMessage:
          'MCP HTTP request failed (-32000): coverage validation failed; ' +
          violation,
      }),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision.class).toBe('split_coverage_invalid');
    expect(decision.failureMessage).toContain(
      'duplicated across children: AC-1, AC-2',
    );
  });

  it('sanitizes secrets out of the attached failure-evidence message', async () => {
    const secret = 'sk-secret-value-that-must-not-leak';
    collector.collect.mockResolvedValueOnce(
      evidence({
        errorMessage: `Cannot find module lodash; token ${secret} leaked`,
      }),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision.failureMessage).toBeDefined();
    expect(decision.failureMessage).not.toContain(secret);
  });

  it('preserves the classification decision when runtime feedback ingestion fails', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence({ errorMessage: 'Cannot find module lodash' }),
    );
    runtimeFeedback.ingest.mockRejectedValueOnce(
      new Error('feedback store down'),
    );

    await expect(service.classifyRunFailure('run-1')).resolves.toMatchObject({
      class: 'dependency_missing',
      eligibility: 'allow',
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
  });
});

function evidence(
  overrides: Partial<NormalizedFailureEvidence> = {},
): NormalizedFailureEvidence {
  return {
    workflowRunId: 'run-1',
    workflowId: 'workflow-1',
    jobId: 'job-1',
    events: [
      {
        id: 'event-1',
        domain: 'workflow',
        name: 'workflow.job.failed',
        outcome: 'failure',
        severity: 'error',
        jobId: 'job-1',
        stepId: 'step-1',
        payload: { detail: 'raw event detail' },
        errorCode: 'job_failed',
        errorMessage: overrides.errorMessage ?? 'Cannot find module lodash',
        occurredAt: '2026-04-28T00:00:00.000Z',
      },
    ],
    jobOutput: null,
    errorCode: 'job_failed',
    errorMessage: 'Cannot find module lodash',
    transcriptReferences: [],
    runtimeDiagnostics: { collectionErrors: [] },
    ...overrides,
  };
}

function failedEvent(
  overrides: Partial<NormalizedFailureEvidence['events'][number]> = {},
): NormalizedFailureEvidence['events'][number] {
  return {
    id: 'event-1',
    domain: 'workflow',
    name: 'workflow.job.failed',
    outcome: 'failure',
    severity: 'error',
    jobId: 'job-1',
    stepId: 'step-1',
    payload: { detail: 'raw event detail' },
    errorCode: 'job_failed',
    errorMessage: 'Cannot find module lodash',
    occurredAt: '2026-04-28T00:00:00.000Z',
    ...overrides,
  };
}
