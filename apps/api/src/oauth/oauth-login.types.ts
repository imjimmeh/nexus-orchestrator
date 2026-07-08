import type {
  OAuthCredentials,
  OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import type { OAuthSessionState } from '@nexus/core/schemas/oauth';

/**
 * Re-export the cross-boundary canonical session-state contract from
 * `@nexus/core/schemas/oauth`. The API package must depend on the shared
 * schema rather than redefining the shape locally so the login engine, the
 * Redis-backed session store, and the cross-pod session bus all agree on a
 * single type.
 */
export type { OAuthSessionState };

/**
 * Historical local alias for the canonical session-state contract above.
 *
 * Older consumers inside the API imported `OAuthLoginSessionDurable` from
 * `./oauth-login.types` directly; this alias preserves that import path so
 * the migration to the canonical `@nexus/core`-authored type is
 * backward-compatible. New code should prefer `OAuthSessionState`.
 */
export type OAuthLoginSessionDurable = OAuthSessionState;

/**
 * Injection token for the pi-ai OAuth provider resolver port.
 * Abstracts `getOAuthProvider` so the login engine is unit-testable.
 */
export const OAUTH_PROVIDER_RESOLVER = Symbol('OAUTH_PROVIDER_RESOLVER');

/** Resolves a pi-ai OAuth preset (e.g. "anthropic", "github-copilot"). */
export interface OAuthProviderResolver {
  resolve(piProviderId: string): Promise<OAuthProviderInterface | undefined>;
}

export interface OAuthStartParams {
  /** pi-ai OAuth preset id, e.g. "anthropic" | "github-copilot" | "openai-codex". */
  piProviderId: string;
  /** Optional enterprise/domain answer for providers that prompt for it. */
  enterpriseUrl?: string;
}

/**
 * Persists the credentials minted by a successful login. Supplied by the
 * caller (provider page or harness credential binding) so the engine itself
 * stays free of any credential-storage concern.
 */
export type OAuthSink = (credentials: OAuthCredentials) => Promise<void>;

/**
 * Injection token for the Redis-backed store that owns the durable half of
 * an OAuth login session. The concrete implementation is
 * `OAuthLoginSessionStore` (Redis-backed); see `oauth-login-session.store.ts`.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the durable / transient split rationale.
 */
export const OAUTH_LOGIN_SESSION_STORE = Symbol('OAUTH_LOGIN_SESSION_STORE');

/**
 * Port for cross-pod delivery of a manually-pasted OAuth authorization code.
 *
 * Decouples {@link OAuthLoginService} from the concrete Redis pub/sub transport
 * so the service can be unit-tested with an in-process fake bus. The channel
 * namespace and message envelope are deliberately hidden behind the port — the
 * implementation is responsible for composing the channel name
 * (`oauth:session:{sessionId}:code`) and the JSON encoding.
 *
 * Lifecycle note: subscribers are expected to unsubscribe once the in-flight
 * `provider.login` Promise settles (success, failure, or expiry). The bus
 * itself does not own the unsubscribe cadence — that is the caller's
 * responsibility.
 */
export interface OAuthLoginSessionBus {
  /**
   * Subscribe to manual-code deliveries for the given session. The callback
   * fires once per published code; multiple subscribers for the same
   * sessionId are allowed and each receives every message.
   */
  subscribeToCode(sessionId: string, callback: (code: string) => void): void;

  /**
   * Publish a manually-pasted authorization code to the session's
   * subscribers. Returns once the underlying transport has accepted the
   * publish (not necessarily when a subscriber has consumed it).
   */
  publishCode(sessionId: string, code: string): Promise<void>;
}

/**
 * Injection token for the cross-pod OAuth login code-delivery bus. See
 * {@link OAuthLoginSessionBus}.
 */
export const OAUTH_LOGIN_SESSION_BUS = Symbol('OAUTH_LOGIN_SESSION_BUS');
