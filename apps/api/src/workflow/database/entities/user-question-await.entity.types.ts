export type UserQuestionAwaitStatus =
  | 'pending'
  | 'answered'
  | 'failed_delivery'
  | 'superseded'
  | 'cancelled';

export type UserQuestionDeliveryChannel = 'ws' | 'resume';

export interface PostedQuestion {
  question: string;
  options?: string[];
}

export interface SubmittedAnswer {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}
