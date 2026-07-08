import type { ChatSession } from '../domain-ports';

/** The subset of `ChatSessionRepository` `resolveChatSessionsForSource` needs. */
export interface ChatSessionLookup {
  findByWorkflowRunId(workflowRunId: string): Promise<ChatSession[]>;
  findById(chatSessionId: string): Promise<ChatSession | null>;
}
