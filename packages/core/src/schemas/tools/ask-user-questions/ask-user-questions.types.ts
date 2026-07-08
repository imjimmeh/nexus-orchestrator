import { z } from "zod";
import {
  AskUserQuestionSchema,
  AskUserQuestionsSchema,
  AskUserQuestionAnswerSchema,
} from "./ask-user-questions.schemas";

export type AskUserQuestion = z.infer<typeof AskUserQuestionSchema>;
export type AskUserQuestionsInput = z.infer<typeof AskUserQuestionsSchema>;
export type AskUserQuestionAnswer = z.infer<typeof AskUserQuestionAnswerSchema>;
