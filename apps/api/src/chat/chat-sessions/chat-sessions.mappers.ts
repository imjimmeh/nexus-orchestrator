import {
  ChatSessionSource,
  ChatSessionStatus,
  type ChatSessionExecutionState,
  type ChatSessionFailureInfo,
  ChatSessionJobData,
  type ChatSessionRetryMetadata,
  ChatSessionType,
} from '@nexus/core';
import type { ChatSession } from '../database/entities/chat-session.entity';
import type {
  ChatMessageTimelineItem,
  ChatSessionSummaryDto,
} from './chat-sessions.types';

export async function mapSessionSummaryDto(
  session: {
    id: string;
    status: string;
    execution_state: ChatSessionExecutionState;
    retry_metadata?: ChatSessionRetryMetadata | null;
    failure_info?: ChatSessionFailureInfo | null;
    session_type: ChatSessionType;
    agent_profile_name: string;
    scopeId?: string | null;
    display_name?: string | null;
    initial_message: string;
    workflow_run_id?: string | null;
    source?: ChatSessionSource;
    parent_chat_session_id?: string | null;
    created_at: Date;
    completed_at?: Date | null;
  },
  resolveProjectName: (scopeId: string) => Promise<string | null>,
): Promise<ChatSessionSummaryDto> {
  const projectName = session.scopeId
    ? await resolveProjectName(session.scopeId)
    : null;

  return {
    id: session.id,
    status: session.status,
    executionState: session.execution_state,
    retryMetadata: session.retry_metadata ?? null,
    failureInfo: session.failure_info ?? null,
    sessionType: session.session_type,
    agentProfileName: session.agent_profile_name,
    scopeId: session.scopeId ?? null,
    projectName,
    displayName:
      session.display_name ?? `Chat with ${session.agent_profile_name}`,
    initialMessage: session.initial_message,
    workflowRunId: session.workflow_run_id ?? null,
    source: session.source ?? ChatSessionSource.AD_HOC,
    parentChatSessionId: session.parent_chat_session_id ?? null,
    createdAt: session.created_at,
    completedAt: session.completed_at ?? null,
  };
}

export function mapTimelineItems(
  messages: Array<{
    id: string;
    direction: string;
    sender: string;
    channel: string;
    event_type: string;
    text: string;
    run_id?: string | null;
    run_status?: string | null;
    created_at: Date;
  }>,
): ChatMessageTimelineItem[] {
  const normalizeDirection = (
    value: string,
  ): ChatMessageTimelineItem['direction'] =>
    value === 'outbound' ? 'outbound' : 'inbound';

  const normalizeSender = (
    value: string,
  ): ChatMessageTimelineItem['sender'] => {
    if (value === 'assistant' || value === 'system') {
      return value;
    }
    return 'user';
  };

  return messages.map((message) => ({
    id: message.id,
    direction: normalizeDirection(message.direction),
    sender: normalizeSender(message.sender),
    channel: message.channel,
    eventType: message.event_type,
    text: message.text,
    runId: message.run_id ?? null,
    runStatus: message.run_status ?? null,
    createdAt: message.created_at,
  }));
}

export function buildChatSessionJobData(params: {
  session: {
    id: string;
    agent_profile_name: string;
    agent_profile_id: string;
    scopeId?: string | null;
    initial_message: string;
  };
  tierPreference: string | null;
  lightTier: number;
  heavyTier: number;
}): ChatSessionJobData {
  const normalizedTier = params.tierPreference?.trim().toLowerCase();
  return {
    chatSessionId: params.session.id,
    agentProfileName: params.session.agent_profile_name,
    agentProfileId: params.session.agent_profile_id,
    contextId: params.session.scopeId ?? null,
    contextType: params.session.scopeId ? 'project' : null,
    initialMessage: params.session.initial_message,
    containerTier:
      normalizedTier === 'heavy' ? params.heavyTier : params.lightTier,
  };
}

export function buildChatSessionCreatePayload(params: {
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
}): Partial<ChatSession> {
  return {
    status: params.status,
    execution_state: params.executionState,
    session_type: params.sessionType ?? ChatSessionType.GENERAL,
    agent_profile_id: params.profile.id,
    agent_profile_name: params.profile.name,
    scopeId: params.scopeId ?? null,
    initial_message: params.initialMessage,
    display_name: params.displayName ?? null,
    source: params.source,
    harness_id: params.harnessId ?? null,
    ...params.overrides,
  };
}
