import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserQuestionAwaitRepository } from './database/repositories/user-question-await.repository';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { StateManagerService } from './state-manager.service';
import {
  resolveParkedTurnEnd,
  isIdleQuestionTeardownTimeout,
  clearOrphanedQuestionStateOnRetry,
} from './workflow-question-park.helpers';
import type { ParkedTurnEndAction } from './workflow-question-park.helpers.types';
import type { WorkflowRun } from './database/entities/workflow-run.entity';

/**
 * Owns the awaiting-input / user-question park lifecycle for job execution.
 * Thin orchestration over the pure helpers in `workflow-question-park.helpers`:
 * it binds the durable collaborators (question awaits, run flag, run state) so
 * `WorkflowRunJobExecutionService` can delegate the decisions in one line each.
 */
@Injectable()
export class WorkflowRunQuestionParkService {
  private readonly logger = new Logger(WorkflowRunQuestionParkService.name);

  constructor(
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly stateManager: StateManagerService,
  ) {}

  async resolveParkedTurnEnd(
    run: WorkflowRun,
    jobId: string,
  ): Promise<ParkedTurnEndAction> {
    return resolveParkedTurnEnd({
      run,
      workflowRunId: run.id,
      jobId,
      getVariable: (path) => this.stateManager.getVariable(run.id, path),
      cancelOpenAwaits: (id) => this.questionAwaitRepo.cancelOpenForRun(id),
      clearAwaitingInput: (id) => this.runRepo.setAwaitingInput(id, false),
      logger: this.logger,
    });
  }

  async isIdleQuestionTeardownTimeout(
    isTransportTimeout: boolean,
    run: WorkflowRun,
  ): Promise<boolean> {
    return isIdleQuestionTeardownTimeout({
      isTransportTimeout,
      awaitingInput: run.awaiting_input,
      workflowRunId: run.id,
      findOpenAwait: (id) => this.questionAwaitRepo.findOpenByRunId(id),
    });
  }

  async clearOrphanedQuestionStateOnRetry(run: WorkflowRun): Promise<void> {
    return clearOrphanedQuestionStateOnRetry({
      awaitingInput: run.awaiting_input,
      workflowRunId: run.id,
      cancelOpenAwaits: (id) => this.questionAwaitRepo.cancelOpenForRun(id),
      clearAwaitingInput: (id) => this.runRepo.setAwaitingInput(id, false),
    });
  }
}
