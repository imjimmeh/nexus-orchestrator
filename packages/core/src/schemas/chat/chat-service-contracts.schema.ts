import { z } from "zod";

const IsoTimestampSchema = z.iso.datetime();

const ChatMessageTimelineItemV1Schema = z
  .object({
    id: z.string().min(1),
    direction: z.enum(["inbound", "outbound"]),
    sender: z.enum(["user", "assistant", "system"]),
    channel: z.string().min(1),
    eventType: z.string().min(1),
    text: z.string(),
    runId: z.string().min(1).nullable(),
    runStatus: z.string().min(1).nullable(),
    createdAt: IsoTimestampSchema,
  })
  .strict();

const ChatSessionSummaryV1Schema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    agentProfileName: z.string().min(1),
    contextId: z.string().min(1).nullable(),
    contextType: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    initialMessage: z.string(),
    createdAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema.nullable(),
  })
  .strict();

const ChatSessionDetailsV1Schema = ChatSessionSummaryV1Schema.extend({
  model: z.string().min(1).nullable(),
  provider: z.string().min(1).nullable(),
  containerTier: z.number().int(),
  errorMessage: z.string().nullable(),
  messageTimeline: z.array(ChatMessageTimelineItemV1Schema),
}).strict();

const ChatEventHistoryItemV1Schema = z
  .object({
    event_type: z.string().min(1),
    timestamp: IsoTimestampSchema,
    payload: z
      .object({
        chatSessionId: z.string().min(1),
        messageId: z.string().min(1),
        direction: z.enum(["inbound", "outbound"]),
        sender: z.enum(["user", "assistant", "system"]),
        channel: z.string().min(1),
        text: z.string(),
        runId: z.string().min(1).nullable(),
        runStatus: z.string().min(1).nullable(),
        metadata: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();

const ChatMessageAcceptedV1Schema = z
  .object({
    acknowledged: z.literal(true),
    messageId: z.string().min(1),
    runId: z.string().min(1).nullable(),
    runStatus: z.string().min(1).nullable(),
  })
  .strict();

const ChatQuestionAnswersAcceptedV1Schema = z
  .object({
    acknowledged: z.literal(true),
  })
  .strict();

const SuccessEnvelope = <TData extends z.ZodType>(schema: TData) =>
  z
    .object({
      success: z.literal(true),
      data: schema,
    })
    .strict();

export const ChatCreateSessionResponseV1Schema = SuccessEnvelope(
  z
    .object({
      id: z.string().min(1),
    })
    .strict(),
);

export const ChatListSessionsResponseV1Schema = SuccessEnvelope(
  z.array(ChatSessionSummaryV1Schema),
);

export const ChatGetSessionResponseV1Schema = SuccessEnvelope(
  ChatSessionDetailsV1Schema,
);

export const ChatCancelSessionResponseV1Schema = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const ChatGetSessionEventsResponseV1Schema = SuccessEnvelope(
  z.array(ChatEventHistoryItemV1Schema),
);

export const ChatSendMessageResponseV1Schema = SuccessEnvelope(
  ChatMessageAcceptedV1Schema,
);

export const ChatSubmitQuestionAnswersResponseV1Schema = SuccessEnvelope(
  ChatQuestionAnswersAcceptedV1Schema,
);

export * from "./chat-service-contracts.schema.types";
