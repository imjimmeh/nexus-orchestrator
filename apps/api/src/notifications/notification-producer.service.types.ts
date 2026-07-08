export interface UserQuestionsPosedPayload {
  workflowRunId: string;
  questions: Array<Record<string, unknown>>;
}

export interface UserQuestionsAnsweredPayload {
  workflowRunId: string;
}
