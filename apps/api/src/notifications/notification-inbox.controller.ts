import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveWebSocketUrl } from '../config/websocket-url.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationRepository } from './database/repositories/notification.repository';

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
  };
}

interface MarkAllAsReadDto {
  scopeId?: string;
}

const NOTIFICATION_NAMESPACE = '/notifications';
const DEFAULT_WS_PORT = 3001;

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/inbox')
@UseGuards(JwtAuthGuard)
export class NotificationInboxController {
  constructor(private readonly notificationRepo: NotificationRepository) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications for current user' })
  async getInbox(
    @Req() req: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('read') read?: string,
  ) {
    const userId = this.resolveUserId(req);
    const readFilter =
      read === 'true' ? true : read === 'false' ? false : undefined;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);

    const { notifications, total } =
      await this.notificationRepo.findInAppByUserId(userId, {
        limit: safeLimit,
        offset: safeOffset,
        read: readFilter,
      });

    return {
      success: true,
      data: notifications,
      meta: { total, limit: safeLimit, offset: safeOffset },
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread in-app notification count' })
  async getUnreadCount(@Req() req: AuthenticatedRequest) {
    const userId = this.resolveUserId(req);
    const count = await this.notificationRepo.countUnreadInAppByUserId(userId);
    return { success: true, data: { count } };
  }

  @Get('websocket-config')
  @ApiOperation({
    summary: 'Get websocket connection config for notifications',
  })
  getWebsocketConfig(@Req() req?: AuthenticatedRequest) {
    return {
      success: true,
      data: {
        wsUrl: this.resolveWsUrl(req),
        namespace: NOTIFICATION_NAMESPACE,
      },
    };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const userId = this.resolveUserId(req);
    const notification = await this.notificationRepo.markAsRead(id, userId);
    return { success: true, data: notification };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(
    @Req() req: AuthenticatedRequest,
    @Body() _body?: MarkAllAsReadDto,
  ) {
    const userId = this.resolveUserId(req);
    const markedAsRead = await this.notificationRepo.markAllAsRead(userId);
    return { success: true, data: { markedAsRead } };
  }

  private resolveWsUrl(req?: AuthenticatedRequest): string {
    const configuredUrl = resolveWebSocketUrl();
    if (configuredUrl) {
      return configuredUrl;
    }

    const host = req?.hostname || '127.0.0.1';
    const protocol = req?.secure ? 'https' : 'http';
    return `${protocol}://${host}:${DEFAULT_WS_PORT}`;
  }

  private resolveUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }
}
