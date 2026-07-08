import type { AnswerQuestionsHandler } from "../chat.types";

export interface QuestionSubmissionHandlers {
  /** True when the submit buttons should be disabled. */
  readonly disabled: boolean;
  /** Whether the option button is currently selected for the question index. */
  isOptionSelected: (questionIndex: number, option: string) => boolean;
  /** Whether the question is currently in "Other" free-text mode. */
  isOtherActive: (questionIndex: number) => boolean;
  /** Current free-text input value for the question's "Other" field. */
  otherAnswer: string;
  /** Update the free-text input value. */
  setOtherAnswer: (value: string) => void;
  /** Open the free-text input for a question (triggered by the "Other" option). */
  showOtherInput: (questionIndex: number) => void;
  /** Submit the chosen option for a question. */
  submitOption: (questionIndex: number, selectedOption: string) => void;
  /** Submit the free-text answer for the question currently in "Other" mode. */
  submitOther: (questionIndex: number) => void;
}

export interface UseQuestionSubmissionParams {
  answeringQuestions?: boolean;
  onAnswerQuestions?: AnswerQuestionsHandler;
}