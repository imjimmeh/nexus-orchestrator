import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IJob,
  IToolPermissionPolicy,
  IWorkflowDefinition,
  SkillDiscoveryMode,
  WorkflowStatus,
  isTerminalWorkflowRunStatus,
} from '@nexus/core';
import { Queue } from 'bullmq';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { PromptLoaderService } from './prompt-loader.service';
import { WorkflowParserService } from './workflow-parser.service';
import { buildRequiredToolRetryQueueJobId } from './workflow-job-identity.helpers';
import type { ResumeJobOptions } from './workflow-job-message-queue.types';

export type { ResumeJobOptions } from './workflow-job-message-queue.types';

@Injectable()
export class WorkflowJobMessageQueueService {
  private readonly logger = new Logger(WorkflowJobMessageQueueService.name);

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly parser: WorkflowParserService,
    private readonly promptLoader: PromptLoaderService,
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
  ) {}

  async resumeJobWithMessage(
    workflowRunId: string,
    sessionTreeId: string | undefined,
    userMessage: string,
    options?: ResumeJobOptions,
  ): Promise<string> {
    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }

    // A terminal run (cancelled, completed, or failed) must never be flipped
    // back to RUNNING. Without this guard a durable agent-await resume — driven
    // by the reconciler or a child-terminal event after the user aborted —
    // resurrects a cancelled run, defeating the abort. This is the backstop for
    // every resume vehicle (await join, steering, question-answer injection).
    if (isTerminalWorkflowRunStatus(run.status)) {
      throw new Error(
        `Cannot resume workflow run ${workflowRunId}: it is in terminal ` +
          `status ${run.status}.`,
      );
    }

    const def = await this.loadWorkflowDefinition(run.workflow_id);
    const job = this.resolveTargetJob(run, def, options?.jobId);

    await this.runRepo.update(workflowRunId, {
      status: WorkflowStatus.RUNNING,
    });

    await this.stepQueue.add(
      'execute-job',
      {
        workflowRunId,
        jobId: job.id,
        job,
        workflowPermissions: def.permissions || undefined,
        workflowSkillDiscoveryMode: def.skill_discovery_mode || undefined,
        workflowYamlSkills: def.skills || undefined,
        ...(sessionTreeId ? { resumeSessionTreeId: sessionTreeId } : {}),
        userMessage,
        ...(options?.resumeSessionRef
          ? { resumeSessionRef: options.resumeSessionRef }
          : {}),
      },
      {
        attempts: 1,
      },
    );

    this.logger.log(
      sessionTreeId
        ? `Enqueued resumed job ${job.id} for run ${workflowRunId} with session tree ${sessionTreeId}`
        : `Enqueued resumed job ${job.id} for run ${workflowRunId} via session ref`,
    );

    return job.id;
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
    const retryPayload = {
      workflowRunId,
      jobId,
      job,
      workflowPermissions,
      workflowSkillDiscoveryMode,
      workflowYamlSkills,
      userMessage: retryPrompt,
      ...(sessionTreeId ? { resumeSessionTreeId: sessionTreeId } : {}),
    };

    const retryQueueJobId = buildRequiredToolRetryQueueJobId(
      workflowRunId,
      jobId,
    );

    await this.stepQueue.add('execute-job', retryPayload, {
      attempts: 1,
      jobId: retryQueueJobId,
      removeOnComplete: true,
      removeOnFail: true,
    });

    if (sessionTreeId) {
      this.logger.log(
        `Enqueued retry for job ${jobId} run ${workflowRunId} with session tree ${sessionTreeId}`,
      );
      return;
    }

    this.logger.log(
      `Enqueued stateless retry for job ${jobId} run ${workflowRunId}`,
    );
  }

  /**
   * Determines which job to resume. Priority order:
   * 1. Explicit `jobId` from caller options
   * 2. `_internal.current_job_id` from run state (reflects the actual running job)
   * 3. `current_step_id` on the run (frozen at launch — stale for parallel-job workflows)
   * 4. Last job in the definition (fallback)
   */
  private resolveTargetJob(
    run: {
      current_step_id?: string | null;
      state_variables?: Record<string, unknown> | null;
    },
    def: IWorkflowDefinition,
    explicitJobId?: string,
  ): IJob {
    const internal = (run.state_variables?._internal ?? {}) as {
      current_job_id?: string;
    };
    const targetJobId =
      explicitJobId ??
      internal.current_job_id ??
      run.current_step_id ??
      def.jobs?.at(-1)?.id;

    const job = def.jobs?.find((candidate) => candidate.id === targetJobId);
    if (!job) {
      throw new NotFoundException('Cannot determine which job to resume');
    }

    return job;
  }

  private async loadWorkflowDefinition(
    workflowId: string,
  ): Promise<IWorkflowDefinition> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const parsedDefinition = this.parser.parseWorkflow(
      workflow.yaml_definition,
    );
    return this.promptLoader.resolveWorkflowPromptsWithRetry(parsedDefinition);
  }
}
