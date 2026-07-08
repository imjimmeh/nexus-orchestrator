import { describe, expect, it } from 'vitest';
import {
  FAILURE_CLASSIFICATION_AUDIT_EVENT,
  REPAIR_POLICY_CLASSES,
  REPAIR_POLICY_ELIGIBILITIES,
  type FailureClassificationDecision,
  type FailureEvidenceReference,
  type FailureEvidenceTranscriptReference,
  type NormalizedFailureEvidence,
} from './failure-classification.types';

describe('failure classification contracts', () => {
  it('defines audit event, policy classes, eligibilities, and decision shape', () => {
    expect(FAILURE_CLASSIFICATION_AUDIT_EVENT).toBe(
      'workflow.failure.classification.decided',
    );
    expect(REPAIR_POLICY_CLASSES).toEqual([
      'dependency_missing',
      'config_missing_local',
      'runtime_artifact_stale',
      'runtime_stall_recoverable',
      'provider_transient',
      'context_window_exceeded',
      'tool_contract_mismatch',
      'credential_missing',
      'quality_gate_failed',
      'merge_dirty_worktree',
      'split_coverage_invalid',
      'ambiguous_failure',
    ]);
    expect(REPAIR_POLICY_ELIGIBILITIES).toEqual([
      'allow',
      'deny',
      'human_required',
    ]);

    const decision: FailureClassificationDecision = {
      class: 'dependency_missing',
      confidence: 0.82,
      reason: 'Missing package detected in workflow failure evidence.',
      evidenceReferences: [
        {
          kind: 'event_ledger',
          id: 'event-1',
          summary: 'Cannot find module @example/missing',
        },
      ],
      eligibility: 'allow',
      allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    };

    expect(decision.evidenceReferences[0].kind).toBe('event_ledger');
    expect(decision.eligibility).toBe('allow');
    expect(decision.allowedRepairActionIds).toEqual([
      'repair.dependency.add_declared_package',
    ]);
  });

  it('covers job output, transcript, runtime diagnostic, and normalized evidence shapes', () => {
    const jobOutputReference: FailureEvidenceReference = {
      kind: 'job_output',
      id: 'job-1',
      summary: 'stderr contains missing module output',
    };
    const transcriptReference: FailureEvidenceTranscriptReference = {
      kind: 'session_tree',
      sessionTreeId: 'tree-1',
      eventIndex: 12,
      summary: 'Transcript event marked is_error',
    };
    const runtimeDiagnosticReference: FailureEvidenceReference = {
      kind: 'runtime_diagnostic',
      summary: 'Host mount diagnostics reported missing paths.',
    };
    const normalizedEvidence: NormalizedFailureEvidence = {
      workflowRunId: 'run-1',
      workflowId: 'workflow-1',
      jobId: 'job-1',
      events: [],
      jobOutput: { stderr: 'Cannot find module left-pad' },
      transcriptReferences: [transcriptReference],
      runtimeDiagnostics: {
        hostMounts: { containers: [{ missingHostPaths: ['G:/missing'] }] },
        collectionErrors: ['skill diagnostics: docker unavailable'],
      },
    };

    expect(jobOutputReference.kind).toBe('job_output');
    expect(transcriptReference.kind).toBe('session_tree');
    expect(runtimeDiagnosticReference.kind).toBe('runtime_diagnostic');
    expect(normalizedEvidence.transcriptReferences).toEqual([
      transcriptReference,
    ]);
    expect(normalizedEvidence.runtimeDiagnostics.collectionErrors).toEqual([
      'skill diagnostics: docker unavailable',
    ]);
  });
});
