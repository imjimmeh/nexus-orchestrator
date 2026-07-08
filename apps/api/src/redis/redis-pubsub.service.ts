import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.constants';
import { Redis } from 'ioredis';

@Injectable()
export class RedisPubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);
  private subscriberClient: Redis;
  private readonly callbacks = new Map<
    string,
    Array<(event: string) => void>
  >();
  // Maps the original raw-channel callback to its JSON-parsing wrapper stored in `callbacks`.
  private readonly rawCallbackWrappers = new Map<
    (payload: unknown) => void,
    (message: string) => void
  >();

  constructor(@Inject(REDIS_CLIENT) private readonly publisherClient: Redis) {
    this.subscriberClient = this.publisherClient.duplicate();

    this.subscriberClient.on('message', (channel, message) => {
      const channelCallbacks = this.callbacks.get(channel);
      if (channelCallbacks) {
        for (const callback of channelCallbacks) {
          try {
            callback(message);
          } catch (e) {
            const err = e as Error;
            this.logger.error(
              `Error in pubsub callback for channel ${channel}: ${err.message}`,
            );
          }
        }
      }
    });
  }

  onModuleDestroy() {
    this.subscriberClient.disconnect();
  }

  async publishEvent(
    workflowRunId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const channel = `telemetry:${workflowRunId}`;
    try {
      await this.publisherClient.publish(channel, JSON.stringify(event));
    } catch (e) {
      const err = e as Error;
      this.logger.error(
        `Failed to publish event to channel ${channel}: ${err.message}`,
      );
    }
  }

  async subscribeToChannel(
    workflowRunId: string,
    callback: (event: string) => void,
  ): Promise<void> {
    const channel = `telemetry:${workflowRunId}`;
    if (!this.callbacks.has(channel)) {
      this.callbacks.set(channel, []);
      await this.subscriberClient.subscribe(channel);
    }
    this.callbacks.get(channel)?.push(callback);
  }

  async unsubscribeFromChannel(
    workflowRunId: string,
    callback: (event: string) => void,
  ): Promise<void> {
    const channel = `telemetry:${workflowRunId}`;
    const channelCallbacks = this.callbacks.get(channel);
    if (channelCallbacks) {
      const index = channelCallbacks.indexOf(callback);
      if (index > -1) {
        channelCallbacks.splice(index, 1);
      }
      if (channelCallbacks.length === 0) {
        this.callbacks.delete(channel);
        await this.subscriberClient.unsubscribe(channel);
      }
    }
  }

  async publishToChannel(channel: string, payload: unknown): Promise<void> {
    try {
      await this.publisherClient.publish(channel, JSON.stringify(payload));
    } catch (e) {
      const err = e as Error;
      this.logger.error(
        `Failed to publish to channel ${channel}: ${err.message}`,
      );
    }
  }

  subscribeToRawChannel(
    channel: string,
    callback: (payload: unknown) => void,
  ): void {
    if (!this.callbacks.has(channel)) {
      this.callbacks.set(channel, []);
      void this.subscriberClient.subscribe(channel);
    }
    // Wrap the caller's callback so the raw message string is parsed before delivery.
    const wrapper = (message: string) => {
      try {
        callback(JSON.parse(message) as unknown);
      } catch (e) {
        const err = e as Error;
        this.logger.error(
          `Failed to parse message on channel ${channel}: ${err.message}`,
        );
      }
    };
    // Store the wrapper keyed by the original callback so we can remove it later.
    this.rawCallbackWrappers.set(callback, wrapper);
    const channelWrappers = this.callbacks.get(channel);
    if (channelWrappers) {
      channelWrappers.push(wrapper);
    }
  }

  unsubscribeFromRawChannel(
    channel: string,
    callback: (payload: unknown) => void,
  ): void {
    const channelCallbacks = this.callbacks.get(channel);
    if (!channelCallbacks) return;

    const wrapper = this.rawCallbackWrappers.get(callback);
    if (wrapper) {
      const index = channelCallbacks.indexOf(wrapper);
      if (index > -1) {
        channelCallbacks.splice(index, 1);
      }
      this.rawCallbackWrappers.delete(callback);
    }

    if (channelCallbacks.length === 0) {
      this.callbacks.delete(channel);
      void this.subscriberClient.unsubscribe(channel);
    }
  }
}
