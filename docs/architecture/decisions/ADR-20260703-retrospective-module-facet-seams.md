# ADR: Document the Three Retrospective-Service Facets and Their Duplicated Primitives

**Status:** Accepted
**Date:** 2026-07-03
**Work item:** ef4d6799-8468-4c4b-b8d6-20e8f0fca384
**Owner:** refactor-executor
**Module:** `apps/kanban/src/retrospectives/`
**Related docs:**
[`ADR-retrospective-module-facet-seams.md`](./ADR-retrospective-module-facet-seams.md),
[`ADR-20260627-refinement-routing-restoration.md`](./ADR-20260627-refinement-routing-restoration.md),
[`docs/architecture/workflow-engine.md`](../workflow-engine.md),
[`docs/guide/22-kanban-lifecycle.md`](../../guide/22-kanban-lifecycle.md),
[`docs/guide/23-kanban-orchestration.md`](../../guide/23-kanban-orchestration.md)

> Status line (literal): `Status: Accepted`

> **Naming note (M4).** The work-item execution plan for
> `ef4d6799-8468-4c4b-b8d6-20e8f0fca384` referenced this decision under
> the path
> `docs/architecture/decisions/ADR-retrospective-module-facet-seams.md`.
> The M1 author landed the file at the date-prefixed path above, which
> is why it does not match the plan's
> `ls docs/architecture/decisions/ | grep retrospective` verification
> literally. The M4 milestone preserves this file verbatim (the
> staged-state contract forbids renaming a file that prior milestones
> have already touched) and adds a short stub at the plan's path,
> `docs/architecture/decisions/ADR-retrospective-module-facet-seams.md`,
> that points back here. The two files together satisfy the plan's
> spirit: this document is the authoritative record of the
> retrospective module-facet seams; the stub exists only for
> traceability against the work-item plan path.

## Context

The Kanban retrospectives module (`apps/kanban/src/retrospectives/`)
owns three large service files whose responsibilities overlap on the
cycle-decision evidence surface but have otherwise distinct run
lifecycles, distinct test surfaces, and distinct module-graph edges:

| File                                                                       | LOC (2026-07-03) | Primary responsibility                                                                              |
| -------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `kanban-retrospective-failure-threshold.service.ts`                        | 571              | Failure-threshold trigger: counts consecutive failures, decides when to fire a retrospective run.  |
| `kanban-retrospective.service.ts`                                          | 528              | Runner: orchestrates the retrospective run lifecycle (completion, manual replay, failure threshold).|
| `kanban-retrospective-evidence.service.ts`                                 | 438              | Evidence collector: turns cycle-decision events + orchestration metadata into a discriminated union.|

Both `kanban-retrospective.service.ts` (528 LOC) and
`kanban-retrospective-failure-threshold.service.ts` (571 LOC) exceed
the **`max-lines: 500`** lint cap defined in `apps/kanban/eslint.config.mjs`
(line 6, `const MAX_FILE_LINES = 500;`). The evidence service (438 LOC)
sits under the cap today but is the structural neighbour whose
responsibility bleeds into both other files.

The nightly `codebase_refactoring_analysis` scan flagged the three
files under work item `ef4d6799-8468-4c4b-b8d6-20e8f0fca384` for
"three large retrospective services — likely overlap on evidence /
promotion logic". This ADR records the decision about **what the
seams between the three files are** so that the implementation
milestones (M2–M4) can target the seams individually rather than
re-designing the module from scratch.

### (a) The three services are coherent facets with distinct test surfaces

The three files map cleanly to three facets of the retrospective
lifecycle. Each facet has its own public surface, its own spec file
(`*.service.spec.ts` / `*.integration.spec.ts`), and its own
dependency wiring through `RetrospectivesModule`. The seams between
them are not accidental — they correspond to three separate
runtime concerns.

#### Runner — `kanban-retrospective.service.ts`

- **Public methods:**
  `runForCompletion(trigger)`,
  `runManualReplay(dto)`,
  `runForFailureThreshold(input)`,
  `listRuns(query)`,
  `getProjectStatus(projectId)`.
- **Owns:** the retrospective-run lifecycle (`KANBAN_RETROSPECTIVE_RUNS`
  rows via `KanbanRetrospectiveRunRepository`), the
  idempotency-key derivation for the three entry points, the
  `executeRun(...)` body that drives a run from trigger to result,
  and the `kanban.retrospective.cooldown_skipped` audit event.
- **Imports:** `KanbanRetrospectiveEvidenceService`,
  `CycleDecisionEventHandler` (registers it via `onModuleInit`),
  `KanbanOrchestrationRepository`, `KanbanRetrospectiveRunRepository`,
  `CoreWorkflowClientService`.
- **Test surface:** `kanban-retrospective.service.spec.ts` (641 LOC)
  exercises the three run paths and the cooldown / idempotency
  short-circuits; `kanban-retrospective.integration.spec.ts`
  (745 LOC) exercises the module through the NestJS DI graph.

#### Evidence Collector — `kanban-retrospective-evidence.service.ts`

- **Public methods:** `collectForProject(projectId)`,
  `collectForOrchestration(orchestration)`, and the helpers
  `convertToEvidenceSummary(...)`,
  `selectMostRecentSubstantiveDecision(...)`,
  `convertStoredToEventEvidence(...)`.
- **Owns:** the `KanbanRetrospectiveEvidence` discriminated union
  (`"missing_project"` / `"missing_orchestration"` /
  `"insufficient_evidence"` / `"ready"`) and the conversion from
  `CycleDecisionEventEvidence` rows into the `deltaSnapshot.workItems`
  shape the runner consumes.
- **Imports:** `KanbanOrchestrationRepository`,
  `KanbanRetrospectiveRunRepository`,
  `KanbanRetrospectiveCycleDecisionRepository`,
  `CycleDecisionEventHandler`. **It does NOT import
  `KanbanRetrospectiveService` or
  `KanbanRetrospectiveFailureThresholdService`** — the dependency
  arrow points one way (runner → evidence; trigger → runner →
  evidence).
- **Test surface:** `kanban-retrospective-evidence.service.spec.ts`
  (328 LOC) exercises the four discriminated-union states and the
  helper conversions in isolation from the runner.

#### Failure-Threshold Trigger — `kanban-retrospective-failure-threshold.service.ts`

- **Public methods:**
  `checkFailureThreshold(input)`,
  `resetConsecutiveFailureCount(projectId)`.
- **Owns:** the consecutive-failure counter and windowing logic
  (`pruneAndAppendFailureTimestamp`,
  `getFailureTimestamps`, `isCooldownActive`,
  `wasWindowAlreadyEmitted`), the resolution of
  `RETROSPECTIVE_FAILURE_THRESHOLD_SETTING_KEYS.*` settings, and
  the `kanban.retrospective.failure_observed` diagnostic event.
  When the consecutive-failure count crosses the configured
  threshold, the trigger calls
  `KanbanRetrospectiveService.runForFailureThreshold(...)`.
- **Imports:** `KanbanRetrospectiveService` (the runner — for the
  fire-and-forget `runForFailureThreshold` call),
  `KanbanOrchestrationRepository`, the settings reader,
  and the `kanban-retrospective-failure-threshold.helpers.ts`
  pure-function module.
- **Test surface:**
  `kanban-retrospective-failure-threshold.service.spec.ts`
  (1496 LOC) exercises the threshold / window / cooldown matrix
  through the public `checkFailureThreshold` surface.

### (b) File-size budget and three duplicated primitives

Both services that exceed the 500-LOC lint cap owe part of their
bloat to **three duplicated primitives** that already exist on
both sides of the runner ↔ trigger seam. Consolidating these
primitives into a single helper module would reclaim roughly
**40–50 LOC per service** (≈ 5–10 % of the total) and remove the
silent-drift hazard that each pair represents. The M2–M4
implementation milestones will extract them; this ADR records the
shape and the rationale so the M2–M4 work has a single source of
truth.

#### (b.1) `EmitterLike` + try/catch/emit/warn guard

Both services implement the same "emit best-effort, swallow with
a `Logger.warn`" pattern around the in-process kanban event
emitter (`getKanbanEventEmitter()`):

- **Runner** — `kanban-retrospective.service.ts` line 47 declares
  `type EmitterLike = { emit: (eventName: string, payload: unknown) => unknown; }`
  to narrow the `any` returned by `getKanbanEventEmitter()` when
  `eventemitter2` is not installed, and lines 419–438 wrap the
  `emitCooldownSkipped(payload)` call in a try/catch that logs
  `Failed to emit kanban.retrospective.cooldown_skipped: ...`.
- **Trigger** — `kanban-retrospective-failure-threshold.service.ts`
  line 43 declares the **identical** `EmitterLike` type alias and
  lines 521–550 wrap the `emitFailureObserved(payload)` call in
  the **same** try/catch + `Logger.warn` shape (the log message
  is keyed on
  `KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT` instead of
  `KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT`).

The two implementations differ only in the event constant and the
payload shape. The try/catch + `Logger.warn` guard itself is
byte-for-byte the same pattern. Today, every future change to
that pattern (e.g. switching to structured logging, adding a
metric, changing the catch to re-throw on a specific error
class) must be made in two places.

#### (b.2) `formatErrorMessage` private helper

Both services ship the same `formatErrorMessage(error: unknown): string`
helper:

- **Runner** — `kanban-retrospective.service.ts` line 409:
  `private formatErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }`
- **Trigger** — `kanban-retrospective-failure-threshold.service.ts`
  line 560: identical body.

This is a one-liner. Extracting it removes one declaration from
each file but more importantly removes the "what counts as an
error message?" policy from being defined twice. A future change
(e.g. support for `{ code, message }`-shaped errors, or pulling
the message out of a `data` envelope) must be made in both places
today.

#### (b.3) Metadata-narrowing helper

Both services ship the same "narrow `unknown` to
`Record<string, unknown>`" helper. The implementations are
near-identical (the trigger version inlines the narrowing, the
evidence version delegates to an `isRecord` predicate):

- **Evidence** — `kanban-retrospective-evidence.service.ts`
  line 431: `private getRecord(value: unknown): Record<string, unknown> { return this.isRecord(value) ? value : {}; }`
  paired with line 434:
  `private isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }`.
- **Trigger** — `kanban-retrospective-failure-threshold.service.ts`
  line 554: `private getRecordMetadata(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}; }`.

Both check `value is non-null, non-array object` and return `{}`
otherwise. The two implementations differ in **style** (one
delegates to a type predicate; the other inlines the check and
casts), not in behaviour. A future change to the narrowing policy
(e.g. handling `Map`/`Set` differently, or rejecting `Object.create(null)`
prototypes) must be made in two places today.

### (c) Cross-module leak: `complete-orchestration-cycle-decision.tool.ts:emitLearningCandidateProposed`

The `learning.candidate.proposed.v1` payload shape is owned
**duplicatively** across two modules:

- **Runner side** — `apps/kanban/src/retrospectives/kanban-retrospective-candidate.helpers.ts:buildCandidatePayload(...)`
  (line 62) builds the payload as part of the runner's normal
  completion path. It is the canonical implementation, imported
  by `kanban-retrospective.service.ts` line 16 and called from
  line 256.
- **MCP-tool side** —
  `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts:emitLearningCandidateProposed(...)`
  (line 364) builds **its own copy of the same payload** with the
  same fields (`event_name`, `source_service`, `scope_type`,
  `scope_id`, `lesson`, `evidence`, `confidence`, `tags`,
  `provenance`). The lesson-text format
  (``Kanban project ${projectId} completed an orchestration cycle with ${doneCount} done items, ${blockedCount} blocked items, and cycle decision ${decision}.``)
  is byte-for-byte identical to
  `kanban-retrospective-candidate.helpers.ts:buildLesson` (line 53).

This is a **cross-module leak**: an MCP tool
(`apps/kanban/src/mcp/tools/mutation/`) re-implements a payload
shape that already lives in the retrospectives module
(`apps/kanban/src/retrospectives/`). The two implementations
have already drifted — the runner's helper emits a richer
`provenance` block (`orchestration_id`, `retrospective_run_id`,
`trigger`) and an additional `project_id` /
`orchestration_id` / `retrospective_run_id` /
`cycle_decision` / `trigger` top-level fields that the MCP-tool
version does not carry. A consumer reading both event sources
sees two shapes for the same event name.

### (d) Two parallel cycle-decision event shapes

The runner and the evidence collector consume **two parallel
shapes** for cycle-decision evidence, and the conversion between
them is documented but not unified:

- `StoredCycleDecisionEvidence` (defined in
  `apps/kanban/src/retrospectives/events/cycle-decision-event.types.ts`
  line 12) is the **stored** form used by
  `CycleDecisionEventHandler` — it extends `CycleDecisionEvidence`
  with `evidenceId`, `storedAt`, `windowStart`, `windowEnd` (the
  aggregation metadata).
- `CycleDecisionEventEvidence` (defined in
  `apps/kanban/src/retrospectives/retrospective.types.ts` line 242,
  and re-declared locally in
  `kanban-retrospective-evidence.service.ts` line 36) is the
  **event-row** form consumed by
  `KanbanRetrospectiveEvidenceService` — it carries
  `decisionType`, `reason`, `recordedAt`, `isSubstantive`,
  `idempotencyKey`, `provenance` (the per-event fields).

The conversion between them lives on the runner:
`kanban-retrospective.service.ts` line 496
(`handlerEvents.map(...)` → `CycleDecisionEventEvidence[]`),
and the evidence service's `convertStoredToEventEvidence(...)`
helper does the inverse. The two shapes share all fields but
carry **different aggregation metadata**; the seams between them
are documented (`StoredCycleDecisionEvidence shares all
CycleDecisionEventEvidence fields via CycleDecisionEvidence`,
see runner line 497 comment) but **not unified** — both shapes
will continue to be maintained in parallel until a follow-up
work item re-aligns them.

### (e) Follow-up: failure-threshold service will still exceed the lint cap after M2–M4

After the M2–M4 milestones consolidate the three duplicated
primitives (b.1–b.3), the **failure-threshold service** is
expected to **still exceed the 500-LOC lint cap** because its
two largest private methods —
`recordFailureObservation(params)` at line 234 and
`maybeFireRetrospective(params)` at line 307 — together account
for roughly 220 LOC of orchestration / persistence / event work
that does not logically belong on the public service. The
follow-up work item (separate from this ADR) will extract those
two methods into a dedicated
`kanban-retrospective-failure-threshold.helpers.ts` (the
existing 108-LOC file holds the pure functions only) — or into a
new sibling module — so the public service shrinks back under
the cap while the orchestration logic remains unit-testable.
That extraction is **explicitly out of scope** for this ADR and
is recorded here only so the next refactoring work item can
re-use the seam inventory below.

## Decision

Adopt the module-facet model below. The three services are
**not** candidates for a single god-service merger; they are
**three focused facets** of the retrospective lifecycle with
their own public surfaces, their own test surfaces, and their
own dependency arrows. The decision is to **leave the three
services in place** and treat them as a coherent **module-facet
diagram**, then run a sequence of small refactors against the
duplicated primitives and the cross-module leak.

### (A) The facet diagram is the source of truth

The retrospective lifecycle is best modelled as three facets
that compose vertically:

```
                    ┌──────────────────────────────────────────────┐
                    │  Failure-Threshold Trigger                   │
                    │  kanban-retrospective-failure-threshold      │
                    │    .service.ts                               │
                    │                                              │
                    │  Public surface:                             │
                    │    checkFailureThreshold(input)              │
                    │    resetConsecutiveFailureCount(projectId)  │
                    │                                              │
                    │  Emits: KANBAN_RETROSPECTIVE_FAILURE_OBSERVED│
                    │  Calls runner.runForFailureThreshold(...)   │
                    └────────────────────┬─────────────────────────┘
                                         │ fire-and-forget
                                         ▼
┌─────────────────────────┐    ┌────────────────────────────────────┐
│  MCP / Cycle-Decision   │    │  Runner                            │
│  complete-orchestration │    │  kanban-retrospective.service.ts   │
│  -cycle-decision.tool   │───▶│                                    │
│                         │    │  Public surface:                   │
│  Emits:                 │    │    runForCompletion(trigger)       │
│  RETROSPECTIVE_CYCLE_   │    │    runManualReplay(dto)             │
│  DECISION_RECORDED_     │    │    runForFailureThreshold(input)   │
│  EVENT                  │    │    listRuns(query)                 │
│  Emits (leak):          │    │    getProjectStatus(projectId)     │
│  LEARNING_CANDIDATE_    │    │                                    │
│  PROPOSED_EVENT         │    │  Builds:                           │
│                         │    │    buildCandidatePayload(...)      │
│  (cross-module leak     │    │  Emits: KANBAN_RETROSPECTIVE_COOLDOWN│
│   — see (c))            │    │         _SKIPPED_EVENT              │
└────────────┬────────────┘    └────────────┬───────────────────────┘
             │                              │
             │ RETROSPECTIVE_CYCLE_         │ runs on
             │ DECISION_RECORDED_EVENT      │ evidence.ready
             ▼                              ▼
       ┌──────────────────────────────────────────────┐
       │  Evidence Collector                          │
       │  kanban-retrospective-evidence.service.ts   │
       │                                              │
       │  Public surface:                             │
       │    collectForProject(projectId)             │
       │    collectForOrchestration(orchestration)    │
       │                                              │
       │  Returns: KanbanRetrospectiveEvidence       │
       │    (missing_project | missing_orchestration  │
       │     | insufficient_evidence | ready)         │
       └──────────────────────────────────────────────┘
```

**Invariants preserved by the facet model:**

1. **The runner does not import the failure-threshold trigger.**
   Today the dependency arrow is one-way (trigger → runner via
   `KanbanRetrospectiveService.runForFailureThreshold`).
2. **The evidence collector does not import the runner or the
   trigger.** Today the evidence collector is a leaf in the
   facet graph — the runner is the only consumer.
3. **The MCP tool
   (`complete-orchestration-cycle-decision.tool.ts`)** is the
   only place today where a payload shape leaks **into** the
   facet diagram from outside (see (c)). The leak is
   one-directional and does not create a circular import.

### (B) The three duplicated primitives will be consolidated

The M2–M4 implementation milestones will extract the three
duplicated primitives (b.1–b.3) into a shared helper module —
most naturally into a new
`apps/kanban/src/retrospectives/kanban-retrospective-shared.helpers.ts`
(or, equivalently, into the existing
`kanban-retrospective-failure-threshold.helpers.ts` if the
shared primitives stay failure-threshold-adjacent). The exact
file is deferred to M2; what this ADR records is that **all
three primitives are extracted together** so the next asymmetric
edit cannot reintroduce the drift. The M2 milestone owns the
file choice.

After M2–M4 the two services' `formatErrorMessage`,
`EmitterLike`, and metadata-narrowing helpers become
single-line re-exports from the shared helpers module. The two
private helpers stay in place only if a service needs a
specialised variant (none is anticipated today).

### (C) The cross-module leak will be closed

The M2–M4 milestones will close the cross-module leak by
**moving `buildCandidatePayload` /
`buildLesson` / `buildCycleDecisionEvidence`** out of the
retrospectives module's `kanban-retrospective-candidate.helpers.ts`
into a **shared** location that the MCP tool can also import.
Two candidate homes:

- **Option C-1 — a new
  `apps/kanban/src/learning-candidate/` module** that owns the
  `learning.candidate.proposed.v1` payload shape end-to-end.
  Both the runner and the MCP tool import from it. This is the
  preferred shape because the payload is a domain-level event
  shape, not a retrospective-internal helper.
- **Option C-2 — keep the helpers in
  `kanban-retrospective-candidate.helpers.ts` and have the MCP
  tool import them.** This is the minimum-change shape but it
  introduces a `mcp/tools/mutation → retrospectives/` import,
  which is the wrong direction in the module graph (the
  retrospectives module is a leaf today; the MCP tool is
  further downstream).

The M2 milestone will pick the home. Either choice closes the
leak; **Option C-1 is preferred** because it keeps the
module-graph arrow direction intact (MCP tools already import
across the boundary in the other direction today, so the
shape is consistent with the existing policy).

### (D) The two parallel cycle-decision event shapes will not be unified in this work item

The seams between `StoredCycleDecisionEvidence` and
`CycleDecisionEventEvidence` are documented and the conversion
helpers (`convertToEvidenceSummary`,
`convertStoredToEventEvidence`) work today. Unifying them
would be a larger refactor that touches the event-handler
storage, the evidence collector, and the MCP tool's payload
shape — that is a separate work item, not the scope of the
M2–M4 consolidation. The current conversion is preserved
byte-for-byte.

### (E) The failure-threshold service will be split in a follow-up work item

Per Context (e), the M2–M4 consolidation will not bring the
failure-threshold service under the 500-LOC lint cap. The
follow-up work item (separate from this ADR) will extract
`recordFailureObservation(params)` and
`maybeFireRetrospective(params)` into a dedicated helpers
file (either an extension of
`kanban-retrospective-failure-threshold.helpers.ts` or a new
sibling). That extraction is tracked here only as a follow-up
so the next refactoring work item can re-use the facet
inventory and the helper-extraction pattern.

## Alternatives

### (i) Collapse all three services into one — REJECTED

Merge `kanban-retrospective.service.ts`,
`kanban-retrospective-evidence.service.ts`, and
`kanban-retrospective-failure-threshold.service.ts` into a
single `KanbanRetrospectiveCoreService` that exposes every
public method. Three spec files become one, three public
surfaces become one.

Rejected on three grounds:

1. **The three services have distinct lifecycles.** The
   evidence collector is a pure read-side projection; the
   runner is a write-side lifecycle owner; the trigger is a
   decision-point owner. Collapsing them conflates a
   **read-side projection**, a **write-side lifecycle**, and
   a **decision policy** on the same class — exactly the
   single-responsibility failure mode that the nightly scan
   flagged.
2. **The dependency arrows stop being enforceable.** Today the
   evidence collector is a leaf — no other module imports it,
   it imports nothing from the runner or the trigger.
   Collapsing it into a single class means the runner's
   evidence-collection methods, the trigger's
   `runForFailureThreshold` call, and the runner's own
   `executeRun` body all live on the same instance, and any
   future caller can reach any method.
3. **The duplicated primitives do not need a class merge to
   be fixed.** The three duplicated primitives (b.1–b.3) are
   independent of class boundaries — they can be extracted
   into shared helpers without merging the services. The
   `500-LOC` cap pressure that motivates this work item is
   about **primitives**, not **classes**.

### (ii) Split each service into a facade + thin delegate — REJECTED

Introduce a thin public facade per service that delegates to
private helpers, mirroring the pattern used by
`ADR-20260702-workflow-engine-responsibility-split.md`. The
three facades (`KanbanRetrospectiveRunner`,
`KanbanRetrospectiveEvidenceCollector`,
`KanbanRetrospectiveFailureThresholdTrigger`) would each
delegate to one or more focused helpers, and the original
service names would be removed.

Rejected because the three services **already have focused
helpers** — the file already in
`kanban-retrospective-failure-threshold.helpers.ts` (108 LOC)
holds the pure-function helpers, and
`kanban-retrospective-candidate.helpers.ts` (147 LOC) holds
the candidate-payload builders. Adding a third layer of
facade + delegate on top of each service would be a third
layer of indirection for a problem that the existing two
layers already solve. The right move is to **finish** the
helper extraction (M2–M4), not to start a new facade.

### (iii) Adopt the facet model and extract the three duplicated primitives — CHOSEN

This is the chosen option. The three services stay in place
as the public facet surfaces; the three duplicated primitives
(b.1–b.3) move to a shared helpers file (M2); the
cross-module leak (c) is closed by relocating the
candidate-payload builders (M3); the failure-threshold split
(e) is recorded as a follow-up (M4 or later).

## Consequences

### Module-graph impact

- **Three facets, three services.** `KanbanRetrospectiveService`,
  `KanbanRetrospectiveEvidenceService`, and
  `KanbanRetrospectiveFailureThresholdService` remain registered
  as separate providers in `RetrospectivesModule`. The module
  graph is unchanged at the provider level.
- **New helpers file.** A new
  `kanban-retrospective-shared.helpers.ts` (or equivalent —
  see Decision (B)) is added to the module. It contains
  pure functions: `formatErrorMessage`,
  `getRecordMetadata`, and `emitWithWarnGuard` (the consolidated
  try/catch/emit/warn wrapper, parameterised on the event
  constant and the payload shape).
- **No `@Global()`, no `forwardRef`, no re-export.** Per the
  core/kanban boundary policy in `AGENTS.md` and the
  module-graph policy in
  `ADR-0001-api-module-dependency-inversion.md`, the helper
  extraction must not introduce new edges. The new helpers
  file lives in `apps/kanban/src/retrospectives/` and is
  imported only by the three services that use it today.

### Code-shape impact (after M2–M4)

- `kanban-retrospective.service.ts` shrinks by roughly
  20–30 LOC (private `EmitterLike` declaration removed;
  private `formatErrorMessage` removed; private
  `emitCooldownSkipped`'s try/catch body becomes a single
  `emitWithWarnGuard(...)` call).
- `kanban-retrospective-failure-threshold.service.ts` shrinks
  by roughly 30–40 LOC (the same three primitives removed;
  `emitFailureObserved`'s body collapses to one call to
  `emitWithWarnGuard(...)`).
- The combined LOC saving on the two over-cap services is
  roughly 50–70 LOC. After the extraction, the runner is
  expected to land at ~500 LOC (still at the cap; further
  work deferred); the failure-threshold service lands at
  ~510–520 LOC (still over the cap; the M4 follow-up extracts
  `recordFailureObservation` + `maybeFireRetrospective` per
  Decision (E)).

### Cross-module leak impact (after M3)

- `complete-orchestration-cycle-decision.tool.ts` no longer
  builds its own copy of the `learning.candidate.proposed.v1`
  payload. It imports the shared helper (per Option C-1,
  `apps/kanban/src/learning-candidate/`, or per Option C-2,
  the existing `kanban-retrospective-candidate.helpers.ts`).
- The lesson-text format and the `evidence[]` shape become
  single-source-of-truth. Any consumer that previously saw two
  shapes for the same event name now sees exactly one.
- The runner's helper file
  (`kanban-retrospective-candidate.helpers.ts`) is either
  relocated to `apps/kanban/src/learning-candidate/` (C-1) or
  kept in place with the MCP tool importing across the module
  boundary (C-2). C-1 is preferred.

### Test-surface impact

- The three existing spec files
  (`kanban-retrospective.service.spec.ts`,
  `kanban-retrospective-evidence.service.spec.ts`,
  `kanban-retrospective-failure-threshold.service.spec.ts`)
  stay in place. The consolidation is behaviour-preserving;
  existing assertions on the three primitives continue to
  pass byte-for-byte.
- The new shared helpers file gets a focused unit spec
  (`kanban-retrospective-shared.helpers.spec.ts`) covering
  the three extracted primitives in isolation from the
  runner / trigger wiring. This is the smallest new test
  surface the consolidation needs.

### `StoredCycleDecisionEvidence` ↔ `CycleDecisionEventEvidence`

The two parallel shapes and their conversion helpers are
**unchanged** by this ADR. Unification is a separate work item
(see Decision (D)). The conversion helpers
(`convertToEvidenceSummary`,
`convertStoredToEventEvidence`) are preserved verbatim.

### Follow-up

The M2–M4 milestones (separate work items) implement the
extraction. The failure-threshold service split (Decision (E))
is recorded as the M5 candidate. Tracking of those milestones
is outside the scope of this ADR; this ADR records only the
decision.

## Status

Status: Accepted. Owner: refactor-executor.

This ADR records the **M1 decision milestone** of work item
`ef4d6799-8468-4c4b-b8d6-20e8f0fca384`. M1 is a
documentation-only milestone: the facet diagram and the
duplicated-primitive inventory are captured in this ADR; no
code change has landed yet. The implementation milestones
(extracting the three duplicated primitives into a shared
helpers file, closing the cross-module leak by relocating
the candidate-payload builders, and the follow-up
failure-threshold service split) are tracked as separate
follow-up milestones behind this ADR and are deliberately out
of scope for the M1 capture recorded here.

## References

- `apps/kanban/src/retrospectives/kanban-retrospective.service.ts`
  — the Runner (528 LOC). `emitCooldownSkipped` at line 419,
  `formatErrorMessage` at line 409, `EmitterLike` at line 47,
  `buildCandidatePayload(...)` call at line 256.
- `apps/kanban/src/retrospectives/kanban-retrospective-evidence.service.ts`
  — the Evidence Collector (438 LOC). `getRecord` at line 431,
  `isRecord` at line 434.
- `apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`
  — the Failure-Threshold Trigger (571 LOC).
  `emitFailureObserved` at line 521, `formatErrorMessage` at
  line 560, `getRecordMetadata` at line 554, `EmitterLike` at
  line 43, `recordFailureObservation` at line 234,
  `maybeFireRetrospective` at line 307.
- `apps/kanban/src/retrospectives/kanban-retrospective-candidate.helpers.ts`
  — the candidate-payload builders (147 LOC). `buildCandidatePayload`
  at line 62, `buildLesson` at line 53.
- `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts`
  — the MCP-tool side of the cross-module leak.
  `emitLearningCandidateProposed` at line 364.
- `apps/kanban/src/retrospectives/events/cycle-decision-event.types.ts`
  — `StoredCycleDecisionEvidence` interface (line 12).
- `apps/kanban/src/retrospectives/retrospective.types.ts` —
  `CycleDecisionEventEvidence` interface (line 242) and
  `KanbanRetrospectiveEvidence` discriminated union (line 218).
- `apps/kanban/eslint.config.mjs` — `MAX_FILE_LINES = 500`
  (line 6), the kanban lint cap both runner and trigger exceed.
- `docs/architecture/decisions/ADR-20260702-workflow-engine-responsibility-split.md`
  — the sibling ADR that established the M4 stub pattern this
  ADR re-uses (date-prefixed canonical + plan-path stub).
- `docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`
  — the plan-path stub for the sibling ADR.
- `docs/architecture/decisions/ADR-20260627-refinement-routing-restoration.md`
  — the predecessor ADR that drove the evidence surface into
  the runner's `runForCompletion` path.
- The `codebase_refactoring_analysis` nightly scan output that
  flagged the three services under work item
  `ef4d6799-8468-4c4b-b8d6-20e8f0fca384`.