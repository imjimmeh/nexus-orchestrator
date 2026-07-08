import { z } from "zod";

export const MAX_QUESTION_OPTIONS = 8;

export const AskUserQuestionSchema = z
  .object({
    question: z.string().trim().min(1),
    options: z
      .array(z.string().trim().min(1))
      .max(MAX_QUESTION_OPTIONS)
      .optional(),
  })
  .strict();

export const AskUserQuestionsSchema = z
  .object({
    questions: z.array(AskUserQuestionSchema).min(1),
  })
  .strict();

export const AskUserQuestionAnswerSchema = z
  .object({
    questionIndex: z.number().int().nonnegative(),
    selectedOption: z.string().trim().nullable(),
    freeTextAnswer: z.string().trim().nullable(),
  })
  .strict();

export * from "./ask-user-questions.types";
