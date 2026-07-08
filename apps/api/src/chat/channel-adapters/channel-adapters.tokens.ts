/**
 * Injection tokens for the multi-provider adapter registries that downstream
 * services will consume via `@Inject(...)`.
 *
 * These are deliberately declared in a sibling `.tokens.ts` file (not a
 * `.types.ts` file) because the symbols are runtime values — the
 * `no-restricted-syntax` lint rule that funnels exported interfaces / type
 * aliases / enums into `*.types.ts` files does not cover value exports.
 *
 * The tokens publish `Map<ChatChannelProvider, ...>` collections so that
 * downstream consumers (e.g. the chat ingress router, a future generic
 * scheduler) can look up a channel implementation without taking a hard
 * dependency on a concrete service class.
 */
export const CHAT_OUTBOUND_SENDERS = Symbol('CHAT_OUTBOUND_SENDERS');
export const CHAT_INBOUND_ADAPTERS = Symbol('CHAT_INBOUND_ADAPTERS');
/**
 * Multi-provider registry of long-running `ChatOutboundRelay` supervisors
 * (see `chat-outbound-relay.types.ts`). Resolves to a
 * `Map<ChatChannelProvider, ChatOutboundRelay>` keyed by each relay's
 * `provider` discriminant. Distinct from `CHAT_OUTBOUND_SENDERS` because
 * senders handle single-shot outbound message dispatch, whereas relays own
 * the periodic poll loop that re-publishes run status updates back to the
 * channel.
 */
export const CHAT_OUTBOUND_RELAYS = Symbol('CHAT_OUTBOUND_RELAYS');
