import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatClientAuthGuard } from '../common/chat-client-auth.guard';
import { InternalServiceScopes } from '../common/internal-service-scopes.decorator';
import { InviteChatSessionParticipantDto } from './chat-session-collaboration.dto';
import { ChatSessionCollaborationService } from './chat-session-collaboration.service';

@UseGuards(ChatClientAuthGuard)
@Controller('sessions/chat')
export class ChatSessionCollaborationController {
  constructor(
    private readonly chatCollaboration: ChatSessionCollaborationService,
  ) {}

  @Get(':chatId/participants')
  @InternalServiceScopes('chat.sessions:read')
  async listChatSessionParticipants(@Param('chatId') chatId: string) {
    const participants = await this.chatCollaboration.listParticipants(chatId);
    return {
      success: true,
      data: participants.map((participant) =>
        mapChatParticipantToDto(participant),
      ),
    };
  }

  @Post(':chatId/participants/invite')
  @InternalServiceScopes('chat.sessions:write')
  async inviteChatSessionParticipant(
    @Req() req: Request,
    @Param('chatId') chatId: string,
    @Body() dto: InviteChatSessionParticipantDto,
  ) {
    const result = await this.chatCollaboration.inviteParticipant({
      chatSessionId: chatId,
      targetAgentProfile: dto.agent_profile,
      role: dto.role,
      invitedBy: resolveChatActorId(req),
      metadata: dto.metadata ?? null,
    });

    return {
      success: true,
      data: {
        status: result.status,
        chatSessionId: result.chat_session_id,
        participant: result.participant
          ? mapChatParticipantSummaryToDto(result.participant)
          : null,
        denialReason: result.denial_reason ?? null,
        lifecycleEvents: result.lifecycle_events,
      },
    };
  }

  @Get(':chatId/state')
  @InternalServiceScopes('chat.sessions:read')
  async getChatSessionState(@Param('chatId') chatId: string) {
    const state = await this.chatCollaboration.getSessionState(chatId);
    return {
      success: true,
      data: {
        status: state.status,
        chatSessionId: state.chat_session_id,
        scopeId: state.scope_id,
        sessionStatus: state.session_status,
        participantCount: state.participant_count,
        activeParticipantCount: state.active_participant_count,
        invitedParticipantCount: state.invited_participant_count,
        participants: state.participants.map((participant) =>
          mapChatParticipantSummaryToDto(participant),
        ),
      },
    };
  }
}

function mapChatParticipantToDto(participant: {
  id: string;
  agent_profile: string;
  role: string;
  participation_status: string;
  invited_by?: string | null;
  joined_at?: Date | null;
  left_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: participant.id,
    agentProfile: participant.agent_profile,
    role: participant.role,
    participationStatus: participant.participation_status,
    invitedBy: participant.invited_by ?? null,
    joinedAt: participant.joined_at ?? null,
    leftAt: participant.left_at ?? null,
    createdAt: participant.created_at,
    updatedAt: participant.updated_at,
  };
}

function mapChatParticipantSummaryToDto(participant: {
  id: string;
  agent_profile: string;
  role: string;
  participation_status: string;
  invited_by?: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: participant.id,
    agentProfile: participant.agent_profile,
    role: participant.role,
    participationStatus: participant.participation_status,
    invitedBy: participant.invited_by ?? null,
    joinedAt: participant.joined_at,
    leftAt: participant.left_at,
    createdAt: participant.created_at,
    updatedAt: participant.updated_at,
  };
}

function resolveChatActorId(req: Request): string | null {
  const userId = (req as Request & { user?: { userId?: unknown } }).user
    ?.userId;
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return null;
  }

  return `ui:${userId}`;
}
