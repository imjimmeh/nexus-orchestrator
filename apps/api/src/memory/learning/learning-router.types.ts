/**
 * Public contract for `LearningRouterService` (EPIC-212 Phase-2 Task 8).
 *
 * The `routing_target` column persists only `RoutingTarget`; the full
 * `RoutingDecision` is the in-process return consumed by the clusterer pass (and
 * available to Task 9/10 governance + promotion dispatch). `signals` NEVER
 * carries a raw lesson/summary string or a secret value — only structured,
 * non-sensitive derivation evidence.
 */

/** The deterministic scope home a candidate is routed to. */
export type RoutingTarget =
  | 'project'
  | 'global'
  | 'agent_preference'
  /** Workflow-definition-scoped home (Epic C). */
  | 'workflow'
  | 'skill_new'
  | 'skill_patch'
  | 'drop';

export interface RoutingDecision {
  /** The chosen routing target (persisted to `learning_candidates.routing_target`). */
  target: RoutingTarget;
  /**
   * The concrete scope_type the downstream promotion should use
   * (`project` | `global` | `agent` | `skill` | `drop`). Distinct from
   * `target`: `skill_new`/`skill_patch` both map to `skill`.
   */
  scopeType: string;
  /** Resolved scope id (project scope, agent profile, or null for global/skill/drop). */
  scopeId?: string | null;
  /** Human-readable reason the candidate landed in this home. */
  rationale: string;
  /** Router confidence in the scope decision (0–1); low values flag ties. */
  confidence: number;
  /**
   * Structured, non-sensitive derivation evidence. Guaranteed free of raw
   * lesson text and secret values so it can be logged/persisted safely.
   */
  signals: Record<string, unknown>;
}
