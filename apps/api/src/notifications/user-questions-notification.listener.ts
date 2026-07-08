import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationProducerService } from './notification-producer.service';

const USER_QUESTIONS_POSED_EVENT = 'workflow.user_questions.posed';
const USER_QUESTIONS_ANSWERED_EVENT = 'workflow.user_questions.answered';

@Injectable()
export class UserQuestionsNotificationListener {
  constructor(private readonly producer: NotificationProducerService) {}

  @OnEvent(USER_QUESTIONS_POSED_EVENT)
  async handleQuestionsPosed(payload: {
    workflowRunId: string;
    questions?: Array<Record<string, unknown>>;
  }): Promise<void> {
    await this.producer.handleUserQuestionsPosed({
      workflowRunId: payload.workflowRunId,
      questions: payload.questions ?? [],
    });
  }

  @OnEvent(USER_QUESTIONS_ANSWERED_EVENT)
  async handleQuestionsAnswered(payload: {
    workflowRunId: string;
  }): Promise<void> {
    await this.producer.handleUserQuestionsAnswered({
      workflowRunId: payload.workflowRunId,
    });
  }
}
