/**
 * Chat session domain types — chat-session lifecycle, participants, retry
 * metadata, telemetry auth, and memory-segment shapes consumed by the
 * project-memory surface.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type {
  Project as KanbanProject,
  WorkItemSubtask as KanbanWorkItemSubtask,
  WorkItemSubtaskStatus as KanbanWorkItemSubtaskStatus,
} from "@nexus/kanban-contracts";
import type { Timestamps } from "./common.types";
import type { LatestBudgetDecision } from "./workflows.types";

// ── Memory segment (project-memory list response) ──

export type MemorySegmentType = "preference" | "fact" | "history";

export interface ProjectMemorySegment extends Timestamps {
  id: string;
  content: string;
  memory_type: MemorySegmentType;
  version: number;
}

export interface ListProjectMemorySegmentsRequest {
  memory_type?: MemorySegmentType;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectMemorySegmentListResponse {
  items: ProjectMemorySegment[];
  total: number;
  limit: number;
  offset: number;
}

// ── Chat Sessions (decoupled from workflows) ──

export type ChatSessionType = "general" | "steering";

export type ChatSessionStatus =
  | "STARTING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

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

export type ChatSessionParticipantRole = "owner" | "participant" | "moderator";

export type ChatSessionParticipationStatus =
  | "invited"
  | "active"
  | "declined"
  | "left"
  | "removed";

export interface CreateChatSessionParticipantInput {
  agent_profile: string;
  role?: ChatSessionParticipantRole;
}

export interface CreateChatSessionRequest {
  agentProfileName: string;
  projectId?: string;
  initialMessage: string;
  sessionType?: ChatSessionType;
  participants?: CreateChatSessionParticipantInput[];
  moderatorProfile?: string;
}

export interface CreateChatSessionResponse {
  id: string;
}

export interface ChatSessionListItem {
  id: string;
  sessionType: ChatSessionType;
  status: ChatSessionStatus;
  executionState: ChatSessionExecutionState;
  retryMetadata: ChatSessionRetryMetadata | null;
  failureInfo: ChatSessionFailureInfo | null;
  agentProfileName: string;
  projectId: string | null;
  projectName: string | null;
  displayName: string;
  initialMessage: string;
  workflowRunId: string | null;
  createdAt: string;
  completedAt: string | null;
  source?: "ad-hoc" | "workflow" | "subagent";
  parentChatSessionId?: string | null;
}

export interface ChatSessionDetail extends ChatSessionListItem {
  model: string | null;
  provider: string | null;
  containerTier: number;
  errorMessage: string | null;
  latestBudgetDecision: LatestBudgetDecision | null;
}

export interface ChatSessionParticipant {
  id: string;
  agentProfile: string;
  role: ChatSessionParticipantRole;
  participationStatus: ChatSessionParticipationStatus;
  invitedBy: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InviteChatSessionParticipantRequest {
  agent_profile: string;
  role?: ChatSessionParticipantRole;
  metadata?: Record<string, unknown>;
}

export interface InviteChatSessionParticipantResponse {
  status: "accepted" | "denied";
  chatSessionId: string;
  participant: ChatSessionParticipant | null;
  denialReason: string | null;
  lifecycleEvents: Array<{
    event_type: string;
    payload: Record<string, unknown>;
  }>;
}

export interface ChatSessionState {
  status: "found";
  chatSessionId: string;
  projectId: string | null;
  sessionType: ChatSessionType;
  sessionStatus: ChatSessionStatus;
  participantCount: number;
  activeParticipantCount: number;
  invitedParticipantCount: number;
  participants: ChatSessionParticipant[];
}

export interface ChatTelemetryAuth {
  token: string;
  wsUrl: string;
}

// WorkItemSubtask re-export shims (referenced by kanban board consumers
// that pass through the chat-session return path).
export type ChatSessionWorkItemSubtaskStatus = KanbanWorkItemSubtaskStatus;
export type ChatSessionWorkItemSubtask = KanbanWorkItemSubtask;

// Project re-export shim so chat-session module is self-contained for
// callers that only consume this module.
export type ChatSessionProject = KanbanProject;