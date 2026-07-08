export const TELEMETRY_GATEWAY = 'TELEMETRY_GATEWAY';

export type QuestionResponseAnswer = {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
};

export interface ITelemetryGateway {
  sendDehydrateCommand(containerId: string): Promise<void>;
  sendPromptCommand(
    workflowRunId: string,
    stepId: string,
    message: string,
  ): Promise<void>;
  sendQuestionResponseCommand(
    workflowRunId: string,
    stepId: string,
    answers: QuestionResponseAnswer[],
  ): Promise<void>;
  hasActiveAgentSocket(workflowRunId: string, stepId?: string): boolean;
}
