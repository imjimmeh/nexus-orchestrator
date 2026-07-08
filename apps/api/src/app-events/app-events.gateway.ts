import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server, Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { TELEMETRY_GATEWAY_PORT } from '../telemetry/types';
import {
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
  WORKFLOW_RUN_STARTED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import {
  CHAT_SESSION_COMPLETED_EVENT,
  CHAT_SESSION_FAILED_EVENT,
  CHAT_SESSION_STARTED_EVENT,
} from '../chat-execution/chat-session-events.constants';
import type { ChatSessionEvent } from '../chat-execution/chat-session-events.types';

interface TokenPayload {
  sub?: string;
  userId?: string;
}

@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  namespace: '/app-events',
  cors: { origin: true, credentials: true },
})
export class AppEventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AppEventsGateway.name);

  handleConnection(@ConnectedSocket() client: Socket): void {
    const token = this.resolveToken(client);
    const userId = token ? this.resolveUserId(token) : null;

    if (!userId) {
      client.disconnect(true);
    }
  }

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  broadcastRunLifecycle(event: WorkflowRunEvent): void {
    const { workflowRunId, workflowId, status } = event;
    this.server.emit('run:lifecycle', { workflowRunId, workflowId, status });
  }

  @OnEvent(CHAT_SESSION_STARTED_EVENT)
  @OnEvent(CHAT_SESSION_COMPLETED_EVENT)
  @OnEvent(CHAT_SESSION_FAILED_EVENT)
  broadcastSessionLifecycle(event: ChatSessionEvent): void {
    this.server.emit('run:lifecycle', {
      workflowRunId: event.sessionId,
      workflowId: event.sessionId,
      status: event.status,
    });
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
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      this.logger.warn('JWT_SECRET missing; rejecting app-events socket');
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
