import type { RedisPubSubService } from '../redis/redis-pubsub.service';
import type { RedisStreamService } from '../redis/redis-stream.service';
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
} from '@nexus/core';

export interface CommandGatewayDeps {
  workflowRunId: string;
  payload: Record<string, unknown>;
  streamService: Pick<RedisStreamService, 'persistEvent'>;
  pubsubService: Pick<RedisPubSubService, 'publishEvent'>;
}

export type CommandEventType =
  | typeof COMMAND_STARTED_EVENT
  | typeof COMMAND_OUTPUT_EVENT
  | typeof COMMAND_FINISHED_EVENT;
