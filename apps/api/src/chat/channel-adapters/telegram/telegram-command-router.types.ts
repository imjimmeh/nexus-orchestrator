import type { ChatSessionSummaryDto } from '../../chat-sessions/chat-sessions.types';

export type CommandExecutionResult = {
  status: 'success' | 'denied' | 'error';
  chatSession: ChatSessionSummaryDto;
  responseText: string;
};
