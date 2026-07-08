import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import {
  listChatSessionsQuerySchema,
  type ListChatSessionsQueryRequest,
} from '@nexus/core';
import { resolveWebSocketUrl } from '../../config/websocket-url.config';
import { ChatClientAuthGuard } from '../common/chat-client-auth.guard';
import { InternalServiceScopes } from '../common/internal-service-scopes.decorator';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import {
  createChatSessionSchema,
  type CreateChatSessionDto,
} from './create-chat-session.dto';
import { ChatSessionsService } from './chat-sessions.service';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { requireJwtSecret } from '../../config/jwt-runtime-config';
const TELEMETRY_GATEWAY_PORT =
  Number(process.env.TELEMETRY_GATEWAY_PORT) || 3001;

type ListChatSessionsQueryDto = ListChatSessionsQueryRequest;

@UseGuards(ChatClientAuthGuard)
@Controller('sessions/chat')
export class ChatSessionsController {
  constructor(
    private readonly chatSessions: ChatSessionsService,
    private readonly chatSessionRepo: ChatSessionRepository,
  ) {}

  @Post()
  @InternalServiceScopes('chat.sessions:write')
  async createSession(
    @ZodBody(createChatSessionSchema) body: CreateChatSessionDto,
    @Req() req: Request,
  ) {
    const data = await this.chatSessions.createSession({
      agentProfileName: body.agentProfileName,
      scopeId: body.scopeId ?? null,
      initialMessage: body.initialMessage,
      displayName: body.displayName ?? null,
      sessionType: body.sessionType,
      participants: body.participants,
      moderatorProfile: body.moderatorProfile,
      invitedBy: resolveChatActorId(req),
    });

    return { success: true, data: { id: data.id } };
  }

  @Get()
  @InternalServiceScopes('chat.sessions:read')
  async listSessions(
    @ZodQuery(listChatSessionsQuerySchema) query: ListChatSessionsQueryDto,
  ) {
    const result = await this.chatSessions.listSessions({
      scopeId: query.scopeId,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':chatId')
  @InternalServiceScopes('chat.sessions:read')
  async getSession(@Param('chatId', ParseUUIDPipe) chatId: string) {
    const data = await this.chatSessions.getSession(chatId);
    return { success: true, data };
  }

  @Get(':chatId/children')
  @InternalServiceScopes('chat.sessions:read')
  async listChildSessions(@Param('chatId', ParseUUIDPipe) chatId: string) {
    const data = await this.chatSessions.listChildSessions(chatId);
    return { success: true, data };
  }

  @Post(':chatId/retry')
  @InternalServiceScopes('chat.sessions:write')
  async retrySession(@Param('chatId', ParseUUIDPipe) chatId: string) {
    const data = await this.chatSessions.retrySession(chatId);
    return { success: true, data };
  }

  @Delete(':chatId')
  @InternalServiceScopes('chat.sessions:write')
  async cancelSession(@Param('chatId', ParseUUIDPipe) chatId: string) {
    await this.chatSessions.cancelSession(chatId);
    return { success: true };
  }

  @Get(':chatId/telemetry-auth')
  @InternalServiceScopes('chat.sessions:read')
  async getChatTelemetryAuth(
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Req() req: Request,
  ) {
    const session = await this.chatSessionRepo.findById(chatId);
    if (!session) {
      throw new NotFoundException(`Chat session '${chatId}' not found`);
    }

    const token = jwt.sign(
      { chatSessionId: session.id, role: 'ui' },
      requireJwtSecret(),
      {
        expiresIn: '30m',
      },
    );

    const wsUrl = resolveTelemetryWsUrl(req, TELEMETRY_GATEWAY_PORT);

    return { success: true, data: { token, wsUrl } };
  }
}

function resolveChatActorId(req: Request): string | null {
  const userId = (req as Request & { user?: { userId?: unknown } }).user
    ?.userId;
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return null;
  }

  return `ui:${userId}`;
}

function resolveTelemetryWsUrl(
  req: Request,
  telemetryGatewayPort: number,
): string {
  const configuredUrl = resolveWebSocketUrl();
  if (configuredUrl) {
    return configuredUrl;
  }

  const protocol = req.protocol === 'https' ? 'wss' : 'ws';
  return `${protocol}://${req.hostname}:${telemetryGatewayPort.toString()}`;
}
