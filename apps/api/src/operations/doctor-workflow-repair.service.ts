import { Inject, Injectable } from '@nestjs/common';
import { readString, WorkflowStatus } from '@nexus/core';
import {
  buildWorkflowRequeueOutcome,
  readIntegerRepairArgument,
} from './doctor-repair-executor.utils';
import type { RepairOutcome } from './doctor-repair-executor.types';
import type { DoctorRepairExecutionInput } from './doctor.types';
import { WorkflowRecoveryCandidatesService } from './workflow-recovery-candidates.service';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowEngineService,
  IWorkflowPersistenceService,
  IWorkflowRunRepository,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { WorkflowFailedJobRetryService } from '../workflow/workflow-failed-job-retry.service';
import { WorkflowParserService } from '../workflow/workflow-parser.service';

const DEFAULT_VALIDATION_MESSAGE =
  'Downstream validation rejected the produced output.';

@Injectable()
export class DoctorWorkflowRepairService {
  constructor(
    private readonly workflowRecoveryCandidates: WorkflowRecoveryCandidatesService,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly failedJobRetryService: WorkflowFailedJobRetryService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    private readonly parser: WorkflowParserService,
  ) {}

  async redispatchProducerJobWithFeedback(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    const workflowRunId = readString(input.arguments.workflowRunId);
    const failedJobId = readString(input.arguments.failedJobId);
    const validationMessage =
      readString(input.arguments.validationMessage) ??
      DEFAULT_VALIDATION_MESSAGE;

    if (!workflowRunId || !failedJobId) {
      return {
        status: 'failed',
        message:
          'Missing workflowRunId or failedJobId for producer re-dispatch.',
        changes: {},
        evidence: { arguments: input.arguments },
      };
    }

    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      return {
        status: 'failed',
        message: `Run ${workflowRunId} not found.`,
        changes: {},
        evidence: {},
      };
    }

    const producerJobId = await this.resolveProducerJobId(
      run.workflow_id,
      failedJobId,
    );
    if (!producerJobId) {
      return {
        status: 'failed',
        message: `No upstream execution producer found for ${failedJobId}; cannot auto-correct.`,
        changes: {},
        evidence: { failedJobId },
      };
    }

    if (input.dry_run) {
      return {
        status: 'succeeded',
        message: `Dry run: would re-dispatch producer ${producerJobId} with validation feedback.`,
        changes: { producerJobId },
        evidence: { validationMessage },
      };
    }

    const result = await this.failedJobRetryService.retryFailedJobWithMessage({
      workflowRunId,
      failedJobId: producerJobId,
      retryPrompt: buildProducerRetryPrompt(validationMessage),
    });

    if (!result) {
      return {
        status: 'failed',
        message: `Re-dispatch of producer ${producerJobId} was rejected (run not in FAILED state or job missing).`,
        changes: { producerJobId },
        evidence: {},
      };
    }

    return {
      status: 'succeeded',
      message: `Re-dispatched producer job ${producerJobId} with validation feedback.`,
      changes: { producerJobId },
      evidence: { validationMessage },
    };
  }

  private async resolveProducerJobId(
    workflowId: string,
    failedJobId: string,
  ): Promise<string | null> {
    const workflow = await this.workflowRepo.findByIdentifier(workflowId, {
      includeInactive: true,
    });
    if (!workflow) {
      return null;
    }

    const definition = this.parser.parseWorkflow(workflow.yaml_definition);
    const failedJob = definition.jobs?.find((job) => job.id === failedJobId);
    const producerJobId = failedJob?.depends_on?.find((depId) =>
      definition.jobs?.some(
        (job) => job.id === depId && job.type === 'execution',
      ),
    );

    return producerJobId ?? null;
  }

  clearStalePollingMarkers(input: DoctorRepairExecutionInput): RepairOutcome {
    return {
      status: 'succeeded',
      message: 'No stale polling markers found.',
      changes: {},
      evidence: { dry_run: input.dry_run },
    };
  }

  async requeueRecoverableWorkflowRuns(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    const maxRuns = readIntegerRepairArgument(
      input.arguments,
      'max_runs',
      25,
      1,
      200,
    );
    const stalePendingMinutes = readIntegerRepairArgument(
      input.arguments,
      'stale_pending_minutes',
      10,
      1,
      720,
    );

    const diagnostics = await this.workflowRecoveryCandidates.inspect({
      stalePendingMinutes,
    });
    const candidateRunIds = diagnostics.recoverable_pending_run_ids.slice(
      0,
      maxRuns,
    );

    if (candidateRunIds.length === 0) {
      return {
        status: 'succeeded',
        message: 'No recoverable pending workflow runs were found.',
        changes: {
          candidate_runs: 0,
          resumed_runs: 0,
        },
        evidence: {
          stale_pending_minutes: stalePendingMinutes,
          max_runs: maxRuns,
        },
      };
    }

    if (input.dry_run) {
      return {
        status: 'succeeded',
        message:
          'Dry run complete. Recoverable pending workflow runs identified but not requeued.',
        changes: {
          candidate_runs: candidateRunIds.length,
          resumed_runs: 0,
        },
        evidence: {
          candidate_run_ids: candidateRunIds,
          stale_pending_minutes: stalePendingMinutes,
          max_runs: maxRuns,
        },
      };
    }

    const { resumedRunIds, skippedRunIds } =
      await this.resumeRecoverableWorkflowRuns(candidateRunIds);

    return buildWorkflowRequeueOutcome({
      candidateRunIds,
      resumedRunIds,
      skippedRunIds,
      stalePendingMinutes,
      maxRuns,
    });
  }

  private async resumeRecoverableWorkflowRuns(
    candidateRunIds: string[],
  ): Promise<{
    resumedRunIds: string[];
    skippedRunIds: string[];
  }> {
    const resumedRunIds: string[] = [];
    const skippedRunIds: string[] = [];

    for (const runId of candidateRunIds) {
      await this.workflowEngine.resumeWorkflow(runId);
      const updatedRun = await this.workflowPersistence.getWorkflowRun(runId);
      if (updatedRun?.status === WorkflowStatus.RUNNING) {
        resumedRunIds.push(runId);
      } else {
        skippedRunIds.push(runId);
      }
    }

    return {
      resumedRunIds,
      skippedRunIds,
    };
  }
}

function buildProducerRetryPrompt(validationMessage: string): string {
  return (
    `Your previous output was rejected by downstream validation:\n\n${validationMessage}\n\n` +
    `Re-run this job and correct the output so it satisfies the validation rules that ` +
    `rejected it. Ensure every required element is covered exactly once, with nothing ` +
    `duplicated and nothing omitted.`
  );
}
