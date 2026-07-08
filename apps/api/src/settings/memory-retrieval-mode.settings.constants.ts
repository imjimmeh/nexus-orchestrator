/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the memory-retrieval-mode
 * operator-tunable knob (work item
 * 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 4).
 *
 * The fragment exports the single keyed default for
 * `memory_retrieval_mode`, the EPIC-212 Phase 1 Task 9 setting
 * that controls whether the `RecentTaskSummaryProvider` injects
 * memories using hybrid vector recall or the legacy
 * recency-ordered path.
 *
 * The keys + defaults + retrieval-tuning constants live in the
 * source-of-truth file
 * `apps/api/src/memory/signals/memory-retrieval.constants.ts` —
 * splitting the runtime constants out of the settings module is
 * the canonical pattern (mirrored by every other settings
 * constants file) because the retrieval service lives under
 * `apps/api/src/memory/signals/` and would otherwise pull the
 * entire settings module surface area into the memory code path.
 * The fragment imports the typed key + default directly so the
 * seeded value stays byte-identical to the runtime constant the
 * retrieval service falls back to.
 *
 * The full multi-line description is copied verbatim from the
 * pre-refactor inline registry so the operator-facing UI text
 * stays identical. The default is `'hybrid'` so the improvement
 * is active immediately once an embedding model is configured;
 * with no model, `hybrid` silently degrades to recency
 * (fail-soft), making the default safe to ship without a model
 * configured.
 *
 * Extracted out of `system-settings.defaults.ts` so that file
 * stays under the project's `max-lines` lint cap while the
 * operator-tunable knob surface continues to grow across
 * milestones. The spread keeps the seeded default byte-identical
 * to the pre-refactor inline registry.
 */
import {
  MEMORY_RETRIEVAL_MODE_DEFAULT,
  MEMORY_RETRIEVAL_MODE_SETTING,
} from '../memory/signals/memory-retrieval.constants';

export const MEMORY_RETRIEVAL_MODE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [MEMORY_RETRIEVAL_MODE_SETTING]: {
    value: MEMORY_RETRIEVAL_MODE_DEFAULT,
    description:
      'Memory injection retrieval strategy for the `RecentTaskSummaryProvider` ' +
      '(EPIC-212 Phase 1 Task 9). ' +
      "Accepted values: `'hybrid'` (default) — embed the current task context, run " +
      'KNN + lexical RRF over memory_embeddings, re-rank by ' +
      'cosine × recency_decay × usefulness × pinned_boost; ' +
      "`'recency'` — legacy recency-ordered injection without vector search. " +
      'When `hybrid` is set but no embedding model is configured the service ' +
      'automatically falls back to `recency` behaviour, so this default is safe ' +
      'on fresh deployments.',
  },
};
