import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { TELEMETRY_GATEWAY_PORT } from '../telemetry/types';

interface TokenPayload {
  sub?: string;
  userId?: string;
}

@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  namespace: '/notifications',
  cors: { origin: true, credentials: true },
})
export class NotificationGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(private readonly configService: ConfigService) {}

  handleConnection(@ConnectedSocket() client: Socket): void {
    const token = this.resolveToken(client);
    const userId = token ? this.resolveUserId(token) : null;

    if (!userId) {
      client.disconnect(true);
      return;
    }

    void client.join(this.toUserRoom(userId));
  }

  broadcastToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(this.toUserRoom(userId)).emit(event, payload);
  }

  broadcastNotificationRead(userId: string, notificationId: string): void {
    this.broadcastToUser(userId, 'notification:read', { notificationId });
  }

  broadcastNewNotification(userId: string, notification: unknown): void {
    this.broadcastToUser(userId, 'notification:new', { notification });
  }

  private toUserRoom(userId: string): string {
    return `user-${userId}`;
  }

  private resolveToken(client: Socket): string | null {
    const authPayload: unknown = client.handshake.auth;
    const authToken =
      authPayload && typeof authPayload === 'object' && 'token' in authPayload
        ? (authPayload as { token?: unknown }).token
        : undefined;

    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return authToken;
    }

    const authorizationHeader = client.handshake.headers.authorization;
    if (typeof authorizationHeader !== 'string') {
      return null;
    }

    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }

    return token;
  }

  private resolveUserId(token: string): string | null {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      this.logger.warn('JWT_SECRET missing; rejecting notification socket');
      return null;
    }

    try {
      const payload = verify(token, secret) as TokenPayload;
      return payload.userId ?? payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
