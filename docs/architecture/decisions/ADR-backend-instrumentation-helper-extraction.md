# ADR: Extract `BackendInstrumentation` Helper to Centralise Cross-Backend Metrics

**Status:** Accepted
**Date:** 2026-06-26
**Work item:** eaed2b58-6818-4e46-ba50-414362f843a5
**Owner:** refactor-executor
**Module:** `apps/api/src/memory/`
**Related docs:** `docs/architecture/memory-management.md`, `.agents/designs/backend-instrumentation-design.md`, `.agents/designs/backend-instrumentation-final-summary.md`

> Status line (literal): `Status: Accepted`

## Context

The memory subsystem ships three per-backend services —
`PostgresMemoryBackendService`, `HonchoMemoryBackendService`, and
`HonchoFallbackMemoryBackendService` — each of which historically wraps
every operation in a copy-pasted
`try { recordBackend*(backend, 'success'); } catch { recordBackend*(backend, 'failure'); throw; }`
pattern, paired with the prom-client mirror on `MetricsService`. The
two metrics sinks (in-memory `MemoryMetricsService` and prom-client
`MetricsService`) drift in subtle ways because the pattern is
hand-rolled at every call site. The full drift inventory lives in
`.agents/designs/backend-instrumentation-design.md` §2.3 (eight
findings, D1–D8). The drift that matters operationally is:

- **D1 — read-latency observation is asymmetric.** Postgres records
  read latency in `finally` (so success and failure both fire);
  HonchoFallback records it **only** inside `catch` (F2 line 91, F3
  line 119, F4 line 167, F5 line 196). A successful honcho read
  routed through HonchoFallback loses its latency observation.
- **D2 — honcho read latency is double-counted on failure.** When
  `HONCHO_FALLBACK_ON_ERROR=false`, `HonchoMemoryBackendService`
  records honcho read latency in its own catch (H2 line 132), then
  `HonchoFallbackMemoryBackendService` records it again (F2 line
  90–91). Two `recordBackendRead('honcho', ...)` calls fire for the
  same honcho attempt.
- **D4 — backend label is a string literal.** All 27 instrumented
  call sites pass the label as a positional string. A typo
  (`'honch'`) compiles silently and produces a new prom-client
  label series.
- **D6 — un-instrumented paths are undocumented.**
  `updateMemorySegmentWithMetadata` and `searchPromotedLessonsByScope`
  bypass instrumentation by **absence** of code rather than by an
  explicit signal at the call site; a reader cannot tell whether
  the lack of instrumentation is deliberate or accidental.

The 27 instrumented call sites are spread across the three backend
services (Postgres: 10, Honcho: 9 metric sites + 2 passthroughs,
HonchoFallback: 9). Every call site is a candidate for asymmetric
edits — e.g. adding a new label to one backend only, switching from
`recordRead` to `recordReadWithOperation`, or normalising the
fallback log prefix on Honcho but not HonchoFallback. The drift is
already creeping in (Honcho logs `"Falling back to postgres memory
backend…"` while HonchoFallback logs `"Honcho-fallback backend
falling back to postgres…"` — D5). Three near-identical hand-rolled
wrappers is the threshold at which the duplication stops being a
stylistic concern and starts actively inviting silent drift.

The nightly `codebase_refactoring_analysis` scan flagged this
pattern under work item `eaed2b58-6818-4e46-ba50-414362f843a5`,
and the rationale from that scan is the canonical statement of why
we are extracting now.

## Decision

Extract a single `@Injectable()` class — `BackendInstrumentation` —
to own the cross-backend metrics shape. The helper lives at
`apps/api/src/memory/backend-instrumentation.ts` (with the
companion `apps/api/src/memory/backend-instrumentation.types.ts`
holding the public type contracts, per the project's lint policy on
`*.types.ts` files for exported interfaces) and is registered as a
**single provider in `MemoryModule`**, not as a separate
`MemoryInstrumentationModule`. Justification for the single-provider
choice: the helper has no other consumers (OQ-5 in the design doc);
introducing a separate NestJS module would add a module-boundary
graph edge with no semantic benefit. `MemoryModule.providers` carries
one entry; nothing else changes in the module graph.

The helper exposes four public methods:

- `recordWrite(ctx, fn)` — wraps a write. Calls
  `memoryMetrics.recordBackendWrite(backend, outcome)` and
  `metricsService.recordMemoryBackendWrite(backend, outcome)` in
  lock-step on success and failure, then re-throws.
- `recordRead(ctx, fn)` — wraps a read. Calls both mirrors in a
  `finally` block using `process.hrtime.bigint()`-derived latency
  so success **and** failure both fire (fixes D1; de-duplicates D2).
- `recordFallback(ctx, fn)` — increments the fallback counter on
  both mirrors; carries an optional `recordPrimaryLatencyMs` for
  the primary-attempt latency observation. Callers using
  `HONCHO_FALLBACK_ON_ERROR=false` route the primary latency
  through `recordRead` instead so it is observed exactly once.
- `passthrough(fn)` — explicit no-op for the un-instrumented
  `updateMemorySegmentWithMetadata` / `searchPromotedLessonsByScope`
  paths (fixes D6; the absence-of-code is now searchable at the
  call site as a `passthrough(...)` invocation).

All 27 instrumented call sites route through one of the four
methods. `BackendLabel` is a closed union re-exported from
`memory-metrics.types.ts`, so the helper boundary is
type-checked and a stray label literal is a compile error (fixes D4).

The helper is the **sole fan-out point** for both metrics mirrors.
After the M3 redundant-injection cleanup, the three backend services
inject `BackendInstrumentation` only — `MemoryMetricsService` and
`MetricsService` are no longer constructor parameters on the three
services. The `passthrough()` method documents the un-instrumented
paths explicitly so the lack of instrumentation is intentional and
searchable rather than accidental.

## Alternatives

### Option 1 — Decorator-based AOP interception (NestJS interceptor / aspect)

Add a NestJS interceptor (or an aspect via `nestjs-pino` /
`@nestjs/terminus`-style metadata reflection) that wraps every
backend method and records `outcome` + latency around the
intercepted call.

Rejected because:

1. **Not every metric call goes through a NestJS controller
   boundary.** The fallback path inside
   `HonchoMemoryBackendService` re-throws and the helper must
   observe the primary-attempt latency **before** the secondary
   backend executes; an interceptor around the public method would
   miss this in-band observation.
2. **The latency observation must happen inside the `try` block.**
   Today the `finally` semantics ensure exactly-once observation
   across success and failure. An interceptor around the method
   would observe twice (entry + exit) or rely on the
   `@nestjs/common` interceptor's error-forwarding contract, which
   is a behaviour we cannot pin at the type level.
3. **Decorator metadata is harder to grep than a method call.**
   Today the 27 call sites are visible as `this.backendInstrumentation.record*(...)`
   in the code. Decorator metadata hides the metric shape behind
   the interceptor wiring, which makes future audits (the
   `codebase_refactoring_analysis` nightly scan, for example)
   strictly harder.

### Option 2 — A static helper class

Export a `recordRead / recordWrite / recordFallback` static
function (or namespace) from a utility file. The three services
would pass `memoryMetrics` and `metrics` at every call site.

Rejected because:

1. **Defeats DRY.** A static helper has no DI, so each service
   must inject both mirrors and forward them as arguments — that
   is exactly the 27-site duplication this refactor is collapsing.
2. **Per-call-site coupling.** A static helper couples every call
   site to the method names on both `MemoryMetricsService` and
   `MetricsService`; if either mutator renames (D4's silent-typo
   failure mode in particular), every call site must change.
3. **No place for `logger` or future extensions.** The D5
   log-prefix normalisation follow-up wants a `logger`-aware
   helper; a static function cannot carry a NestJS `Logger` in a
   type-safe way without an instance.

### Option 3 — A per-backend subclass

`PostgresBackendInstrumentation extends BackendInstrumentation`,
`HonchoBackendInstrumentation extends BackendInstrumentation`, etc.
The base class holds the common fan-out; the subclasses override
per-backend behaviour.

Rejected because:

1. **The drift is between backends, not within.** The eight
   findings are about how the three backends wrap the same
   operation differently. Subclassing per backend **reproduces
   the drift by construction** — every drift D1–D8 needs to be
   re-expressed as a per-backend override, which is exactly the
   shape the hand-rolled wrappers took today.
2. **Re-introduces the type-erased label problem.** Subclasses
   typically accept a `string` label and forward to the base
   method; the type boundary moves from `BackendInstrumentation`
   into each subclass, which is where the original `'honch'`-typo
   failure lived. The base class can still type-check the label,
   but the subclasses can shadow the method with a `string`
   signature, defeating the D4 fix.
3. **Three classes instead of one.** Per the project conventions
   (and the `DRY` standard), three near-identical classes is the
   failure mode this refactor is explicitly avoiding. A base +
   three subclasses is four files to maintain for a problem one
   file solves.

## Consequences

### Drift fixes

- **D4 — backend label is a type, not a string literal.**
  `BackendLabel` is the closed union
  `'postgres' | 'honcho' | 'honcho_fallback'` (re-exported from
  `memory-metrics.types.ts`). Every `recordWrite / recordRead /
  recordFallback` call site is type-checked at compile time; a
  stray `'honch'` is a `TypeScript` error.
- **D2 — honcho read latency is recorded exactly once on
  `HONCHO_FALLBACK_ON_ERROR=false`.** The helper's `finally` block
  handles the latency observation; the outer catch in the service
  body no longer records a separate read. The primary-attempt
  latency is observed inside `recordRead` (in `finally`) and the
  secondary backend's latency is observed inside the secondary
  service's own `recordRead` call. Two attempts, two observations,
  one each.
- **D1 — successful honcho reads through HonchoFallback emit a
  latency observation.** The `finally` block fires on the success
  path; the legacy `catch`-only recording (F2–F5) is gone.
- **D6 — un-instrumented paths are explicit.** The `passthrough()`
  method documents the un-instrumented
  `updateMemorySegmentWithMetadata` /
  `searchPromotedLessonsByScope` paths intentionally bypassing
  instrumentation. A reader searching for "why does this method
  skip the helper?" finds the `passthrough()` call.

### Implementation notes

- The helper uses `process.hrtime.bigint()` for monotonic latency
  observation (immune to wall-clock adjustments — preferred for
  sub-millisecond instrumentation).
- The helper fans out to both `MemoryMetricsService` and
  `MetricsService` mirrors from a single call site, so the
  lock-step between the two metrics sinks is enforced structurally
  rather than by reviewer discipline.
- After M3, the three backend services no longer inject
  `MemoryMetricsService` or `MetricsService` directly. Only
  `BackendInstrumentation` is injected (plus the backend's own
  domain collaborators — `MemorySegmentRepository`,
  `HonchoClientService`, `ConfigService`, etc.). The dead
  constructor parameters were removed and the migration-window
  comments were cleaned up.

### Module-graph impact

`MemoryModule.providers` gains a single `BackendInstrumentation`
entry. No new module is introduced, no `forwardRef` is required,
no `@Global()` decoration is added, and no re-export surface is
introduced. The module-graph discipline from
`docs/architecture/ADR-0001-api-module-dependency-inversion.md` is
preserved verbatim.

## Follow-up

Two drift items are **deliberately out of scope** for the helper
extraction and remain as residual follow-ups:

- **D3 — add `operation` label to the read counter and histogram.**
  `nexus_memory_backend_read_total` and
  `nexus_memory_backend_read_latency_ms` currently carry only
  `{backend}`. Adding `operation` requires extending
  `MetricsService` (a metrics-schema change with consumer-side
  impact on dashboards and alerts) — a contract change strictly
  larger than the helper extraction itself. Tracked as a separate
  work item in
  `.agents/designs/backend-instrumentation-final-summary.md` §10.
- **D5 — unify the `"Falling back to postgres memory backend…"`
  log prefix between Honcho and HonchoFallback.** Today they emit
  two different prefixes; the helper does not own logger calls
  (logging stays in the backend service so it has access to
  `entityType` / `entityId` / reason context), so unifying the
  prefix requires a `BackendInstrumentation.logFallback(ctx)` helper
  plus a logging-contract update across both backends — a
  log-pipeline concern, not a code-hygiene one. Tracked in the
  same §10.

The M3 redundant-injection cleanup (the removal of the direct
`MemoryMetricsService` and `MetricsService` constructor parameters
on the three backend services) is **complete** and is documented
in
`.agents/designs/backend-instrumentation-final-summary.md` §7.3.
The dead constructor parameters were removed; the migration-window
comments were cleaned up; the helper is now the sole fan-out point
for both metrics mirrors.

## Status

Status: Accepted. Owner: refactor-executor.

The helper class file (`backend-instrumentation.ts`), the helper
types file (`backend-instrumentation.types.ts`), and the helper
unit tests (`backend-instrumentation.spec.ts`) are in place as of
M1. The 27 call sites across the three backend services are
migrated to `this.backendInstrumentation.recordWrite / recordRead /
recordFallback / passthrough` calls as of M3 (Postgres: 10 sites;
Honcho: 9 metric sites + 2 passthroughs; HonchoFallback: 9). The
decision recorded here is that the single-provider shape (helper in
`MemoryModule.providers`, no separate `MemoryInstrumentationModule`)
is the canonical form going forward, that `BackendLabel` is the
type-checked label boundary, and that `process.hrtime.bigint()` is
the latency timer.

## References

- `apps/api/src/memory/backend-instrumentation.ts` — the helper
  class itself.
- `apps/api/src/memory/backend-instrumentation.types.ts` — the
  `BackendLabel`, `BackendOperation`, `RecordWriteContext`,
  `RecordReadContext`, `RecordFallbackContext`, and
  `BackendInstrumentationDeps` interfaces.
- `apps/api/src/memory/memory-metrics.types.ts` — source of truth
  for `BackendLabel` (re-exported from the helper types).
- `apps/api/src/observability/metrics.service.ts` — the
  prom-client mirror (`recordMemoryBackendRead / Write / Fallback`,
  lines 187–220).
- `apps/api/src/memory/memory-metrics.service.ts` — the in-memory
  mirror (`recordBackendRead / Write / Fallback`, lines 240–263).
- `apps/api/src/memory/memory.module.ts` — single-provider
  registration of `BackendInstrumentation`.
- `.agents/designs/backend-instrumentation-design.md` — full drift
  inventory D1–D8, helper API rationale, migration plan.
- `.agents/designs/backend-instrumentation-final-summary.md` —
  milestone close-out (M1–M4), migration matrix, follow-up
  backlog §10.
- `docs/architecture/ADR-0001-api-module-dependency-inversion.md` —
  module-graph discipline preserved by the extraction (no
  `forwardRef`, no `@Global()`, no re-exports).