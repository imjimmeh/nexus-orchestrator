import { Injectable } from '@nestjs/common';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';
import { classifyFailureEvidence } from './failure-classification-rules';
import { sanitizeCompletionMessage } from './completion-message-sanitizer';
import {
  FAILURE_CLASSIFICATION_AUDIT_EVENT,
  type FailureClassificationDecision,
  type FailureEvidenceReference,
  type NormalizedFailureEvidence,
  type RepairPolicyClass,
} from './failure-classification.types';
import { RepairPolicyService } from './repair-policy.service';
import { WorkflowFailureEvidenceCollectorService } from './workflow-failure-evidence.collector';

const DURABLE_FAILURE_CLASSES = new Set<RepairPolicyClass>([
  'dependency_missing',
  'config_missing_local',
  'runtime_artifact_stale',
  'ambiguous_failure',
]);

const FEEDBACK_FAILURE_CLASS_BY_POLICY_CLASS: Partial<
  Record<RepairPolicyClass, string>
> = {
  dependency_missing: 'dependency_missing',
  config_missing_local: 'config_missing_local',
  runtime_artifact_stale: 'runtime_artifact_stale',
  ambiguous_failure: 'unknown',
};

@Injectable()
export class WorkflowFailureClassificationService {
  constructor(
    private readonly evidenceCollector: WorkflowFailureEvidenceCollectorService,
    private readonly repairPolicy: RepairPolicyService,
    private readonly eventLedger: EventLedgerService,
    private readonly runtimeFeedback: RuntimeFeedbackIngestionService,
  ) {}

  async classifyRunFailure(
    workflowRunId: string,
  ): Promise<FailureClassificationDecision> {
    const evidence = await this.evidenceCollector.collect(workflowRunId);
    const classification = classifyFailureEvidence(evidence);
    const decision = this.attachFailureMessage(
      this.repairPolicy.applyPolicy(classification),
      evidence,
    );

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: FAILURE_CLASSIFICATION_AUDIT_EVENT,
      workflowRunId,
      workflowId: evidence.workflowId,
      jobId:
        evidence.jobId ?? evidence.events.find((event) => event.jobId)?.jobId,
      stepId: evidence.events.find((event) => event.stepId)?.stepId,
      outcome: decision.eligibility === 'deny' ? 'denied' : 'success',
      severity: decision.eligibility === 'allow' ? 'info' : 'warn',
      errorCode: `failure_classification_${decision.class}`,
      errorMessage: decision.reason,
      payload: {
        decision: this.buildAuditDecision(decision),
        evidenceSummary: this.buildEvidenceSummary(evidence),
      },
    });

    await this.ingestRuntimeFeedbackBestEffort(decision, evidence);

    return decision;
  }

  /**
   * Carries the concrete (sanitized) failure-evidence message on the decision so
   * downstream repair delegation can feed the actual violation back to the
   * re-dispatched producer instead of only the static classifier reason.
   */
  private attachFailureMessage(
    decision: FailureClassificationDecision,
    evidence: NormalizedFailureEvidence,
  ): FailureClassificationDecision {
    const rawMessage = evidence.errorMessage?.trim();
    if (!rawMessage) {
      return decision;
    }

    return {
      ...decision,
      failureMessage: sanitizeCompletionMessage(rawMessage),
    };
  }

  private async ingestRuntimeFeedbackBestEffort(
    decision: FailureClassificationDecision,
    evidence: NormalizedFailureEvidence,
  ): Promise<void> {
    if (!DURABLE_FAILURE_CLASSES.has(decision.class)) {
      return;
    }

    await this.runtimeFeedback
      .ingest(this.buildRuntimeFeedbackSignal(decision, evidence))
      .catch(() => undefined);
  }

  private buildRuntimeFeedbackSignal(
    decision: FailureClassificationDecision,
    evidence: NormalizedFailureEvidence,
  ): RuntimeFeedbackSignal {
    const failureClass = this.toFeedbackFailureClass(decision.class);
    const repairActions = [...decision.allowedRepairActionIds].sort();
    const jobId = this.getJobId(evidence);

    return {
      signal_type: 'failure_classification',
      source_module: 'workflow-repair',
      scope: {
        scope_type: 'workflow_run',
        scope_id: evidence.workflowRunId,
      },
      affected: {
        workflow_id: evidence.workflowId,
        workflow_run_id: evidence.workflowRunId,
        job_id: jobId,
        failure_class: failureClass,
        repair_action_id: repairActions[0],
      },
      evidence: this.buildRuntimeFeedbackEvidence(
        decision,
        evidence,
        failureClass,
      ),
      examples: [
        {
          summary: `Failure classification ${failureClass} decided for workflow run ${evidence.workflowRunId}.`,
          redacted: true,
        },
      ],
      confidence: decision.confidence,
      severity: this.toRuntimeFeedbackSeverity(decision),
      dedupe_fingerprint: this.buildRuntimeFeedbackDedupeFingerprint(
        decision,
        evidence,
        failureClass,
        repairActions,
      ),
    };
  }

  private buildRuntimeFeedbackEvidence(
    decision: FailureClassificationDecision,
    evidence: NormalizedFailureEvidence,
    failureClass: string,
  ): RuntimeFeedbackSignal['evidence'] {
    return [
      {
        kind: 'failure_classification',
        summary: `Failure classification ${failureClass} selected with ${decision.eligibility} repair eligibility.`,
      },
      ...decision.evidenceReferences.map((reference) =>
        this.buildRuntimeFeedbackEvidenceReference(reference),
      ),
      {
        kind: 'evidence_summary',
        summary: `Evidence summary: ${evidence.events.length} event(s), ${evidence.transcriptReferences.length} transcript reference(s), job output present=${Boolean(evidence.jobOutput)}.`,
      },
    ].slice(0, 20);
  }

  private buildRuntimeFeedbackEvidenceReference(
    reference: FailureEvidenceReference,
  ): RuntimeFeedbackSignal['evidence'][number] {
    if (reference.kind === 'session_tree') {
      const sessionTreeReference = reference as FailureEvidenceReference & {
        sessionTreeId?: string;
      };

      return {
        kind: 'session_tree',
        id: reference.id ?? sessionTreeReference.sessionTreeId,
        summary: 'Session transcript failure reference captured.',
      };
    }

    return {
      kind: reference.kind,
      id: reference.id,
      summary: reference.summary,
    };
  }

  private toFeedbackFailureClass(policyClass: RepairPolicyClass): string {
    return FEEDBACK_FAILURE_CLASS_BY_POLICY_CLASS[policyClass] ?? policyClass;
  }

  private toRuntimeFeedbackSeverity(
    decision: FailureClassificationDecision,
  ): RuntimeFeedbackSignal['severity'] {
    if (decision.eligibility === 'deny') {
      return 'high';
    }

    if (decision.eligibility === 'human_required') {
      return 'medium';
    }

    return 'low';
  }

  private buildRuntimeFeedbackDedupeFingerprint(
    decision: FailureClassificationDecision,
    evidence: NormalizedFailureEvidence,
    failureClass: string,
    repairActions: string[],
  ): string {
    return [
      'failure_classification',
      failureClass,
      `workflow:${evidence.workflowId}`,
      `eligibility:${decision.eligibility}`,
      `repair_action:${repairActions.join(',') || 'none'}`,
    ].join('|');
  }

  private getJobId(evidence: NormalizedFailureEvidence): string | undefined {
    return (
      evidence.jobId ?? evidence.events.find((event) => event.jobId)?.jobId
    );
  }

  private buildAuditDecision(
    decision: FailureClassificationDecision,
  ): FailureClassificationDecision {
    return {
      ...decision,
      evidenceReferences: decision.evidenceReferences.map((reference) =>
        this.buildAuditEvidenceReference(reference),
      ),
    };
  }

  private buildAuditEvidenceReference(
    reference: FailureEvidenceReference,
  ): FailureEvidenceReference {
    if (reference.kind === 'session_tree') {
      return {
        ...reference,
        summary: 'Session transcript failure reference captured.',
      };
    }

    return reference;
  }

  private buildEvidenceSummary(evidence: NormalizedFailureEvidence): {
    eventCount: number;
    transcriptReferenceCount: number;
    hasJobOutput: boolean;
    runtimeDiagnosticCollectionErrorCount: number;
  } {
    return {
      eventCount: evidence.events.length,
      transcriptReferenceCount: evidence.transcriptReferences.length,
      hasJobOutput: Boolean(evidence.jobOutput),
      runtimeDiagnosticCollectionErrorCount:
        evidence.runtimeDiagnostics.collectionErrors.length,
    };
  }
}
