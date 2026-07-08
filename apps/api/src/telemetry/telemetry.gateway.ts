import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { TelemetryEventService } from './telemetry-event.service';
import { TelemetryGatewayLifecycle } from './telemetry-gateway-lifecycle.service';
import { TelemetrySubagentGatewayService } from './telemetry-subagent.service';
import { TelemetryAgentCommandService } from './telemetry-agent-command.service';
import {
  type AuthenticatedSocket,
  type CheckSubagentStatusPayload,
  type SpawnSubagentAsyncPayload,
  TELEMETRY_GATEWAY_PORT,
  type WaitForSubagentsPayload,
} from './types';
import {
  BridgeActionHandler,
  BridgeHandlerType,
} from '../tool/bridge-action.decorator';

/**
 * Thin WebSocket adapter for the runtime telemetry gateway. Every
 * `@SubscribeMessage` handler is a 1-2 line delegation to a service:
 *
 * - {@link TelemetryGatewayLifecycle} owns `handleConnection` /
 *   `handleDisconnect` (auth + per-socket state).
 * - {@link TelemetryEventService} owns event broadcasting, transformation,
 *   and per-message business logic.
 * - {@link TelemetrySubagentGatewayService} owns subagent orchestration
 *   handlers (which bypass the event broadcast path and target the agent
 *   socket directly).
 * - {@link TelemetryAgentCommandService} owns the public command-sending
 *   surface (consumed via the `TELEMETRY_GATEWAY` token).
 */
@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  cors: {
    origin:
      process.env.CORS_ORIGIN === '*'
        ? true
        : (process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? false),
  },
})
export class TelemetryGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(TelemetryGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly lifecycle: TelemetryGatewayLifecycle,
    private readonly eventService: TelemetryEventService,
    private readonly subagentService: TelemetrySubagentGatewayService,
    private readonly commandService: TelemetryAgentCommandService,
  ) {}

  afterInit(server: Server): void {
    this.commandService.attachServer(server);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    await this.lifecycle.handleConnection(client);
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    await this.lifecycle.handleDisconnect(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() _client: AuthenticatedSocket,
    @MessageBody() payload: { filters?: Record<string, unknown> },
  ): void {
    this.logger.log(
      `Client subscribed with filters: ${JSON.stringify(payload)}`,
    );
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'agent_telemetry')
  @SubscribeMessage('agent_telemetry')
  async handleAgentTelemetry(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleAgentTelemetry(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'tool_execution_start')
  @SubscribeMessage('tool_execution_start')
  async handleToolExecutionStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleToolExecutionStart(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'tool_execution_end')
  @SubscribeMessage('tool_execution_end')
  async handleToolExecutionEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleToolExecutionEnd(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'tool_execution_update')
  @SubscribeMessage('tool_execution_update')
  async handleToolExecutionUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleToolExecutionUpdate(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'agent_error')
  @SubscribeMessage('agent_error')
  async handleAgentError(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleAgentError(client, payload);
  }

  @SubscribeMessage('command_started')
  async handleCommandStarted(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleCommandStarted(client, payload);
  }

  @SubscribeMessage('command_output')
  async handleCommandOutput(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleCommandOutput(client, payload);
  }

  @SubscribeMessage('command_finished')
  async handleCommandFinished(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleCommandFinished(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'step_complete')
  @SubscribeMessage('step_complete')
  async handleStepComplete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleStepComplete(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'user_questions_posed')
  @SubscribeMessage('user_questions_posed')
  async handleUserQuestionsPosed(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { questions: Array<Record<string, unknown>> },
  ): Promise<void> {
    await this.eventService.handleUserQuestionsPosed(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.RUNNER, 'spawn_subagent_async')
  @SubscribeMessage('spawn_subagent_async')
  async handleSpawnSubagentAsync(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SpawnSubagentAsyncPayload,
  ): Promise<void> {
    await this.subagentService.handleSpawnSubagentAsync(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.RUNNER, 'wait_for_subagents')
  @SubscribeMessage('wait_for_subagents')
  async handleWaitForSubagents(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload?: WaitForSubagentsPayload,
  ): Promise<void> {
    await this.subagentService.handleWaitForSubagents(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.RUNNER, 'check_subagent_status')
  @SubscribeMessage('check_subagent_status')
  async handleCheckSubagentStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: CheckSubagentStatusPayload,
  ): Promise<void> {
    await this.subagentService.handleCheckSubagentStatus(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'turn_end')
  @SubscribeMessage('turn_end')
  async handleTurnEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleTurnEnd(client, payload);
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'agent_end')
  @SubscribeMessage('agent_end')
  async handleAgentEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventService.handleAgentEnd(client, payload);
  }
}
