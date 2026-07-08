import type {
  ScopeApplicationDecision,
  ScopeApplicationInput,
} from './skill-scope-auto-apply.decide.types';

/**
 * Pure function — no NestJS, no side effects, no I/O.
 *
 * Decides whether an analyst-recommended skill scope should be applied
 * immediately (`auto_apply`) or parked for human review (`stage`).
 *
 * Rules:
 * - `manual` → always stage (preserves the pre-Phase-4 behaviour exactly).
 * - `staged` → stage (marks eligible for future bulk-confirm, not yet wired).
 * - `auto`   → auto_apply only when ALL of the following hold: the scope has
 *              at least one non-empty array in `projects`, `agents`, or
 *              `workflows`; `originScopeId` is known (non-null); the
 *              recommendation does not widen past that origin scope (its
 *              `projects` list is either empty-meaning-"no restriction", in
 *              which case it is treated as widening and NOT auto-applied, or
 *              contains only `originScopeId`); AND both `agents` and
 *              `workflows` are empty. A recommendation that widens past the
 *              origin — including recommending global (no project
 *              restriction), a different project, or ANY non-empty `agents`
 *              or `workflows` entry — always stages, even in `auto` mode: no
 *              autonomous proposal may grant itself scope wider than the run
 *              it actually executed under.
 *
 * Why `agents`/`workflows` can never auto-apply: skill visibility is OR'd
 * across the three scope dimensions (see
 * `AgentSkillLibraryService.isVisible`) — a non-empty `agents` or `workflows`
 * list is its own independent widening axis, not a narrowing filter on top of
 * `projects`. Naming an agent profile or workflow grants that profile/workflow
 * visibility into the skill in *every* project, which is strictly wider than
 * the single origin project the run executed under. Only a `projects`-only
 * recommendation (empty `agents` and `workflows`) is confined to the origin
 * scope and eligible for `auto` mode; anything naming an agent or workflow
 * always stages for a human to grant explicitly.
 *
 * When auto-applying, `confirmedScope.projects` is clamped to exactly
 * `[originScopeId]` rather than trusting the recommendation's own `projects`
 * value verbatim, so the applied scope's project dimension can never drift
 * from the run's actual origin even if the recommendation redundantly named
 * it. `confirmedScope.agents`/`workflows` are always empty in the auto-applied
 * result, since a non-empty value on either would have caused a stage instead.
 */
export function decideScopeApplication(
  input: ScopeApplicationInput,
): ScopeApplicationDecision {
  const { mode, recommendedScope, originScopeId } = input;

  if (
    mode !== 'auto' ||
    recommendedScope == null ||
    !hasContent(recommendedScope)
  ) {
    return {
      action: 'stage',
      reason: buildStageReason(mode, recommendedScope),
    };
  }

  if (originScopeId === null) {
    return {
      action: 'stage',
      reason: 'auto mode but there is no known origin scope to clamp against',
    };
  }

  if (!isWithinOriginScope(recommendedScope, originScopeId)) {
    return {
      action: 'stage',
      reason: 'recommendation widens beyond origin scope',
    };
  }

  if (namesAgentsOrWorkflows(recommendedScope)) {
    return {
      action: 'stage',
      reason:
        'recommendation names agents or workflows, which widen visibility ' +
        'independently of the origin-scope project clamp (OR semantics) ' +
        'and always require human confirmation',
    };
  }

  return {
    action: 'auto_apply',
    confirmedScope: {
      projects: [originScopeId],
      agents: [],
      workflows: [],
    },
    reason: 'auto mode with a recommendation clamped to the origin scope',
  };
}

/**
 * True when the recommendation's `projects` dimension does not reach beyond
 * `originScopeId`: an empty list means "no restriction" (implicit global,
 * always a widening) and any entry other than `originScopeId` is a widening
 * to a different scope. A recommendation naming only `originScopeId` (or
 * omitting `projects` entirely, treated the same as empty) is the only case
 * that passes.
 */
function isWithinOriginScope(
  recommendedScope: Record<string, unknown>,
  originScopeId: string,
): boolean {
  const projects = (recommendedScope as { projects?: unknown }).projects;
  if (!Array.isArray(projects) || projects.length === 0) {
    return false;
  }
  return projects.every((project) => project === originScopeId);
}

/**
 * True when the recommendation names at least one agent or workflow. Under
 * the OR-semantics of skill visibility, either is an independent widening
 * axis (visible to that agent/workflow in every project) and can never be
 * folded into the origin-scope `projects` clamp.
 */
function namesAgentsOrWorkflows(scope: Record<string, unknown>): boolean {
  const { agents, workflows } = scope as {
    agents?: unknown;
    workflows?: unknown;
  };
  return (
    (Array.isArray(agents) && agents.length > 0) ||
    (Array.isArray(workflows) && workflows.length > 0)
  );
}

function hasContent(scope: Record<string, unknown>): boolean {
  const { projects, agents, workflows } = scope as {
    projects?: unknown;
    agents?: unknown;
    workflows?: unknown;
  };
  return [projects, agents, workflows].some(
    (arr) => Array.isArray(arr) && arr.length > 0,
  );
}

function buildStageReason(
  mode: ScopeApplicationInput['mode'],
  scope: Record<string, unknown> | null | undefined,
): string {
  if (mode !== 'auto') {
    return `mode is ${mode}`;
  }
  if (scope == null) {
    return 'auto mode but recommended scope is null/undefined';
  }
  return 'auto mode but recommended scope has no projects, agents, or workflows entries';
}
