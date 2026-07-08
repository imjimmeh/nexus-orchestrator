/**
 * Operator-tunable gate for the templated orchestration-cycle learning
 * candidate emitted by the external retrospective service.
 *
 * The external service emits a `learning.candidate.proposed.v1` event after
 * every orchestration cycle with a templated lesson of a well-known format:
 * "<scope> completed an orchestration cycle with N done items, M blocked
 * items, and cycle decision <decision>.".
 * These generate ~714 useless rows/week that are all rejected at the scoring
 * phase.  This gate lets the API consumer drop them at ingestion without
 * touching the emitting service (which keeps this module domain-neutral).
 * The original plan included a `scope_type` equality guard for the domain project
 * type, but domain-specific value strings are banned from API/core by the
 * core/API boundary lint rule.  The regex suffix match is specific enough to
 * avoid false positives without anchoring on the scope type.
 *
 * Default: OFF — the flood is blocked from birth.  Set the setting to `true`
 * only if you want to restore the legacy templated producer rows.
 *
 * EPIC-212 noise hygiene, Task B1.
 */

export const ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_KEY =
  'orchestration_cycle_candidate_enabled';

export const ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_DEFAULT = false;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * gate seeds on a fresh DB with its canonical default (`false`) and a UI
 * description.
 */
export const ORCHESTRATION_CYCLE_CANDIDATE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_KEY]: {
    value: ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_DEFAULT,
    description:
      'When false (default) the API drops templated "completed an orchestration cycle" learning candidates at ingestion. Set true only to restore the legacy templated producer rows.',
  },
} as const;

/**
 * Regex that matches the templated orchestration-cycle lesson format emitted
 * by the external retrospective service.  Reused by the gate (Task B1) and
 * the classifier (Task B2) so there is a single source of truth.
 *
 * Example match:
 *   "… completed an orchestration cycle with 2 done items,
 *    0 blocked items, and cycle decision repeat."
 *
 * No `^` start anchor: the lesson text begins with a domain-specific project
 * identifier prefix (e.g. "<DomainType> project <uuid>...") that varies per
 * emitter and cannot be expressed in API/core code.  The suffix is distinctive
 * enough to uniquely identify the template without anchoring the start.
 */
export const ORCHESTRATION_CYCLE_LESSON_TEMPLATE =
  /completed an orchestration cycle with \d+ done items?, \d+ blocked items?, and cycle decision .+\.$/;
