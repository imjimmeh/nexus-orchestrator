import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Logger, Optional } from '@nestjs/common';
import { RedisStreamService } from '../redis/redis-stream.service';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { WarRoomService } from '../war-room/war-room.service';
import { processAndBroadcastEventCompat } from './telemetry-gateway-compat.helpers';
import {
  handleCloseWarRoomCompat,
  handleGetWarRoomStateCompat,
  handleInviteWarRoomParticipantCompat,
  handleOpenWarRoomCompat,
  handlePostWarRoomMessageCompat,
  handleSubmitWarRoomSignoffCompat,
  handleUpdateWarRoomBlackboardCompat,
} from './telemetry-gateway-war-room.helpers';
import {
  type AuthenticatedSocket,
  type CloseWarRoomGatewayPayload,
  type GetWarRoomStateGatewayPayload,
  type InviteWarRoomParticipantGatewayPayload,
  type OpenWarRoomGatewayPayload,
  type PostWarRoomMessageGatewayPayload,
  type SubmitWarRoomSignoffGatewayPayload,
  TELEMETRY_GATEWAY_PORT,
  type UpdateWarRoomBlackboardGatewayPayload,
} from './types';
import { BridgeActionHandler } from '../tool/bridge-action.decorator';
import { BridgeHandlerType } from '../tool/bridge-action.types';

@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  cors: {
    origin:
      process.env.CORS_ORIGIN === '*'
        ? true
        : (process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? false),
  },
})
export class TelemetryWarRoomGateway {
  private readonly logger = new Logger(TelemetryWarRoomGateway.name);

  constructor(
    private readonly streamService: RedisStreamService,
    private readonly pubsubService: RedisPubSubService,
    @Optional() private readonly warRoomService?: WarRoomService,
  ) {}

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'open_war_room')
  @SubscribeMessage('open_war_room')
  async handleOpenWarRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: OpenWarRoomGatewayPayload,
  ) {
    await handleOpenWarRoomCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  @BridgeActionHandler(
    BridgeHandlerType.TELEMETRY,
    'invite_war_room_participant',
  )
  @SubscribeMessage('invite_war_room_participant')
  async handleInviteWarRoomParticipant(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: InviteWarRoomParticipantGatewayPayload,
  ) {
    await handleInviteWarRoomParticipantCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'post_war_room_message')
  @SubscribeMessage('post_war_room_message')
  async handlePostWarRoomMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: PostWarRoomMessageGatewayPayload,
  ) {
    await handlePostWarRoomMessageCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  @BridgeActionHandler(
    BridgeHandlerType.TELEMETRY,
    'update_war_room_blackboard',
  )
  @SubscribeMessage('update_war_room_blackboard')
  async handleUpdateWarRoomBlackboard(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: UpdateWarRoomBlackboardGatewayPayload,
  ) {
    await handleUpdateWarRoomBlackboardCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'submit_war_room_signoff')
  @SubscribeMessage('submit_war_room_signoff')
  async handleSubmitWarRoomSignoff(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: SubmitWarRoomSignoffGatewayPayload,
  ) {
    await handleSubmitWarRoomSignoffCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'get_war_room_state')
  @SubscribeMessage('get_war_room_state')
  async handleGetWarRoomState(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: GetWarRoomStateGatewayPayload,
  ) {
    await handleGetWarRoomStateCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
    });
  }

  @BridgeActionHandler(BridgeHandlerType.TELEMETRY, 'close_war_room')
  @SubscribeMessage('close_war_room')
  async handleCloseWarRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: CloseWarRoomGatewayPayload,
  ) {
    await handleCloseWarRoomCompat({
      client,
      payload,
      logger: this.logger,
      warRoomService: this.warRoomService,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
    });
  }

  private async processAndBroadcastEvent(
    workflowRunId: string,
    event: { event_type: string; payload: Record<string, unknown> },
  ) {
    await processAndBroadcastEventCompat({
      workflowRunId,
      event,
      streamService: this.streamService,
      pubsubService: this.pubsubService,
    });
  }
}
