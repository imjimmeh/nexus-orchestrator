import { Injectable, Logger } from '@nestjs/common';
import { EventLedgerService } from '../observability/event-ledger.service';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { RedisStreamService } from '../redis/redis-stream.service';
import { RunnerConfigStoreService } from '../redis/runner-config-store.service';
import {
  handleTelemetryConnectionCompat,
  handleTelemetryDisconnectCompat,
} from './telemetry-gateway-connection.helpers';
import { TelemetryEventService } from './telemetry-event.service';
import type { AuthenticatedSocket } from './types';

/**
 * Owns the runtime WebSocket lifecycle for {@link TelemetryGateway}:
 * authentication (JWT handshake), per-socket registration (room joins,
 * pub/sub subscription, runner-config fetch, replay-stream replay), and
 * disconnect cleanup.
 *
 * The lifecycle service holds the post-auth broadcast sink
 * ({@link TelemetryEventService.processAndBroadcastEvent}) so a fresh agent
 * can emit `agent_runtime_ready` immediately after auth — the gateway never
 * has to thread that sink through manually.
 */
@Injectable()
export class TelemetryGatewayLifecycle {
  private readonly logger = new Logger(TelemetryGatewayLifecycle.name);

  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    private readonly pubsubService: RedisPubSubService,
    private readonly streamService: RedisStreamService,
    private readonly eventService: TelemetryEventService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    await handleTelemetryConnectionCompat({
      client,
      logger: this.logger,
      eventLedger: this.eventLedger,
      runnerConfigStore: this.runnerConfigStore,
      pubsubService: this.pubsubService,
      streamService: this.streamService,
      processAndBroadcastEvent: this.eventService.processAndBroadcastEvent.bind(
        this.eventService,
      ),
    });
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    await handleTelemetryDisconnectCompat({
      client,
      logger: this.logger,
      pubsubService: this.pubsubService,
    });
  }
}
