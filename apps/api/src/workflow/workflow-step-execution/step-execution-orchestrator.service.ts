import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WorkflowStatus } from '@nexus/core';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { ExecutionOwnerLeaseService } from '../../execution-lifecycle/execution-owner-lease.service';
import { supersedePriorExecutions } from './step-execution-supersede.helpers';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { JobQueueData } from './step-execution.types';
import { StepEventPublisherService } from './step-event-publisher.service';
import { StepSupportService } from './step-support.service';
import { StepSpecialStepExecutorService } from '../workflow-special-steps/step-special-step-executor.service';
import { StepAgentStepExecutorService } from './step-agent-step-executor.service';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { StepSessionCheckpointRepository } from '../workflow-session-checkpoint/step-session-checkpoint.repository';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import {
  evaluateJobCondition,
  publishJobStartEvent,
  readOptionalString,
  resolveStateVariables,
} from './step-execution-orchestrator.helpers';
import { sanitizeJsonSafeLogText } from '../../docker/container-log-text.utils';
import { isSessionCheckpointResumeEnabled } from '../../config/session-checkpoint.config';
import type {
  DispatchJobResult,
  SkippedJobResult,
} from './step-execution-orchestrator.service.types';
import type { SpecialStepExecutionResult } from '../workflow-special-steps/step-special-step.types';

/**
 * Minimal, guaranteed DB-safe message used when the sanitized failure message
 * still cannot be persisted, so the execution always reaches a terminal state.
 */
const FAILURE_PUBLISH_FALLBACK_MESSAGE =
  'Execution failed; original diagnostic message could not be persisted.';

type PreflightContext = {
  stateVariables: Record<string, unknown>;
  resolvedJobInputs: Record<string, unknown>;
};

type PreflightResult =
  | ({ skipped: true } & SkippedJobResult)
  | (PreflightContext & { specialResult: SpecialStepExecutionResult | null });

@Injectable()
export class StepExecutionOrchestratorService {
  private readonly logger = new Logger(StepExecutionOrchestratorService.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly eventPublisher: StepEventPublisherService,
    private readonly support: StepSupportService,
    private readonly specialStepExecutor: StepSpecialStepExecutorService,
    private readonly agentStepExecutor: StepAgentStepExecutorService,
    private readonly capabilityPreflight: CapabilityPreflightService,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly executionRepo: ExecutionRepository,
    private readonly executionEventPublisher: ExecutionEventPublisher,
    private readonly checkpointRepo: StepSessionCheckpointRepository,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    private readonly executionOwnerLease: ExecutionOwnerLeaseService,
    @Optional() private readonly budgetDecisionService?: BudgetDecisionService,
  ) {}

  async executeJob(
    data: JobQueueData,
    bullJobId: string | number | undefined,
  ): Promise<unknown> {
    const context = await this.resolveJobPreflightContext(data, bullJobId);
    if ('skipped' in context) return context;

    if (context.specialResult) return context.specialResult;

    return this.executeAgentJob({
      data,
      bullJobId,
      stateVariables: context.stateVariables,
      resolvedJobInputs: context.resolvedJobInputs,
    });
  }

  /**
   * Fire-and-poll dispatch for workflow step agent jobs.
   *
   * Performs all pre-flight checks synchronously (run status, condition
   * evaluation, capability preflight), then fires the agent execution in the
   * background and returns immediately with an executionId.  Step completion
   * arrives via StepExecutionCompletionListener which handles
   * workflowEngine.handleJobComplete / handleJobFailed.
   *
   * Special job types (register_tool, invoke_workflow) are still executed
   * synchronously because they are fast and side-effect-free from a BullMQ
   * lock perspective.
   */
  async dispatchJob(
    data: JobQueueData,
    bullJobId: string | number | undefined,
  ): Promise<
    DispatchJobResult | SkippedJobResult | SpecialStepExecutionResult
  > {
    const context = await this.resolveJobPreflightContext(data, bullJobId);
    if ('skipped' in context) return context;

    if (context.specialResult) return context.specialResult;

    return this.dispatchAgentJobBackground({
      data,
      bullJobId,
      stateVariables: context.stateVariables,
      resolvedJobInputs: context.resolvedJobInputs,
    });
  }

  /**
   * Shared pre-flight logic for both executeJob and dispatchJob.
   * Resolves the run state, evaluates the job condition, resolves inputs,
   * runs capability preflight, and handles special job types.
   */
  private async resolveJobPreflightContext(
    data: JobQueueData,
    bullJobId: string | number | undefined,
  ): Promise<PreflightResult> {
    const { workflowRunId, jobId, job } = data;

    const runnableRun = await this.resolveRunnableRun(workflowRunId, jobId);
    if ('skipped' in runnableRun) {
      return runnableRun;
    }

    await publishJobStartEvent(
      this.eventPublisher,
      workflowRunId,
      jobId,
      bullJobId,
    );

    const stateVariables = resolveStateVariables(runnableRun.state_variables);

    const jobCondition = job.condition ?? job.if;
    if (jobCondition) {
      const isConditionMet = evaluateJobCondition(
        this.support,
        jobCondition,
        stateVariables,
      );
      if (!isConditionMet) {
        this.logger.log(
          `Skipping job ${jobId} because condition evaluated to false`,
        );
        return { skipped: true, reason: 'condition_false' };
      }
    }

    const resolvedJobInputs = this.support.resolveJobInputs(
      job.inputs,
      stateVariables,
    );

    const preflightResult =
      await this.capabilityPreflight.preflightJobExecution({
        workflowRunId,
        jobId,
        job,
        stateVariables,
        resolvedJobInputs,
        workflowPermissions: data.workflowPermissions,
        workflowSkillDiscoveryMode: data.workflowSkillDiscoveryMode,
      });

    if (!preflightResult.ok) {
      return this.handlePreflightFailure(workflowRunId, jobId, preflightResult);
    }

    const specialResult = await this.specialStepExecutor.executeSpecialStep(
      workflowRunId,
      jobId,
      job,
      resolvedJobInputs,
      stateVariables,
    );

    return {
      stateVariables,
      resolvedJobInputs,
      specialResult: specialResult ?? null,
    };
  }

  private async dispatchAgentJobBackground(params: {
    data: JobQueueData;
    bullJobId: string | number | undefined;
    stateVariables: Record<string, unknown>;
    resolvedJobInputs: Record<string, unknown>;
  }): Promise<DispatchJobResult> {
    const { data, stateVariables } = params;
    const { workflowRunId, jobId } = data;

    // Populate resume fields from auto-retry before enrichDataWithCheckpointResume so its
    // caller-supplied-fields guard short-circuits to this session, not a fresh lookup.
    if (data.autoRetry?.resume) {
      const { resumeSessionTreeId: treeId, resumeSessionRef: ref } =
        data.autoRetry.resume;
      if (treeId && !data.resumeSessionTreeId)
        data.resumeSessionTreeId = treeId;
      if (ref && !data.resumeSessionRef) data.resumeSessionRef = ref;
    }
    await this.enrichDataWithCheckpointResume(
      data,
      jobId,
      workflowRunId,
      stateVariables,
    );

    const executionId = randomUUID();

    // A new dispatch for this (run, job) replaces any prior attempt. Mark the
    // old executions cancelled BEFORE the new attempt kills their containers,
    // so their resulting agent errors are recognised as expected deaths by the
    // completion listener instead of being double-counted as fresh failures.
    const supersededContainerIds = await supersedePriorExecutions({
      executionRepo: this.executionRepo,
      workflowRunId,
      jobId,
      log: (message) => {
        this.logger.log(message);
      },
    });

    await this.cancelSupersededSubagents(
      supersededContainerIds,
      workflowRunId,
      jobId,
    );

    // Persist the execution record so the completion listener can look up
    // workflow_run_id + context_id (jobId) when the execution.completed event fires.
    await this.executionRepo.create({
      id: executionId,
      kind: 'workflow_step',
      state: 'pending',
      workflow_run_id: workflowRunId,
      context_id: jobId,
      container_tier: 2, // default light tier; actual tier is managed by container support
    });

    await this.executionEventPublisher.created(executionId, {
      kind: 'workflow_step',
      workflow_run_id: workflowRunId,
    });

    // Fire-and-forget: run the full agent execution in the background.
    // Completion / failure is signalled via execution.completed / execution.failed
    // events handled by StepExecutionCompletionListener.
    void this.runAgentJobAndPublishResult(executionId, params).catch(
      (error: unknown) => {
        this.logger.error(
          `Unhandled error in background agent execution ${executionId} for job ${jobId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      },
    );

    this.logger.log(
      `Dispatched background execution ${executionId} for job ${jobId} in run ${workflowRunId}`,
    );

    return { dispatched: true, executionId };
  }

  /** Cancels any in-flight subagents spawned under each superseded container. */
  private async cancelSupersededSubagents(
    parentContainerIds: string[],
    workflowRunId: string,
    jobId: string,
  ): Promise<void> {
    for (const parentContainerId of parentContainerIds) {
      const { cancelled_execution_ids } =
        await this.subagentOrchestrator.cancelActiveForParent(
          parentContainerId,
          { workflowRunId, reason: 'parent step superseded by retry' },
        );
      if (cancelled_execution_ids.length > 0) {
        this.logger.warn(
          `Cancelled ${cancelled_execution_ids.length} in-flight subagent(s) under superseded container ${parentContainerId} (run ${workflowRunId} job ${jobId})`,
        );
      }
    }
  }

  private async runAgentJobAndPublishResult(
    executionId: string,
    params: {
      data: JobQueueData;
      bullJobId: string | number | undefined;
      stateVariables: Record<string, unknown>;
      resolvedJobInputs: Record<string, unknown>;
    },
  ): Promise<void> {
    const { data, bullJobId, stateVariables, resolvedJobInputs } = params;

    const lease = await this.executionOwnerLease.claim(executionId);
    if (!lease.claimed) {
      await this.executionEventPublisher.failed(executionId, {
        failure_reason: 'agent_error',
        error_message: 'Execution owner lease could not be claimed',
      });
      return;
    }

    try {
      // State transitions are owned by ExecutionProjector, driven by these
      // events — never write row state directly here.
      await this.executionEventPublisher.provisioning(executionId);

      await this.checkStepBudget(
        data.workflowRunId,
        readOptionalString(resolvedJobInputs.provider),
        readOptionalString(resolvedJobInputs.model),
      );

      // Token usage is recorded per turn at the telemetry gateway
      // (TurnUsageRecorderService), capturing the full multi-turn session cost.
      await this.agentStepExecutor.executeJob(
        data,
        bullJobId,
        stateVariables,
        resolvedJobInputs,
        executionId,
      );

      await this.executionEventPublisher.completed(executionId);
    } catch (error) {
      const e = error as Error;
      this.logger.error(
        `Background execution ${executionId} failed for job ${data.jobId}: ${e.message}`,
      );

      // Sanitize first: an error_message embedding raw Docker log bytes carries
      // NUL/control bytes that abort the outbox INSERT and silently wedge the
      // run (the execution.failed event that advances it never persists).
      const safeMessage = sanitizeJsonSafeLogText(e.message ?? '');
      try {
        await this.executionEventPublisher.failed(executionId, {
          failure_reason: 'agent_error',
          error_message: safeMessage,
        });
      } catch (publishError) {
        this.logger.error(
          `Failed to publish failure event for execution ${executionId}: ${(publishError as Error).message}`,
        );
        // Defense-in-depth: never leave the run wedged because the diagnostic
        // message could not be persisted. Retry once with a minimal, guaranteed
        // DB-safe payload so the execution still reaches a terminal state.
        try {
          await this.executionEventPublisher.failed(executionId, {
            failure_reason: 'agent_error',
            error_message: FAILURE_PUBLISH_FALLBACK_MESSAGE,
          });
        } catch (fallbackError) {
          this.logger.error(
            `Failed to publish fallback failure event for execution ${executionId}: ${(fallbackError as Error).message}`,
          );
        }
      }
    } finally {
      await lease.stop();
    }
  }

  private async executeAgentJob(params: {
    data: JobQueueData;
    bullJobId: string | number | undefined;
    stateVariables: Record<string, unknown>;
    resolvedJobInputs: Record<string, unknown>;
  }): Promise<unknown> {
    const { data, bullJobId, stateVariables, resolvedJobInputs } = params;

    try {
      await this.checkStepBudget(
        data.workflowRunId,
        readOptionalString(resolvedJobInputs.provider),
        readOptionalString(resolvedJobInputs.model),
      );

      // Token usage is recorded per turn at the telemetry gateway
      // (TurnUsageRecorderService), capturing the full multi-turn session cost.
      const result = await this.agentStepExecutor.executeJob(
        data,
        bullJobId,
        stateVariables,
        resolvedJobInputs,
      );

      return result;
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Failed to execute job ${data.jobId}: ${e.message}`);
      throw error;
    }
  }

  private async handlePreflightFailure(
    workflowRunId: string,
    jobId: string,
    preflightResult: Awaited<
      ReturnType<CapabilityPreflightService['preflightJobExecution']>
    >,
  ): Promise<{
    skipped: true;
    reason: 'capability_preflight_failed';
    preflight: Awaited<
      ReturnType<CapabilityPreflightService['preflightJobExecution']>
    >;
  }> {
    this.logger.warn(
      `Capability preflight failed for run ${workflowRunId} job ${jobId}: ${preflightResult.message}`,
    );

    await this.eventPublisher.publishBestEffort(
      workflowRunId,
      this.eventPublisher.createEvent('capability_preflight_failed', {
        workflowRunId,
        jobId,
        reasonCode: preflightResult.reasonCode,
        message: preflightResult.message,
        remediation: preflightResult.remediation,
        failedTool: preflightResult.failedTool,
        callableToolNames: preflightResult.callableToolNames,
        denied: preflightResult.denied,
      }),
    );

    await this.runExecution.handleJobFailed(
      workflowRunId,
      jobId,
      preflightResult.message || 'Capability preflight failed',
    );

    return {
      skipped: true,
      reason: 'capability_preflight_failed',
      preflight: preflightResult,
    };
  }

  private async checkStepBudget(
    runId: string,
    providerName: string | null,
    modelName: string | null,
  ): Promise<void> {
    try {
      const result = await this.budgetDecisionService?.evaluateAction({
        scopeId: null,
        contextType: 'workflow_run',
        contextId: runId,
        actionType: 'step_execution',
        actorType: 'agent',
        actorId: null,
        providerName,
        modelName,
        expectedTokens: null,
        correlationId: runId,
      });

      if (result?.decision === 'deny') {
        throw new Error(
          `Step execution blocked by budget policy: ${result.reasonCode}`,
        );
      }
      if (result?.decision === 'warn') {
        this.logger.warn(
          `Step approaching budget limits: ${result.reasonCode}`,
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('blocked by budget policy')
      ) {
        throw err;
      }
    }
  }

  /**
   * Enriches `data` in-place with resume fields derived from the latest durable
   * session checkpoint for this (run, job) pair. Uses the harness registry to
   * determine how resume state should be threaded into the queue data based on
   * the checkpoint's `session_ref.kind`.
   */
  private async enrichDataWithCheckpointResume(
    data: JobQueueData,
    jobId: string,
    workflowRunId: string,
    stateVariables: Record<string, unknown>,
  ): Promise<void> {
    // Honour caller-supplied resume fields (e.g. durable-await path).
    // This guard runs before the feature-flag check so that durable-await
    // resume is never affected by SESSION_CHECKPOINT_RESUME_ENABLED.
    if (data.resumeSessionTreeId || data.resumeSessionRef) {
      return;
    }

    // Checkpoint-based resume is gated by the feature flag (default OFF).
    if (!isSessionCheckpointResumeEnabled()) return;

    // A completed job must not be resumed from checkpoint.
    const internalVars = stateVariables._internal as
      | Record<string, unknown>
      | undefined;
    if (internalVars?.completed_jobs) {
      const completedMap = internalVars.completed_jobs as Record<
        string,
        unknown
      >;
      if (completedMap[jobId] === true) {
        return;
      }
    }

    const checkpoint = await this.checkpointRepo.findLatest(
      workflowRunId,
      jobId,
    );
    if (!checkpoint) {
      return;
    }

    const ref = checkpoint.session_ref;
    if (!ref) {
      return;
    }

    const capabilities = this.harnessRegistry.getCapabilitiesForRef(ref);
    if (capabilities.resumeMechanism === 'file_injection' && 'treeId' in ref) {
      data.resumeSessionTreeId = ref.treeId;
    }
    data.resumeSessionRef = ref;

    // Surface an in-flight tool call warning when the tool result was never
    // recorded. Only inject if the caller has not already set userMessage.
    if (checkpoint.phase === 'intent' && !data.userMessage) {
      await this.maybeInjectInFlightToolNote(
        data,
        workflowRunId,
        jobId,
        checkpoint,
      );
    }
  }

  /**
   * Injects a `userMessage` warning when the checkpoint's tool call was still
   * in flight at reap time — i.e. `intent` was recorded but `result` was not.
   * The warning asks the agent to verify state before re-issuing the call to
   * avoid duplicating a side effect that may have already completed.
   */
  private async maybeInjectInFlightToolNote(
    data: JobQueueData,
    workflowRunId: string,
    jobId: string,
    checkpoint: { call_seq: number; tool_name?: string | null },
  ): Promise<void> {
    const resultExists = await this.checkpointRepo.hasResultFor(
      workflowRunId,
      jobId,
      checkpoint.call_seq,
    );
    if (resultExists) {
      return;
    }
    const toolName = checkpoint.tool_name ?? 'an unknown tool';
    data.userMessage =
      `The previous turn was interrupted while tool "${toolName}" (call #${checkpoint.call_seq}) was in flight. ` +
      `Its result was not recorded, so its side effects are UNKNOWN — verify the current state before re-issuing this call to avoid duplicating an action that may have already completed.`;
  }

  private async resolveRunnableRun(
    workflowRunId: string,
    jobId: string,
  ): Promise<
    | { skipped: true; reason: 'run_not_found' }
    | { skipped: true; reason: 'run_not_running'; runStatus: WorkflowStatus }
    | { state_variables: unknown }
  > {
    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      this.logger.warn(
        `Skipping job ${jobId} because workflow run ${workflowRunId} was not found`,
      );
      return { skipped: true, reason: 'run_not_found' };
    }

    if (run.status !== WorkflowStatus.RUNNING) {
      this.logger.warn(
        `Skipping job ${jobId} for workflow run ${workflowRunId} because status is ${run.status}`,
      );
      return {
        skipped: true,
        reason: 'run_not_running',
        runStatus: run.status,
      };
    }

    return { state_variables: run.state_variables };
  }
}
