/**
 * Cross-pod code-delivery bus port for OAuth login sessions.
 *
 * This module is the public surface for the bus; the concrete
 * `RedisPubSubService`-backed implementation lands in M2 of work item
 * `53b39246-24df-4565-bd90-f468e0fd16cd` and will be bound to the
 * `OAUTH_LOGIN_SESSION_BUS` injection token.
 *
 * The interface itself is declared in `./oauth-login.types` so it lives
 * alongside the other OAuth-login port types and tokens; this file re-exports
 * it to give the bus a dedicated module anchor (mirrors the
 * `*-session.store.ts` / `*.types.ts` split used by the durable store).
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the architectural shape this port implements against.
 */
export type { OAuthLoginSessionBus } from './oauth-login.types';
export { OAUTH_LOGIN_SESSION_BUS } from './oauth-login.types';
