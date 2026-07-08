import type { Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type { RedisPubSubService } from '../redis/redis-pubsub.service';
import type { RedisStreamService } from '../redis/redis-stream.service';
import type { RunnerConfigStoreService } from '../redis/runner-config-store.service';
import { requireJwtSecret } from '../config/jwt-runtime-config';
import { handleTelemetryPostAuthConnection } from './telemetry-gateway-post-auth.helpers';
import type { AuthenticatedSocket } from './types';

export async function handleTelemetryConnectionCompat(params: {
  client: AuthenticatedSocket;
  logger: Logger;
  eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
  runnerConfigStore: Pick<RunnerConfigStoreService, 'get'>;
  pubsubService: Pick<RedisPubSubService, 'subscribeToChannel'>;
  streamService: Pick<RedisStreamService, 'getEventHistory'>;
  processAndBroadcastEvent: (
    workflowRunId: string,
    event: { event_type: string; payload: Record<string, unknown> },
  ) => Promise<void>;
}): Promise<void> {
  const {
    client,
    logger,
    eventLedger,
    runnerConfigStore,
    pubsubService,
    streamService,
    processAndBroadcastEvent,
  } = params;

  try {
    const token = client.handshake.auth.token as string;
    if (!token) {
      client.disconnect();
      return;
    }

    const decoded = jwt.verify(token, requireJwtSecret()) as {
      workflowRunId?: string;
      chatSessionId?: string;
      scopeId?: string;
      role?: string;
      jobId?: string;
      stepId?: string;
      agentProfileName?: string;
      isSubagent?: boolean;
      containerId?: string;
      subagentExecutionId?: string;
    };

    client.chatSessionId = decoded.chatSessionId;
    client.workflowRunId = decoded.workflowRunId ?? decoded.chatSessionId;
    client.streamId =
      decoded.isSubagent && decoded.chatSessionId
        ? decoded.chatSessionId
        : client.workflowRunId;
    client.scopeId = decoded.scopeId;
    client.jobId = decoded.jobId;
    client.stepId = decoded.stepId;
    client.agentProfileName = decoded.agentProfileName;
    client.role = (decoded.role ?? undefined) as 'agent' | 'ui' | undefined;
    client.isSubagent = decoded.isSubagent;
    client.containerId = decoded.containerId;
    client.subagentExecutionId = decoded.subagentExecutionId;

    await handleTelemetryPostAuthConnection({
      client,
      processAndBroadcastEvent,
      getRunnerConfig: runnerConfigStore.get.bind(runnerConfigStore),
      subscribeUiChannel: pubsubService.subscribeToChannel.bind(pubsubService),
      getEventHistory: streamService.getEventHistory.bind(streamService),
    });
  } catch (e) {
    logger.error(`Connection failed: ${(e as Error).message}`);
    await eventLedger.emitBestEffort({
      domain: 'telemetry',
      eventName: 'telemetry.gateway.connection.failed',
      outcome: 'failure',
      source: 'gateway',
      errorMessage: (e as Error).message,
    });
    client.disconnect();
  }
}

export async function handleTelemetryDisconnectCompat(params: {
  client: AuthenticatedSocket;
  logger: Logger;
  pubsubService: Pick<RedisPubSubService, 'unsubscribeFromChannel'>;
}): Promise<void> {
  const { client, logger, pubsubService } = params;

  if (client.role === 'agent' && client.workflowRunId) {
    logger.log(
      `Agent socket disconnected for ${client.workflowRunId}/${client.stepId ?? '?'}`,
    );
  }

  if (client.role === 'ui' && client.workflowRunId && client.pubsubCallback) {
    await pubsubService.unsubscribeFromChannel(
      client.workflowRunId,
      client.pubsubCallback,
    );
  }
}
