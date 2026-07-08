import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { UserQuestionAwaitService } from './user-question-await.service';
import type { PostedQuestion } from '../database/entities/user-question-await.entity.types';

const USER_QUESTIONS_POSED_EVENT = 'workflow.user_questions.posed';
const USER_QUESTIONS_ANSWERED_EVENT = 'workflow.user_questions.answered';

/**
 * Keeps `workflow_runs.awaiting_input` in sync with the question lifecycle.
 *
 * While a run is awaiting a human answer it is intentionally idle: the agent is
 * blocked inside `ask_user_questions`. Without this flag, reconciliation treats
 * the idle run as stalled and re-enqueues its job, which kills the container the
 * agent is blocked in and replays the prompt — an infinite ask/kill/restart loop.
 */
@Injectable()
export class WorkflowRunAwaitingInputListener {
  private readonly logger = new Logger(WorkflowRunAwaitingInputListener.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly questionAwaits: UserQuestionAwaitService,
  ) {}

  @OnEvent(USER_QUESTIONS_POSED_EVENT)
  async handleQuestionsPosed(payload: {
    workflowRunId?: string;
    stepId?: string;
    questions?: PostedQuestion[];
  }): Promise<void> {
    await this.setAwaitingInput(payload?.workflowRunId, true);

    if (payload?.workflowRunId && payload?.stepId) {
      try {
        await this.questionAwaits.recordPosed({
          workflowRunId: payload.workflowRunId,
          stepId: payload.stepId,
          questions: payload.questions ?? [],
        });
      } catch (error) {
        this.logger.warn(
          `Failed to persist posed questions for run ${payload.workflowRunId}: ${(error as Error).message}`,
        );
      }
    }
  }

  @OnEvent(USER_QUESTIONS_ANSWERED_EVENT)
  async handleQuestionsAnswered(payload: {
    workflowRunId?: string;
  }): Promise<void> {
    await this.setAwaitingInput(payload?.workflowRunId, false);
  }

  private async setAwaitingInput(
    workflowRunId: string | undefined,
    awaitingInput: boolean,
  ): Promise<void> {
    if (!workflowRunId) {
      return;
    }
    try {
      await this.runRepo.setAwaitingInput(workflowRunId, awaitingInput);
    } catch (error) {
      this.logger.warn(
        `Failed to set awaiting_input=${String(awaitingInput)} for run ${workflowRunId}: ${(error as Error).message}`,
      );
    }
  }
}
