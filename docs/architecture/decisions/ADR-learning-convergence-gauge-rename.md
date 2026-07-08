# ADR: Learning convergence gauge rename + deprecation timeline

**Status:** Accepted
**Date:** 2026-07-08
**Work item:** 946a3c8b-5814-4e76-a804-b557e589600b
**Owner:** learning-convergence-executor
**Module:** `apps/api/src/memory/learning/learning-convergence/`

> Status line (literal): `Status: Accepted`

## Context

The self-improvement feedback loop exposes a per-scope
convergence ratio as a Prometheus gauge. The current
instrument is `nexus_learning_loop_convergence_ratio{scope}`,
labelled by `scope` so the operator UI can break the ratio
down by the agent scope the recorder scanned.

The same recorder now also publishes a per-window
convergence score via the recorder service
(`apps/api/src/memory/learning/learning-convergence/convergence-recorder.service.ts`)
under the new instrument name
`nexus_learning_convergence_score{source}`, labelled by
`source` (the `'24h' | '7d' | '30d'` enum the recorder
iterates). The new gauge is the canonical histogram source
because:

- Its label cardinality is bounded (3 source values vs. the
  open-ended `scope` label set the recorder cannot enumerate
  a priori).
- Its metric TYPE is a histogram (not a bare ratio), which
  lets Grafana compute quantiles / per-window trailing
  averages the bare ratio cannot.
- It is namespaced under the recorder's own domain
  (`learning/convergence`) rather than the
  learning-`loop` namespace the historical gauge borrowed
  from the upstream agent-feedback surface.

The two instruments co-exist today: both are populated, both
are scraped, and both are referenced from Grafana dashboards
the operator relies on.

## Decision

The recorder (`ConvergenceRecorderService.tick` /
`computeAndPersistSnapshot`) sets **only** the new
`nexus_learning_convergence_score{source}` gauge. The
historical `nexus_learning_loop_convergence_ratio{scope}`
gauge is **retained** in the Prometheus registry, but the
recorder stops emitting it. The historical gauge is left in
place so existing Grafana dashboards, alert rules, and the
operator UI's pre-existing "convergence ratio" widget
continue to render their last-observed value while the
operator migrates them to the new instrument.

The retention policy is: both instruments live on the
registry until the new instrument has been the sole
emitter for **at least four releases** (the milestone-5
T+0 dual-write window), after which the historical
`nexus_learning_loop_convergence_ratio{scope}` gauge is
marked deprecated in the registry's HELP/TYPE metadata and
the migration is gated on a follow-up ADR.

## Rollout

- **T+0 (this milestone, M5):** Dual-write. The recorder
  emits BOTH gauges on every pass. This is the
  M5-shipped-state: the historical gauge's last value is
  frozen to whatever the recorder's last
  `setConvergenceScore(scope, ratio)` call wrote before the
  recorder stopped calling the historical gauge; the new
  gauge advances on every pass.
- **T+1 release (next minor deploy):** Recorder switches
  to `SET_ONLY new`. The recorder no longer calls
  `setConvergenceScore` on the historical gauge (the
  `MetricsService.setConvergenceRatio` call site is
  removed). Existing Grafana dashboards continue to
  render the historical gauge's last value (a flat line at
  the T+0 freeze value) — a visible-but-actionable signal
  for the operator to migrate the dashboards.
- **T+2 through T+4 releases (operator migration window):**
  The operator migrates dashboards, alert rules, and the
  web UI's "convergence ratio" widget to
  `nexus_learning_convergence_score{source}`. The
  historical gauge is NOT removed from the registry —
  removing it would orphan any dashboard / alert that the
  operator hasn't migrated and would silently disable an
  active alert.
- **T+5 release (deprecation baked in):** The historical
  gauge is marked deprecated. The `HELP` metadata is
  rewritten to point operators at the new instrument.
  The gauge still emits (`1` values from the registry's
  default-zero state) so the dashboard migration window
  is still survivable for any operator that hasn't
  migrated yet.
- **T+6 release (next-next minor, follow-up ADR):** The
  historical gauge is removed from the registry in a
  separate ADR. The removal is gated on confirming the
  Grafana dashboard migration is complete (no active
  alert / no active dashboard panel references the
  historical gauge name).

## Consequences

- The recorder's per-pass metrics surface is unambiguous:
  pass observers see one instrument advancing, one frozen.
- Grafana dashboard migration is an explicit operator
  task, not an implicit retro-compat hazard. The T+2→T+4
  window gives the operator enough release cadence to
  migrate one dashboard panel at a time.
- The historical gauge retains its semantic meaning
  ("per-scope ratio") in frozen state until T+5, so
  forensic inspection of an incident that pre-dates the
  rename is still possible.
- The `nexus_learning_loop_convergence_ratio{scope}`
  removal at T+6 is a breaking change for any operator
  who has not migrated by then. The HELP/TYPE rewrite at
  T+5 is the explicit "you must migrate now" signal.

## Alternatives rejected

- **Rename-without-deprecation.** Adopt the new gauge as
  the sole canonical source, immediately remove the
  historical gauge from the registry, AND treat the
  rename as a single-deploy breaking change.
  - **Rejected because** it would orphan every active
    Grafana dashboard panel and every Prometheus alert
    rule that references the historical gauge, silently
    disabling them on the deploy day. The operator has
    no signal that anything is broken until they next
    open the dashboard. The deprecation timeline above
    trades one extra release of dual-write for
    observability of the migration.
- **Silent replace.** Keep the historical gauge name in
  the registry, but repoint the recorder's emission to
  write to it under the new `source` label semantic. The
  labels change meaning without the gauge name changing.
  - **Rejected because** it is invisible: the operator
    sees the historical gauge continuing to update, with
    no signal that the label cardinality / semantics have
    shifted. Any alert that fired on the historical
    `scope` label structure would silently start firing
    on the new `source` structure (or stop firing
    entirely, depending on the alert rule) — a silent
    alerting failure mode. The dual-write + deprecation
    timeline above leaves the label semantics pinned to
    the historical gauge until the explicit deprecation
    step.
- **One-shot rename with no historical retention.** Add the
  new gauge, remove the historical gauge's HELP/TYPE
  references, and rely on Grafana's "metric missing"
  rendering to alert the operator that the dashboard
  needs an update.
  - **Rejected because** Prometheus's "metric missing"
    behaviour is dashboard-config-dependent — some
    dashboards render the panel as "no data" with no
    explicit error indicator, so the operator only learns
    the panel is broken when they happen to open the
    dashboard. The HELP/TYPE rewrite at T+5 is the
    explicit operator-visible signal this alternative
    lacks.
