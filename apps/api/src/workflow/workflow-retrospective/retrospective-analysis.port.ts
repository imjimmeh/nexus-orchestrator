/**
 * Dependency-inversion seam between the budget-capped drain (EPIC-212 Phase-2
 * Task 3) and the LLM analysis orchestrator (Task 6, NOT yet built).
 *
 * The drain depends on this ABSTRACTION — never on Task 6's concrete service —
 * so the cost-governing pipeline (claim → budget → floor → mark) is complete,
 * testable, and safe to ship before any analyst exists. When Task 6 lands it
 * binds a concrete provider to {@link RETROSPECTIVE_ANALYSIS_PORT} in the
 * module; until then the `@Optional()` injection resolves to `undefined` and
 * the drain degrades gracefully without losing any queued row.
 *
 * The contract types live in `retrospective-analysis.types.ts` (the project's
 * `*.types.ts` convention) and are re-exported here for ergonomic import
 * alongside the token.
 */
export const RETROSPECTIVE_ANALYSIS_PORT = Symbol(
  'RETROSPECTIVE_ANALYSIS_PORT',
);

export type {
  RetrospectiveAnalysisStatus,
  RetrospectiveAnalysisOutcome,
  RetrospectiveAnalysisPort,
} from './retrospective-analysis.types';
