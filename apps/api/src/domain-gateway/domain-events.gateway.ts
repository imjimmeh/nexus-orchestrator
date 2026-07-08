import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { RedisPubSubService } from '../redis/redis-pubsub.service';

interface JoinScopePayload {
  scopeId: string;
}

@WebSocketGateway({
  namespace: '/domain-events',
  cors: { origin: true, credentials: true },
})
export class DomainEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private readonly server: Server;
  private readonly logger = new Logger(DomainEventsGateway.name);

  private readonly clientSubscriptions = new Map<
    string,
    { channel: string; callback: (payload: unknown) => void }[]
  >();

  constructor(private readonly redisPubSub: RedisPubSubService) {}

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth as Record<string, string>).token ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    const jwtSecret = process.env['JWT_SECRET'];
    if (!jwtSecret) {
      this.logger.warn(
        `DomainEventsGateway: JWT_SECRET not configured, rejecting client ${client.id}`,
      );
      client.disconnect(true);
      return;
    }

    try {
      jwt.verify(token, jwtSecret);
      this.clientSubscriptions.set(client.id, []);
    } catch {
      this.logger.warn(
        `DomainEventsGateway: rejected client ${client.id} — invalid token`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const subs = this.clientSubscriptions.get(client.id) ?? [];
    for (const { channel, callback } of subs) {
      this.redisPubSub.unsubscribeFromRawChannel(channel, callback);
    }
    this.clientSubscriptions.delete(client.id);
  }

  @SubscribeMessage('join-scope')
  handleJoinScope(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinScopePayload,
  ): void {
    const { scopeId } = payload ?? {};
    if (!scopeId) return;

    const subs = this.clientSubscriptions.get(client.id) ?? [];

    // Guard: don't subscribe twice to the same scope
    if (subs.some((s) => s.channel === `ri:${scopeId}`)) return;

    const room = `scope-${scopeId}`;
    void client.join(room);

    const channel = `ri:${scopeId}`;
    const callback = (data: unknown) => {
      this.server.to(room).emit('resource-updated', data);
    };

    this.redisPubSub.subscribeToRawChannel(channel, callback);
    subs.push({ channel, callback });
    this.clientSubscriptions.set(client.id, subs);
  }
}
