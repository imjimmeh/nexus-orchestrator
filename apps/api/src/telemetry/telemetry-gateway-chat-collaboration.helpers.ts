import type { Logger } from '@nestjs/common';
import type { ChatSessionCollaborationClient } from './chat-session-collaboration.client';
import type {
  AuthenticatedSocket,
  GatewayWorkflowEvent,
  InviteAgentToChatGatewayPayload,
} from './types';

type CollaborationServiceLike = Pick<
  ChatSessionCollaborationClient,
  'inviteParticipant'
>;

type ProcessAndBroadcastEvent = (
  workflowRunId: string,
  event: GatewayWorkflowEvent,
) => Promise<void>;

function emitCommand(
  client: AuthenticatedSocket,
  type: string,
  payload: Record<string, unknown>,
): void {
  client.emit('command', { type, ...payload });
}

function emitCommandError(
  client: AuthenticatedSocket,
  type: string,
  error: unknown,
): void {
  emitCommand(client, type, {
    success: false,
    error: (error as Error).message,
  });
}

function resolveEventStreamId(client: AuthenticatedSocket): string | undefined {
  return client.workflowRunId ?? client.chatSessionId;
}

function isAgentChatContext(
  client: AuthenticatedSocket,
): client is AuthenticatedSocket & {
  role: 'agent';
  chatSessionId: string;
} {
  return client.role === 'agent' && typeof client.chatSessionId === 'string';
}

export async function handleInviteAgentToChatCompat(params: {
  client: AuthenticatedSocket;
  payload: InviteAgentToChatGatewayPayload;
  logger: Logger;
  collaborationService?: CollaborationServiceLike;
  processAndBroadcastEvent: ProcessAndBroadcastEvent;
}): Promise<void> {
  const {
    client,
    payload,
    logger,
    collaborationService,
    processAndBroadcastEvent,
  } = params;

  if (!isAgentChatContext(client)) {
    return;
  }

  if (!collaborationService) {
    logger.warn('invite_agent_to_chat: missing required service injection');
    return;
  }

  try {
    const result = await collaborationService.inviteParticipant({
      chatSessionId: client.chatSessionId,
      targetAgentProfile: payload.target_agent_profile,
      role: payload.role,
      invitedBy: client.stepId,
      metadata: {
        reason: payload.reason,
      },
    });

    emitCommand(client, 'invite_agent_to_chat_result', {
      success: true,
      ...result,
    });

    const streamId = resolveEventStreamId(client);
    if (!streamId) {
      return;
    }

    for (const lifecycleEvent of result.lifecycle_events ?? []) {
      await processAndBroadcastEvent(streamId, {
        event_type: lifecycleEvent.event_type,
        payload: lifecycleEvent.payload,
      });
    }
  } catch (error) {
    emitCommandError(client, 'invite_agent_to_chat_result', error);
  }
}
