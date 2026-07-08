import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IToolPermissionPolicy,
  IWorkflowStep,
  IJob,
  SkillDiscoveryMode,
} from '@nexus/core';
import {
  CHAT_SESSION_DOMAIN_PORT,
  type ChatSessionDomainPort,
} from '../domain-ports';
import { StateManagerService } from '../state-manager.service';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import { WorkflowOutputContractService } from '../workflow-output-contract.service';
import type { OutputContractTypeMismatch } from '../workflow-output-contract.types';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowEngineService,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';

import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';

@Injectable()
export class StepRequiredToolRetryService {
  private readonly logger = new Logger(StepRequiredToolRetryService.name);

  constructor(
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly stateManager: StateManagerService,
    private readonly eventLog: WorkflowEventLogService,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly outputContractService: WorkflowOutputContractService,
    private readonly runtimeFeedback: RuntimeFeedbackIngestionService,
  ) {}

  /**
   * @deprecated Use checkRequiredToolCallsAndRetryJob instead
   */
  async checkRequiredToolCallsAndRetry(
    workflowRunId: string,
    stepId: string,
    step: IWorkflowStep,
    containerId: string,
    workflowPermissions?: IToolPermissionPolicy,
    workflowSkillDiscoveryMode?: SkillDiscoveryMode,
    workflowYamlSkills?: string[],
  ): Promise<'retried' | 'proceed'> {
    return this.checkRequiredToolCallsAndRetryJob(
      workflowRunId,
      stepId,
      step,
      containerId,
      workflowPermissions,
      workflowSkillDiscoveryMode,
      workflowYamlSkills,
    );
  }

  async checkRequiredToolCallsAndRetryJob(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    containerId: string,
    workflowPermissions?: IToolPermissionPolicy,
    workflowSkillDiscoveryMode?: SkillDiscoveryMode,
    workflowYamlSkills?: string[],
  ): Promise<'retried' | 'proceed'> {
    const contract = job.output_contract;
    if (!contract) {
      return 'proceed';
    }

    if (await this.isRunParked(workflowRunId)) {
      // The turn ended because the agent durably suspended (await_agent_workflow
      // / delegate_*), not because it finished the job. A parked run produces no
      // set_job_output by design; enforcing the output contract here would
      // mis-read the suspended turn as a missing contract and re-enqueue it,
      // re-spawning child workflows. Leave it parked for the dependency-resume
      // path to re-enqueue once the awaited children complete.
      this.logger.log(
        `Job ${jobId} run ${workflowRunId}: run is parked (durable await); ` +
          `skipping output-contract enforcement.`,
      );
      return 'proceed';
    }

    return this.checkOutputContractAndRetry(
      workflowRunId,
      jobId,
      job,
      contract,
      containerId,
      workflowPermissions,
      workflowSkillDiscoveryMode,
      workflowYamlSkills,
    );
  }

  /**
   * A run parked for any reason (awaiting human input or a durable dependency
   * wait) ended its turn deliberately and has no job output to validate.
   * Resolved from the authoritative run row because `register()` sets
   * `wait_reason` synchronously during the suspending tool call.
   */
  private async isRunParked(workflowRunId: string): Promise<boolean> {
    try {
      const run = await this.runRepo.findById(workflowRunId);
      return Boolean(run?.awaiting_input) || Boolean(run?.wait_reason);
    } catch {
      return false;
    }
  }

  private async checkOutputContractAndRetry(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    contract: NonNullable<IJob['output_contract']>,
    containerId: string,
    workflowPermissions?: IToolPermissionPolicy,
    workflowSkillDiscoveryMode?: SkillDiscoveryMode,
    workflowYamlSkills?: string[],
  ): Promise<'retried' | 'proceed'> {
    const { valid, missing, invalid } =
      await this.outputContractService.validateOutputContract(
        workflowRunId,
        jobId,
        contract,
      );

    const problemFields = [...missing, ...invalid.map((m) => m.field)];

    if (valid) {
      await this.logOutputContractSatisfied(
        workflowRunId,
        jobId,
        contract.required,
      );
      return 'proceed';
    }

    const maxRetries = job.max_retries ?? 0;
    const retryKey = `_internal.retries.${jobId}`;
    const retryCount = await this.getRetryCount(workflowRunId, retryKey);
    const willRetry = retryCount < maxRetries;

    await this.logOutputContractMissing({
      workflowRunId,
      jobId,
      requiredFields: contract.required,
      missingFields: missing,
      problemFields,
      retryCount,
      maxRetries,
      willRetry,
    });

    if (retryCount >= maxRetries) {
      const autoSatisfied = await this.tryAutoSatisfyDecisionOutputContract({
        workflowRunId,
        jobId,
        requiredFields: contract.required,
        missingFields: missing,
        problemFields,
      });
      if (autoSatisfied) {
        return 'proceed';
      }

      await this.failForExhaustedOutputContract({
        workflowRunId,
        jobId,
        requiredFields: contract.required,
        missingFields: missing,
        problemFields,
        retryCount,
        maxRetries,
      });
    }

    await this.enqueueOutputContractRetry({
      workflowRunId,
      jobId,
      job,
      containerId,
      missing,
      invalid,
      problemFields,
      requiredFields: contract.required,
      retryCount,
      maxRetries,
      retryKey,
      workflowPermissions,
      workflowSkillDiscoveryMode,
      workflowYamlSkills,
    });

    return 'retried';
  }

  private async enqueueOutputContractRetry(params: {
    workflowRunId: string;
    jobId: string;
    job: IJob;
    containerId: string;
    missing: string[];
    invalid: OutputContractTypeMismatch[];
    problemFields: string[];
    requiredFields: string[];
    retryCount: number;
    maxRetries: number;
    retryKey: string;
    workflowPermissions?: IToolPermissionPolicy;
    workflowSkillDiscoveryMode?: SkillDiscoveryMode;
    workflowYamlSkills?: string[];
  }): Promise<void> {
    const sessionTreeId = await this.trySaveRetrySessionTree(
      params.containerId,
      params.workflowRunId,
      params.jobId,
    );

    await this.stateManager.setVariable(
      params.workflowRunId,
      params.retryKey,
      params.retryCount + 1,
    );

    const autoPrompt = this.outputContractService.buildRetryPrompt(
      params.missing,
      params.invalid,
    );
    const retryPrompt = params.job.retry_prompt
      ? `${params.job.retry_prompt}\n\n${autoPrompt}`
      : autoPrompt;

    await this.logRetryEnqueued({
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      requiredFields: params.requiredFields,
      missingFields: params.missing,
      problemFields: params.problemFields,
      retryCount: params.retryCount,
      maxRetries: params.maxRetries,
      sessionTreeId,
    });

    this.logger.log(
      `Job ${params.jobId} run ${params.workflowRunId}: output_contract problem fields [${params.problemFields.join(', ')}]. ` +
        `Retry ${params.retryCount + 1}/${params.maxRetries} — re-enqueueing with retry prompt.`,
    );

    await this.workflowEngine.retryJobWithMessage(
      params.workflowRunId,
      params.jobId,
      params.job,
      sessionTreeId,
      retryPrompt,
      params.workflowPermissions,
      params.workflowSkillDiscoveryMode,
      params.workflowYamlSkills,
    );
  }

  private async tryAutoSatisfyDecisionOutputContract(params: {
    workflowRunId: string;
    jobId: string;
    requiredFields: string[];
    missingFields: string[];
    problemFields: string[];
  }): Promise<boolean> {
    const requiresOnlyDecision =
      params.requiredFields.length === 1 &&
      params.requiredFields[0] === 'decision';
    const missingOnlyDecision =
      params.missingFields.length === 1 &&
      params.missingFields[0] === 'decision';
    const orchestrationDecisionJob =
      params.jobId === 'ceo_orchestration_decision' ||
      params.jobId === 'orchestration_decision';

    if (
      !(requiresOnlyDecision && missingOnlyDecision && orchestrationDecisionJob)
    ) {
      return false;
    }

    const stateKey = `jobs.${params.jobId}.output`;
    const currentOutput = await this.stateManager.getVariable(
      params.workflowRunId,
      stateKey,
    );
    const currentRecord =
      currentOutput &&
      typeof currentOutput === 'object' &&
      !Array.isArray(currentOutput)
        ? (currentOutput as Record<string, unknown>)
        : {};

    await this.stateManager.setVariable(params.workflowRunId, stateKey, {
      ...currentRecord,
      decision: 'continue',
      auto_generated: true,
      auto_reason:
        'Output contract fallback applied after retries exhausted for orchestration decision.',
    });

    await this.eventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: 'job.output_contract.auto_fallback',
      jobId: params.jobId,
      payload: {
        requiredFields: params.requiredFields,
        missingFields: params.missingFields,
      },
    });

    this.logger.warn(
      `Job ${params.jobId} run ${params.workflowRunId}: auto-satisfied output_contract with fallback decision after retries exhausted.`,
    );
    return true;
  }

  private async getRetryCount(
    workflowRunId: string,
    retryKey: string,
  ): Promise<number> {
    const currentRetries = (await this.stateManager.getVariable(
      workflowRunId,
      retryKey,
    )) as number | null;
    return typeof currentRetries === 'number' ? currentRetries : 0;
  }

  private async trySaveRetrySessionTree(
    containerId: string,
    workflowRunId: string,
    jobId: string,
  ): Promise<string | undefined> {
    try {
      return await this.sessionHydration.saveSessionFromExitedContainer(
        containerId,
        workflowRunId,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Job ${jobId} run ${workflowRunId}: failed to save session tree for retry: ${msg}. Proceeding with stateless retry.`,
      );
      return undefined;
    }
  }

  private async logOutputContractSatisfied(
    workflowRunId: string,
    jobId: string,
    requiredFields: string[],
  ): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId,
      eventType: 'job.output_contract.satisfied',
      jobId,
      payload: { requiredFields },
    });
    this.logger.log(`Job ${jobId}: output_contract satisfied — proceeding.`);
  }

  private async logOutputContractMissing(params: {
    workflowRunId: string;
    jobId: string;
    requiredFields: string[];
    missingFields: string[];
    problemFields: string[];
    retryCount: number;
    maxRetries: number;
    willRetry: boolean;
  }): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: 'job.output_contract.missing',
      jobId: params.jobId,
      payload: {
        requiredFields: params.requiredFields,
        missingFields: params.missingFields,
        problemFields: params.problemFields,
        retryCount: params.retryCount,
        maxRetries: params.maxRetries,
        willRetry: params.willRetry,
      },
    });
  }

  private async failForExhaustedOutputContract(params: {
    workflowRunId: string;
    jobId: string;
    requiredFields: string[];
    missingFields: string[];
    problemFields: string[];
    retryCount: number;
    maxRetries: number;
  }): Promise<never> {
    const message =
      `Job ${params.jobId} run ${params.workflowRunId}: output_contract fields [${params.problemFields.join(', ')}] not provided. ` +
      `Max retries (${params.maxRetries}) exhausted — failing job.`;

    await this.eventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: 'job.output_contract.exhausted',
      jobId: params.jobId,
      payload: {
        requiredFields: params.requiredFields,
        missingFields: params.missingFields,
        problemFields: params.problemFields,
        retryCount: params.retryCount,
        maxRetries: params.maxRetries,
      },
    });

    await this.emitOutputContractExhaustedFeedback(params);

    this.logger.error(message);
    throw new Error(message);
  }

  private async emitOutputContractExhaustedFeedback(params: {
    workflowRunId: string;
    jobId: string;
    requiredFields: string[];
    missingFields: string[];
    problemFields: string[];
    retryCount: number;
    maxRetries: number;
  }): Promise<void> {
    const sortedProblemFields = [...params.problemFields].sort();

    try {
      await this.runtimeFeedback.ingest({
        signal_type: 'workflow_anomaly',
        source_module: 'workflow-step-execution',
        scope: {
          scope_type: 'workflow_run',
          scope_id: params.workflowRunId,
        },
        affected: {
          workflow_run_id: params.workflowRunId,
          job_id: params.jobId,
          failure_class: 'output_contract_exhausted',
          schema_path: sortedProblemFields.join(','),
        },
        evidence: [
          {
            kind: 'output_contract_exhausted',
            summary:
              `Output contract exhausted after ${params.maxRetries} retries; problem fields: ` +
              sortedProblemFields.join(', '),
          },
        ],
        examples: [],
        confidence: 0.85,
        severity: 'high',
        dedupe_fingerprint: [
          'workflow_anomaly',
          'output_contract_exhausted',
          params.workflowRunId,
          params.jobId,
          sortedProblemFields.join(','),
        ].join(':'),
        occurred_at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Job ${params.jobId} run ${params.workflowRunId}: failed to emit runtime feedback for exhausted output_contract: ${message}`,
      );
    }
  }

  private async logRetryEnqueued(params: {
    workflowRunId: string;
    jobId: string;
    requiredFields: string[];
    missingFields: string[];
    problemFields: string[];
    retryCount: number;
    maxRetries: number;
    sessionTreeId?: string;
  }): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: 'job.output_contract.retry_enqueued',
      jobId: params.jobId,
      payload: {
        requiredFields: params.requiredFields,
        missingFields: params.missingFields,
        problemFields: params.problemFields,
        retryCount: params.retryCount + 1,
        maxRetries: params.maxRetries,
        resumeSession: typeof params.sessionTreeId === 'string',
      },
    });
  }
}
