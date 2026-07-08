/**
 * Type contracts for the ProjectGoal-override metadata accessor used by
 * {@link DistillationThresholdService}.
 *
 * Background (work item 3effbfa9):
 *   The session-distillation trigger threshold is resolved with a
 *   3-tier precedence chain:
 *     1. SystemSetting (`memoryDistillationThreshold.<resource>` /
 *        `memoryDistillationThreshold.__global__`).
 *     2. ProjectGoal override metadata
 *        (`ProjectGoal.metadata.memoryDistillationThreshold`).
 *     3. Hardcoded default (`MEMORY_DISTILLATION_THRESHOLD_DEFAULT`).
 *
 *   The ProjectGoal entity lives outside the `apps/api` workspace and
 *   the api workspace must stay decoupled from the upstream types and
 *   service layer (the eslint boundary rule forbids any
 *   domain-specific residue in this file). This module is the bridge
 *   point: the api resolver asks "what is the ProjectGoal-override
 *   metadata for this resource?" without importing any upstream type.
 *
 *   The concrete implementation will be provided by a followup work
 *   item that wires the upstream goal repository into the api DI
 *   graph (e.g. via an HTTP client or shared module). Until then the
 *   {@link NoopProjectGoalOverrideAccessor} is wired as the default —
 *   it always returns `null` so the resolver still walks the chain
 *   and falls through to the hardcoded default. This is intentional:
 *   the chain must be live code, not a JSDoc TODO, so the 3-tier
 *   wiring is exercised in production today and the bridge can drop
 *   in a real implementation without touching the resolver.
 */
import { Injectable } from '@nestjs/common';

/**
 * DI token used by {@link DistillationThresholdService} to look up
 * ProjectGoal override metadata. The default provider is
 * {@link NoopProjectGoalOverrideAccessor}; the followup bridge should
 * rebind it to a real implementation that delegates to the upstream
 * goal repository.
 */
export const PROJECT_GOAL_OVERRIDE_ACCESSOR = 'PROJECT_GOAL_OVERRIDE_ACCESSOR';

/**
 * The well-known key inside `ProjectGoal.metadata` that the resolver
 * consults. Mirrors the `memoryDistillationThreshold.*` SystemSetting
 * shape so operators can use either layer interchangeably.
 */
export const PROJECT_GOAL_OVERRIDE_METADATA_KEY =
  'memoryDistillationThreshold' as const;

/**
 * Narrow shape of the ProjectGoal row the resolver cares about. We
 * intentionally do NOT import the upstream `ProjectGoal` type here —
 * the eslint boundary rule would reject the import and the api
 * workspace should not depend on the upstream contracts. The bridge
 * implementation is free to use the full upstream schema internally;
 * the contract surfaced to the resolver is just the override fragment
 * keyed by a well-known `metadata` map.
 */
export interface ProjectGoalOverrideRecord {
  readonly id: string;
  readonly resourceScopeId: string;
  readonly metadata: Record<string, unknown> | null;
}

/**
 * Reads the ProjectGoal override metadata for a given resource id.
 *
 * The accessor is intentionally narrow: it returns either the full
 * override fragment (id + resourceScopeId + metadata) or `null`.
 * Callers decide what to do with the metadata blob; the resolver
 * only cares about the well-known key.
 */
export interface IProjectGoalOverrideAccessor {
  /**
   * Look up the ProjectGoal (if any) attached to the given resource
   * context. The `resourceId` semantics are decided by the bridge
   * implementation — the api resolver passes the sessionTreeId
   * (for `DistillationConsumer`) or the workflowRunId (for
   * `SessionHydrationService`) and the bridge translates the id to
   * the upstream lookup.
   *
   * @returns A {@link ProjectGoalOverrideRecord} when a goal is
   *   attached to the resource; `null` when there is no goal, when
   *   the resource id is unknown, or when the bridge has not been
   *   wired into the api workspace yet.
   */
  getOverrideByResourceId(
    resourceId: string,
  ): Promise<ProjectGoalOverrideRecord | null>;
}

/**
 * Default accessor used until the bridge lands.
 *
 * Always returns `null` so the resolver falls through the ProjectGoal
 * tier and the chain resolves to either the global SystemSetting or
 * the hardcoded default. The class is `@Injectable()` so it can be
 * replaced by binding a different provider to
 * {@link PROJECT_GOAL_OVERRIDE_ACCESSOR} when the bridge lands — no
 * change to the resolver or its callers is required.
 */
@Injectable()
export class NoopProjectGoalOverrideAccessor implements IProjectGoalOverrideAccessor {
  getOverrideByResourceId(
    _resourceId: string,
  ): Promise<ProjectGoalOverrideRecord | null> {
    return Promise.resolve(null);
  }
}
