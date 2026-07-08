import type { ChatChannelProvider } from './chat-channel-provider.types';

export interface ChannelOutboundMessage {
  channel: string;
  externalThreadId: string;
  text: string;
}

export interface ChannelOutboundSendResult {
  providerMessageId: string | null;
}

/**
 * Outbound contract every chat-channel adapter must satisfy. Pairs with
 * `ChatInboundAdapter` so that a "fat" `ChannelAdapter` (the type alias in
 * `channel-adapter.types.ts`) can satisfy both halves through the `&`
 * intersection. Implementations only need to format the message for their
 * provider and return whatever provider-side message identifier the
 * transport hands back (or `null` when the provider did not echo one).
 */
export interface ChatOutboundAdapter {
  readonly provider: ChatChannelProvider;
  sendMessage(
    message: ChannelOutboundMessage,
  ): Promise<ChannelOutboundSendResult>;
}

/**
 * Narrow outbound-only sender shape retained for the pre-existing
 * `TelegramSenderService`, which historically only carried the `sendMessage`
 * half and was injected via its own class token. Concrete implementations
 * of `ChatOutboundAdapter` (e.g. `TelegramSenderService` once it gains a
 * `provider` discriminant) continue to satisfy this minimal contract
 * without exposing webhook / extraction methods.
 */
export interface ChannelOutboundSender {
  sendMessage(
    message: ChannelOutboundMessage,
  ): Promise<ChannelOutboundSendResult>;
}
