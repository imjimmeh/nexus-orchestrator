import type {
  ChatSessionFailureInfo,
  ChatSessionListItem,
  ChatSessionRetryMetadata,
  CreateChatSessionRequest,
} from "./chat-sessions.types";
import type { ApiClientWorkflowMethods } from "./client.workflow.types";

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

type RetryChatSessionNowResult = Awaited<
  ReturnType<ApiClientWorkflowMethods["retryChatSessionNow"]>
>;

export const retryChatSessionNowReturnsSessionSummary: ChatSessionListItem =
  {} as RetryChatSessionNowResult;

export const chatSessionListItemUsesCamelCaseSessionType: ChatSessionListItem =
  {
    id: "chat-session-1",
    sessionType: "general",
    status: "RUNNING",
    executionState: "running",
    retryMetadata: null,
    failureInfo: null,
    agentProfileName: "Assistant",
    projectId: null,
    projectName: null,
    displayName: "General chat",
    initialMessage: "hello",
    workflowRunId: null,
    createdAt: "2026-04-14T10:00:00.000Z",
    completedAt: null,
  };

export const createChatSessionRequestUsesCamelCaseSessionType: CreateChatSessionRequest =
  {
    agentProfileName: "Assistant",
    initialMessage: "hello",
    sessionType: "general",
  };

export const chatSessionListItemRejectsSnakeCaseSessionType: ChatSessionListItem =
  {
    ...chatSessionListItemUsesCamelCaseSessionType,
    // @ts-expect-error API chat-session list items should expose sessionType.
    session_type: "general",
  };

export const createChatSessionRequestRejectsSnakeCaseSessionType: CreateChatSessionRequest =
  {
    ...createChatSessionRequestUsesCamelCaseSessionType,
    // @ts-expect-error Create chat-session requests should use sessionType.
    session_type: "general",
  };

export const retryMetadataWithUnexpectedField: ChatSessionRetryMetadata = {
  // @ts-expect-error Retry metadata should reject unmodeled API fields.
  unexpectedField: true,
};

export const failureInfoWithUnexpectedField: ChatSessionFailureInfo = {
  // @ts-expect-error Failure info should reject unmodeled API fields.
  unexpectedField: true,
};
