import {
  type ChatSessionExecutionState,
  ChatSessionSource,
  type ChatSessionStatus,
  ChatSessionType,
} from '@nexus/core';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';

export interface SubagentChatSessionCreatePayload {
  profile: { id: string; name: string };
  status: ChatSessionStatus;
  executionState: ChatSessionExecutionState;
  source: ChatSessionSource;
  initialMessage: string;
  displayName?: string | null;
  scopeId?: string | null;
  sessionType?: ChatSessionType;
  harnessId?: string | null;
  overrides?: Partial<ChatSession>;
}

export interface ISubagentChatSessionPort {
  createSubagentChatSession(
    payload: SubagentChatSessionCreatePayload,
  ): Promise<string | null>;
}
