import type { ChatChannelProvider } from './chat-channel-provider.types';

/**
 * Long-running "outbound relay" supervisor for a single chat-channel
 * provider. Each relay polls its provider-side chat messages / workflow-run
 * status updates and pushes the results back to the channel (e.g. editing
 * a status message in-place on Telegram when a workflow finishes).
 *
 * This interface is the multi-provider contract that downstream consumers
 * (e.g. the chat ingress router or a future generic scheduler) will use to
 * enumerate every active relay via the `CHAT_OUTBOUND_RELAYS` injection
 * token. Concrete implementations (currently only
 * `TelegramOutboundRelayService`) live alongside their channel adapter and
 * implement this interface so the module can register them under a single
 * `Map<ChatChannelProvider, ChatOutboundRelay>` keyed by their `provider`
 * discriminant.
 *
 * Lifecycle mirrors the NestJS `OnModuleInit` / `OnModuleDestroy` hooks so
 * the supervisor can start its poll loop on application boot and tear it
 * down cleanly on shutdown — the interface deliberately returns
 * `Promise<void> | void` from both hooks so synchronous startup paths stay
 * legal.
 *
 * The `provider` field carries the same curated discriminant declared in
 * `chat-channel-provider.types.ts`; the `(string & {})` escape hatch on that
 * type keeps the contract open for future channels (e.g. Slack, Discord)
 * without forcing churn across call sites.
 */
export interface ChatOutboundRelay {
  readonly provider: ChatChannelProvider;
  onModuleInit(): Promise<void> | void;
  onModuleDestroy(): void | Promise<void>;
  pollOnce(): Promise<void>;
}
