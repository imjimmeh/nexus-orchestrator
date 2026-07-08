import { Injectable, Logger, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.constants';
import { Redis } from 'ioredis';

@Injectable()
export class RedisStreamService {
  private readonly logger = new Logger(RedisStreamService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async appendToStream(
    streamKey: string,
    fields: Record<string, string>,
    options: { maxLength?: number } = {},
  ): Promise<string | null> {
    const entries = Object.entries(fields).flatMap(([key, value]) => [
      key,
      value,
    ]);
    if (options.maxLength) {
      return this.redisClient.xadd(
        streamKey,
        'MAXLEN',
        '~',
        options.maxLength,
        '*',
        ...entries,
      );
    }

    return this.redisClient.xadd(streamKey, '*', ...entries);
  }

  async persistEvent(
    workflowRunId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const streamKey = `stream:telemetry:${workflowRunId}`;
    try {
      await this.redisClient.xadd(
        streamKey,
        'MAXLEN',
        '~',
        10000,
        '*',
        'event_type',
        String(event.event_type),
        'timestamp',
        typeof event.timestamp === 'string'
          ? event.timestamp
          : new Date().toISOString(),
        'payload',
        JSON.stringify(event.payload || {}),
      );
    } catch (e) {
      const err = e as Error;
      this.logger.error(
        `Failed to persist event to Redis Stream ${streamKey}: ${err.message}`,
      );
    }
  }

  async getEventHistory(
    workflowRunId: string,
  ): Promise<Record<string, unknown>[]> {
    const streamKey = `stream:telemetry:${workflowRunId}`;
    try {
      const results = await this.redisClient.xrange(streamKey, '-', '+');
      return results.map((result) => {
        const fields = result[1];
        const event: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];
          if (key === 'payload') {
            event[key] = JSON.parse(value);
          } else {
            event[key] = value;
          }
        }
        return event;
      });
    } catch (e) {
      const err = e as Error;
      this.logger.error(
        `Failed to get history from Redis Stream ${streamKey}: ${err.message}`,
      );
      return [];
    }
  }

  async trimStream(workflowRunId: string, maxLength: number): Promise<void> {
    const streamKey = `stream:telemetry:${workflowRunId}`;
    try {
      await this.redisClient.xtrim(streamKey, 'MAXLEN', '~', maxLength);
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Failed to trim stream ${streamKey}: ${err.message}`);
    }
  }
}
