import type {
  AgentCommunicationMessage,
  AgentCommunicationThread,
} from '../domain-ports';
import type {
  AgentMentionLifecycleEvent,
  AgentMentionThreadSummary,
  ResolveAgentThreadResult,
} from './agent-communication-mesh.service.types';

export function toAgentMentionThreadSummary(
  thread: AgentCommunicationThread,
  messages: AgentCommunicationMessage[],
): AgentMentionThreadSummary {
  return {
    id: thread.id,
    thread_id: thread.thread_id,
    workflow_run_id: thread.workflow_run_id,
    scope_id: thread.scopeId ?? null,
    context_id: thread.contextId ?? null,
    requester_execution_id: thread.requester_execution_id ?? null,
    target_agent_profile: thread.target_agent_profile,
    urgency: thread.urgency,
    status: thread.status,
    message_count: thread.message_count,
    correlation_id: thread.correlation_id ?? null,
    resolution_note: thread.resolution_note ?? null,
    metadata: thread.metadata ?? null,
    last_message_at: thread.last_message_at ?? null,
    resolved_at: thread.resolved_at ?? null,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    messages: messages.map((message) => ({
      id: message.id,
      thread_id: message.thread_id,
      workflow_run_id: message.workflow_run_id,
      sender_execution_id: message.sender_execution_id ?? null,
      recipient_profile: message.recipient_profile ?? null,
      message_kind: message.message_kind,
      body: message.body,
      correlation_id: message.correlation_id ?? null,
      metadata: message.metadata ?? null,
      created_at: message.created_at,
    })),
  };
}

export function buildMentionAcceptedLifecycleEvents(
  threadId: string,
  targetAgentProfile: string,
  requesterExecutionId: string | null,
): AgentMentionLifecycleEvent[] {
  return [
    {
      event_type: 'agent_mention_requested',
      payload: {
        thread_id: threadId,
        target_agent_profile: targetAgentProfile,
        requester_execution_id: requesterExecutionId,
      },
    },
    {
      event_type: 'agent_mention_received',
      payload: {
        thread_id: threadId,
        target_agent_profile: targetAgentProfile,
      },
    },
  ];
}

export function resolveThreadDenialReason(
  thread: AgentCommunicationThread,
  workflowRunId: string,
  requesterExecutionId: string | null,
): string | null {
  if (thread.workflow_run_id !== workflowRunId) {
    return 'workflow_run_scope_mismatch';
  }
  if (
    requesterExecutionId &&
    thread.requester_execution_id &&
    requesterExecutionId !== thread.requester_execution_id
  ) {
    return 'requester_execution_id_mismatch';
  }

  return null;
}

export function buildResolveDeniedResult(
  workflowRunId: string,
  threadId: string,
  denialReason: string,
): ResolveAgentThreadResult {
  return {
    status: 'denied',
    thread_id: threadId,
    workflow_run_id: workflowRunId,
    denial_reason: denialReason,
    lifecycle_events: [],
  };
}
