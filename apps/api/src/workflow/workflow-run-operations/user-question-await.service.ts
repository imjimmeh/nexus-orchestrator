import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserQuestionAwaitRepository } from '../database/repositories/user-question-await.repository';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { PostedQuestion } from '../database/entities/user-question-await.entity.types';

interface InternalState {
  current_job_id?: string;
}

/**
 * Owns the durable lifecycle of ask_user_questions interactions. The job id
 * is captured at pose time from `_internal.current_job_id` because
 * `current_step_id` only reflects the first/last *advanced* job and is wrong
 * for parallel-job workflows.
 */
@Injectable()
export class UserQuestionAwaitService {
  private readonly logger = new Logger(UserQuestionAwaitService.name);

  constructor(
    private readonly awaitRepo: UserQuestionAwaitRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  async recordPosed(input: {
    workflowRunId: string;
    stepId: string;
    questions: PostedQuestion[];
  }): Promise<void> {
    const run = await this.runRepo.findById(input.workflowRunId);
    if (!run) {
      this.logger.warn(
        `Questions posed for unknown run ${input.workflowRunId}; not persisting`,
      );
      return;
    }

    const internal = (run.state_variables?._internal ?? {}) as InternalState;
    const jobId = internal.current_job_id ?? run.current_step_id;
    if (!jobId) {
      this.logger.warn(
        `Cannot resolve posing job for run ${input.workflowRunId}; not persisting`,
      );
      return;
    }

    await this.awaitRepo.createPosed({
      workflowRunId: input.workflowRunId,
      jobId,
      stepId: input.stepId,
      questions: input.questions,
    });
  }

  async cancelForRun(workflowRunId: string): Promise<void> {
    await this.awaitRepo.cancelOpenForRun(workflowRunId);
  }
}
