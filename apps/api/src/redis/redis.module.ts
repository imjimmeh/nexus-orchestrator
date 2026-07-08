import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { RedisStreamService } from './redis-stream.service';
import { RedisPubSubService } from './redis-pubsub.service';
import { RunnerConfigStoreService } from './runner-config-store.service';
import { AgentResponseStoreService } from './agent-response-store.service';
import { REDIS_CLIENT } from './redis.constants';

const logger = new Logger('RedisModule');

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
          // Prevent BullMQ from crashing on transient Redis disconnects.
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            if (times > 20) return null;
            return Math.min(times * 500, 5000);
          },
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
    }),
  ],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const client = new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
          // Allow ioredis to reconnect on transient failures (ECONNRESET, etc.)
          // without a cap on how many times it may retry blocking commands.
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            // Back off up to 5 s; stop after 20 consecutive failures so
            // a genuinely unavailable Redis doesn't spin forever.
            if (times > 20) return null;
            return Math.min(times * 500, 5000);
          },
        });

        // Register an error listener so Node.js doesn't treat the emitted
        // 'error' event as an uncaught exception and crash the process.
        // ioredis handles reconnection automatically once a listener exists.
        client.on('error', (err: Error) => {
          logger.warn(`Redis client error (will retry): ${err.message}`);
        });

        return client;
      },
    },
    RedisStreamService,
    RedisPubSubService,
    RunnerConfigStoreService,
    AgentResponseStoreService,
  ],
  exports: [
    REDIS_CLIENT,
    RedisStreamService,
    RedisPubSubService,
    RunnerConfigStoreService,
    AgentResponseStoreService,
  ],
})
export class RedisModule {
  /** Redis and BullMQ connection module */
  protected readonly _moduleName = 'RedisModule';
}
