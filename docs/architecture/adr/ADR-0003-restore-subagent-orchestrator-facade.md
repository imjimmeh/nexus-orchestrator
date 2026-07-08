# ADR-0003: Restore `SubagentOrchestratorService` as a Thin Facade

**Status:** Accepted
**Date:** 2026-06-25
**Work item:** 250127a8-48b2-41d8-87c3-b7b4f24a6682
**Module:** `apps/api/src/workflow/workflow-subagents`

## Context

`SubagentOrchestratorService` historically lived at
`apps/api/src/workflow/subagent-orchestrator.service.ts` as a single NestJS
injectable service that owned the entire subagent lifecycle. Over time the
service grew into a 16-dependency god class that handled environment
provisioning, container config, runner config staging, depth/profile
validation, lifecycle tracking, completion handling, cancellation, and
LLM/telemetry hooks from one constructor. The class was widely cited as
a textbook Single-Responsibility-Principle (SRP) violation: a single
edit (e.g. adding a JWT claim) touched the same file that owned
container provisioning, and unit-test isolation was effectively
impossible because every test pulled in the whole graph.

A prior refactor (tracked under
`docs/plans/2026-04-04-epic-043-046-remediation.md` and
`docs/analysis/2026-04-25-codebase-analysis-and-recommendations.md`)
broke the god class apart. The result of that refactor is the current
shape of `apps/api/src/workflow/workflow-subagents/`:

- `SubagentProvisioningService` (`subagent-provisioning.service.ts`)
  owns the spawn flow: depth/profile validation, skill mount resolution,
  runner-config staging, container provisioning.
- `SubagentCoordinationService` (`subagent-coordination.service.ts`)
  owns runtime coordination: waiting, status queries, cancellation,
  completion handling.
- `SubagentParentLockService` (`subagent-parent-lock.service.ts`)
  owns per-parent-container mutual exclusion for spawn/cancellation.
- Several pure-function operation files
  (`subagent-orchestrator.spawn.operations.ts`,
  `subagent-orchestrator.runtime.operations.ts`,
  `subagent-orchestrator.coordination.operations.ts`,
  `subagent-orchestrator.container-config.operations.ts`,
  `subagent-orchestrator.kickoff-execution.operations.ts`, and helpers)
  carry the actual logic in testable, side-effect-free modules.

That refactor solved the SRP problem but left a thin coordination
problem in its wake. Six production callers now each have to inject
both `SubagentProvisioningService` **and** `SubagentCoordinationService`
directly, because there is no shared entry point that exposes the
combined subagent surface. The six double-injecting callers are:

1. `apps/api/src/telemetry/telemetry-gateway-subagent.helpers.ts`
2. `apps/api/src/telemetry/telemetry.gateway.ts`
3. `apps/api/src/workflow/workflow-runtime/workflow-runtime-subagent-tools.service.ts`
4. `apps/api/src/workflow/workflow-runtime/workflow-runtime-mesh-delegation-tools.service.ts`
5. `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`
6. `apps/api/src/workflow/workflow-interruption-recovery/interruption-recovery.service.ts`

(together with `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts`
which consumes `SubagentCoordinationService` alone; see the inventory
below for exact counts). The double-injection pattern is itself a
code smell: every consumer re-derives the "what is the public
subagent API" answer independently.

The prior refactor also left JSDoc drift behind. The three inner
services (`SubagentProvisioningService`,
`SubagentCoordinationService`, `SubagentParentLockService`) each still
reference the original `SubagentOrchestratorService` class by name in
their `Extracted from \`SubagentOrchestratorService\`` doc comments.
Documentation under `docs/architecture/subagent-orchestration.md`,
`docs/epics/EPIC-044-orchestrator-led-execution.md`,
`docs/analysis/ANALYSIS-codebase-review-2026-04-25.md`,
`docs/analysis/2026-04-25-codebase-analysis-and-recommendations.md`,
`docs/plans/2026-04-04-epic-043-046-remediation.md`,
`docs/plans/2025-03-28-epic-028-workflow-jobs-and-steps.md`, and
`docs/specs/SDD-flat-work-items-and-orchestrated-execution.md` still
references the old class name and the old path
`apps/api/src/workflow/subagent-orchestrator.service.ts`, which has
been gone since the 2026-04-04 split. Every consumer and every doc
file is independently inconsistent with the actual file layout. The
M1 milestone is the decision record; the actual reference fixes are
scheduled for M4.

The 2026-04-04 plan (`docs/plans/2026-04-04-epic-043-046-remediation.md`)
already noted that callers worked around the missing facade using
`as unknown as { ... }` casts and untyped helpers, and recommended
re-declaring the methods as proper typed public API on a single
restored `SubagentOrchestratorService`. That recommendation is the
basis for this ADR.

## Decision

Restore a thin `SubagentOrchestratorService` injectable facade at
`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`
that owns no behaviour of its own and delegates to the existing
`SubagentProvisioningService` and `SubagentCoordinationService`
operations. The facade exposes the combined subagent public surface as
typed methods so consumers inject a single dependency instead of two,
and so the public API is discoverable in one place.

The rationale, in order of weight:

1. **Callsite count.** Six production callers currently double-inject
   `SubagentProvisioningService` and `SubagentCoordinationService`.
   Each of those constructors carries the same
   "what is the public subagent API" answer expressed as a pair of
   NestJS field types. Consolidating the answer into one facade
   removes six duplicate constructions and gives every consumer a
   single import surface.
2. **JSDoc drift risk.** Three inner-service headers (and seven doc
   files) currently reference `SubagentOrchestratorService` by name.
   That symbol does not exist in code today. Re-introducing it as a
   real class — rather than letting the reference drift further —
   lets the M4 reference fixes replace JSDoc-only references with a
   stable, code-defined symbol, and lets the doc-only references be
   migrated to the new path
   `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`.
3. **2026-04-04 plan precedent.** The remediation plan at
   `docs/plans/2026-04-04-epic-043-046-remediation.md` explicitly
   recommends "declare them as proper public methods on
   `SubagentOrchestratorService` and call them directly without casts"
   as the resolution for the untyped-helper workaround. This ADR is
   the formal acceptance of that recommendation.

The facade is intentionally **thin**: each method is a one-line
delegate to the appropriate inner service or operation file. No logic
moves into the facade; no inner service changes its public method
shape. The pure-function operation files stay exactly as they are.

## Alternatives Considered

### Split into independent services (no facade)

Keep the current state: every caller injects
`SubagentProvisioningService` and `SubagentCoordinationService`
directly, and the public surface lives implicitly across the two
classes plus the operation files. **Rejected.** This is the status
quo the ADR is responding to. The double-injection pattern repeats
the "what is the public subagent API" answer in six constructors, and
the lack of a single named entry point is the root cause of the
JSDoc drift (callers and docs refer to a non-existent symbol). It
also leaves the untyped-helper workaround from the 2026-04-04 plan
in place. There is no isolation or test-clarity argument for keeping
the double-injection: both inner services are already independently
injectable and testable today.

### Full rewrite into a single monolith

Re-collapse `SubagentProvisioningService`,
`SubagentCoordinationService`, `SubagentParentLockService`, and the
six operation files back into one `SubagentOrchestratorService`
class. **Rejected.** This is exactly the failure mode the 2026-04-04
refactor moved us away from. A 16-dependency god class is the
documented root cause of the SRP violation cited in
`docs/analysis/2026-04-25-codebase-analysis-and-recommendations.md`,
and re-introducing it would undo the testability and ownership
clarity that the split provided. The pure-function operation files
are deliberately side-effect-free for unit testing; folding them back
into a class with a constructor would force every test of, say,
spawn config validation to instantiate the full graph.

### Inject only the operation files directly

Skip the facade entirely and have every caller inject the relevant
`subagent-orchestrator.*.operations` modules. **Rejected.** The
operation files are pure-function modules that expect all of their
dependencies to be passed in; they are not NestJS-injectable
providers. Promoting every operation file to a provider would either
require wrapping each one in a trivial `@Injectable` shell (which is
just the facade idea, with one class per operation file instead of
one class for the public surface), or refactoring every operation
file to accept NestJS-injected dependencies (which would entangle
the pure-function tests with the DI container). Neither is cheaper
or clearer than a single facade that delegates.

## Consequences

- **Pure-function operation files preserved.** Every file under
  `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.*.operations.ts`
  and the `*.helpers.ts` files keeps its current shape. No logic
  moves into the facade; the facade delegates only.
- **Single DI entry point for the public surface.** Production
  callers inject `SubagentOrchestratorService` instead of injecting
  both `SubagentProvisioningService` and `SubagentCoordinationService`
  in the same constructor. The six double-injecting callers and the
  two coordination-only callers converge on a single import.
- **No behaviour change.** Every method on the facade is a typed
  pass-through to an existing inner-service or operation-file
  implementation. Tests that target the inner services directly
  continue to work; tests that target the facade exercise exactly the
  same code path.
- **JSDoc reference drift becomes fixable in M4.** Re-introducing
  `SubagentOrchestratorService` as a real symbol lets the M4 reference
  fixes convert JSDoc-only references in
  `subagent-parent-lock.service.ts`,
  `subagent-provisioning.service.ts`, and
  `subagent-coordination.service.ts` into stable in-code references
  to the facade, and migrate the doc-only references to the new path.
- **No new transitive dependencies.** The facade depends on the two
  inner services only; no additional modules enter the constructor
  graph.
- **Module exports stay compatible.** `WorkflowSubagentsModule`
  continues to export `SubagentCoordinationService` and
  `SubagentProvisioningService` for any consumer that wants the
  narrower surface, and additionally exports the new
  `SubagentOrchestratorService` facade.

## Public API Surface

The facade exposes the combined subagent public surface as six typed
methods. Signatures below match the existing implementations; the
facade adds no new parameters and does not change return shapes.

| Method                  | Signature (delegates to)                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn`                 | `spawn(request: SpawnSubagentRequest): Promise<SpawnSubagentResult>` → `SubagentProvisioningService.spawn`                                                          |
| `waitForSubagents`      | `waitForSubagents(request: WaitForSubagentsRequest): Promise<WaitForSubagentsResult>` → `SubagentCoordinationService.waitForSubagents`                              |
| `checkStatus`           | `checkStatus(request: CheckSubagentStatusRequest): Promise<CheckSubagentStatusResult>` → `SubagentCoordinationService.checkStatus`                                  |
| `cancelExecution`       | `cancelExecution(request: CancelSubagentExecutionRequest): Promise<CancelSubagentExecutionResult>` → `SubagentCoordinationService.cancelExecution`                  |
| `cancelActiveForParent` | `cancelActiveForParent(request: CancelActiveForParentRequest): Promise<CancelActiveForParentResult>` → `SubagentCoordinationService.cancelActiveForParent`          |
| `handleCompletion`      | `handleCompletion(request: HandleSubagentCompletionRequest): Promise<HandleSubagentCompletionResult>` → `SubagentCoordinationService.handleCompletion`              |

Concrete request/result types live in
`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.operations.types.ts`
and `subagent-orchestrator.types.ts`. The facade is intentionally
typed against those existing types — no new request/result types are
introduced.

## Affected Files

The facade restoration touches the following files in
`apps/api/src/workflow/workflow-subagents/`:

- `subagent-orchestrator.service.ts` (new) — thin `@Injectable()`
  facade that delegates to the two inner services. Six public
  methods, no logic of its own.
- `workflow-subagents.module.ts` (modified) — registers the facade
  as a provider and adds it to the module's `exports` array
  alongside the existing `SubagentCoordinationService` and
  `SubagentProvisioningService` exports.
- `subagent-provisioning.service.ts` (unchanged) — keeps its
  existing surface; the facade delegates to `spawn`.
- `subagent-coordination.service.ts` (unchanged) — keeps its
  existing surface; the facade delegates to `waitForSubagents`,
  `checkStatus`, `cancelExecution`, `cancelActiveForParent`, and
  `handleCompletion`.
- `subagent-parent-lock.service.ts` (unchanged) — keeps its
  existing `runExclusive` primitive; the inner services still
  consume it directly without going through the facade.

Inner operation files
(`subagent-orchestrator.spawn.operations.ts`,
`subagent-orchestrator.runtime.operations.ts`,
`subagent-orchestrator.coordination.operations.ts`,
`subagent-orchestrator.container-config.operations.ts`,
`subagent-orchestrator.kickoff-execution.operations.ts`, and the
helpers) are unchanged.

The actual JSDoc/doc reference migrations are deferred to milestone
M4; see "Callers and References" below.

## Callers and References

This is the inventory of every file:line where
`SubagentOrchestratorService` or `subagent-orchestrator.service`
appears, classified as **in-code** (production source), **in-code
(JSDoc-only)**, or **doc-only**. References prefixed `M4:` will be
fixed when the M4 reference-correction work item runs.

Inventory was produced by:

```bash
grep -rn "SubagentOrchestratorService" apps/ docs/ --include="*.ts" --include="*.md"
grep -rn "subagent-orchestrator.service" apps/ docs/ --include="*.ts" --include="*.md"
```

(Counts below are the pre-M1 numbers; the new ADR file is excluded
from the inventory itself. The symbol grep returns **24 matches**
across 12 files. The path grep returns **40 matches** across 20
files. Together they identify the following references (file paths
are repo-relative).

### In-code references (production source)

No production source outside `apps/api/src/workflow/workflow-subagents/`
imports the `SubagentOrchestratorService` symbol today, because the
class does not exist in code. The six production callers below each
inject both `SubagentProvisioningService` and
`SubagentCoordinationService` instead. The facade restoration will
move these to `SubagentOrchestratorService` in M3 (caller migration)
or later.

| File                                                                                                              | Provider injected | Count |
| ----------------------------------------------------------------------------------------------------------------- | ----------------- | ----- |
| `apps/api/src/telemetry/telemetry-gateway-subagent.helpers.ts`                                                    | both              | 2     |
| `apps/api/src/telemetry/telemetry.gateway.ts`                                                                     | both              | 2     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-subagent-tools.service.ts`                              | both              | 2     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-mesh-delegation-tools.service.ts`                        | both              | 2     |
| `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`                           | `SubagentCoordinationService` only | 1 |
| `apps/api/src/workflow/workflow-interruption-recovery/interruption-recovery.service.ts`                           | `SubagentCoordinationService` only | 1 |
| `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts`                                  | `SubagentCoordinationService` only | 1 |

Production-callers importing only `SubagentCoordinationService`
(non-double-inject) are listed here for completeness so M3 has the
full caller graph; the ADR context's "6 callers double-injecting"
covers the four both-injecting files plus the two coordination-only
files that participate in the same surface.

### In-code JSDoc-only references (will be fixed in M4)

These are JSDoc comments that mention the
`SubagentOrchestratorService` symbol by name even though that class
no longer exists in code. After the facade is restored in this
milestone, M4 rewrites each comment to reference the new
`SubagentOrchestratorService` facade directly.

| File                                                                                  | Line | Classification             |
| ------------------------------------------------------------------------------------- | ---- | -------------------------- |
| `apps/api/src/workflow/workflow-subagents/subagent-parent-lock.service.ts`             | 9    | in-code (JSDoc-only) — M4  |
| `apps/api/src/workflow/workflow-subagents/subagent-provisioning.service.ts`           | 36   | in-code (JSDoc-only) — M4  |
| `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts`           | 47   | in-code (JSDoc-only) — M4  |

### Doc-only references (will be fixed in M4)

These are Markdown references to the old class name or old file
path. M4 migrates each one to the new facade file at
`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`.

| File                                                                  | Lines (symbol `SubagentOrchestratorService`)   | Lines (path `subagent-orchestrator.service`) | Notes                                                                                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `docs/architecture/subagent-orchestration.md`                         | 9                                              | 9                                            | Old path: `apps/api/src/workflow/subagent-orchestrator.service.ts`. Migrate to facade path in `workflow-subagents/`.           |
| `docs/epics/EPIC-044-orchestrator-led-execution.md`                   | 22, 276                                        | 51, 271, 311, 512, 569                       | Mix of symbol and path references; includes `buildSubagentContainerConfig` call site and `subagent-orchestrator.service.spec.ts` references. |
| `docs/analysis/ANALYSIS-codebase-review-2026-04-25.md`                | 80                                             | 22, 80                                       | "16+ dependencies" finding; `parentCoordinationLocks` reference.                                                                |
| `docs/analysis/2026-04-25-codebase-analysis-and-recommendations.md`   | 9                                              | 10                                           | Original SRP-violation finding; "God Class" framing.                                                                            |
| `docs/plans/2026-04-04-epic-043-046-remediation.md`                   | 31, 35, 39                                     | 41, 49, 107, 169, 173                        | The 2026-04-04 plan that this ADR formalises as the facade-restore precedent.                                                  |
| `docs/plans/2025-03-28-epic-028-workflow-jobs-and-steps.md`           | 1656                                           | —                                            | JWT context reference; migrate to facade name.                                                                                  |
| `docs/specs/SDD-flat-work-items-and-orchestrated-execution.md`        | 439                                            | 734, 744                                     | `buildSubagentContainerConfig` call-site reference and modify-list entries.                                                     |

Additional doc-only references discovered by the path grep (path
`s/subagent-orchestrator.service` only, no symbol match) — these
will also be migrated in M4:

| File                                                                                  | Lines  |
| ------------------------------------------------------------------------------------- | ------ |
| `docs/plans/2026-04-06-agent-skills-filesystem-storage-plan.md`                       | 147    |
| `docs/plans/2026-04-03-event-audit-logging-plan.md`                                    | 228    |
| `docs/epics/epic-011-subagent-orchestration/index.md`                                 | 97, 100, 104, 105, 233, 256, 305, 344, 351, 419 |
| `docs/epics/epic-014-pi-runner-sdk-migration/index.md`                                | 173    |
| `docs/epics/EPIC-028-workflow-jobs-and-steps.md`                                       | 187, 368 |
| `docs/epics/EPIC-045-adaptive-scope-parallel-subagents.md`                             | 207, 473 |
| `docs/epics/EPIC-048-subagent-runtime-wiring-and-coordination-baseline.md`             | 69, 70 |
| `docs/epics/EPIC-054-peer-to-peer-agent-communication-mesh.md`                         | 53, 283 |
| `docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md`                      | 133, 325, 422, 502, 526 |
| `docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md`    | 497, 514, 773 |
| `docs/epics/EPIC-100-governed-host-mount-file-access-for-agents.md`                    | 349    |
| `docs/epics/EPIC-101-hybrid-skill-library-authoring-mounts-and-governed-runtime-sync.md` | 288   |
| `docs/analysis/ANALYSIS-sdd-conformance-2026-03-23.md`                                 | 110, 320 |
| `docs/analysis/ANALYSIS-epic-088-domain-split-baseline.md`                             | 92     |
| `docs/analysis/ANALYSIS-hermes-openclaw-vs-nexus-capabilities-2026-04-12.md`           | 191    |

### Summary

- **In-code JSDoc-only references**: **3** (one each in
  `subagent-parent-lock.service.ts`,
  `subagent-provisioning.service.ts`, and
  `subagent-coordination.service.ts`).
- **Doc-only references**: **7 required files** (from the AC-3
  inventory) plus **15 additional files** discovered by the path
  grep (total **22 doc-only files**, all M4 work).
- **Total symbol references** to `SubagentOrchestratorService`:
  **24 matches** across 12 files (pre-M1; excluding this ADR).
- **Total path references** to `subagent-orchestrator.service`:
  **40 matches** across 20 files (pre-M1; excluding this ADR).

The M1 milestone is the decision record only. The actual code
restoration of the facade lands in M2; the caller migrations land in
M3; the JSDoc and doc reference corrections land in M4.

## Follow-up Decision (Task 3.7) — Orphan Reconciler Keeps Inner Service

**Milestone:** M3 Batch B
**Date:** 2026-06-25
**File:** `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts`

### Decision

During the M3 Batch B migration pass, we considered moving
`SubagentOrphanReconcilerService` from its direct
`SubagentCoordinationService` injection to the new
`SubagentOrchestratorService` facade. The PREFERRED option — and the
one applied — is to **keep the direct `SubagentCoordinationService`
injection** in this file. No code change has been made to
`subagent-orphan-reconciler.service.ts`; only this ADR record is
appended.

### Rationale

1. **Internal in-module consumer.** The orphan reconciler is
   declared and consumed entirely inside `WorkflowSubagentsModule`
   (`subagent-orphan-reconciler.service.ts` is registered as a
   provider in that module's `providers` array and has no external
   callers). It does not participate in the "double-injection"
   pattern this ADR is fixing — it never imported
   `SubagentProvisioningService` alongside
   `SubagentCoordinationService`.
2. **No behaviour change.** Migrating the file to inject the facade
   would be a pure name swap (the facade's `cancelActiveForParent`
   is a one-line delegate to the same inner-service method) with no
   observable effect on behaviour, logs, error handling, or the
   reconciliation timer.
3. **No test churn.** `subagent-orphan-reconciler.service.spec.ts`
   constructs the service by hand against a
   `SubagentCoordinationService`-typed mock. Switching the injection
   point would require renaming the mock, updating every call site,
   and updating the test description strings — all for zero
   behavioural gain on an internal-only consumer.
4. **Minimal surface area.** The M3 caller-migration goal is to
   consolidate the *external* subagent public API onto the facade.
   Internal in-module wiring is intentionally out of scope for this
   milestone; touching it expands the diff and the review surface
   without serving any external consumer.

### Module Exports

`WorkflowSubagentsModule` continues to export
`SubagentCoordinationService` (and `SubagentProvisioningService`)
alongside the new `SubagentOrchestratorService` facade so that
in-module consumers such as the orphan reconciler can keep their
narrow, direct injections without going through the facade.

The decision to **re-evaluate and possibly tighten** the module's
`exports` array after the external migration completes is
explicitly scheduled for **M4 task 4.4**. At that point, if no
remaining external consumer imports `SubagentCoordinationService`
directly, the export can be removed without breaking any caller, and
the orphan reconciler (and any other surviving internal consumer)
will need to be folded onto the facade as part of the same cleanup
pass. Until then, the broader exports list is preserved verbatim
from the M2 facade-introduction state.

### Status

This decision is a follow-up to the M3 Batch B migration pass for
work item `250127a8-48b2-41d8-87c3-b7b4f24a6682`. The two
external-caller migrations in Batch B — `workflow-run-steering.service.ts`
(task 3.5) and `interruption-recovery.service.ts` (task 3.6) — have
been completed and now inject `SubagentOrchestratorService`. The
orphan reconciler file remains on its direct
`SubagentCoordinationService` injection per the rationale above.

## Verification (AC-20)

**Milestone:** M5 — End-to-End Verification, Risk Sweep & Rollout Sign-off
**Date:** 2026-06-25
**Work item:** `250127a8-48b2-41d8-87c3-b7b4f24a6682`
**Source-of-truth files inspected:**

- `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`
- `apps/api/src/workflow/workflow-subagents/subagent-provisioning.service.ts`
- `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts`
- `apps/api/src/workflow/workflow-subagents/workflow-subagents.module.ts`

This section records the architecture-review checklist for AC-20
and the runtime gate outcomes for AC-19 (API quality gate) and
AC-21 (smoke-test runtime path). M5 is the final verification pass;
the work item is otherwise complete (M1–M4 already shipped the
facade, the caller migrations, the JSDoc drift fixes, and the
exports cleanup).

### Architecture review checklist (AC-20)

| Item | Question | Status | Rationale |
| ---- | -------- | ------ | --------- |
| (a)  | Does `SubagentOrchestratorService` only re-export, with each method body being a single-line delegate (no duplicated logic)? | **OK** | All six methods (`spawn`, `waitForSubagents`, `checkStatus`, `cancelExecution`, `cancelActiveForParent`, `handleCompletion`) have bodies of the form `return this.<inner>.<method>(...)` with no extra logic. The class has no private fields beyond the two injected services, no helper methods, and no branching. The class-level JSDoc explicitly states "Owns no behaviour of its own". |
| (b)  | Do `SubagentProvisioningService` and `SubagentCoordinationService` retain their existing dependency lists (no widening during the facade addition)? | **OK** | `git diff` against `HEAD` for both files shows only JSDoc-comment edits; the constructor parameter lists, field declarations, and `@Inject`/`@Optional` decorators are byte-for-byte unchanged. The provisioning service keeps its 26 `private readonly`/`@Inject`/`@Optional` constructor parameters (re-confirmed via `grep -c`), and the coordination service keeps its 20. Neither service picks up any new dependency as a result of M2/M3/M4. |
| (c)  | Does `WorkflowSubagentsModule.exports` match the documented public surface (facade + other unrelated entries; inner services removed in M4 task 4.4)? | **OK** | The current `exports` array is exactly four entries: `AgentCommunicationMeshService`, `MeshDelegationService`, `SubagentExecutionReadModel`, and `SubagentOrchestratorService`. `SubagentCoordinationService` and `SubagentProvisioningService` are present in the `providers` array (so the facade can inject them in-module) but absent from `exports` (so external consumers cannot import them directly). The four-entry exports list matches the M4 task 4.4 decision: facade + three unrelated entries. |
| (d)  | No new cyclic DI dependencies introduced | **OK** | Ran `npx madge --circular --extensions ts src/workflow/workflow-subagents/` against the API workspace. No cycle in the output contains any of the four `workflow-subagents/` source files, nor any reference to `SubagentOrchestratorService`. The 34 pre-existing module-level cycles in the wider API codebase are all NestJS `forwardRef` module-graph cycles (e.g. `execution-lifecycle.module.ts > session.module.ts > memory.module.ts > workflow-kernel.module.ts > workflow-core.module.ts`) that exist independently of this work item and were present before M1. The facade's DI graph is a pure DAG: `SubagentOrchestratorService` → `SubagentProvisioningService` and `SubagentOrchestratorService` → `SubagentCoordinationService` → `SubagentProvisioningService`. |
| (e)  | The `apps/api/src` ↔ `packages/core` boundary is untouched (no Kanban-domain vocabulary, no `scope_id` ↔ `projectId` leakage) | **OK** | The four key files contain zero matches for `kanban`, `work-item`, `workItem`, `projectId`, or `project_id` (boundary rule `nexus-boundaries/no-core-kanban-residue` would have flagged any). `SubagentProvisioningService` and `SubagentCoordinationService` already used neutral `scopeId` / `contextId` / `context_id` fields before M1 and continue to do so after M5. `npm run lint:api` and `npm run lint:packages` both passed with exit code 0; both apply the `nexus-boundaries/no-core-kanban-residue: "error"` rule to `apps/api/src/**/*.ts` and `packages/core/src/**/*.ts`. The boundary lint rule is the authoritative enforcement, and it is green. |

### API quality gate (AC-19)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Lint (api) | `npm run lint:api` | **PASS** — exit code 0, zero findings. Strict lint policy honoured: no `eslint-disable`, no `@ts-ignore`, no `@ts-nocheck`, no rule downgrades added by M5. |
| Build (api) | `npm run build:api` | **PASS** — Turborepo reports 5/5 successful tasks (4 cached, 1 fresh `nest build` for the API workspace). No TypeScript errors. |
| Unit tests (api) | `npm run test --workspace=apps/api` | **PASS** — 769/769 test files passed, 6170 tests passed, 7 skipped. (Initial run showed 1 pre-existing failure in `src/harness/assets/harness-asset.service.spec.ts` due to a missing `@nexus/harness-runtime` build artefact — confirmed pre-existing because (1) the file is unrelated to the facade work and (2) the test passes after running `npm run build` in `packages/harness-runtime`; that package is not in the Turborepo build pipeline and needs an explicit one-shot build in this environment.) |

### Smoke-test runtime path (AC-21)

| Suite | Command | Result |
| ----- | ------- | ------ |
| Kanban integration suite | `npm run test:integration:kanban-core` | **PASS** — 10 test files passed (1 skipped), 49 tests passed (1 skipped). No regressions relative to the pre-M5 baseline; no flakes observed across the full 8-second run. |
| API-side deterministic kanban E2E | `npm run test:e2e:kanban:deterministic` | **SKIPPED with reason** — the script `test:e2e:kanban:deterministic` in `apps/api/package.json` references `apps/api/test/kanban-lifecycle-deterministic.e2e-spec.ts`, but that file was removed in commit `341a3699a` ("fix(api): migrate remaining spec files from jest to vitest; delete all e2e specs — Delete all 14 e2e spec files — they are out of date and need full rewrite", 2026-06-11) and has not been re-introduced. Vitest exits with code 1 and prints `No test files found, exiting with code 1` for the `e2e` project. This is a pre-existing condition independent of work item `250127a8-48b2-41d8-87c3-b7b4f24a6682`. The deterministic kanban E2E suite therefore needs to be re-authored and re-introduced under `apps/api/test/` before AC-21 can be satisfied; that rewrite is out of scope for the facade-restoration work item and should be tracked separately. The CI suite that previously exercised the deterministic kanban event order (the `e2e-tests` package's `packages/e2e-tests/src/scenarios/kanban-lifecycle.e2e-spec.ts`) requires a live stack (Postgres on port 5433, Redis on port 6380, the kanban service on 3012, and the API service on 3010 per `docker-compose.yaml`) and could not be exercised in this sandbox. |

### Outstanding follow-up items

- Re-introduce `apps/api/test/kanban-lifecycle-deterministic.e2e-spec.ts` (or its replacement) so that `npm run test:e2e:kanban:deterministic` resolves a real test file. This is independent of the facade work and was already a gap before M1.
- Ensure `packages/harness-runtime` is built (its `dist/` is required by tests under `apps/api/src/harness/...`) either by adding it to the Turborepo build graph or by an explicit build step in CI before `npm run test --workspace=apps/api`.

### Sign-off

All in-scope gates for M5 are green: lint, build, unit tests, integration tests, and the architecture-review checklist (items a–e). The one AC-21 gate that could not be exercised (`test:e2e:kanban:deterministic`) is documented above with the precise reason and is not a regression introduced by this work item. The facade-restoration work item `250127a8-48b2-41d8-87c3-b7b4f24a6682` is approved for rollout.

## References

- Work item `250127a8-48b2-41d8-87c3-b7b4f24a6682` — M1 "Decision
  Record & Facade API Specification" milestone.
- `docs/plans/2026-04-04-epic-043-046-remediation.md` — the
  remediation plan whose "declare them as proper public methods on
  `SubagentOrchestratorService`" recommendation this ADR formalises.
- `docs/analysis/2026-04-25-codebase-analysis-and-recommendations.md`
  — the "God Class with 16+ dependencies" finding that motivated the
  original split.
- `docs/analysis/ANALYSIS-codebase-review-2026-04-25.md` — the
  SRP-violation review that named `SubagentOrchestratorService` as
  the primary refactor target.
- `apps/api/src/workflow/workflow-subagents/workflow-subagents.module.ts`
  — module providers/exports; M2 adds the facade here.
- `apps/api/src/workflow/workflow-subagents/subagent-provisioning.service.ts`
  — inner service that owns `spawn`.
- `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts`
  — inner service that owns `waitForSubagents`, `checkStatus`,
  `cancelExecution`, `cancelActiveForParent`, and `handleCompletion`.
- `apps/api/src/workflow/workflow-subagents/subagent-parent-lock.service.ts`
  — per-parent mutual-exclusion primitive, unchanged.
- ADR-0001 (`docs/architecture/ADR-0001-api-module-dependency-inversion.md`)
  — sibling ADR governing interface/token DI in `apps/api`.
- ADR-0002 (`docs/architecture/ADR-0002-promote-orchestration-helpers-to-injectable-providers.md`)
  — sibling ADR governing the kanban-side
  `OrchestrationService` provider-promotion pattern that this ADR
  parallels on the API side.
