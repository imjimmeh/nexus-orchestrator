/**
 * Response and request types for the apps/web control plane's
 * self-improvement surface (`PromotedLessonsCard` +
 * `SkillBindingUsageCard`). Mirrors the backend shape in
 * `apps/api/src/self-improvement/promoted-lessons.service.types.ts`.
 *
 * The web app does not depend on the api package, so the types
 * are duplicated verbatim. Keep both files in sync when the
 * response shape evolves.
 *
 * Note: `SkillBindingMostSpecificSource` is `'workflow' | 'step'`
 * only. `'profile'` is intentionally absent because
 * `workflow_skill_bindings` does not represent profile-scope
 * assignments — those live on the agent profile / skill binding
 * table (see `effective-skills.types.ts`).
 */

export type SkillBindingMostSpecificSource = "workflow" | "step";

export interface PromotedLesson {
  id: string;
  sourceSignalId: string | null;
  promotedAt: string;
  confidence: number;
  workflowSkillBindingIds: string[];
}

export interface SkillBindingUsage {
  id: string;
  mostSpecificSource: SkillBindingMostSpecificSource;
  reuseCount7d: number;
  workflowStepIds: string[];
}

export interface PromotedLessonsResponse {
  promoted: PromotedLesson[];
  bindings: SkillBindingUsage[];
}

/**
 * Request parameters for `GET /self-improvement/promoted-lessons`.
 * `since` is a compact `<count><unit>` token (`7d`, `24h`, `30m`).
 * Defaults to `7d` on the server when omitted; we mirror that
 * default at the API-client boundary so the hook can pass it
 * through verbatim.
 */
export interface PromotedLessonsParams {
  since?: string;
}
