import type { z } from "zod";
import {
  ChatCancelSessionResponseV1Schema,
  ChatCreateSessionResponseV1Schema,
  ChatGetSessionEventsResponseV1Schema,
  ChatGetSessionResponseV1Schema,
  ChatListSessionsResponseV1Schema,
  ChatSendMessageResponseV1Schema,
  ChatSubmitQuestionAnswersResponseV1Schema,
} from "./chat-service-contracts.schema";

export type ChatCreateSessionResponseV1Shape = z.infer<
  typeof ChatCreateSessionResponseV1Schema
>;
export type ChatListSessionsResponseV1Shape = z.infer<
  typeof ChatListSessionsResponseV1Schema
>;
export type ChatGetSessionResponseV1Shape = z.infer<
  typeof ChatGetSessionResponseV1Schema
>;
export type ChatCancelSessionResponseV1Shape = z.infer<
  typeof ChatCancelSessionResponseV1Schema
>;
export type ChatGetSessionEventsResponseV1Shape = z.infer<
  typeof ChatGetSessionEventsResponseV1Schema
>;
export type ChatSendMessageResponseV1Shape = z.infer<
  typeof ChatSendMessageResponseV1Schema
>;
export type ChatSubmitQuestionAnswersResponseV1Shape = z.infer<
  typeof ChatSubmitQuestionAnswersResponseV1Schema
>;
