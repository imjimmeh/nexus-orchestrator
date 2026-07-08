import type {
  ChatSessionFailureInfo,
  ChatSessionRetryMetadata,
  IChatSession,
} from "./chat-session.types";
import {
  ChatSessionSource,
  ChatSessionStatus,
  ChatSessionType,
} from "./chat-session.types";

export const publicChatSessionUsesCamelCaseFields: IChatSession = {
  id: "chat-session-1",
  status: ChatSessionStatus.RUNNING,
  executionState: "running",
  retryMetadata: null,
  failureInfo: null,
  sessionType: ChatSessionType.GENERAL,
  agentProfileId: "agent-profile-1",
  agentProfileName: "ceo-agent",
  context: null,
  initialMessage: "hello",
  displayName: "General chat",
  containerId: null,
  containerTier: 1,
  provider: null,
  model: null,
  systemPrompt: null,
  sessionTreeId: null,
  workflowRunId: null,
  errorMessage: null,
  source: ChatSessionSource.AD_HOC,
  createdAt: new Date("2026-04-14T10:00:00.000Z"),
  updatedAt: new Date("2026-04-14T10:01:00.000Z"),
  completedAt: null,
};

export const publicChatSessionRejectsExecutionStateSnakeCase: IChatSession = {
  ...publicChatSessionUsesCamelCaseFields,
  // @ts-expect-error Public chat sessions should use executionState.
  execution_state: "running",
};

export const publicChatSessionRejectsRetryMetadataSnakeCase: IChatSession = {
  ...publicChatSessionUsesCamelCaseFields,
  // @ts-expect-error Public chat sessions should use retryMetadata.
  retry_metadata: null,
};

export const publicChatSessionRejectsSessionTypeSnakeCase: IChatSession = {
  ...publicChatSessionUsesCamelCaseFields,
  // @ts-expect-error Public chat sessions should use sessionType.
  session_type: ChatSessionType.GENERAL,
};

export const publicChatSessionRejectsAgentProfileSnakeCase: IChatSession = {
  ...publicChatSessionUsesCamelCaseFields,
  // @ts-expect-error Public chat sessions should use agentProfileId.
  agent_profile_id: "agent-profile-1",
};

export const retryMetadataWithVisibilityFields: ChatSessionRetryMetadata = {
  attempt: 1,
  maxAttempts: 3,
  nextRetryAt: "2026-04-14T10:10:00.000Z",
  reasonCode: "rate_limit_exceeded",
  reasonMessage: "Rate limit exceeded",
  retryJobId: "chat-session-retry:chat-1:1",
  rateLimitResetAt: "2026-04-14T10:15:00.000Z",
  providerTier: "standard",
  usageLimit: {
    used: 100,
    limit: 100,
    resetAt: "2026-04-14T10:15:00.000Z",
  },
};

export const failureInfoWithVisibilityFields: ChatSessionFailureInfo = {
  reasonCode: "rate_limit_exceeded",
  message: "Rate limit exceeded",
  occurredAt: "2026-04-14T10:02:00.000Z",
  retryable: true,
  rateLimitResetAt: "2026-04-14T10:15:00.000Z",
  providerTier: "standard",
  usageLimit: {
    used: 100,
    limit: 100,
    resetAt: "2026-04-14T10:15:00.000Z",
  },
};

export const retryMetadataRejectsLegacySnakeCaseFields: ChatSessionRetryMetadata =
  {
    // @ts-expect-error Retry metadata should use maxAttempts.
    max_attempts: 3,
  };

export const retryMetadataRejectsUnknownFields: ChatSessionRetryMetadata = {
  // @ts-expect-error Retry metadata should reject unmodeled API fields.
  unexpectedField: true,
};

export const failureInfoRejectsLegacySnakeCaseFields: ChatSessionFailureInfo = {
  // @ts-expect-error Failure info should use occurredAt.
  failed_at: "2026-04-14T10:02:00.000Z",
};

export const failureInfoRejectsLooseDetails: ChatSessionFailureInfo = {
  // @ts-expect-error Failure info should expose modeled fields, not loose details.
  details: { retryable: true },
};
