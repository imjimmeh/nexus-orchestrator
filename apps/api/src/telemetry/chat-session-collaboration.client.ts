import { BadGatewayException, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type {
  ChatCollaborationInviteResponseData,
  ChatCollaborationInviteResponseEnvelope,
  ChatCollaborationInviteResult,
  ChatCollaborationLifecycleEventDto,
  ChatCollaborationParticipantDto,
} from './chat-session-collaboration.client.types';

const DEFAULT_CHAT_SERVICE_BASE_URL = 'http://localhost:3013/api';

@Injectable()
export class ChatSessionCollaborationClient {
  async inviteParticipant(params: {
    chatSessionId: string;
    targetAgentProfile: string;
    role?: 'owner' | 'participant' | 'moderator';
    invitedBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChatCollaborationInviteResult> {
    const chatServiceBaseUrl = this.resolveChatServiceBaseUrl();
    const authorization = this.resolveAuthorizationHeader();
    const response = await this.postInviteRequest(
      chatServiceBaseUrl,
      authorization,
      params,
    );
    const payload = await this.readResponseEnvelope(response);

    this.assertSuccessfulInviteResponse(response, payload);
    return this.mapInviteResult(payload.data);
  }

  private async postInviteRequest(
    chatServiceBaseUrl: string,
    authorization: string,
    params: {
      chatSessionId: string;
      targetAgentProfile: string;
      role?: 'owner' | 'participant' | 'moderator';
      invitedBy?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Response> {
    return fetch(
      `${chatServiceBaseUrl}/sessions/chat/${encodeURIComponent(
        params.chatSessionId,
      )}/participants/invite`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          agent_profile: params.targetAgentProfile,
          role: params.role,
          metadata: params.metadata,
        }),
      },
    );
  }

  private assertSuccessfulInviteResponse(
    response: Response,
    payload: ChatCollaborationInviteResponseEnvelope,
  ): asserts payload is {
    success: true;
    data: ChatCollaborationInviteResponseData;
  } {
    if (!response.ok) {
      throw new BadGatewayException(
        this.readRemoteErrorMessage(payload) ??
          `Failed to invite chat participant (status ${response.status})`,
      );
    }

    if (!payload.success || !payload.data) {
      throw new BadGatewayException(
        'Invalid response from chat collaboration endpoint',
      );
    }
  }

  private mapInviteResult(
    data: ChatCollaborationInviteResponseData,
  ): ChatCollaborationInviteResult {
    if (data.status !== 'accepted' && data.status !== 'denied') {
      throw new BadGatewayException(
        'Invalid participant invitation status from chat collaboration endpoint',
      );
    }

    if (
      typeof data.chatSessionId !== 'string' ||
      data.chatSessionId.length === 0
    ) {
      throw new BadGatewayException(
        'Missing chatSessionId in chat collaboration response',
      );
    }

    return {
      status: data.status,
      chat_session_id: data.chatSessionId,
      participant: mapParticipant(data.participant),
      denial_reason:
        typeof data.denialReason === 'string' ? data.denialReason : undefined,
      lifecycle_events: mapLifecycleEvents(data.lifecycleEvents),
    };
  }

  private async readResponseEnvelope(
    response: Response,
  ): Promise<ChatCollaborationInviteResponseEnvelope> {
    const payload = await this.readResponseJson(response);

    if (isInviteResponseEnvelope(payload)) {
      return payload;
    }

    return {};
  }

  private resolveChatServiceBaseUrl(): string {
    const configured = process.env.CHAT_SERVICE_BASE_URL;
    if (typeof configured !== 'string' || configured.trim().length === 0) {
      return DEFAULT_CHAT_SERVICE_BASE_URL;
    }

    return configured.trim().replace(/\/$/, '');
  }

  private resolveAuthorizationHeader(): string {
    const staticToken = process.env.CHAT_SERVICE_BEARER_TOKEN?.trim();
    if (staticToken) {
      return `Bearer ${staticToken}`;
    }

    const jwtSecret = process.env.JWT_SECRET?.trim();
    if (!jwtSecret) {
      throw new BadGatewayException(
        'Missing chat service credentials: CHAT_SERVICE_BEARER_TOKEN or JWT_SECRET is required',
      );
    }

    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
        service: 'api',
        serviceScopes: ['chat.sessions:write', 'chat.sessions:read'],
      },
      jwtSecret,
      {
        expiresIn: (process.env.CHAT_SERVICE_JWT_TTL ??
          '5m') as jwt.SignOptions['expiresIn'],
        subject: 'api-service',
      },
    );

    return `Bearer ${token}`;
  }

  private async readResponseJson(response: Response): Promise<unknown> {
    const bodyText = await response.text();
    if (!bodyText) {
      return null;
    }

    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return { message: bodyText };
    }
  }

  private readRemoteErrorMessage(payload: unknown): string | null {
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }

    return null;
  }
}

function mapLifecycleEvents(
  events: ChatCollaborationLifecycleEventDto[] | undefined,
): Array<{ event_type: string; payload: Record<string, unknown> }> {
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .filter(
      (
        event,
      ): event is { event_type: string; payload: Record<string, unknown> } =>
        typeof event?.event_type === 'string' &&
        typeof event.payload === 'object' &&
        event.payload !== null,
    )
    .map((event) => ({
      event_type: event.event_type,
      payload: event.payload,
    }));
}

function mapParticipant(
  participant: ChatCollaborationParticipantDto | null | undefined,
): ChatCollaborationInviteResult['participant'] | undefined {
  if (!participant) {
    return undefined;
  }

  const required = readRequiredParticipantFields(participant);
  if (!required) {
    return undefined;
  }

  return {
    id: required.id,
    agent_profile: required.agentProfile,
    role: required.role,
    participation_status: required.participationStatus,
    invited_by:
      typeof participant.invitedBy === 'string' ? participant.invitedBy : null,
    joined_at:
      typeof participant.joinedAt === 'string' ? participant.joinedAt : null,
    left_at: typeof participant.leftAt === 'string' ? participant.leftAt : null,
    created_at: required.createdAt,
    updated_at: required.updatedAt,
  };
}

function readRequiredParticipantFields(
  participant: ChatCollaborationParticipantDto,
): {
  id: string;
  agentProfile: string;
  role: string;
  participationStatus: string;
  createdAt: string;
  updatedAt: string;
} | null {
  if (
    typeof participant.id !== 'string' ||
    typeof participant.agentProfile !== 'string' ||
    typeof participant.role !== 'string' ||
    typeof participant.participationStatus !== 'string' ||
    typeof participant.createdAt !== 'string' ||
    typeof participant.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: participant.id,
    agentProfile: participant.agentProfile,
    role: participant.role,
    participationStatus: participant.participationStatus,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

function isInviteResponseEnvelope(
  payload: unknown,
): payload is ChatCollaborationInviteResponseEnvelope {
  return typeof payload === 'object' && payload !== null;
}
