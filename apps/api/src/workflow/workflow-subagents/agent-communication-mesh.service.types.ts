import type {
  AgentCommunicationMessageKind,
  AgentCommunicationThreadStatus,
  AgentCommunicationThreadUrgency,
} from '../domain-ports';

export interface AgentMentionLifecycleEvent {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface MentionAgentParams {
  workflow_run_id: string;
  requester_execution_id?: string | null;
  target_agent_profile: string;
  message: string;
  thread_id?: string | null;
  context_id?: string | null;
  urgency?: AgentCommunicationThreadUrgency;
  correlation_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MentionAgentResult {
  status: 'accepted' | 'denied';
  thread_id: string;
  correlation_id: string;
  thread_status: AgentCommunicationThreadStatus;
  denial_reason?: string;
  lifecycle_events: AgentMentionLifecycleEvent[];
}

export interface CheckAgentMentionsParams {
  workflow_run_id: string;
  requester_execution_id?: string | null;
  thread_id?: string | null;
}

export interface AgentMentionMessageSummary {
  id: string;
  thread_id: string;
  workflow_run_id: string;
  sender_execution_id: string | null;
  recipient_profile: string | null;
  message_kind: AgentCommunicationMessageKind;
  body: string;
  correlation_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface AgentMentionThreadSummary {
  id: string;
  thread_id: string;
  workflow_run_id: string;
  scope_id: string | null;
  context_id: string | null;
  requester_execution_id: string | null;
  target_agent_profile: string;
  urgency: AgentCommunicationThreadUrgency;
  status: AgentCommunicationThreadStatus;
  message_count: number;
  correlation_id: string | null;
  resolution_note: string | null;
  metadata: Record<string, unknown> | null;
  last_message_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  messages: AgentMentionMessageSummary[];
}

export interface CheckAgentMentionsResult {
  workflow_run_id: string;
  requester_execution_id: string | null;
  thread_count: number;
  threads: AgentMentionThreadSummary[];
}

export interface ResolveAgentThreadParams {
  workflow_run_id: string;
  thread_id: string;
  requester_execution_id?: string | null;
  resolver_execution_id?: string | null;
  resolution_note?: string | null;
  correlation_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolveAgentThreadResult {
  status: 'resolved' | 'denied';
  thread_id: string;
  workflow_run_id: string;
  denial_reason?: string;
  lifecycle_events: AgentMentionLifecycleEvent[];
}

export interface MentionValidationContext {
  workflowRunId: string;
  targetAgentProfile: string;
  body: string;
  requesterExecutionId: string | null;
  payloadContextId: string | null;
  threadId: string;
  correlationId: string;
  urgency: AgentCommunicationThreadUrgency;
  metadata: Record<string, unknown> | null;
  scopeId: string | null;
  scopeContextId: string | null;
  existingThread: {
    workflow_run_id: string;
    message_count: number;
  } | null;
}
