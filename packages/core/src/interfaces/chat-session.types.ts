export enum ChatSessionStatus {
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum ChatSessionType {
  GENERAL = "general",
  STEERING = "steering",
}

export enum ChatSessionSource {
  AD_HOC = "ad-hoc",
  SUBAGENT = "subagent",
}

export type ChatSessionExecutionState =
  | "idle"
  | "starting"
  | "running"
  | "retry_scheduled"
  | "failed"
  | "completed"
  | "cancelled";

export interface ChatSessionUsageLimit {
  used?: number;
  limit?: number;
  resetAt?: string;
}

export interface ChatSessionRetryMetadata {
  attempt?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  firstFailureAt?: string;
  reasonCode?: string;
  reasonMessage?: string;
  retryJobId?: string;
  rateLimitResetAt?: string;
  providerTier?: string;
  usageLimit?: ChatSessionUsageLimit;
}

export interface ChatSessionFailureInfo {
  reasonCode?: string;
  message?: string;
  occurredAt?: string;
  retryable?: boolean;
  rateLimitResetAt?: string;
  providerTier?: string;
  usageLimit?: ChatSessionUsageLimit;
}

export interface IChatSession {
  id: string;
  status: ChatSessionStatus;
  executionState: ChatSessionExecutionState;
  retryMetadata?: ChatSessionRetryMetadata | null;
  failureInfo?: ChatSessionFailureInfo | null;
  sessionType: ChatSessionType;
  agentProfileId: string;
  agentProfileName: string;
  context?: { contextId: string; contextType: string } | null;
  initialMessage: string;
  displayName?: string | null;
  containerId?: string | null;
  containerTier: number;
  provider?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  sessionTreeId?: string | null;
  workflowRunId?: string | null;
  errorMessage?: string | null;
  source: ChatSessionSource;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

/** @deprecated Use context?.contextId instead. Maps to context when contextType === 'project'. */
export function getScopeId(session: IChatSession): string | null {
  return session.context?.contextType === "project"
    ? session.context.contextId
    : null;
}
