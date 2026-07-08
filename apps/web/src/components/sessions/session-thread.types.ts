import { ChatSessionExecutionState, ChatSessionRetryMetadata, ChatSessionStatus } from "@/lib/api/chat-sessions.types";
import { WorkflowRunStatus } from "@/lib/api/common.types";

export type SessionThreadKind = "chat" | "workflow" | "subagent";

export interface SessionThread {
  id: string;
  kind: SessionThreadKind;
  sessionType?: string;
  title: string;
  displayName: string;
  initialMessage?: string;
  status: ChatSessionStatus | WorkflowRunStatus;
  executionState?: ChatSessionExecutionState;
  retryMetadata?: ChatSessionRetryMetadata | null;
  createdAt: string;
  completedAt: string | null;
  lastActivityAt?: string;
  projectName?: string | null;
  agentProfileName?: string;
  workflowId?: string;
  sourceType?: "seed" | "user" | "repository";
  activeParticipantCount?: number;
  parentId?: string | null;
}
