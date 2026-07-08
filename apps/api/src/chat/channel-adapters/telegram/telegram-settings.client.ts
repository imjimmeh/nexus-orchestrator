import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Optional } from '@nestjs/common';
import type { ChatTelegramRuntimeSettings } from '../../chat-actions/chat-telegram-settings.types';
import type { ServiceClientHttpOptions } from '@nexus/core';
import { unwrapSuccessEnvelope } from '../../chat-actions/chat-to-core-action.utils';
import {
  fetchJsonFromCore,
  resolveHttpOptions,
} from '../../chat-actions/chat-to-core-action-http.helpers';
import { readTelegramRuntimeSettings } from './telegram-runtime-settings.parsers';
import { RequestContextService } from '../../common/request-context.service';
import type { ChatChannelProvider } from '../chat-channel-provider.types';

/**
 * Telegram-specific transport for the two core endpoints the chat-channel
 * adapter needs in order to bootstrap a Telegram runtime: reading the
 * shared runtime settings (ingest mode, agent defaults, poll cadence,
 * etc.) and registering the channel identity of an inbound user for
 * downstream notifications.
 *
 * The class is the telegram-flavored counterpart of the chat-actions
 * `ChatToCoreActionService` and intentionally reuses the same
 * `fetchJsonFromCore` / `unwrapSuccessEnvelope` plumbing so that
 * authorization, correlation-id handling, and error-shape conversion stay
 * identical across every chat-channel endpoint the chat-actions surface
 * touches. The chat-actions layer remains the neutral transport home;
 * this client is the only Telegram-aware seam that knows how to map
 * `getTelegramRuntimeSettings` and `registerChannelIdentity` onto the
 * matching `/internal/core/telegram-settings/runtime` and
 * `/internal/notifications/identities` core routes.
 */
@Injectable()
export class TelegramSettingsClient {
  private readonly httpOptions: ServiceClientHttpOptions;

  constructor(
    @Optional() private readonly requestContext?: RequestContextService,
  ) {
    this.httpOptions = resolveHttpOptions();
  }

  async getTelegramRuntimeSettings(
    correlationId: string,
  ): Promise<ChatTelegramRuntimeSettings> {
    try {
      const response = await this.fetchJsonFromCore(
        '/internal/core/telegram-settings/runtime',
        correlationId,
      );
      const parsed = readTelegramRuntimeSettings(
        unwrapSuccessEnvelope(response),
      );
      if (!parsed) {
        throw new Error(
          'Unexpected telegram runtime settings response payload',
        );
      }

      return parsed;
    } catch (error) {
      throw new BadGatewayException(
        `Failed to fetch telegram runtime settings: ${(error as Error).message}`,
      );
    }
  }

  async registerChannelIdentity(params: {
    channel: ChatChannelProvider;
    externalUserId: string;
  }): Promise<void> {
    const correlationId = this.resolveCorrelationId();
    try {
      await this.fetchJsonFromCore(
        '/internal/notifications/identities',
        correlationId,
        {
          method: 'POST',
          body: {
            channel: params.channel,
            externalUserId: params.externalUserId,
          },
        },
      );
    } catch (error) {
      // Log but don't throw - identity registration is best-effort
      console.warn(
        `Failed to register channel identity: ${(error as Error).message}`,
      );
    }
  }

  private resolveCorrelationId(): string {
    return this.requestContext?.getRequestId() ?? randomUUID();
  }

  private async fetchJsonFromCore(
    path: string,
    correlationId: string,
    options?: {
      method?: 'GET' | 'POST';
      body?: unknown;
    },
  ): Promise<unknown> {
    return fetchJsonFromCore({
      httpOptions: this.httpOptions,
      path,
      correlationId,
      options,
    });
  }
}
