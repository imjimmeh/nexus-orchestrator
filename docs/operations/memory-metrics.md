# Memory Metrics: `active_segments` Gauge

This document explains the two `active_segments` gauges for the
`postgres` backend (the `honcho` gauge is described in the "Honcho
backend" section below), clarifies which one is authoritative when
the refresh service is enabled, and documents the operator-facing
settings that toggle the refresh path on and off.

## TL;DR

| Gauge                                                                                                                        | Source of truth                                                                                                                        | Authoritative when…                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryMetricsService.snapshot().backend.active_segments.total.postgres` (in-memory, per-process)                            | Refresh service: `MemoryMetricsRefreshService` (default). Bump path: `MemoryManagerService.bumpActiveSegmentsGauge` (kill switch off). | Refresh enabled (default). The refresh tick overwrites this gauge with the DB count. When the kill switch is off, the bump path is authoritative, but it is best-effort (see below).                                               |
| `MetricsService.memoryBackendActiveSegments` → `nexus_memory_backend_active_segments{backend,source}` (prom-client, scraped) | Refresh service: `MemoryMetricsRefreshService`. Bump path: `MemoryManagerService.bumpActiveSegmentsGauge`.                             | Refresh enabled. This gauge is updated **in the same call** as the in-memory gauge on every refresh tick. In a multi-replica deployment, the prom-client scrape is the **cross-process aggregate** (see "Distributed mode" below). |

When the kill switch (`memory_metrics_gauge_use_refresh`) is `false`,
both gauges are populated **only** by the legacy bump path in
`MemoryManagerService` (called from `createMemorySegment`,
`updateMemorySegment`, and `deleteMemorySegment`). The bump path is
best-effort: it increments the gauge on writes but never decrements
unless `deleteMemorySegment` is called, so deletes that bypass
`MemoryManagerService` (e.g. direct SQL or a future bulk-delete API)
will leave the gauge inflated.

## Authoritative gauge, in one sentence

The refresh service is the authoritative source of the
`postgres`/`active_segments` gauge when
`memory_metrics_gauge_use_refresh = true` (the default). With the kill
switch off, the legacy bump-on-write path in `MemoryManagerService`
is the only source — and it is best-effort, not derived from the
DB.

## How the refresh service works

`MemoryMetricsRefreshService` is a NestJS service registered on
`MemoryModule` that runs a self-rescheduling async chain on
`OnApplicationBootstrap`:

1. Read the kill switch (`memory_metrics_gauge_use_refresh`).
   - If `false`, the tick is a no-op; the legacy bump path is the
     only source of the gauge.
2. Read the interval (`memory_metrics_refresh_interval_seconds`,
   default `60s`, range `5s`–`3600s`). The interval is re-read on
   every tick so operator overrides take effect on the next tick
   without a restart.
3. Run
   `SELECT metadata_json->>'source' AS source, COUNT(*) AS count FROM memory_segments GROUP BY source`
   against the `memory_segments` table. Rows with a missing or empty
   `source` are coalesced to `'unknown'`.
4. For each `(source, count)` row, call **both** of the following in
   the same loop iteration:
   - `MemoryMetricsService.setActiveSegments('postgres', source, count)` —
     overwrites the in-memory snapshot.
   - `MetricsService.setMemoryBackendActiveSegments('postgres', source, count)` —
     overwrites the prom-client gauge.
     Both APIs overwrite the gauge absolutely — the refresh does NOT
     accumulate. The two writes are paired deliberately so a tick
     that successfully updates one always updates the other.

The body is wrapped in try/catch: DB errors are logged and the chain
reschedules. The service is safe to instantiate in tests; the chain
is only armed on `onApplicationBootstrap` (or `start()` in tests).

## Distributed mode

The refresh service is **per-process**. In a multi-replica
deployment, every replica runs its own `MemoryMetricsRefreshService`
on its own timer. Two consequences:

- The in-memory snapshot (`MemoryMetricsService.snapshot()…`) is a
  per-process view: each replica sees only the writes that landed
  on its connection pool. The REST endpoint
  `GET /memory/metrics` is therefore a per-replica view, not a
  cluster-wide one.
- The prom-client gauge
  (`nexus_memory_backend_active_segments{backend,source}`) is
  **also per-process** at the metric level, but the Prometheus
  scrape aggregates across replicas. Use the scraped metric for any
  cross-replica observability (dashboards, alerts, SLOs). The
  per-process REST snapshot is for local debugging only.

The refresh tick is intentionally cheap (a single indexed
`GROUP BY` against `memory_segments`), so the per-process cost is
negligible even with many replicas. If the query ever becomes
expensive, the kill switch (see below) reverts each replica to the
bump-on-write path with no code change.

## Honcho backend

The refresh service only authoritatively refreshes the `postgres`
backend label. The `memory_segments` table is the source of truth for
postgres-backed segments; Honcho data lives in an external service
and is not queryable from inside the API. The `honcho`
`active_segments` gauge therefore remains the legacy bump path until a
future work item introduces an equivalent query surface. The
`memory_metrics_gauge_use_refresh` kill switch only toggles the
postgres gauge — honcho is unaffected.

## Legacy bump-on-write path

`MemoryManagerService` calls a private
`bumpActiveSegmentsGauge()` from three write sites:
`createMemorySegment`, `updateMemorySegment`, and
`deleteMemorySegment`. The method reads the current value from
`MemoryMetricsService.snapshot()`, increments it by 1, and writes it
back to **both** `MemoryMetricsService.setActiveSegments` and
`MetricsService.setMemoryBackendActiveSegments`.

The bump path remains in place deliberately so the kill switch has a
non-refresh fallback. With the kill switch off, every write site
still updates both gauges; with the kill switch on, the bump is
ineffective because the next refresh tick overwrites the gauge
absolutely.

## Operator-facing settings

| Key                                       | Type    | Default | Range          | Effect                                                                                                                                                                                                       |
| ----------------------------------------- | ------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memory_metrics_refresh_interval_seconds` | number  | `60`    | `5`–`3600`     | Seconds between refresh ticks. Re-read on every tick; operator changes take effect on the next tick. Lower values track writes more closely at the cost of more `SELECT count(*) … GROUP BY source` queries. |
| `memory_metrics_gauge_use_refresh`        | boolean | `true`  | `true`/`false` | When `true`, the refresh tick overwrites the gauge with the DB count (authoritative). When `false`, the refresh is a no-op and the legacy bump path is the only source.                                      |

Both settings are registered in `SYSTEM_SETTING_DEFAULTS` (see
`apps/api/src/settings/system-settings.service.ts`) and are seeded by
`SystemSettingsModule.onModuleInit` (`seedDefaults`).

Changes to either setting emit a `memory.setting.changed.v1` event to
the EventLedger so operator changes are auditable alongside the
existing `memoryDistillationThreshold` family.

### Tuning the refresh interval

The default 60s is a balance between freshness and DB load. For
busier deployments, raise it (e.g. 300s) — the gauge will lag a few
minutes behind the table, but the prom-client scrape still surfaces
a coherent cross-replica aggregate. For debugging, lower it (e.g.
5s) — note that the in-memory snapshot and the per-process prom-client
gauge will reflect writes within one tick, but the cluster-wide
prom-client aggregate will still depend on each replica's tick
phase.

### Kill-switch fallback workflow

If the refresh query is expensive on a hot DB (e.g. a large
`memory_segments` table where the `GROUP BY` plan regresses), set:

```
memory_metrics_gauge_use_refresh=false
```

The change takes effect on the next tick of every replica. The
refresh chain becomes a no-op and the legacy bump-on-write path
takes over as the only source of the gauge. There is no need to
restart the API. To re-enable the refresh, set the setting back to
`true`; the next tick of each replica will overwrite the gauge with
the DB count.

The kill switch only affects the `postgres` gauge. Honcho is
unaffected (see above).

## Verifying the gauge

To confirm the refresh is working:

1. Watch the gauge via the REST endpoint
   `GET /memory/metrics` (auth: `memory:read`).
2. Insert / delete rows directly in `memory_segments` and check the
   `active_segments.total.postgres.<source>` value after the next tick.
3. The gauge MUST equal `SELECT count(*) FROM memory_segments WHERE metadata_json->>'source' = '<source>'`
   within one refresh interval.

## Failure modes

| Failure                                       | Behaviour                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `memory_metrics_gauge_use_refresh` is `false` | Refresh is a no-op. Legacy bump path is the only source of the gauge.                                             |
| Interval setting is missing or out of range   | Default of 60s is used. The refresh continues to run.                                                             |
| Kill switch setting read throws (DB down)     | Refresh defaults to enabled for that tick and logs a warning. The chain keeps rescheduling.                       |
| Refresh query throws (DB down)                | Tick logs a warning and returns early. The chain keeps rescheduling. The gauge retains the previous tick's value. |
| Gauge push throws                             | Tick logs a warning and returns early. The chain keeps rescheduling. The gauge retains the previous tick's value. |

In every failure mode the process stays alive and the refresh chain
keeps running. The kill switch and the long default interval (60s)
mean a transient DB outage does not surface as a "stuck" gauge.

## Related Docs

- `apps/api/src/memory/memory-metrics-refresh.service.ts`
- `apps/api/src/memory/memory-metrics.service.ts`
- `apps/api/src/memory/memory-manager.service.ts`
- `apps/api/src/settings/memory-metrics-settings.constants.ts`
- `apps/api/src/observability/metrics.service.ts`

---

# Memory Metrics: `learning.convergence` Block

The `GET /memory/metrics` REST snapshot also exposes the
**learning feedback-loop convergence gauge** (work item
`88d7654e-ca93-4ffa-8ba5-7065db9506db`, milestone 4). Operators can read
it directly off the response — no Prometheus scrape required.

## TL;DR

| Gauge                                                                                                             | Source of truth                                                                                                  | Authoritative when…                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MemoryMetricsService.getSnapshot().learning.convergence[scope]` (in-memory, per-process JSON snapshot)           | `MemoryMetricsService.computeConvergenceSnapshotsAsync` (live `learning_convergence_window_days` SystemSetting). | Always, for the single replica that owns the in-memory state.                                                            |
| `MetricsService.nexusLearningLoopConvergenceRatio` → `nexus_learning_loop_convergence_ratio{scope}` (prom-client) | Same per-scope computation; `MetricsService.setLearningLoopConvergenceRatio` is called from the snapshot path.   | Multi-replica. Use the scraped metric for cluster-wide aggregations (same caveat as the `active_segments` gauges above). |

`scope` is the resolved scope id the lesson was attached to —
typically a project UUID or a workflow-run UUID. The block is omitted
from the snapshot when the scope has zero injections AND zero
outcomes in the rolling window; an empty `learning.convergence: {}`
is the "no data" signal.

## Snapshot shape

```jsonc
{
  "learning": {
    "promoted_total": 7,
    "last_promoted": {
      /* ... */
    },
    "lesson_injected_total": 12,
    "last_lesson_injected": {
      "lesson_id": "...",
      "scope": "project-x",
      "injected_at": "2026-06-15T12:05:00.000Z",
    },
    "run_outcome_after_lesson_total": 10,
    "last_run_outcome_after_lesson": {
      "lesson_id": "...",
      "scope": "project-x",
      "outcome": "success",
      "observed_at": "2026-06-15T12:06:00.000Z",
    },
    "convergence": {
      "project-x": {
        "ratio": 0.8,
        "window_days": 7,
        "runs_after_lesson": 10,
        "successes_after_lesson": 8,
        "computed_at": "2026-06-15T12:10:00.000Z",
      },
    },
  },
}
```

`ratio` is `successes_after_lesson / runs_after_lesson` over the
rolling window of `learning_convergence_window_days` days (default
`7`). `ratio` is `0` when `runs_after_lesson === 0` — the block
still surfaces so the operator can see "the lesson was injected but
no run-after-lesson has completed yet".

## How the computation works

The convergence snapshot is recomputed on every call to
`MemoryMetricsService.getSnapshot()` (the async path used by the REST
controller), so the JSON snapshot and the prom-client gauge are
always consistent. Per-scope ring buffers track every
`recordLearningLessonInjected` (timestamp) and
`recordWorkflowRunOutcomeAfterLesson` (`{at, outcome}`) event; the
computation trims expired samples, divides the in-window successes
by the in-window runs, and publishes the per-scope ratio to the
prom-client gauge via
`MetricsService.setLearningLoopConvergenceRatio`.

## Operator-facing settings

| Key                                | Type   | Default | Range    | Effect                                                                                                                                                            |
| ---------------------------------- | ------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learning_convergence_window_days` | number | `7`     | `1`–`90` | Days of in-process history used to compute the per-scope ratio. Re-read on every snapshot; operator overrides take effect on the next `GET /memory/metrics` call. |

The setting is registered in `SYSTEM_SETTING_DEFAULTS` and is
seeded by `SystemSettingsModule.onModuleInit` (`seedDefaults`). The
default of 7 days matches the original work-item contract; raise it
to smooth over short bursts of noisy run outcomes, lower it to react
faster to feedback-loop regressions.

## Verifying the gauge

1. Watch the gauge via the REST endpoint `GET /memory/metrics`
   (auth: `memory:read`).
2. The `learning.convergence` block is keyed by `scope`; the
   `ratio` MUST equal `successes_after_lesson / runs_after_lesson`
   for the in-window samples tracked by
   `MemoryMetricsService.learningInjectTimestampsByScope` /
   `learningOutcomeTimestampsByScope`.
3. Cross-check the same value via the prom-client scrape
   `nexus_learning_loop_convergence_ratio{scope=<scope>}` — they
   MUST agree within one snapshot tick.

## WebUI visibility

The control-plane `MemoryHealthCard` (`apps/web/src/features/control-plane/MemoryHealthCard.tsx`)
renders a "Learning convergence" section that mirrors the snapshot.
It exposes the scope, ratio (formatted to two decimal places), and
the raw `successes / runs` numbers so operators can see "ratio = 0.5
from 2/4" vs "ratio = 0.5 from 50/100" without leaving the UI. The
section is loading / empty / populated depending on the hook state.

## Related Docs

- `apps/api/src/memory/memory-metrics.service.ts`
- `apps/api/src/settings/learning-convergence-settings.constants.ts`
- `apps/web/src/features/control-plane/MemoryHealthCard.tsx`
- `apps/web/src/hooks/useMemoryMetrics.ts`
