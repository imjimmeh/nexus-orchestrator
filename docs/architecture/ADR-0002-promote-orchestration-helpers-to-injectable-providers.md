# ADR-0002: Promote Orchestration Helpers to `@Injectable` Providers

**Status:** Accepted
**Date:** 2026-06-24
**Work item:** 9a9abf66-217c-4028-bb45-147486fa1719
**Supersedes:** work item `2b8d0c51-ad27-4f10-9448-38502c8bbf35` (the original refactor item tracked by the `codebase_refactoring_analysis` nightly scan, which described the manual-DI design)
**Module:** `apps/kanban/src/orchestration`

## Context

`OrchestrationService` (`apps/kanban/src/orchestration/orchestration.service.ts`)
had grown to **759 lines** with a `/* eslint-disable max-lines */` directive
sitting on top of it, and its constructor body manually instantiated five
helper services:

- `OrchestrationCycleDecisionService`
- `OrchestrationActionRequestsService`
- `OrchestrationObservabilityService`
- `OrchestrationStateLifecycleService`
- `OrchestrationRunRequestService`

These helpers were all NestJS-injectable in shape (constructor-injected
dependencies, typed method surface, testable in isolation) but were being
newed up by hand inside the orchestrator's constructor body. The orchestrator
was therefore the only place those classes were instantiated, and the
NestJS DI container never saw them.

That manual-DI pattern had three concrete costs:

1. **Testing-module overrides were bypassed.** A unit test that wanted to
   stub out, say, `OrchestrationObservabilityService` for a focused
   `OrchestrationService` test could not use
   `Test.createTestingModule({ providers: [...] }).overrideProvider(...)`,
   because the helper was never registered as a provider — it was a private
   field initialised by hand. Tests that wanted isolation either had to
   drive behaviour through public methods (slow, brittle) or monkey-patch
   the instance (fragile, untyped).
2. **Unit-test isolation was impossible.** Every test that constructed
   `OrchestrationService` directly pulled in the entire helper graph,
   including transitive dependencies the test did not care about. Test
   failures blamed the wrong layer; test runtime ballooned.
3. **The orchestrator's surface area was inflated.** The orchestrator file
   carried import, instantiation, and wiring code for every helper even
   though the only thing that file should own is orchestration policy. The
   `max-lines` disable was a direct symptom.

The `codebase_refactoring_analysis` nightly scan flagged this as a
high-severity refactor target (see `2b8d0c51-ad27-4f10-9448-38502c8bbf35`).

### Cyclic dependency constraint

Promoting the helpers to providers is not free: `OrchestrationService` and
`OrchestrationCycleDecisionService` form a real cycle. The cycle-decision
service drains a pending-consecutive-failure flag into the failure-threshold
service and then needs the orchestrator to clear that flag on its persisted
metadata — so the orchestrator is reachable from the cycle-decision service
through public surface, while the orchestrator injects the cycle-decision
service for its decision logic.

Upstream EPIC-117 / EPIC-202 resolved this cycle by introducing the
`ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` injection token. The token
is satisfied by a module-level factory that takes the orchestrator via
`forwardRef(() => OrchestrationService)` and returns a callback bound to
the orchestrator's public `clearPendingConsecutiveFailure` method. The
cycle-decision service consumes that callback via `@Inject` rather than
holding a direct reference to the orchestrator. This ADR preserves that
mechanism verbatim — it is the canonical way to express this cycle in
NestJS and is the basis for the test assertion in
`orchestration.module.spec.ts` that locks the factory's registration.

## Decision

Promote all five helpers to `@Injectable` providers and drop manual
instantiation from `OrchestrationService`'s constructor body. Concretely:

1. **`@Injectable` on each helper.** `OrchestrationCycleDecisionService`,
   `OrchestrationActionRequestsService`, `OrchestrationObservabilityService`,
   `OrchestrationStateLifecycleService`, and `OrchestrationRunRequestService`
   are annotated `@Injectable()`. No class-level behaviour changes; only
   the lifecycle owner moves from the orchestrator's constructor to the
   NestJS DI container.
2. **Providers registered in `OrchestrationModule`.** All five classes are
   listed in `OrchestrationModule.providers` alongside the orchestrator
   itself. `orchestration.module.spec.ts` locks the providers array with
   five `toContain` assertions, so a future refactor that accidentally
   drops a helper from the providers list fails CI rather than silently
   re-introducing manual DI.
3. **Constructor injection in `OrchestrationService`.** The orchestrator's
   constructor now takes the five helpers as NestJS-injected fields. The
   constructor body is empty; the previous `new XxxService(...)` lines and
   the `/* eslint-disable max-lines */` directive are gone.
4. **Cycle broken via the existing factory token (no change).** The
   `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` factory token stays
   exactly as EPIC-117 / EPIC-202 defined it:

   ```ts
   {
     provide: ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
     useFactory: (orchestrator) => (projectId) =>
       orchestrator.clearPendingConsecutiveFailure(projectId),
     inject: [forwardRef(() => OrchestrationService) as never],
   }
   ```

   The cycle-decision service consumes the callback via
   `@Inject(ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE)` and calls it
   instead of holding a direct orchestrator reference. `orchestration.module.spec.ts`
   asserts that this token's provider entry is present, with the factory
   bound and the `forwardRef` preserved.
5. **`forwardRef` mirror on the orchestrator side.** Because the cycle is
   bilateral — the orchestrator injects `OrchestrationCycleDecisionService`
   and the factory injects `OrchestrationService` — the orchestrator's own
   injection site uses `@Inject(forwardRef(() => OrchestrationCycleDecisionService))`
   for symmetry. The other four helpers are plain (non-cyclic) injection
   sites.
6. **Constructor slot order is load-bearing.** The orchestrator's
   `design:paramtypes` slot order is consumed by an existing provider
   metadata spec used by the suite. The five helper injections are
   appended at the end of the constructor to preserve the historical slot
   order, and `orchestration.service.spec.ts` now asserts that slot order
   so accidental re-ordering fails CI rather than silently breaking the
   forwardRef wiring.

## Alternatives Considered

### Keep manual DI

Status quo: keep `new XxxService(...)` lines in the orchestrator's
constructor body. **Rejected.** This is the exact failure mode the
`codebase_refactoring_analysis` scan flagged — manual DI blocks NestJS
testing-module overrides, perpetuates the `max-lines` workaround, and
inflates the orchestrator's surface area. There is no test-isolation
benefit and no architectural justification for keeping the helpers outside
the DI container in a NestJS app.

### Full interface-based DI via interface files

Extract a TypeScript interface for each helper (e.g.
`IOrchestrationCycleDecision`) and inject via a token binding, with no
direct class import in the orchestrator. **Rejected as over-engineering
for this scope.** The helpers are tightly co-located in
`apps/kanban/src/orchestration`, the orchestrator is their only consumer,
and `@Injectable` providers already give the suite the override,
replaceability, and isolation properties that matter. Interface extraction
is the right move when crossing a module boundary or when multiple
consumers need a stable contract — neither condition holds here. Interface
extraction can be revisited if any helper later becomes a cross-module
dependency.

### Move helpers into sub-modules

Split each helper into its own NestJS sub-module (e.g.
`OrchestrationCycleDecisionModule`, `OrchestrationObservabilityModule`)
and re-import them from `OrchestrationModule`. **Rejected.** Adds module
boundary overhead and cross-module import plumbing without solving the
test-isolation problem any more cleanly than registering them as
providers in the existing `OrchestrationModule`. The helpers share a
domain, share the orchestrator as their only consumer, and share the
cyclic graph against the orchestrator — a sub-module split would force
every sub-module to depend on `OrchestrationModule` for the cycle-decision
forwardRef and would multiply `forwardRef` edges without simplifying the
graph. If a future refactor pushes a helper across a domain boundary
(e.g. to the policy module), that helper can graduate to its own module
at that point.

## Consequences

- **Line count.** `orchestration.service.ts` drops from **759 → 553 lines**
  (~206 lines removed). The drop is concentrated in the constructor body
  and in helper wiring code that no longer lives in the orchestrator.
- **`max-lines` lint rule now passes naturally.** The
  `/* eslint-disable max-lines */` directive on
  `orchestration.service.ts` is removed; the lint rule passes without it.
- **Testing-module overrides work.** Unit tests can now use
  `Test.createTestingModule({ providers: [...] }).overrideProvider(...)` to
  replace any of the five helpers with a fake without instantiating real
  implementations. `orchestration.service.spec.ts` contains a focused test
  block — `OrchestrationService — NestJS testing-module isolation` — that
  proves helpers can be replaced without instantiating real implementations.
- **Providers array is CI-locked.** `orchestration.module.spec.ts` asserts
  that all five helpers are present in `OrchestrationModule.providers` via
  `toContain` and that the `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE`
  factory entry is registered with its `useFactory` / `inject: [forwardRef(...)]`
  shape. A future refactor that drops a helper from the providers list
  fails CI rather than silently re-introducing manual DI.
- **Constructor slot order is CI-locked.** `orchestration.service.spec.ts`
  asserts the orchestrator's `design:paramtypes` slot order. Accidental
  re-ordering — which would silently break the forwardRef wiring or the
  existing provider metadata spec — fails CI rather than passing review
  on visual inspection alone.
- **No public API change.** `OrchestrationService` exposes the same
  methods with the same signatures. Consumers (the continuation service,
  the policy service, MCP tools, etc.) are unaffected.
- **ForwardRef ordering discipline.** Adding a new cyclic dependency
  between the orchestrator and a helper now requires touching both the
  factory token in `OrchestrationModule` and the helper's own injection
  site. This ADR is the canonical reference for that ordering: the
  factory uses `forwardRef(() => OrchestrationService)`; the orchestrator
  uses `@Inject(forwardRef(() => OrchestrationCycleDecisionService))` for
  symmetry.

## References

- Work item `2b8d0c51-ad27-4f10-9448-38502c8bbf35` — the original "refactor"
  work item tracked by the `codebase_refactoring_analysis` nightly scan;
  this ADR supersedes the manual-DI design described there.
- EPIC-117 / EPIC-202 — the upstream that introduced the
  `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` factory token and the
  `forwardRef` cycle-breaking pattern.
- `apps/kanban/src/orchestration/orchestration.module.ts` — provider
  registrations for the five helpers and the
  `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` factory token.
- `apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts`
  — `@Inject(ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE)` consumer.
- `apps/kanban/src/orchestration/orchestration.service.ts` — constructor
  injection sites for the five helpers, with
  `@Inject(forwardRef(() => OrchestrationCycleDecisionService))` mirror.
- `apps/kanban/src/orchestration/orchestration.service.spec.ts` —
  `OrchestrationService — NestJS testing-module isolation` test block;
  `design:paramtypes` slot-order assertion.
- `apps/kanban/src/orchestration/orchestration.module.spec.ts` —
  providers-array `toContain` assertions and
  `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` factory registration
  assertion.
- Audit note (M1 milestone): `.audit-notes/M1-orchestration-refactor-audit.md`.
- ADR-0001 (`docs/architecture/ADR-0001-api-module-dependency-inversion.md`)
  — sibling ADR governing `forwardRef` usage and the module-graph ratchet
  in `apps/api`. The kanban-side `forwardRef` introduced by this ADR is
  contained within `OrchestrationModule` and does not affect the API
  ratchet baseline.