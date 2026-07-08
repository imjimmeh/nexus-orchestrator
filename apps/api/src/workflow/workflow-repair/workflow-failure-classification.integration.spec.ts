import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';
import { RepairPolicyService } from './repair-policy.service';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import { WorkflowFailureEvidenceCollectorService } from './workflow-failure-evidence.collector';
import type { NormalizedFailureEvidence } from './failure-classification.types';

describe('workflow failure classification integration', () => {
  const collector = { collect: vi.fn() };
  const eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
  const runtimeFeedback = { ingest: vi.fn().mockResolvedValue(undefined) };
  let service: WorkflowFailureClassificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowFailureClassificationService(
      collector as unknown as WorkflowFailureEvidenceCollectorService,
      new RepairPolicyService(),
      eventLedger as unknown as EventLedgerService,
      runtimeFeedback as unknown as RuntimeFeedbackIngestionService,
    );
  });

  it.each([
    [
      'missing module',
      'Cannot find module lodash',
      'dependency_missing',
      'allow',
    ],
    [
      'local non-secret config missing',
      'required local config .nexusrc not found',
      'config_missing_local',
      'allow',
    ],
    [
      'OPENAI_API_KEY is missing',
      'OPENAI_API_KEY is missing',
      'credential_missing',
      'deny',
    ],
    [
      'set_job_output requires data object',
      'set_job_output requires data object',
      'tool_contract_mismatch',
      'human_required',
    ],
    [
      'unexpected failure',
      'worker exited with status 1',
      'ambiguous_failure',
      'human_required',
    ],
  ])(
    'classifies %s as %s/%s',
    async (_name, errorMessage, expectedClass, expectedEligibility) => {
      collector.collect.mockResolvedValueOnce(evidence(errorMessage));

      const decision = await service.classifyRunFailure('run-1');

      expect(decision).toMatchObject({
        class: expectedClass,
        eligibility: expectedEligibility,
      });
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies split coverage validation failure as split_coverage_invalid/allow with redispatch action', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence(
        'job_failed_after_retries: MCP tool invocation failed: MCP HTTP request failed (-32000): Split coverage validation failed for item-123: acceptance criteria duplicated across children: AC-1, AC-2',
      ),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision).toMatchObject({
      class: 'split_coverage_invalid',
      eligibility: 'allow',
    });
    expect(decision.allowedRepairActionIds).toContain(
      'doctor.workflow_run.redispatch_producer_with_feedback',
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
  });

  it('denies destructive ambiguous failures', async () => {
    collector.collect.mockResolvedValueOnce(
      evidence('git reset --hard failed with exit code 128'),
    );

    const decision = await service.classifyRunFailure('run-1');

    expect(decision).toMatchObject({
      class: 'ambiguous_failure',
      eligibility: 'deny',
      safetyTags: ['destructive_operation'],
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
  });
});

function evidence(errorMessage: string): NormalizedFailureEvidence {
  return {
    workflowRunId: 'run-1',
    workflowId: 'workflow-1',
    jobId: 'job-1',
    events: [],
    jobOutput: null,
    errorCode: 'job_failed',
    errorMessage,
    transcriptReferences: [],
    runtimeDiagnostics: { collectionErrors: [] },
  };
}
