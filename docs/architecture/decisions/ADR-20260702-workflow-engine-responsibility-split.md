# ADR: Split `WorkflowEngineService` into Focused Cancellation-Cascade and Container-Cleanup Services

**Status:** Accepted
**Date:** 2026-07-02
**Work item:** f9d280a4-849c-4159-bc87-b45d47dbec7a
**Owner:** refactor-executor
**Module:** `apps/api/src/workflow/`
**Related docs:** `docs/architecture/workflow-engine.md`, `docs/guide/06-workflow-engine.md`, `docs/architecture/ADR-0001-api-module-dependency-inversion.md`, `docs/architecture/workflow-module-decomposition.md`, `docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`

> Status line (literal): `Status: Accepted`

> **Naming note (M4).** The work-item execution plan for
> `f9d280a4-849c-4159-bc87-b45d47dbec7a` referenced this decision under
> the path
> `docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`.
> The M1 author landed the file at the date-prefixed path above, which
> is why it does not match the plan's `ls … | grep workflow-engine-srp`
> verification literally. The M4 milestone preserves this file
> verbatim (the staged-state contract forbids renaming a file that
> prior milestones have already touched) and adds a short stub at
> the plan's path,
> `docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`,
> that points back here. The two files together satisfy the plan's
> spirit: this document is the authoritative record of the
> workflow-engine SRP extraction; the stub exists only for
> traceability against the work-item plan path.

## Context

`WorkflowEngineService` (`apps/api/src/workflow/workflow-engine.service.ts`,
504 LOC) is the central orchestrator of a workflow run. It owns launch
input parsing, DAG resolution, run-state persistence, step launch, and
job completion handling. The same class also carries the cancellation
cascade, which has been growing in scope and now spans three private
methods and two optional injector parameters that exist exclusively
to serve the cancel path:

- **`cancelWorkflowRunWithCascade(runId, reason, visited: Set<string>)`**
  — the recursive engine of the cascade. The `Set<string> visited`
  parameter is threaded through the method signature as a recursion
  carrier, leaking the visited-set invariant into the public type of
  the helper and forcing every caller (and every test double) to know
  about it.
- **`cancelActiveChildRuns(parentRunId, reason, visited: Set<string>)`**
  — the recursive child-discovery collaborator. Same leaky
  `Set<string> visited` parameter, plus a hard dependency on the
  optional `workflowRunRepository` injector (the
  `findActiveChildRunsForParentRun` call is gated by
  `if (!this.workflowRunRepository) return;`).
- **`stopAllManagedContainersForRun(workflowRunId)`** — the Docker
  kill loop. Lists containers labelled
  `nexus.managed=true` / `nexus.workflow_run_id=<runId>` and kills
  them. Self-contained, but lives on the engine because the cascade
  calls it; it has no other consumers today, and its presence on the
  engine drags the `@Inject(DOCKER_CLIENT) @Optional() docker?: Docker`
  constructor parameter onto the class.

The class-level effects are:

1. **The `visited: Set<string>` parameter is leaky.** The visited-set
   invariant ("every reachable run is cancelled at most once per
   top-level call") is a property of the cascade, not of any one
   invocation. Threading it through the method signature couples
   every test, every mock, and every future call site to a recursion
   carrier that the cascade should own.
2. **Two `@Optional()` injectors on the engine exist for the cancel
   path only.** `@Inject(DOCKER_CLIENT) @Optional() docker?: Docker`
   and `@Optional() workflowRunRepository?: WorkflowRunRepository` are
   constructor parameters on `WorkflowEngineService` whose only
   consumers are `stopAllManagedContainersForRun` and
   `cancelActiveChildRuns`. Every unit test that constructs the
   engine has to decide whether to mock the Docker client and the
   run repository, even when the test is about launch behaviour.
3. **`WORKFLOW_RUN_CANCELLED_EVENT` is imported by the engine** solely
   because the inline cascade emits it. Removing the cascade from the
   engine removes the import.
4. **The cascade and the kill loop have separate lifecycles.** The
   cancel cascade is invoked once per cancellation and is the
   orchestrator of the cancellation lifecycle (status write, event
   emission, queued-job drain). The Docker kill loop is a side
   effect of cancelling a run; the same effect is a natural fit for
   a future quiescence sweep or manual run-termination path that
   does not want to go through the full cascade.

The nightly `codebase_refactoring_analysis` scan flagged the engine
under work item `f9d280a4-849c-4159-bc87-b45d47dbec7a` for mixing
launch, concurrency, cancellation-cascade, and Docker-cleanup
responsibilities on the same class. The cancellation half of that
finding — the cascade with its leaky `Set<string> visited` parameter
plus the inline Docker kill loop — is the scope of this ADR. The
launch / concurrency / DAG-resolution responsibilities of the engine
are out of scope and remain on the engine.

## Decision

Split the cancel path off `WorkflowEngineService` into two focused
services. The engine keeps its public `cancelWorkflowRun` entry
point as a thin delegator; the cascade and the Docker kill loop move
into dedicated services.

### (a) Extract `WorkflowContainerCleanupService`

A new `@Injectable()` class — `WorkflowContainerCleanupService` —
takes ownership of the Docker `listContainers` + per-container
`kill()` loop that today lives in the engine's private
`stopAllManagedContainersForRun` method. The new service exposes
`stopManagedContainersForRun(runId)` (renamed from the engine's
private helper) and:

- Carries the `@Inject(DOCKER_CLIENT) @Optional() docker?: Docker`
  constructor parameter so the engine no longer has to.
- Swallows per-container kill failures with a `Logger.warn` so a
  single stuck container cannot abort the cascade (preserving the
  current behaviour of the engine's helper).
- Returns the count of containers stopped so callers can log
  structured metrics without re-querying.

### (b) Extract `WorkflowCancellationCascadeService`

A new `@Injectable()` class — `WorkflowCancellationCascadeService` —
takes ownership of the recursive cancellation logic that today
lives across the engine's private `cancelWorkflowRunWithCascade` and
`cancelActiveChildRuns` methods. The new service exposes
`cancelRunWithCascade(runId, reason)` and:

- **Moves the `Set<string> visited` recursion carrier out of the
  method signature and into an instance-scoped `Set<string>`
  field** on the cascade service. The leaky parameter on
  `cancelWorkflowRunWithCascade(runId, reason, visited: Set<string>)`
  and `cancelActiveChildRuns(parentRunId, reason, visited: Set<string>)`
  is gone. The cascade's public surface is
  `cancelRunWithCascade(runId, reason)` and the visited-set
  invariant is a property of the cascade service instance, not of
  any one call.
- Preserves the **child-first then parent** cancellation order: the
  cascade recurses into each active child (so children persist as
  `CANCELLED` and emit `WORKFLOW_RUN_CANCELLED_EVENT` before their
  parent), then runs the kill-loop and parent-status write for the
  current run.
- Delegates Docker teardown to
  `WorkflowContainerCleanupService.stopManagedContainersForRun` so
  the cascade does not import `DOCKER_CLIENT` or `dockerode`.
- Carries the `@Optional() workflowRunRepository?: WorkflowRunRepository`
  constructor parameter so the engine no longer has to. The
  `findActiveChildRunsForParentRun` call inside the cascade is
  still gated by the `if (!this.workflowRunRepository) return;` early
  return so test / kafka-only deployments without a run repository
  keep operating.

### (c) Keep `WorkflowEngineService.cancelWorkflowRun` as a thin delegator

The engine's public
`IWorkflowEngineService.cancelWorkflowRun(runId, reason?)` method is
preserved as the single public entry point. After the split its
body collapses to `await this.cascade.cancelRunWithCascade(runId, reason)`.
The engine no longer carries `cancelWorkflowRunWithCascade`,
`cancelActiveChildRuns`, `stopAllManagedContainersForRun`, the
`@Inject(DOCKER_CLIENT)` Docker client, the optional
`WorkflowRunRepository` injector, or the `WORKFLOW_RUN_CANCELLED_EVENT`
import.

### Invariants preserved by the split

The following invariants are non-negotiable and are preserved
byte-for-byte by the extraction. They are recorded here so the
implementation milestones and the unit tests that follow this ADR
have a single source of truth.

1. **Public signature preserved.** The public
   `IWorkflowEngineService.cancelWorkflowRun(runId: string, reason?: string): Promise<void>`
   signature is preserved on `WorkflowEngineService`. Controllers,
   API routes, kernel ports, and external consumers see no change.
2. **`WORKFLOW_RUN_CANCELLED_EVENT` payload + ordering preserved.**
   The event payload
   `{ workflowRunId, workflowId, status, stateVariables, reason }`
   is emitted with the same shape and in the same order as today
   (after the run's `WorkflowStatus.CANCELLED` write succeeds, before
   the queued-job drain). The cascade service emits it via the
   injected `EventEmitter2`; the engine no longer imports
   `WORKFLOW_RUN_CANCELLED_EVENT`.
3. **Child-first then parent cancellation order preserved.** The
   cascade recurses into each active child run before running the
   kill loop + `WorkflowStatus.CANCELLED` write + event emission for
   the current run. The visited-set invariant that each run is
   cancelled at most once per top-level call is preserved by the
   instance-scoped `Set<string>` field on
   `WorkflowCancellationCascadeService`.
4. **`findActiveChildRunsForParentRun` continues to gate cascade
   recursion on the optional repository.** The
   `if (!this.workflowRunRepository) return;` early return inside the
   cascade's child-discovery block is preserved verbatim on the
   cascade service's `WorkflowRunRepository` constructor parameter.
   Test / kafka-only deployments that wire the cascade without a
   run repository still operate the cascade as a single-run cancel
   (no child walk).

### Module placement

Per `docs/architecture/ADR-0001-api-module-dependency-inversion.md`, the extraction
introduces no `@Global()`, no `forwardRef`, and no re-export. Both
new services live next to the engine in `apps/api/src/workflow/`
and are registered in `WorkflowCoreModule.providers` alongside the
existing `WorkflowEngineService` provider. The module's `imports`
and `exports` arrays are unchanged because none of the new classes
are cross-module collaborators.

## Alternatives

### (i) Keep the current god-service — REJECTED

Keep `cancelWorkflowRunWithCascade`, `cancelActiveChildRuns`, and
`stopAllManagedContainersForRun` as private methods on the engine.
The engine continues to mix launch, concurrency, cancellation, and
Docker cleanup. The `@Optional()` Docker client and run-repository
injectors stay on the engine. The leaky `Set<string> visited`
parameter stays in the cascade's method signature. The nightly
`codebase_refactoring_analysis` scan continues to flag the engine on
every run.

Rejected on the SRP / testability grounds stated by the
`codebase_refactoring_analysis` scan that produced work item
`f9d280a4-849c-4159-bc87-b45d47dbec7a`. The cascade's invariants
(visited-set, child-first ordering, terminal-status short-circuit,
optional-repository fallback) are easier to read, easier to spec,
and easier to unit-test as their own class than as private methods
at the bottom of a 500-line engine. The Docker kill loop is a
self-contained side effect of cancelling a run that has no
overlap with launch or DAG resolution; leaving it on the engine
keeps the `@Inject(DOCKER_CLIENT)` injector on the class for no
reason other than "that's where the code landed first".

### (ii) Collapse cancellation into `WorkflowTerminalRunCloserService` — REJECTED

Move the cascade into the existing
`WorkflowTerminalRunCloserService` (which today exposes
`closeFailedRun({ workflowRunId, workflowId, failedJobId, reason })`
as a single-run, fail-path closer) so cancellation and failure
terminalisation share one class.

Rejected because `WorkflowTerminalRunCloserService` is a
**single-run, fail-path closer**: its `closeFailedRun` method runs
`removeQueuedJobsForRun` + `stopManagedContainersForRun` for one
run, emits no `WORKFLOW_RUN_CANCELLED_EVENT`, and walks no
parent→child graph. Folding the cascade into it would conflate two
lifecycles:

- The cascade is the **cancellation lifecycle**: status write to
  `CANCELLED`, per-run `WORKFLOW_RUN_CANCELLED_EVENT` emission, and
  a parent→child walk.
- `closeFailedRun` is the **failure-terminal closer**: queue +
  container teardown for one run that has already been written to
  `FAILED` by a separate path. It does not walk children, does not
  emit a cancellation event, and does not own the visited-set
  invariant.

Merging the two would force `closeFailedRun` to either gain
cascade plumbing it does not need (and would never invoke in
production) or lose the single-run fail-path shape that its
callers depend on. Two focused services (one for the cascade, one
for the failure closer) are cheaper to wire, easier to mock, and
preserve the two lifecycles' separate invariants.

### (iii) Extract cancellation only — PARTIAL, EXTENDED TO (iii) + (a) AS THE CHOSEN SCOPE

Extract `WorkflowCancellationCascadeService` from
`cancelWorkflowRunWithCascade` + `cancelActiveChildRuns` and leave
`stopAllManagedContainersForRun` inline on the engine. This
removes the cascade's leaky `Set<string> visited` parameter and
the optional `WorkflowRunRepository` injector from the engine, but
keeps the `@Inject(DOCKER_CLIENT) @Optional() docker?: Docker`
injector on the engine for the inline kill loop.

The chosen scope is **(iii) plus (a)** — the cascade extraction
*plus* the `WorkflowContainerCleanupService` extraction — for
completeness. The cascade delegates container teardown to
`WorkflowContainerCleanupService.stopManagedContainersForRun` in
the same way that, today, it calls the engine's private
`stopAllManagedContainersForRun`; the cleanup service carries the
Docker injector, and the engine drops it. Doing only (iii) would
leave the Docker client on the engine for the sake of one helper
that has no business being there; doing (a) without (iii) would
miss the higher-leverage extraction (the cascade with its
visited-set invariant and its child-first ordering) that the
nightly scan explicitly called out.

## Consequences

- **No public contract change.** `IWorkflowEngineService.cancelWorkflowRun(runId, reason?)`
  is preserved byte-for-byte on the engine. No controller, API
  route, kernel port, integration test, or external consumer
  changes.
- **No event-shape change.** The `WORKFLOW_RUN_CANCELLED_EVENT`
  payload `{ workflowRunId, workflowId, status, stateVariables, reason }`
  is preserved; the cascade service emits it via the same
  `EventEmitter2` instance the engine uses today.
- **Engine constructor shrinks.** The engine drops
  `@Inject(DOCKER_CLIENT) @Optional() docker?: Docker` and
  `@Optional() workflowRunRepository?: WorkflowRunRepository`; the
  `WORKFLOW_RUN_CANCELLED_EVENT` import is removed. The three
  private cancel-path helpers (`cancelWorkflowRunWithCascade`,
  `cancelActiveChildRuns`, `stopAllManagedContainersForRun`) are
  removed and replaced by a one-line delegate to
  `this.cascade.cancelRunWithCascade(runId, reason)`.
- **Visited-set moves from method parameter to instance-scoped
  field.** The leaky `Set<string> visited` parameter on
  `cancelWorkflowRunWithCascade` and `cancelActiveChildRuns` is
  gone. The cascade's child-first ordering and the
  "each run is cancelled at most once per call" invariant become
  properties of `WorkflowCancellationCascadeService` and are
  visible at the class boundary rather than at the method
  signature.
- **`WorkflowContainerCleanupService` is reusable.** The
  `stopManagedContainersForRun` seam can be invoked from the
  cascade today and from any future quiescence / manual-termination
  path tomorrow without instantiating the cascade.
- **Module graph preserved.** No `@Global()`, no `forwardRef`, no
  re-export. `WorkflowCoreModule.providers` is the only
  module-graph mutation; the module's `imports` and `exports`
  arrays are unchanged.
- **No new event types, no new persistence, no migrations.** The
  refactor is a pure responsibility split on the cancel path. No
  database schema change, no new BullMQ queue, no new
  `EventEmitter2` event constant.
- **Follow-up milestones land separately.** The M2 implementation
  (the two new service classes, the engine rewrite, the
  `WorkflowCoreModule` provider registration, the test files) and
  the M3+ test / wiring / documentation follow-ups are tracked
  behind this ADR but are out of scope for the decision recorded
  here. The implementation work is not yet merged at the time of
  this ADR.

## Status

Status: Accepted. Owner: refactor-executor.

This ADR records the **M1 decision milestone** of work item
`f9d280a4-849c-4159-bc87-b45d47dbec7a`. M1 is a documentation-only
milestone: the decision is captured in this ADR; no code change
has landed yet. The implementation milestones (creating
`WorkflowContainerCleanupService` and
`WorkflowCancellationCascadeService`, rewriting
`WorkflowEngineService.cancelWorkflowRun` as a thin delegator,
registering the new providers in `WorkflowCoreModule`, and
updating the affected spec files) are tracked as separate
follow-up milestones behind this ADR and are deliberately out of
scope for the M1 capture recorded here.

## References

- `apps/api/src/workflow/workflow-engine.service.ts` — the engine
  to be split (504 LOC). The private methods
  `cancelWorkflowRunWithCascade`, `cancelActiveChildRuns`, and
  `stopAllManagedContainersForRun` are the source of the split.
- `apps/api/src/workflow/workflow-terminal-run-closer.service.ts`
  — the single-run, fail-path closer (alternative (ii) was
  rejected against this class).
- `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`
  — the `IWorkflowEngineService` interface whose
  `cancelWorkflowRun(runId, reason?)` signature is preserved by
  invariant (1).
- `apps/api/src/workflow/workflow-core.module.ts` — the single
  module-graph mutation point for the future provider
  registrations.
- `docs/architecture/workflow-engine.md` and
  `docs/guide/06-workflow-engine.md` — the engine's companion
  architecture and guide documents, to be updated in the
  documentation follow-up milestone.
- `docs/architecture/ADR-0001-api-module-dependency-inversion.md`
  — the module-graph policy that governs the extraction (no
  `@Global()`, no `forwardRef`, no re-export).
- The `codebase_refactoring_analysis` nightly scan output that
  flagged the engine under work item
  `f9d280a4-849c-4159-bc87-b45d47dbec7a`.
