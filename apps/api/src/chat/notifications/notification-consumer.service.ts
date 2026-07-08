import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { NotificationRepository } from '../database/repositories/notification.repository';
import { CHAT_OUTBOUND_SENDERS } from '../channel-adapters/channel-adapters.tokens';
import type { ChatChannelProvider } from '../channel-adapters/chat-channel-provider.types';
import type { ChannelOutboundSender } from '../channel-adapters/outbound-sender.types';
import type { Notification } from '../database/entities/notification.entity';

const STREAM_KEY = 'stream:notifications';
const CONSUMER_GROUP = 'chat-notifications';
const CONSUMER_NAME = `consumer-${process.pid}`;
const POLL_BLOCK_MS = 5000;
const POLL_COUNT = 10;

@Injectable()
export class NotificationConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationConsumerService.name);
  private isRunning = false;

  constructor(
    private readonly notificationRepo: NotificationRepository,
    @Inject(CHAT_OUTBOUND_SENDERS)
    private readonly outboundSenders: Map<
      ChatChannelProvider,
      ChannelOutboundSender
    >,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureConsumerGroup();
    this.isRunning = true;
    this.logger.log('Notification consumer started');
    void this.runLoop();
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    this.logger.log('Notification consumer stopping');
  }

  async pollOnce(): Promise<void> {
    try {
      const results = await this.redisClient.xreadgroup(
        'GROUP',
        CONSUMER_GROUP,
        CONSUMER_NAME,
        'COUNT',
        POLL_COUNT,
        'BLOCK',
        POLL_BLOCK_MS,
        'STREAMS',
        STREAM_KEY,
        '>',
      );

      if (!Array.isArray(results) || results.length === 0) {
        return;
      }

      for (const [, entries] of results as Array<
        [string, Array<[string, string[]]>]
      >) {
        if (!Array.isArray(entries)) continue;
        for (const [entryId, fields] of entries) {
          await this.processEntry(entryId, fields);
        }
      }
    } catch (error) {
      this.logger.error(`Poll failed: ${(error as Error).message}`);
    }
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      await this.pollOnce();
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redisClient.xgroup(
        'CREATE',
        STREAM_KEY,
        CONSUMER_GROUP,
        '$',
        'MKSTREAM',
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (!message.includes('BUSYGROUP')) {
        this.logger.error(`Failed to create consumer group: ${message}`);
        throw error;
      }
    }
  }

  private async processEntry(entryId: string, fields: string[]): Promise<void> {
    const payload = this.parseFields(fields);

    if (!payload.notification_id) {
      await this.ack(entryId);
      return;
    }

    const notification = await this.notificationRepo.findById(
      payload.notification_id,
    );

    if (!notification) {
      this.logger.warn(
        `Notification ${payload.notification_id} not found in DB`,
      );
      await this.ack(entryId);
      return;
    }

    try {
      const delivered = await this.dispatch(notification);
      if (delivered) {
        await this.notificationRepo.update(notification.id, {
          status: 'sent',
          sentAt: new Date(),
        });
      } else {
        this.logger.warn(`Unsupported channel: ${notification.channel}`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(
        `Failed to deliver notification ${notification.id}: ${errorMessage}`,
      );
      await this.notificationRepo.update(notification.id, {
        status: 'failed',
        failedAt: new Date(),
        errorMessage,
      });
    } finally {
      await this.ack(entryId);
    }
  }

  /**
   * Delivers a notification via the channel-specific sender.
   *
   * Looks up the implementation in the `CHAT_OUTBOUND_SENDERS` registry
   * keyed by `ChatChannelProvider` — this is the same multi-provider map
   * `ChannelAdaptersModule` builds from its `useFactory`, so adding a new
   * channel (Slack, Discord, …) is a single registration there plus a
   * `Map.set` here is not required. No `as ChatChannelProvider` cast is
   * needed because the `(string & {})` open-extension trick on that
   * discriminant lets any `string` index the map. A missing entry is the
   * "unsupported channel" signal and the caller logs a warning before
   * leaving the row untouched.
   *
   * @returns `true` if the channel was recognized and delivery was attempted
   * (caller marks the notification `sent`); `false` for an unsupported
   * channel (caller logs a warning, leaving status untouched).
   */
  private async dispatch(notification: Notification): Promise<boolean> {
    const sender = this.outboundSenders.get(notification.channel);
    if (!sender) {
      return false;
    }

    await sender.sendMessage({
      channel: notification.channel,
      externalThreadId: notification.externalRecipientId,
      text: notification.body,
      ...(notification.subject ? { subject: notification.subject } : {}),
    });
    return true;
  }

  private parseFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      result[fields[i]] = fields[i + 1];
    }
    return result;
  }

  private async ack(entryId: string): Promise<void> {
    try {
      await this.redisClient.xack(STREAM_KEY, CONSUMER_GROUP, entryId);
    } catch (error) {
      this.logger.error(
        `Failed to ack ${entryId}: ${(error as Error).message}`,
      );
    }
  }
}
