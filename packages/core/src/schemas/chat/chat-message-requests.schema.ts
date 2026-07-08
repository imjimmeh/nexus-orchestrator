import { z } from "zod";

export const sendChatMessageSchema = z.object({
  message: z.string().max(4000),
  attachmentIds: z.array(z.uuid()).optional().default([]),
});

export const chatQuestionAnswerSchema = z.object({
  questionIndex: z.number().int().min(0),
  selectedOption: z.string().nullable(),
  freeTextAnswer: z.string().nullable(),
});

export const submitChatQuestionAnswersSchema = z.object({
  answers: z.array(chatQuestionAnswerSchema).min(1),
});

export type SendChatMessageRequest = z.infer<typeof sendChatMessageSchema>;

export type ChatQuestionAnswerRequest = z.infer<
  typeof chatQuestionAnswerSchema
>;

export type SubmitChatQuestionAnswersRequest = z.infer<
  typeof submitChatQuestionAnswersSchema
>;
