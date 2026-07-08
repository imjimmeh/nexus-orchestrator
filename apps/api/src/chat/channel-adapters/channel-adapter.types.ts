import type { ChatChannelProvider } from './chat-channel-provider.types';
import type { ChatOutboundAdapter } from './outbound-sender.types';

/**
 * Wire-level inbound message contract. The `provider`/`channel` fields stay
 * typed as `string` because they originate from arbitrary, untrusted webhook
 * payloads and may contain values ahead of the curated `ChatChannelProvider`
 * set (the discriminant is intentionally permissive via the `(string & {})`
 * escape hatch). The receiving service is responsible for narrowing `provider`
 * before treating it as the typed discriminant.
 */
export interface InboundChannelMessage {
  provider: string;
  channel: string;
  externalUserId: string;
  externalThreadId: string;
  providerMessageId: string;
  correlationId: string;
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * Inbound contract every chat-channel adapter must satisfy:
 *
 * - `validateWebhookSecret` checks an incoming webhook's secret header.
 * - `extractInboundMessage` parses arbitrary provider webhook payload bytes
 *   into the shared `InboundChannelMessage` shape, or returns `null` when
 *   the payload is not a usable inbound message.
 */
export interface ChatInboundAdapter {
  readonly provider: ChatChannelProvider;
  validateWebhookSecret(
    secretHeader: string | undefined,
  ): boolean | Promise<boolean>;
  extractInboundMessage(payload: unknown): InboundChannelMessage | null;
}

/**
 * A "fat" chat-channel adapter that handles both incoming webhooks and
 * outgoing messages. Concrete implementations (e.g. `TelegramAdapterService`)
 * fulfil this by satisfying the `&` intersection of `ChatInboundAdapter`
 * and `ChatOutboundAdapter`. Providers that prefer to keep their inbound
 * webhook surface and outbound dispatch logic in separate services can
 * instead register two distinct narrow adapters with the multi-provider
 * registries (see `channel-adapters.tokens.ts`) — `ChannelAdapter` is the
 * combined contract, not the only one.
 */
export type ChannelAdapter = ChatInboundAdapter & ChatOutboundAdapter;
