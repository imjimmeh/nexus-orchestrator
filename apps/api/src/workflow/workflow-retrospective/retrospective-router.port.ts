/**
 * Dependency-inversion seam between the retrospective analysis orchestrator
 * (EPIC-212 Phase-2 Task 6) and the deterministic output router (Task 7, NOT
 * yet built).
 *
 * The orchestrator depends on this ABSTRACTION — never on Task 7's concrete
 * `RetrospectiveOutputRouter` — so the parse → verify-evidence →
 * dedup-against-known pipeline is complete, testable, and safe to ship before
 * any router exists. When Task 7 lands it binds a concrete provider to
 * {@link RETROSPECTIVE_ROUTER_PORT} in the module; until then the `@Optional()`
 * injection resolves to `undefined` and the orchestrator logs the would-be
 * routes (it never loses findings silently).
 *
 * The contract types live in `retrospective-router.types.ts` (the project's
 * `*.types.ts` convention) and are re-exported here for ergonomic import
 * alongside the token.
 */
export const RETROSPECTIVE_ROUTER_PORT = Symbol('RETROSPECTIVE_ROUTER_PORT');

export type {
  RetrospectiveRouteInput,
  RetrospectiveRouteResult,
  RetrospectiveRouterPort,
} from './retrospective-router.types';
