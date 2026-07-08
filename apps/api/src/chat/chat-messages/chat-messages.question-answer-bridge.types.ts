import type { ChatActionQuestionAnswer } from '../chat-actions/chat-actions.types';

export interface ForwardedQuestionAnswer {
  runId: string;
  runStatus: string;
  correlationId: string;
  answers: ChatActionQuestionAnswer[];
}
