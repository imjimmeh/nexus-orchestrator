import { Injectable, Logger } from '@nestjs/common';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import type { OAuthLoginSessionBus } from './oauth-login.types';

const SESSION_CHANNEL_PREFIX = 'oauth:session';
const CODE_CHANNEL_SUFFIX = ':code';

/**
 * Build the channel name for a session's manual-code deliveries.
 * Centralised so the publish and subscribe paths cannot drift out of sync.
 */
function buildCodeChannel(sessionId: string): string {
  return `${SESSION_CHANNEL_PREFIX}:${sessionId}${CODE_CHANNEL_SUFFIX}`;
}

/**
 * Type-guard: true for non-null, non-array objects (the only shape the
 * `{ code }` envelope can validly take after parsing).
 */
function isEnvelopeObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * RedisPubSubService-backed implementation of the cross-pod OAuth login
 * code-delivery bus. Routes manual authorization-code delivery through the
 * `oauth:session:{sessionId}:code` channel; the JSON-encoded `{ code }`
 * envelope is parsed and validated before the caller's callback fires,
 * mirroring {@link RedisPubSubService.subscribeToRawChannel}'s own
 * "log-on-parse-failure, don't invoke the callback" error semantics.
 *
 * The wrapper accepts both a JSON string (test/standalone usage) and a
 * pre-parsed object (the shape delivered by `RedisPubSubService` in
 * production, which already JSON.parses the raw Redis message before handing
 * it to subscribers). Either way, the `code` field must be a string for the
 * caller's callback to fire; anything else logs a warning and is dropped.
 *
 * Lifecycle: subscribers are expected to call
 * {@link RedisPubSubService.unsubscribeFromRawChannel} once the in-flight
 * `provider.login` Promise settles. The bus itself does not own the
 * unsubscribe cadence — that is the caller's responsibility (see the
 * `OAuthLoginSessionBus` interface for the lifecycle contract).
 */
@Injectable()
export class OAuthLoginSessionBusService implements OAuthLoginSessionBus {
  private readonly logger = new Logger(OAuthLoginSessionBusService.name);

  constructor(private readonly redisPubSub: RedisPubSubService) {}

  subscribeToCode(sessionId: string, callback: (code: string) => void): void {
    const channel = buildCodeChannel(sessionId);

    const wrapper = (payload: unknown): void => {
      const code = this.extractCode(payload, channel);
      if (code === undefined) {
        return;
      }
      callback(code);
    };

    this.redisPubSub.subscribeToRawChannel(channel, wrapper);
  }

  publishCode(sessionId: string, code: string): Promise<void> {
    const channel = buildCodeChannel(sessionId);
    return this.redisPubSub.publishToChannel(channel, { code });
  }

  /**
   * Parse and validate the incoming payload, returning the `code` field on
   * success or `undefined` on any failure. Failures log a warning and are
   * intentionally swallowed to mirror the upstream `RedisPubSubService`
   * semantics (the subscriber must never crash the message dispatcher).
   */
  private extractCode(payload: unknown, channel: string): string | undefined {
    const envelope = this.parseEnvelope(payload, channel);
    if (envelope === undefined) {
      return undefined;
    }

    const code = envelope.code;
    if (typeof code !== 'string') {
      this.logger.warn(
        `Invalid OAuth code payload on ${channel}: ` +
          `code field missing or not a string`,
      );
      return undefined;
    }

    return code;
  }

  private parseEnvelope(
    payload: unknown,
    channel: string,
  ): Record<string, unknown> | undefined {
    if (typeof payload === 'string') {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (!isEnvelopeObject(parsed)) {
          this.logger.warn(
            `Invalid OAuth code payload on ${channel}: ` +
              `parsed envelope is not an object`,
          );
          return undefined;
        }
        return parsed;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'unknown parse error';
        this.logger.warn(
          `Invalid OAuth code payload on ${channel}: ` +
            `failed to parse JSON (${message})`,
        );
        return undefined;
      }
    }

    if (isEnvelopeObject(payload)) {
      return payload;
    }

    this.logger.warn(
      `Invalid OAuth code payload on ${channel}: ` +
        `expected JSON string or object, got ${payload === null ? 'null' : typeof payload}`,
    );
    return undefined;
  }
}
