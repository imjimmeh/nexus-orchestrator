export interface TelegramIngressAck {
  acknowledged: true;
  ignored?: true;
  chatSessionId?: string;
  messageId?: string;
  runId?: string | null;
  runStatus?: string | null;
}
