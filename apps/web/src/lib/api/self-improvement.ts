import { api } from "./client";
import type {
  PromotedLessonsParams,
  PromotedLessonsResponse,
} from "./self-improvement.types";

/**
 * Default `since` token forwarded to
 * `GET /self-improvement/promoted-lessons` when the caller does
 * not pass one explicitly. Matches the backend's `since` default
 * (see `promotedLessonsQuerySchema` in
 * `apps/api/src/self-improvement/promoted-lessons.service.types.ts`).
 */
const DEFAULT_SINCE = "7d";

/**
 * Fetch the trailing-window snapshot of promoted learning
 * candidates plus the currently-active workflow skill bindings.
 *
 * The control plane's `PromotedLessonsCard` and
 * `SkillBindingUsageCard` are co-served from this one endpoint
 * because the two facts (recent promotions + the bindings
 * already wired up) form a small, coherent dataset; splitting
 * them would double the round-trips and surface a stale
 * snapshot when the two are read moments apart.
 */
export async function fetchPromotedLessons(
  params: PromotedLessonsParams = {},
): Promise<PromotedLessonsResponse> {
  const since = params.since ?? DEFAULT_SINCE;
  return api.get<PromotedLessonsResponse>("/self-improvement/promoted-lessons", {
    params: { since },
  });
}

export const selfImprovementApi = {
  fetchPromotedLessons,
};
