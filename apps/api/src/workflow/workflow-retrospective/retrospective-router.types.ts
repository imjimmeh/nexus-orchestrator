/**
 * Contract types for the retrospective router seam (EPIC-212 Phase-2 Task 7,
 * NOT yet built).
 *
 * Declared in a `*.types.ts` companion (not the `.port.ts` file) to satisfy
 * the project's `no-restricted-syntax` convention — exported interfaces live
 * in `*.types.ts`. The port file owns the injection-token Symbol and
 * re-exports these for ergonomic import alongside the token.
 *
 * The analysis orchestrator (Task 6) depends on this ABSTRACTION only. When
 * Task 7's concrete `RetrospectiveOutputRouter` lands it binds a provider to
 * `RETROSPECTIVE_ROUTER_PORT`; until then the `@Optional()` injection resolves
 * to `undefined` and the orchestrator logs the would-be routes without losing
 * data silently.
 */
import type { RetrospectiveFinding } from '@nexus/core';

/**
 * One routing request: a single surviving, evidence-backed, not-already-known
 * finding plus the correlation needed to attribute it. `scopeId` is null for
 * runs that carried no scope (e.g. some failed runs). Scope-neutral: no
 * domain-specific identifiers appear here.
 */
export interface RetrospectiveRouteInput {
  finding: RetrospectiveFinding;
  scopeId: string | null;
  originalRunId: string;
}

/**
 * The honest outcome of a single `route` call. `'routed'` means the finding
 * reached its destination pipeline (record_learning / improvement proposal).
 * `'dropped'` means the router deliberately declined to route it — an
 * unroutable `kind`, or an internal routing error — and carries a
 * `reasonCode` so the caller can emit an accurate rejection event instead of
 * silently counting a dropped finding as routed.
 */
export type RetrospectiveRouteResult =
  | { outcome: 'routed' }
  | { outcome: 'dropped'; reasonCode: string; detail?: string };

/**
 * The abstraction the analysis orchestrator calls once per surviving finding.
 * Task 7 implements this (re-derive confidence → route into the existing
 * `record_learning` / `create_skill_proposal` pipelines). It MUST be
 * fail-soft itself — a thrown error inside `route` should be caught and
 * translated into a `{ outcome: 'dropped' }` result — but the orchestrator
 * additionally guards every call so a throw still cannot abort the remaining
 * findings.
 */
export interface RetrospectiveRouterPort {
  route(input: RetrospectiveRouteInput): Promise<RetrospectiveRouteResult>;
}
