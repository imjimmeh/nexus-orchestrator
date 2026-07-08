/**
 * Operator-tunable confidence caps for the `RetrospectiveOutputRouter`
 * (EPIC-212 Phase-2 Task 7).
 *
 * The router RE-DERIVES every finding's confidence from its evidence CLASS and
 * ignores the analyst's self-reported `confidence_self` — the hallucination
 * neutralizer. The re-derived value is a HARD CAP:
 *
 *   - struggle-backed (the run exhibited a real failed→recovered struggle span)
 *     → capped at `retrospective_confidence_struggle_cap` (default 0.7).
 *   - pure inference (no struggle anchor) → capped at
 *     `retrospective_confidence_inference_cap` (default 0.45 — DELIBERATELY
 *     BELOW the 0.5 promotion floor, so an inference finding can never
 *     auto-promote without human approval).
 *
 * Both knobs live here as the canonical default and are seeded into
 * `SYSTEM_SETTING_DEFAULTS` (via {@link RETROSPECTIVE_ROUTER_SYSTEM_SETTING_DEFAULTS})
 * so a fresh database returns a sane value. The router re-reads each key on
 * every routing pass (via `SystemSettingsService.get`) so an operator can
 * re-tune the ceilings without restarting the app.
 */

export const RETROSPECTIVE_ROUTER_SETTING_KEYS = {
  struggleCap: 'retrospective_confidence_struggle_cap',
  inferenceCap: 'retrospective_confidence_inference_cap',
} as const;

export const RETROSPECTIVE_ROUTER_SETTING_DEFAULTS = {
  struggleCap: 0.7,
  inferenceCap: 0.45,
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so each
 * confidence cap is seeded with its canonical default and a UI description.
 */
export const RETROSPECTIVE_ROUTER_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [RETROSPECTIVE_ROUTER_SETTING_KEYS.struggleCap]: {
    value: RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.struggleCap,
    description:
      'Maximum re-derived confidence (0–1) the retrospective router assigns to a struggle-backed finding (a run that exhibited a real failed→recovered struggle span). A hard cap — the analyst self-report is ignored.',
  },
  [RETROSPECTIVE_ROUTER_SETTING_KEYS.inferenceCap]: {
    value: RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap,
    description:
      'Maximum re-derived confidence (0–1) for a pure-inference finding (no struggle anchor). Deliberately below the 0.5 promotion floor so an inference finding can never auto-promote without human approval.',
  },
};
