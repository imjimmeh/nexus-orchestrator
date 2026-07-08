import type {
  ChatSessionExecutionState,
  ChatSessionFailureInfo,
  ChatSessionRetryMetadata,
  ChatSessionSource,
  ChatSessionType,
} from '@nexus/core';
import type { LatestBudgetDecisionDto } from '../../cost-governance/types/budget-decision.types';
import type { ChatSessionParticipantRole } from '../database/entities/chat-session-participant.entity.types';

export interface CreateChatSessionParticipantInput {
  agent_profile: string;
  role?: ChatSessionParticipantRole;
}

export interface CreateChatSessionInput {
  agentProfileName: string;
  initialMessage: string;
  sessionType?: ChatSessionType;
  scopeId?: string | null;
  displayName?: string | null;
  participants?: CreateChatSessionParticipantInput[];
  moderatorProfile?: string | null;
  invitedBy?: string | null;
}

export interface ChannelSessionResolveInput {
  provider: string;
  externalUserId: string;
  externalThreadId: string;
  initialMessage: string;
  defaultAgentProfileName: string;
  scopeId?: string | null;
}

export interface ChannelSessionIdentityInput {
  provider: string;
  externalUserId: string;
  externalThreadId: string;
}

export interface SetActiveChannelSessionInput extends ChannelSessionIdentityInput {
  chatSessionId: string;
}

export interface ListRecentChannelSessionsInput extends ChannelSessionIdentityInput {
  limit: number;
}

export interface CreateChannelSessionInput extends ChannelSessionIdentityInput {
  agentProfileName: string;
  initialMessage: string;
  scopeId?: string | null;
}

export interface ListChatSessionFilters {
  scopeId?: string;
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface ChatMessageTimelineItem {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: 'user' | 'assistant' | 'system';
  channel: string;
  eventType: string;
  text: string;
  runId: string | null;
  runStatus: string | null;
  createdAt: Date;
}

export interface ChatSessionSummaryDto {
  id: string;
  status: string;
  executionState: ChatSessionExecutionState;
  retryMetadata: ChatSessionRetryMetadata | null;
  failureInfo: ChatSessionFailureInfo | null;
  sessionType: ChatSessionType;
  agentProfileName: string;
  scopeId: string | null;
  projectName: string | null;
  displayName: string;
  initialMessage: string;
  workflowRunId: string | null;
  source: ChatSessionSource;
  parentChatSessionId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ChatSessionDetailsDto extends ChatSessionSummaryDto {
  model: string | null;
  provider: string | null;
  containerTier: number;
  errorMessage: string | null;
  messageTimeline: ChatMessageTimelineItem[];
  latestBudgetDecision: LatestBudgetDecisionDto | null;
}
