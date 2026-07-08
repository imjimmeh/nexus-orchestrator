import { describe, expect, it } from 'vitest';
import type { NormalizedFailureEvidence } from './failure-classification.types';
import { classifyFailureEvidence } from './failure-classification-rules';
import { RepairPolicyService } from './repair-policy.service';

function evidence(message: string): NormalizedFailureEvidence {
  return {
    workflowRunId: 'run-1',
    workflowId: 'workflow-1',
    events: [
      {
        id: 'event-1',
        domain: 'workflow',
        name: 'job.failed',
        outcome: 'failure',
        severity: 'error',
        jobId: 'job-1',
        errorMessage: message,
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    jobOutput: { stderr: message },
    transcriptReferences: [],
    runtimeDiagnostics: { collectionErrors: [] },
    errorMessage: message,
  };
}

describe('classifyFailureEvidence', () => {
  it.each([
    ['OpenAI API key is missing', 'credential_missing'],
    [
      'Tool output schema mismatch: expected field result',
      'tool_contract_mismatch',
    ],
    ['Cannot find module @scope/missing-package', 'dependency_missing'],
    [
      "error TS7016: Could not find a declaration file for module 'lucide-react'",
      'dependency_missing',
    ],
    ['Missing local config file .nexusrc', 'config_missing_local'],
    [
      'Git command failed: Author identity unknown fatal: unable to auto-detect email address',
      'config_missing_local',
    ],
    [
      'error: failed to push some refs; npm run lint failed: eslint reported errors',
      'quality_gate_failed',
    ],
    [
      'Merge blocked: uncommitted local changes in the working tree would be overwritten by the merge. error: Your local changes to the following files would be overwritten by merge: apps/api/src/x.ts Please commit your changes or stash them before you merge. Aborting',
      'merge_dirty_worktree',
    ],
    [
      'job_failed_after_retries: Run stalled: RUNNING with no active or queued step job (stale-run watchdog)',
      'runtime_stall_recoverable',
    ],
    ['Execution container exited or was lost', 'runtime_stall_recoverable'],
    [
      'Container health check timed out after 60000ms at http://172.18.0.10:8374',
      'runtime_stall_recoverable',
    ],
    // Transient provider / transport faults — recoverable by requeue.
    [
      'AI provider error: 529 server cluster is under high load (2064)',
      'provider_transient',
    ],
    ['Agent turn failed: 504 Gateway Timeout', 'provider_transient'],
    ['request failed: socket hang up', 'provider_transient'],
    ['Connection error.', 'provider_transient'],
    [
      'Stream ended without a finish_reason from the provider',
      'provider_transient',
    ],
    [
      'job_failed_after_retries: Provider finish_reason: abort',
      'provider_transient',
    ],
    ['fetch failed: ECONNRESET', 'provider_transient'],
    ['provider returned 503 Service Unavailable', 'provider_transient'],
    [
      '429 Too Many Requests: rate limit exceeded, please retry',
      'provider_transient',
    ],
    // Deterministic, NOT retryable — its own class, not transient.
    [
      '400 invalid params: context window exceeds limit (2013)',
      'context_window_exceeded',
    ],
    [
      "This model's maximum context length is 200000 tokens, however you requested 250000",
      'context_window_exceeded',
    ],
    // Split coverage validation — every violation variant must route to the
    // producer re-dispatch repair, not only the "duplicated" case.
    [
      'Split coverage validation failed for 439b8258: acceptance criteria duplicated across children: AC-1, AC-2',
      'split_coverage_invalid',
    ],
    [
      'Split coverage validation failed for item-9: uncovered parent acceptance criteria: AC-3, AC-4',
      'split_coverage_invalid',
    ],
    [
      'Split coverage validation failed for item-9: unknown acceptance criteria not on the parent: AC-99',
      'split_coverage_invalid',
    ],
  ] as const)('classifies %s as %s', (message, expectedClass) => {
    expect(classifyFailureEvidence(evidence(message)).class).toBe(
      expectedClass,
    );
  });

  it('classifies a stale-run-watchdog stall as runtime_stall_recoverable even when host-mount diagnostics are present', () => {
    // Regression: the stale-run watchdog attaches/removes host mounts while it
    // reaps, so the run carries host-mount runtime diagnostics. The stall must
    // not be misrouted to the runtime_artifact_stale no-op repair.
    const decision = classifyFailureEvidence({
      ...evidence(
        'Run stalled: RUNNING with no active or queued step job (stale-run watchdog)',
      ),
      runtimeDiagnostics: {
        collectionErrors: [],
        hostMounts: { containers: [{ missingHostPaths: ['G:/missing'] }] },
      },
    });

    expect(decision.class).toBe('runtime_stall_recoverable');
  });

  it('classifies a stale-run-watchdog stall as auto-repairable via requeue', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(
        evidence(
          'Run stalled: RUNNING with no active or queued step job (stale-run watchdog)',
        ),
      ),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'runtime_stall_recoverable',
        eligibility: 'allow',
        allowedRepairActionIds: ['doctor.workflow_run.requeue_recoverable'],
      }),
    );
  });

  it('classifies a transient provider error as auto-repairable via requeue', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(
        evidence('AI provider error: 529 server cluster is under high load'),
      ),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'provider_transient',
        eligibility: 'allow',
        allowedRepairActionIds: ['doctor.workflow_run.requeue_recoverable'],
      }),
    );
  });

  it('classifies provider abort finish reasons as auto-repairable via requeue', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(
        evidence('job_failed_after_retries: Provider finish_reason: abort'),
      ),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'provider_transient',
        eligibility: 'allow',
        allowedRepairActionIds: ['doctor.workflow_run.requeue_recoverable'],
      }),
    );
  });

  it('prioritizes output contract exhaustion over a provider abort finish reason', () => {
    const decision = classifyFailureEvidence({
      ...evidence('Provider finish_reason: abort'),
      events: [
        {
          id: 'event-1',
          domain: 'workflow',
          name: 'job.output_contract.exhausted',
          outcome: 'failure',
          severity: 'error',
          jobId: 'sweep',
          stepId: 'run_sweep',
          errorCode: 'output_contract_exhausted',
          errorMessage:
            'Job sweep run run-1: output_contract fields [promotedCandidates, createdSkillProposals] not provided. Max retries (0) exhausted - failing job.',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(decision.class).toBe('tool_contract_mismatch');
  });

  it('routes a context-window overflow to human_required (not a blind requeue)', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(
        evidence('400 invalid params: context window exceeds limit (2013)'),
      ),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'context_window_exceeded',
        eligibility: 'human_required',
        allowedRepairActionIds: [],
      }),
    );
  });

  it('does not classify terminal provider errors (billing/usage/auth) as transient', () => {
    // These are non-retryable; requeuing would loop. They must NOT be caught by
    // the transient-provider rule.
    for (const message of [
      'Provider error: insufficient balance (402)',
      'You are out of extra usage; see claude.ai/settings/usage',
      'authentication_error: invalid api key',
    ]) {
      expect(classifyFailureEvidence(evidence(message)).class).not.toBe(
        'provider_transient',
      );
    }
  });

  it('classifies runtime diagnostic mount/artifact signals as runtime_artifact_stale', () => {
    expect(
      classifyFailureEvidence({
        ...evidence('job failed'),
        runtimeDiagnostics: {
          collectionErrors: [],
          hostMounts: { containers: [{ missingHostPaths: ['G:/missing'] }] },
        },
      }).class,
    ).toBe('runtime_artifact_stale');
  });

  it('routes a dirty-worktree merge block to human-required reconciliation', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(
        evidence(
          'Merge blocked: uncommitted local changes in the working tree would be overwritten by the merge. Please commit your changes or stash them before you merge. Aborting',
        ),
      ),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'merge_dirty_worktree',
        eligibility: 'human_required',
        allowedRepairActionIds: [],
      }),
    );
  });

  it('does not include secret-looking job output values in evidence references', () => {
    const decision = classifyFailureEvidence({
      ...evidence('Cannot find module @scope/missing-package'),
      jobId: 'job-1',
      jobOutput: {
        stderr: 'Cannot find module @scope/missing-package',
        env: 'API_KEY=sk-secret',
        message: 'password=hunter2',
      },
    });

    const serializedReferences = JSON.stringify(decision.evidenceReferences);

    expect(serializedReferences).not.toContain('API_KEY=sk-secret');
    expect(serializedReferences).not.toContain('hunter2');
    expect(serializedReferences).not.toContain('password');
    expect(decision.evidenceReferences).toContainEqual({
      kind: 'job_output',
      id: 'job-1',
      summary:
        'Job output captured for workflowRunId=run-1 jobId=job-1 outputKeys=stderr,env,message',
    });
  });

  it('does not include secret-looking event error or payload values in evidence references', () => {
    const decision = classifyFailureEvidence({
      ...evidence('Cannot find module @scope/missing-package'),
      events: [
        {
          id: 'event-1',
          domain: 'workflow',
          name: 'job.failed',
          outcome: 'failure',
          severity: 'error',
          jobId: 'job-1',
          stepId: 'step-1',
          errorCode: 'MODULE_NOT_FOUND',
          errorMessage:
            'Cannot find module @scope/missing-package API_KEY=sk-secret',
          payload: {
            stderr: 'password=hunter2',
          },
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const serializedReferences = JSON.stringify(decision.evidenceReferences);

    expect(serializedReferences).not.toContain('sk-secret');
    expect(serializedReferences).not.toContain('API_KEY');
    expect(serializedReferences).not.toContain('password');
    expect(serializedReferences).not.toContain('hunter2');
    expect(decision.evidenceReferences).toContainEqual({
      kind: 'event_ledger',
      id: 'event-1',
      summary:
        'Event ledger failure signal: job.failed workflowRunId=run-1 jobId=job-1 stepId=step-1 errorCode=MODULE_NOT_FOUND',
    });
  });

  it('prioritizes credential signatures over dependency and local config-looking text', () => {
    const decision = classifyFailureEvidence(
      evidence(
        'Missing local config file .nexusrc after Cannot find module because API key is missing',
      ),
    );

    expect(decision).toMatchObject({
      class: 'credential_missing',
      confidence: 0.95,
    });
  });

  it('detects destructive operation evidence and includes the destructive_operation safety tag', () => {
    const decision = classifyFailureEvidence(
      evidence('git reset --hard failed'),
    );

    expect(decision).toMatchObject({
      class: 'ambiguous_failure',
      confidence: 0.9,
      safetyTags: ['destructive_operation'],
    });
    expect(decision.reason).toContain('destructive operation');
  });

  it('classifies and denies destructive operation evidence end-to-end', () => {
    const policy = new RepairPolicyService();
    const decision = policy.applyPolicy(
      classifyFailureEvidence(evidence('git reset --hard failed')),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        class: 'ambiguous_failure',
        eligibility: 'deny',
        allowedRepairActionIds: [],
        safetyTags: ['destructive_operation'],
      }),
    );
  });

  it('builds runtime diagnostic evidence references when diagnostics exist', () => {
    const decision = classifyFailureEvidence({
      ...evidence('job failed'),
      runtimeDiagnostics: {
        collectionErrors: [],
        skillMounts: { containers: [{ catalogLoadError: 'catalog missing' }] },
      },
    });

    expect(decision.evidenceReferences).toContainEqual({
      kind: 'runtime_diagnostic',
      summary: 'Runtime diagnostics contain failure signals.',
    });
  });

  it('classifies split coverage validation failure as split_coverage_invalid', () => {
    const decision = classifyFailureEvidence(
      evidence(
        'job_failed_after_retries: MCP tool invocation failed: MCP HTTP request failed (-32000): ' +
          'Split coverage validation failed for 439b8258: acceptance criteria duplicated across children: AC-1, AC-2',
      ),
    );

    expect(decision.class).toBe('split_coverage_invalid');
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('classifies a -32000 Invalid arguments rejection from the split-coverage tool as split_coverage_invalid', () => {
    const decision = classifyFailureEvidence(
      evidence(
        'job_failed_after_retries: MCP tool invocation failed: ' +
          'MCP HTTP request failed (-32000): Invalid arguments for MCP tool validate_split_coverage',
      ),
    );
    expect(decision.class).toBe('split_coverage_invalid');
  });

  it('still classifies the coverage-logic rejection as split_coverage_invalid', () => {
    const decision = classifyFailureEvidence(
      evidence(
        'Split coverage validation failed for 77112b26: uncovered parent ' +
          'acceptance criteria: AC-2, AC-7',
      ),
    );
    expect(decision.class).toBe('split_coverage_invalid');
  });

  it('defaults to ambiguous_failure and includes evidence references', () => {
    const decision = classifyFailureEvidence({
      ...evidence('process exited with code 1'),
      transcriptReferences: [
        {
          kind: 'session_tree',
          sessionTreeId: 'tree-1',
          eventIndex: 4,
          summary: 'failed with exit code 1',
        },
      ],
    });

    expect(decision).toMatchObject({
      class: 'ambiguous_failure',
      confidence: 0.3,
    });
    expect(
      decision.evidenceReferences.map((reference) => reference.kind),
    ).toEqual(['event_ledger', 'job_output', 'session_tree']);
  });
});
