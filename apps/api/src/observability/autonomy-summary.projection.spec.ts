import { describe, expect, it } from 'vitest';

import type {
  QaDecisionSummaryInput,
  SkillProposalDiagnosticsInput,
} from './autonomy-summary.projection.types';
import {
  summarizeLearningCandidateLifecycle,
  summarizeLearningLifecycle,
} from './autonomy-learning-summary.projection';
import {
  summarizeFailureClassification,
  summarizeQaDecision,
  summarizeRepairDelegation,
  summarizeRuntimeFeedback,
  summarizeSkillProposalDiagnostics,
} from './autonomy-summary.projection';

describe('autonomy summary projections', () => {
  const candidateId = '11111111-1111-4111-8111-111111111111';
  const groupId = '22222222-2222-4222-8222-222222222222';

  it('summarizes learning run started and completed lifecycle events', () => {
    const started = summarizeLearningLifecycle({
      eventName: 'memory.learning.run.started',
      eventLedgerId: 'event-started',
      payload: {
        runId: 'learning-run-1',
        trigger: 'manual',
      },
    });
    const completed = summarizeLearningLifecycle({
      eventName: 'memory.learning.run.completed',
      eventLedgerId: 'event-completed',
      payload: {
        runId: 'learning-run-1',
        trigger: 'manual',
        scannedScopes: 2,
        rankedCandidates: 1,
        promotedCandidates: 0,
        createdSkillProposals: 1,
      },
    });

    expect(started).toMatchObject({
      category: 'learning',
      title: expect.stringContaining('Learning run'),
      status: 'in_progress',
      summary: expect.stringContaining('manual'),
    });
    expect(completed).toMatchObject({
      category: 'learning',
      title: expect.stringContaining('Learning run'),
      status: 'succeeded',
      summary: expect.stringContaining('Skill proposals: 1.'),
    });
    expect(started.evidence).toEqual([
      {
        kind: 'event_ledger',
        id: 'event-started',
        summary: 'Learning lifecycle event ledger record.',
      },
    ]);
  });

  it('redacts bare provider tokens from learning lifecycle summaries', () => {
    const summary = summarizeLearningLifecycle({
      eventName: 'memory.learning.run.started',
      eventLedgerId: 'event-started',
      payload: {
        runId: 'learning-run-1',
        trigger: 'sk-live-tokenvalue123',
      },
    });

    expect(summary.summary).toBe('[REDACTED]');
    expect(JSON.stringify(summary)).not.toContain('sk-live-tokenvalue123');
  });

  it('summarizes learning candidates as reviewable learning items', () => {
    const summary = summarizeLearningCandidateLifecycle({
      eventName: 'memory.learning.candidate_created',
      eventLedgerId: 'event-candidate',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      payload: {
        candidate_id: candidateId,
        scope_type: 'workflow_run',
        scope_id: 'run-1',
        confidence: 0.72,
        evidence_count: 2,
        tag_count: 1,
        lesson: 'raw job output api_key=secret should not appear',
      },
    });

    expect(summary).toMatchObject({
      category: 'learning',
      title: 'Learning candidate created',
      status: 'needs_review',
      summary:
        'Learning candidate created for workflow_run. Confidence: 0.72. Evidence: 2. Tags: 1.',
      nextSteps: [{ label: 'Review learning candidate', severity: 'warning' }],
    });
    expect(summary.evidence).toEqual([
      {
        kind: 'workflow_run',
        id: 'run-1',
        summary: 'Workflow run associated with learning candidate.',
      },
      {
        kind: 'event_ledger',
        id: 'event-candidate',
        summary: 'Learning candidate event ledger record.',
      },
      {
        kind: 'workflow_job',
        id: 'job-1',
        summary: 'Job associated with learning candidate.',
      },
      {
        kind: 'learning_candidate',
        id: candidateId,
        summary: 'Learning candidate awaiting review.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('api_key=secret');
    expect(JSON.stringify(summary)).not.toContain('raw job output');
  });

  it('redacts bare provider tokens from learning candidate payload summaries', () => {
    const summary = summarizeLearningCandidateLifecycle({
      eventName: 'memory.learning.candidate_created',
      eventLedgerId: 'event-candidate',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      payload: {
        candidate_id: candidateId,
        scope_type: 'sk-live-tokenvalue456',
        confidence: 0.72,
      },
    });

    expect(summary.summary).toBe('[REDACTED]');
    expect(JSON.stringify(summary)).not.toContain('sk-live-tokenvalue456');
  });

  it('summarizes runtime feedback candidate-created events under learning', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-1',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: 'tool_contract_repair',
        dedupe_fingerprint_hash: 'a'.repeat(64),
      },
    });

    expect(summary).toMatchObject({
      category: 'learning',
      title: 'Runtime feedback: tool_contract_repair',
      status: 'needs_review',
      summary: 'Runtime feedback candidate created for tool_contract_repair.',
      nextSteps: [
        {
          label: 'Review runtime feedback learning candidate',
          severity: 'warning',
        },
      ],
    });
    expect(summary.evidence).toEqual([
      {
        kind: 'workflow_run',
        id: 'run-1',
        summary: 'Workflow run associated with runtime feedback.',
      },
      {
        kind: 'event_ledger',
        id: 'event-1',
        summary: 'Runtime feedback event ledger record.',
      },
      {
        kind: 'workflow_job',
        id: 'job-1',
        summary: 'Job associated with runtime feedback.',
      },
      {
        kind: 'learning_candidate',
        id: candidateId,
        summary: 'Runtime feedback learning candidate.',
      },
      {
        kind: 'runtime_diagnostic',
        id: groupId,
        summary: 'Runtime feedback signal group.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('dedupe_fingerprint_hash');
  });

  it('marks runtime feedback candidate-created events for review even without a candidate id', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-1',
      payload: {
        group_id: 'group-1',
        signal_type: 'tool_contract_repair',
      },
    });

    expect(summary.status).toBe('needs_review');
    expect(summary.nextSteps).toContainEqual({
      label: 'Review runtime feedback learning candidate',
      severity: 'warning',
    });
  });

  it('redacts unsafe runtime feedback signal types from titles and summaries', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-unsafe',
      payload: {
        group_id: 'group-unsafe',
        candidate_id: 'candidate-unsafe',
        signal_type: 'raw job output api_key=secret-value',
      },
    });

    expect(summary.title).toBe('Runtime feedback: [REDACTED]');
    expect(summary.summary).toBe('[REDACTED]');
    expect(JSON.stringify(summary)).not.toContain('secret-value');
    expect(JSON.stringify(summary)).not.toContain('raw job output');
  });

  it('falls back for malformed runtime feedback signal types while preserving known values', () => {
    const malformed = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-malformed',
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: '../../unexpected',
      },
    });
    const known = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.signal_ingested',
      eventLedgerId: 'event-known',
      payload: {
        group_id: groupId,
        signal_type: 'memory_miss',
      },
    });

    expect(malformed.title).toBe('Runtime feedback: unknown_signal');
    expect(malformed.summary).toBe(
      'Runtime feedback candidate created for unknown_signal.',
    );
    expect(JSON.stringify(malformed)).not.toContain('../../unexpected');
    expect(known.title).toBe('Runtime feedback: memory_miss');
    expect(known.summary).toBe(
      'Runtime feedback signal ingested for memory_miss.',
    );
  });

  it('projects UUID runtime feedback candidate and group evidence ids', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-safe',
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: 'tool_contract_repair',
      },
    });

    expect(summary.evidence).toContainEqual({
      kind: 'learning_candidate',
      id: candidateId,
      summary: 'Runtime feedback learning candidate.',
    });
    expect(summary.evidence).toContainEqual({
      kind: 'runtime_diagnostic',
      id: groupId,
      summary: 'Runtime feedback signal group.',
    });
  });

  it('omits malformed runtime feedback candidate and group evidence ids', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.candidate_created',
      eventLedgerId: 'event-safe',
      payload: {
        group_id: 'tool:set_job_output:data:abc123',
        candidate_id: 'candidate-password-secret',
        signal_type: 'tool_contract_repair',
      },
    });

    expect(summary.evidence).not.toContainEqual(
      expect.objectContaining({ kind: 'learning_candidate' }),
    );
    expect(summary.evidence).not.toContainEqual(
      expect.objectContaining({ kind: 'runtime_diagnostic' }),
    );
    expect(JSON.stringify(summary)).not.toContain('password-secret');
    expect(JSON.stringify(summary)).not.toContain('tool:set_job_output');
  });

  it('summarizes skipped runtime feedback without exposing unsafe raw payload fields', () => {
    const payloadWithUnsafeFields: Record<string, unknown> = {
      group_id: 'group-1',
      signal_type: 'raw job output api_key=secret-value',
      skipped_reason: 'confidence_below_threshold',
      raw_payload: { api_key: 'secret-value' },
      evidence: [{ summary: 'raw job output: leaked logs' }],
      examples: [{ summary: 'raw example must not appear' }],
      diagnostics: { bearer: 'token' },
      dedupe_fingerprint: 'tool:set_job_output:data:secret-value',
    };

    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.signal_skipped',
      eventLedgerId: 'event-2',
      payload: payloadWithUnsafeFields,
    });

    expect(summary).toMatchObject({
      category: 'learning',
      title: 'Runtime feedback: [REDACTED]',
      status: 'denied',
      summary:
        'Runtime feedback signal skipped. Reason: confidence_below_threshold.',
      nextSteps: [
        {
          label: 'Review skipped runtime feedback policy thresholds',
          severity: 'info',
        },
      ],
    });
    expect(summary.evidence).toEqual([
      {
        kind: 'event_ledger',
        id: 'event-2',
        summary: 'Runtime feedback event ledger record.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('group-1');
    expect(JSON.stringify(summary)).not.toContain('secret-value');
    expect(JSON.stringify(summary)).not.toContain('raw job output');
    expect(JSON.stringify(summary)).not.toContain('raw example');
    expect(JSON.stringify(summary)).not.toContain('bearer');
  });

  it('links tool-contract repair runtime feedback evidence to workflow run and job when available', () => {
    const summary = summarizeRuntimeFeedback({
      eventName: 'runtime.feedback.signal_ingested',
      eventLedgerId: 'event-3',
      workflowRunId: 'run-3',
      jobId: 'job-3',
      payload: {
        group_id: 'group-3',
        signal_type: 'tool_contract_repair',
        dedupe_fingerprint_hash: 'b'.repeat(64),
        occurrence_count: 3,
      },
    });

    expect(summary).toMatchObject({
      category: 'learning',
      title: 'Runtime feedback: tool_contract_repair',
      status: 'succeeded',
      summary:
        'Runtime feedback signal ingested for tool_contract_repair. Occurrences: 3.',
    });
    expect(summary.evidence).toContainEqual({
      kind: 'workflow_run',
      id: 'run-3',
      summary: 'Workflow run associated with runtime feedback.',
    });
    expect(summary.evidence).toContainEqual({
      kind: 'workflow_job',
      id: 'job-3',
      summary: 'Job associated with runtime feedback.',
    });
    expect(JSON.stringify(summary)).not.toContain('dedupe_fingerprint_hash');
  });

  it('summarizes pending skill proposals without exposing raw transcripts or secrets', () => {
    const sourceEvidenceWithIgnoredFields: Record<string, unknown> = {
      learning_candidate_id: 'candidate-1',
      source_evidence: [
        {
          sourceType: 'transcript',
          sessionTreeId: 'session-1',
          chatSessionId: 'chat-1',
          eventCount: 7,
          truncated: true,
          transcript: 'full raw transcript body must not appear',
        },
        {
          sourceType: 'retrospective',
          workflowRunId: 'run-1',
          arbitraryBlob: 'large unrestricted blob must not appear',
        },
      ],
    };

    const summary = summarizeSkillProposalDiagnostics({
      id: 'proposal-1',
      status: 'pending',
      targetSkill: 'triage-issue',
      rationale:
        'Improve routing for issue triage. authorization: Bearer should not leak.',
      diagnostics: {
        source_evidence: sourceEvidenceWithIgnoredFields as NonNullable<
          SkillProposalDiagnosticsInput['diagnostics']
        >['source_evidence'],
      },
    });

    expect(summary).toMatchObject({
      category: 'learning',
      status: 'needs_review',
      title: expect.stringContaining('triage-issue'),
      summary: '[REDACTED]',
      nextSteps: [
        { label: 'Preview patch', severity: 'info' },
        { label: 'Approve or reject with a reason', severity: 'warning' },
      ],
    });
    expect(summary.evidence).toEqual([
      {
        kind: 'skill_proposal',
        id: 'proposal-1',
        summary: 'Skill proposal for triage-issue.',
      },
      {
        kind: 'learning_candidate',
        id: 'candidate-1',
        summary: 'Learning candidate for proposal source evidence.',
      },
      {
        kind: 'session_tree',
        id: 'session-1',
        summary: 'transcript source evidence with 7 events (truncated).',
      },
      {
        kind: 'workflow_run',
        id: 'run-1',
        summary: 'retrospective source evidence.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('full raw transcript body');
    expect(JSON.stringify(summary)).not.toContain('large unrestricted blob');
  });

  it('redacts unsafe skill proposal subjects from titles and summaries', () => {
    const summary = summarizeSkillProposalDiagnostics({
      id: 'proposal-unsafe-subject',
      status: 'pending',
      targetSkill: 'raw job output: api_key=secret-value',
      title: 'fallback title should not be used',
      summary: 'Proposal summary.',
    });

    expect(summary).toMatchObject({
      category: 'learning',
      status: 'needs_review',
      title: 'Skill proposal: [REDACTED]',
      summary: 'Proposal summary.',
    });
    expect(summary.evidence).toContainEqual({
      kind: 'skill_proposal',
      id: 'proposal-unsafe-subject',
      summary: 'Skill proposal for [REDACTED].',
    });
    expect(JSON.stringify(summary)).not.toContain('secret-value');
    expect(JSON.stringify(summary)).not.toContain('raw job output');
  });

  it('omits unsafe skill proposal evidence ids from flat and nested source evidence', () => {
    const summary = summarizeSkillProposalDiagnostics({
      id: 'raw job output proposal id should not leak',
      status: 'pending',
      title: 'Safe proposal title',
      diagnostics: {
        source_evidence: [
          {
            kind: 'event_ledger',
            id: 'raw job output: bearer token',
            summary: 'Unsafe id with benign summary.',
          },
          {
            kind: 'workflow_run',
            id: 'safe-run-1',
            summary: 'Safe workflow evidence.',
          },
        ],
      },
    });

    expect(summary.evidence).toEqual([
      {
        kind: 'skill_proposal',
        summary: 'Skill proposal for Safe proposal title.',
      },
      {
        kind: 'event_ledger',
        summary: 'Unsafe id with benign summary.',
      },
      {
        kind: 'workflow_run',
        id: 'safe-run-1',
        summary: 'Safe workflow evidence.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('bearer token');
    expect(JSON.stringify(summary)).not.toContain('raw job output');

    const nested = summarizeSkillProposalDiagnostics({
      id: 'proposal-safe-id',
      status: 'pending',
      title: 'Safe nested evidence proposal',
      diagnostics: {
        source_evidence: {
          learning_candidate_id: 'api_key=learning-secret',
          source_evidence: [
            {
              sourceType: 'retrospective',
              sessionTreeId: 'full transcript: session secret',
              workflowRunId: 'raw job output: workflow secret',
              eventCount: 2,
            },
            {
              sourceType: 'retrospective',
              sessionTreeId: 'session-safe',
              workflowRunId: 'run-safe',
            },
          ],
        },
      },
    });

    expect(nested.evidence).toEqual([
      {
        kind: 'skill_proposal',
        id: 'proposal-safe-id',
        summary: 'Skill proposal for Safe nested evidence proposal.',
      },
      {
        kind: 'learning_candidate',
        summary: 'Learning candidate for proposal source evidence.',
      },
      {
        kind: 'session_tree',
        summary: 'retrospective source evidence with 2 events.',
      },
      {
        kind: 'workflow_run',
        summary: 'retrospective source evidence with 2 events.',
      },
      {
        kind: 'session_tree',
        id: 'session-safe',
        summary: 'retrospective source evidence.',
      },
      {
        kind: 'workflow_run',
        id: 'run-safe',
        summary: 'retrospective source evidence.',
      },
    ]);
    expect(JSON.stringify(nested)).not.toContain('learning-secret');
    expect(JSON.stringify(nested)).not.toContain('session secret');
    expect(JSON.stringify(nested)).not.toContain('workflow secret');
    expect(JSON.stringify(nested)).not.toContain('raw job output');
    expect(JSON.stringify(nested)).not.toContain('full transcript');
  });

  it('maps terminal skill proposal statuses to review outcomes and next steps', () => {
    expect(
      summarizeSkillProposalDiagnostics({
        id: 'approved-1',
        status: 'approved',
        title: 'Better QA routing',
        summary: 'Proposal summary.',
      }).status,
    ).toBe('succeeded');

    const rejected = summarizeSkillProposalDiagnostics({
      id: 'rejected-1',
      status: 'rejected',
      title: 'Noisy learning proposal',
      rejectionReason: 'Too broad.',
    });
    expect(rejected.status).toBe('denied');
    expect(rejected.nextSteps).toContainEqual({
      label: 'Use rejection reason to tune proposal generation',
      severity: 'info',
    });

    const failed = summarizeSkillProposalDiagnostics({
      id: 'failed-1',
      status: 'failed',
      title: 'Broken patch',
      rationale: 'Patch failed validation.',
    });
    expect(failed.status).toBe('failed');
    expect(failed.nextSteps).toContainEqual({
      label: 'Review validation warnings before retrying approval',
      severity: 'error',
    });
  });

  it('summarizes QA accept and reject decisions with bounded failed deliverable evidence', () => {
    const failedDeliverablesWithIgnoredFields: Record<string, unknown>[] = [
      {
        deliverable_id: 'unit-tests',
        failure_type: 'test_failure',
        details: 'Unit test suite failed on repair projection.',
        affected_files: [
          'apps/api/src/observability/autonomy-summary.projection.ts',
          'apps/api/src/observability/autonomy-summary.projection.spec.ts',
          'apps/api/src/observability/unrelated-large-file.ts',
        ],
        arbitraryBlob: 'large unrestricted blob must not appear',
      },
      {
        deliverable_id: 'secret-check',
        failure_type: 'incorrect',
        details: 'api_key=should-not-leak',
        affected_files: ['apps/api/src/observability/secret.ts'],
      },
    ];

    const accepted = summarizeQaDecision({
      decision: 'accept',
      contextId: 'work-1',
      workflowRunId: 'run-1',
      feedback: 'Looks good.',
    });
    expect(accepted).toMatchObject({
      category: 'review',
      status: 'succeeded',
      summary: expect.stringContaining('Looks good.'),
      evidence: [
        {
          kind: 'context_item',
          id: 'work-1',
          summary: 'QA decision for context work-1.',
        },
        {
          kind: 'workflow_run',
          id: 'run-1',
          summary: 'Workflow run reviewed by QA.',
        },
      ],
    });

    const rejected = summarizeQaDecision({
      decision: 'reject',
      contextId: 'work-2',
      workflowRunId: 'run-2',
      feedback: 'Tests failed.',
      failedDeliverables: failedDeliverablesWithIgnoredFields,
    });
    expect(rejected.status).toBe('denied');
    expect(rejected.summary).toContain('Tests failed.');
    expect(rejected.evidence).toContainEqual({
      kind: 'event_ledger',
      id: 'unit-tests',
      summary:
        'Deliverable unit-tests failed with test_failure. Details: Unit test suite failed on repair projection. Affected files: apps/api/src/observability/autonomy-summary.projection.ts, apps/api/src/observability/autonomy-summary.projection.spec.ts.',
    });
    expect(rejected.evidence).toContainEqual({
      kind: 'event_ledger',
      id: 'secret-check',
      summary: '[REDACTED]',
    });
    expect(rejected.nextSteps).toContainEqual({
      label: 'Address failed deliverables before resubmitting',
      severity: 'warning',
    });
    expect(JSON.stringify(rejected)).not.toContain('large unrestricted blob');
    expect(JSON.stringify(rejected)).not.toContain('should-not-leak');
  });

  it('summarizes failure classifications with sanitized evidence references', () => {
    const allowed = summarizeFailureClassification({
      eligibility: 'allow',
      class: 'runtime_artifact_stale',
      confidence: 0.82,
      reason: 'Tool timeout can be retried.',
      evidenceReferences: [
        {
          kind: 'workflow_event',
          id: 'event-1',
          summary: 'Observed timeout in workflow event.',
        },
        {
          kind: 'runtime_diagnostic',
          id: 'diagnostic-1',
          summary: 'Runtime diagnostic captured stale artifact.',
        },
        { kind: 'job_output', id: 'job-1', summary: 'password=hidden' },
      ],
    });

    expect(allowed).toMatchObject({
      category: 'failure_classification',
      status: 'succeeded',
      summary:
        'Class: runtime_artifact_stale. Confidence: 0.82. Reason: Tool timeout can be retried.',
      nextSteps: [
        {
          label: 'Review allowed repair actions before dispatch',
          severity: 'info',
        },
      ],
    });
    expect(allowed.evidence).toEqual([
      {
        kind: 'workflow_event',
        id: 'event-1',
        summary: 'Observed timeout in workflow event.',
      },
      {
        kind: 'runtime_diagnostic',
        id: 'diagnostic-1',
        summary: 'Runtime diagnostic captured stale artifact.',
      },
      { kind: 'job_output', id: 'job-1', summary: '[REDACTED]' },
    ]);

    expect(
      summarizeFailureClassification({
        eligibility: 'deny',
        class: 'ambiguous_failure',
        confidence: 0.2,
        reason: 'Unsafe.',
      }).status,
    ).toBe('denied');
    expect(
      summarizeFailureClassification({
        eligibility: 'human_required',
        class: 'ambiguous_failure',
        confidence: 0.5,
        reason: 'Needs judgement.',
      }).nextSteps,
    ).toContainEqual({
      label: 'Review evidence and choose a manual repair path',
      severity: 'warning',
    });
  });

  it('redacts explicit raw transcript, job output, and secret labels while preserving benign summaries', () => {
    const transcriptClassification = summarizeFailureClassification({
      eligibility: 'deny',
      class: 'ambiguous_failure',
      confidence: 0.2,
      reason: 'Raw transcript: user and agent conversation body follows.',
    });
    const credentialClassification = summarizeFailureClassification({
      eligibility: 'deny',
      class: 'credential_missing',
      confidence: 0.9,
      reason: 'credential value was included in diagnostic summary.',
    });
    const bearerClassification = summarizeFailureClassification({
      eligibility: 'deny',
      class: 'credential_missing',
      confidence: 0.9,
      reason: 'bearer token was included in diagnostic summary.',
    });
    const rawJobOutputRepair = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 1,
      message: 'raw job output: npm printed unrestricted logs',
    });
    const hyphenatedJobOutputRepair = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 1,
      message: 'job-output contained unrestricted logs',
    });
    const apiKeyRepair = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 1,
      message: 'api-key was included in diagnostic summary',
    });
    const accessTokenRepair = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 1,
      message: 'access-token was included in diagnostic summary',
    });
    const benignRepair = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 1,
      message: 'Repair failed after validation.',
    });

    expect(transcriptClassification.summary).toBe('[REDACTED]');
    expect(credentialClassification.summary).toBe('[REDACTED]');
    expect(bearerClassification.summary).toBe('[REDACTED]');
    expect(rawJobOutputRepair.summary).toBe('[REDACTED]');
    expect(hyphenatedJobOutputRepair.summary).toBe('[REDACTED]');
    expect(apiKeyRepair.summary).toBe('[REDACTED]');
    expect(accessTokenRepair.summary).toBe('[REDACTED]');
    expect(benignRepair.summary).toBe(
      'Policy action: doctor. Execution path: doctor. Attempt: 1. Message: Repair failed after validation.',
    );
  });

  it('summarizes repair delegation status, evidence, and next steps', () => {
    const failed = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor',
      executionPath: 'doctor',
      attempt: 2,
      message: 'Repair failed after validation.',
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      doctorRepairAttemptId: 'doctor-1',
      repairWorkflowRunId: 'repair-run-1',
    });

    expect(failed).toMatchObject({
      category: 'repair',
      status: 'failed',
      summary:
        'Policy action: doctor. Execution path: doctor. Attempt: 2. Message: Repair failed after validation.',
      nextSteps: [
        {
          label: 'Inspect repair output and retry manually if safe',
          severity: 'error',
        },
      ],
    });
    expect(failed.evidence).toEqual([
      { kind: 'workflow_run', id: 'run-1', summary: 'Original workflow run.' },
      { kind: 'job_output', id: 'job-1', summary: 'Failed job output.' },
      {
        kind: 'doctor_repair_history',
        id: 'doctor-1',
        summary: 'Doctor repair attempt history.',
      },
      {
        kind: 'workflow_run',
        id: 'repair-run-1',
        summary: 'Repair workflow run.',
      },
    ]);

    expect(
      summarizeRepairDelegation({
        status: 'dispatched',
        policyAction: 'sysadmin',
        executionPath: 'sysadmin_workflow',
        attempt: 1,
      }).status,
    ).toBe('in_progress');
    expect(
      summarizeRepairDelegation({
        status: 'retry_limit_exceeded',
        policyAction: 'doctor',
        executionPath: 'doctor',
        attempt: 3,
      }).nextSteps,
    ).toContainEqual({
      label: 'Escalate after retry budget is exhausted',
      severity: 'error',
    });
  });

  it('summarizes requested and completed repair delegation events', () => {
    const requested = summarizeRepairDelegation({
      status: 'dispatched',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      message: 'Doctor repair requested.',
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
    });
    const completed = summarizeRepairDelegation({
      status: 'succeeded',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      message: 'Doctor repair completed.',
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      doctorRepairAttemptId: 'doctor-attempt-1',
    });

    expect(requested).toMatchObject({
      category: 'repair',
      status: 'in_progress',
      summary:
        'Policy action: doctor.runtime_artifact.refresh_stale_artifacts. Execution path: doctor. Attempt: 1. Message: Doctor repair requested.',
    });
    expect(completed).toMatchObject({
      category: 'repair',
      status: 'succeeded',
      summary:
        'Policy action: doctor.runtime_artifact.refresh_stale_artifacts. Execution path: doctor. Attempt: 1. Message: Doctor repair completed.',
    });
    expect(completed.evidence).toContainEqual({
      kind: 'doctor_repair_history',
      id: 'doctor-attempt-1',
      summary: 'Doctor repair attempt history.',
    });
  });

  it('redacts unsafe repair policy actions from titles and summaries', () => {
    const summary = summarizeRepairDelegation({
      status: 'dispatched',
      policyAction: 'api_key=secret',
      executionPath: 'doctor',
      attempt: 1,
      message: 'Doctor repair requested.',
    });

    expect(summary.title).toBe('Repair delegation: [REDACTED]');
    expect(summary.summary).toBe('[REDACTED]');
    expect(JSON.stringify(summary)).not.toContain('api_key=secret');
  });

  it('drops unsafe repair evidence ids while preserving safe ids', () => {
    const summary = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      workflowRunId: 'run-1',
      failedJobId: 'api_key=secret',
      doctorRepairAttemptId: 'doctor-attempt-1',
      repairWorkflowRunId: 'raw job output contains unrestricted logs',
    });

    expect(summary.evidence).toEqual([
      { kind: 'workflow_run', id: 'run-1', summary: 'Original workflow run.' },
      {
        kind: 'job_output',
        summary: 'Failed job output.',
      },
      {
        kind: 'doctor_repair_history',
        id: 'doctor-attempt-1',
        summary: 'Doctor repair attempt history.',
      },
      {
        kind: 'workflow_run',
        summary: 'Repair workflow run.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('api_key=secret');
    expect(JSON.stringify(summary)).not.toContain('raw job output');
  });

  it('redacts unsafe requested and completed repair messages', () => {
    const requested = summarizeRepairDelegation({
      status: 'dispatched',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      message: 'Doctor repair requested with api_key in raw job output.',
    });
    const completed = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      message: 'authorization header appeared in completion message.',
    });

    expect(requested.summary).toBe('[REDACTED]');
    expect(completed.summary).toBe('[REDACTED]');
    expect(JSON.stringify([requested, completed])).not.toContain('api_key');
    expect(JSON.stringify([requested, completed])).not.toContain(
      'raw job output',
    );
    expect(JSON.stringify([requested, completed])).not.toContain(
      'authorization',
    );
  });

  it('redacts bare provider tokens from repair summary text', () => {
    const summary = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      message:
        'Doctor repair failed after provider returned sk-live-testvalue123.',
    });

    expect(summary.summary).toBe('[REDACTED]');
    expect(JSON.stringify(summary)).not.toContain('sk-live-testvalue123');
  });

  it('omits bare provider tokens from repair evidence ids while preserving safe ids', () => {
    const summary = summarizeRepairDelegation({
      status: 'failed',
      policyAction: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      doctorRepairAttemptId: 'doctor-attempt-1',
      repairWorkflowRunId: 'sk-test-secret',
    });

    expect(summary.evidence).toEqual([
      { kind: 'workflow_run', id: 'run-1', summary: 'Original workflow run.' },
      { kind: 'job_output', id: 'job-1', summary: 'Failed job output.' },
      {
        kind: 'doctor_repair_history',
        id: 'doctor-attempt-1',
        summary: 'Doctor repair attempt history.',
      },
      {
        kind: 'workflow_run',
        summary: 'Repair workflow run.',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('sk-test-secret');
  });
});
