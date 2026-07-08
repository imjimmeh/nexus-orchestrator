import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { readString } from '@nexus/core';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../workflow-events.constants';
import { WorkflowFailedJobRetryService } from '../workflow-failed-job-retry.service';
import { WorkflowRepairContinuationPolicyService } from './workflow-repair-continuation-policy.service';

interface DoctorDecision {
  decision: 'fixable' | 'not_fixable';
  confidence?: number;
  rationale?: string;
  remediationInstructions?: string;
  suggestedInputPatch?: Record<string, unknown>;
  evidence?: string[];
}

interface DoctorRetryContext {
  failedWorkflowRunId: string;
  failedJobId?: string;
  trigger: Record<string, unknown> | null;
  decision: DoctorDecision;
}

@Injectable()
export class WorkflowFailureDoctorCompletionListener {
  private readonly logger = new Logger(
    WorkflowFailureDoctorCompletionListener.name,
  );

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly failedJobRetryService: WorkflowFailedJobRetryService,
    private readonly continuationPolicy: WorkflowRepairContinuationPolicyService,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowCompleted(event: WorkflowRunEvent): Promise<void> {
    if (!(await this.isDoctorWorkflow(event.workflowId))) {
      return;
    }

    const doctorContext = this.resolveDoctorRetryContext(event);
    if (!doctorContext) {
      return;
    }

    const retryPrompt = buildRetryPrompt({
      trigger: doctorContext.trigger,
      decision: doctorContext.decision,
    });
    const retryResult =
      await this.failedJobRetryService.retryFailedJobWithMessage({
        workflowRunId: doctorContext.failedWorkflowRunId,
        failedJobId: doctorContext.failedJobId,
        retryPrompt,
        onRetryResolved: async ({ failedJobId }) => {
          await this.runRepo.setStateVariableAtomic(
            doctorContext.failedWorkflowRunId,
            '_internal.failure_doctor.latest',
            buildDoctorFeedbackState({
              doctorRunId: event.workflowRunId,
              failedJobId,
              trigger: doctorContext.trigger,
              decision: doctorContext.decision,
            }),
          );
        },
      });
    if (!retryResult) {
      this.logger.warn(
        `Skipping workflow doctor feedback for run ${event.workflowRunId}: original run ${doctorContext.failedWorkflowRunId} could not be retried.`,
      );
      return;
    }

    this.logger.log(
      `Applied workflow doctor feedback from run ${event.workflowRunId} to original run ${doctorContext.failedWorkflowRunId}, retrying job ${retryResult.failedJobId}.`,
    );
  }

  private async isDoctorWorkflow(workflowId: string): Promise<boolean> {
    const doctorWorkflow = await this.workflowRepo.findByIdentifier(
      this.continuationPolicy.resolveFailureDoctorWorkflowIdentifier(),
    );
    return doctorWorkflow?.id === workflowId;
  }

  private resolveDoctorRetryContext(
    event: WorkflowRunEvent,
  ): DoctorRetryContext | null {
    const trigger = readRecord(event.stateVariables.trigger);
    const failedWorkflowRunId = readNonEmptyString(
      trigger?.failed_workflow_run_id,
    );
    if (!failedWorkflowRunId) {
      this.logger.warn(
        `Skipping workflow doctor feedback for run ${event.workflowRunId}: missing failed_workflow_run_id.`,
      );
      return null;
    }

    const decision = readDoctorDecision(
      event.stateVariables,
      this.continuationPolicy.resolveFailureDoctorOutputJobId(),
    );
    if (decision?.decision !== 'fixable') {
      return null;
    }

    return {
      failedWorkflowRunId,
      failedJobId: readNonEmptyString(trigger?.failed_job_id) ?? undefined,
      trigger,
      decision,
    };
  }
}

function buildDoctorFeedbackState(params: {
  doctorRunId: string;
  failedJobId: string;
  trigger: Record<string, unknown> | null;
  decision: DoctorDecision;
}): Record<string, unknown> {
  return {
    doctor_workflow_run_id: params.doctorRunId,
    failed_job_id: params.failedJobId,
    decision: params.decision.decision,
    confidence: params.decision.confidence ?? null,
    rationale: params.decision.rationale ?? null,
    remediation_instructions: params.decision.remediationInstructions ?? null,
    suggested_input_patch: params.decision.suggestedInputPatch ?? null,
    evidence: params.decision.evidence ?? [],
    original_failure_reason:
      readNonEmptyString(params.trigger?.failure_reason) ?? null,
    applied_at: new Date().toISOString(),
  };
}

function buildRetryPrompt(params: {
  trigger: Record<string, unknown> | null;
  decision: DoctorDecision;
}): string {
  const sections = ['Workflow failure doctor feedback for this retry:'];

  const failureReason = readNonEmptyString(params.trigger?.failure_reason);
  if (failureReason) {
    sections.push(`Original failure reason: ${failureReason}`);
  }

  if (typeof params.decision.confidence === 'number') {
    sections.push(`Doctor confidence: ${params.decision.confidence}`);
  }

  if (params.decision.rationale) {
    sections.push(`Doctor rationale: ${params.decision.rationale}`);
  }

  if (params.decision.remediationInstructions) {
    sections.push(
      `Remediation instructions: ${params.decision.remediationInstructions}`,
    );
  }

  if (params.decision.suggestedInputPatch) {
    sections.push(
      `Suggested input patch: ${JSON.stringify(params.decision.suggestedInputPatch)}`,
    );
  }

  if (params.decision.evidence && params.decision.evidence.length > 0) {
    sections.push(`Evidence: ${params.decision.evidence.join(' | ')}`);
  }

  sections.push(
    'Retry this job using the doctor feedback above. Verify assumptions against the current project state before taking action.',
  );

  return sections.join('\n\n');
}

function readDoctorDecision(
  stateVariables: Record<string, unknown>,
  outputJobId: string,
): DoctorDecision | null {
  const output = readDoctorOutput(stateVariables, outputJobId);
  const decision = readDoctorDecisionValue(output?.decision);
  if (!decision) {
    return null;
  }

  return {
    decision,
    confidence: readDoctorConfidence(output),
    rationale: readDoctorRationale(output),
    remediationInstructions: readDoctorRemediationInstructions(output),
    suggestedInputPatch: readDoctorSuggestedInputPatch(output),
    evidence: readDoctorEvidence(output),
  };
}

function readDoctorDecisionValue(
  value: unknown,
): DoctorDecision['decision'] | null {
  const decision = readNonEmptyString(value);
  if (decision === 'fixable' || decision === 'not_fixable') {
    return decision;
  }

  return null;
}

function readDoctorConfidence(
  output: Record<string, unknown> | null,
): number | undefined {
  return readNumber(output?.confidence);
}

function readDoctorRationale(
  output: Record<string, unknown> | null,
): string | undefined {
  return readNonEmptyString(output?.rationale) ?? undefined;
}

function readDoctorRemediationInstructions(
  output: Record<string, unknown> | null,
): string | undefined {
  return readNonEmptyString(output?.remediation_instructions) ?? undefined;
}

function readDoctorSuggestedInputPatch(
  output: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  return readRecord(output?.suggested_input_patch) ?? undefined;
}

function readDoctorEvidence(
  output: Record<string, unknown> | null,
): string[] | undefined {
  return readStringArray(output?.evidence);
}

function readDoctorOutput(
  stateVariables: Record<string, unknown>,
  outputJobId: string,
): Record<string, unknown> | null {
  const jobs = readRecord(stateVariables.jobs);
  const diagnoseFailure = readRecord(jobs?.[outputJobId]);
  return readRecord(diagnoseFailure?.output);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);

  return entries.length > 0 ? entries : undefined;
}

export { buildRetryPrompt, readDoctorDecision };
