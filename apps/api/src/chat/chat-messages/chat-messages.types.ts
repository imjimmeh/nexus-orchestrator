export interface ChatQuestionAnswerInput {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}

export interface SendChatMessageOptions {
  channel?: string;
  providerMessageId?: string | null;
  correlationId?: string | null;
  externalUserId?: string | null;
  metadata?: Record<string, unknown>;
  requestedBy?: string | null;
  attachmentIds?: string[];
}

export interface SendChatMessageResult {
  acknowledged: true;
  messageId: string;
  runId: string | null;
  runStatus: string | null;
}

export interface ChatEventHistoryItem {
  event_type: string;
  timestamp: string;
  payload: {
    chatSessionId: string;
    messageId: string;
    direction: 'inbound' | 'outbound';
    sender: 'user' | 'assistant' | 'system';
    channel: string;
    text: string;
    runId: string | null;
    runStatus: string | null;
    metadata: Record<string, unknown>;
  };
}

export interface AppendOutboundMessageInput {
  chatId: string;
  text: string;
  channel: string;
  metadata?: Record<string, unknown>;
  providerMessageId?: string | null;
}
