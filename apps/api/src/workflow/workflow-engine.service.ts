import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IJob,
  IToolPermissionPolicy,
  SkillDiscoveryMode,
  WorkflowStatus,
} from '@nexus/core';
import { WorkflowJobMessageQueueService } from './workflow-job-message-queue.service';
import {
  StartWorkflowOptions,
  WorkflowDryRunResult,
} from './workflow-engine.types';
import {
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
} from './workflow-events.constants';
import type { WorkflowRunEvent } from './workflow-events.types';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowLaunchDedupeService } from './workflow-launch-dedupe.service';
import { WorkflowDefinitionLoaderService } from './workflow-definition-loader.service';
import { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import { WorkflowEngineLaunchOrchestratorService } from './workflow-engine-launch-orchestrator.service';
import {
  WORKFLOW_CANCELLATION_CASCADE_SERVICE,
  type IWorkflowCancellationCascadeService,
  type IWorkflowEngineService,
} from './kernel/interfaces/workflow-kernel.ports';
import type { ResumeJobOptions } from './workflow-job-message-queue.types';

@Injectable()
export class WorkflowEngineService implements IWorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly persistence: WorkflowPersistenceService,
    private readonly workflowDefinitionLoader: WorkflowDefinitionLoaderService,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowLaunchDedupe: WorkflowLaunchDedupeService,
    private readonly jobMessageQueue: WorkflowJobMessageQueueService,
    @Inject(WORKFLOW_CANCELLATION_CASCADE_SERVICE)
    private readonly cancellationCascade: IWorkflowCancellationCascadeService,
    private readonly launchOrchestrator: WorkflowEngineLaunchOrchestratorService,
  ) {}

  async startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options: StartWorkflowOptions & { dryRun: true },
  ): Promise<WorkflowDryRunResult>;
  async startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options?: StartWorkflowOptions,
  ): Promise<string | null>;
  async startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options: StartWorkflowOptions = {},
  ): Promise<string | null | WorkflowDryRunResult> {
    const requestedWorkflowId = workflowId;
    const wf = await this.persistence.getWorkflow(workflowId);
    if (!wf.is_active) {
      throw new Error(`Workflow ${requestedWorkflowId} is not active`);
    }
    const persistedWorkflowId = wf.id;

    const def = await this.workflowDefinitionLoader.loadExecutableDefinition(
      wf.yaml_definition,
    );

    if (options.dryRun === true) {
      return this.launchOrchestrator.simulateDryRun(
        requestedWorkflowId,
        triggerData,
        def,
        options,
      );
    }

    const launch = this.workflowLaunchDedupe.prepareTriggerData(triggerData);
    return this.launchOrchestrator.startAndDedupRun(
      persistedWorkflowId,
      launch.triggerData,
      def,
    );
  }

  public async cancelWorkflowRun(
    runId: string,
    reason = 'concurrency_cancel_running',
  ): Promise<void> {
    return this.cancellationCascade.cancelRun(runId, reason);
  }

  async handleJobComplete(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.runExecution.handleJobComplete(workflowRunId, jobId, output);
  }

  async pauseWorkflow(workflowRunId: string): Promise<void> {
    const run = await this.persistence.updateRunStatus(
      workflowRunId,
      WorkflowStatus.PENDING,
    );
    const pausedEvent: WorkflowRunEvent = {
      workflowRunId,
      workflowId: run.workflow_id,
      status: WorkflowStatus.PENDING,
      stateVariables: run.state_variables,
    };
    this.eventEmitter.emit(WORKFLOW_RUN_PAUSED_EVENT, pausedEvent);
  }

  async resumeWorkflow(workflowRunId: string): Promise<void> {
    const run = await this.persistence.getWorkflowRun(workflowRunId);
    if (run?.status !== WorkflowStatus.PENDING) return;

    const resumedRun = await this.persistence.updateRunStatus(
      workflowRunId,
      WorkflowStatus.RUNNING,
    );

    const resumedEvent: WorkflowRunEvent = {
      workflowRunId,
      workflowId: resumedRun.workflow_id,
      status: WorkflowStatus.RUNNING,
      stateVariables: resumedRun.state_variables,
    };
    this.eventEmitter.emit(WORKFLOW_RUN_RESUMED_EVENT, resumedEvent);

    if (run.current_step_id) {
      const wf = await this.persistence.getWorkflow(run.workflow_id);
      const def = await this.workflowDefinitionLoader.loadExecutableDefinition(
        wf.yaml_definition,
      );
      await this.runExecution.enqueueJob(
        workflowRunId,
        def,
        run.current_step_id,
      );
    }
  }

  async resumeJobWithMessage(
    workflowRunId: string,
    sessionTreeId: string,
    userMessage: string,
    options?: ResumeJobOptions,
  ): Promise<string> {
    return this.jobMessageQueue.resumeJobWithMessage(
      workflowRunId,
      sessionTreeId,
      userMessage,
      options,
    );
  }

  async retryJobWithMessage(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    sessionTreeId: string | undefined,
    retryPrompt: string,
    workflowPermissions?: IToolPermissionPolicy,
    workflowSkillDiscoveryMode?: SkillDiscoveryMode,
    workflowYamlSkills?: string[],
  ): Promise<void> {
    await this.jobMessageQueue.retryJobWithMessage(
      workflowRunId,
      jobId,
      job,
      sessionTreeId,
      retryPrompt,
      workflowPermissions,
      workflowSkillDiscoveryMode,
      workflowYamlSkills,
    );
  }
}
