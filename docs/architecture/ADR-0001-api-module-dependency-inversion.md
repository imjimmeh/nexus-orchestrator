# ADR-0001: API Module Dependency Inversion & `forwardRef` Policy

**Status:** Accepted
**Date:** 2026-06-22
**Context docs:** `docs/plans/2026-06-21-api-forwardref-refactor-design.md`,
`docs/superpowers/plans/2026-06-21-api-forwardref-refactor.md`

## Context

`apps/api` had ~50 `forwardRef()` edges across 28 NestJS modules. `forwardRef` masks a
genuine dependency cycle; the sprawl caused fragile boot ordering, `@Optional()` injections that
existed only to satisfy cycles (some of which silently disabled load-bearing liveness seams), and
defensive cargo-culting where new code added yet more `forwardRef`. The module graph could not be
reasoned about or tested module-by-module.

## Decision

Reduce the module graph toward a DAG using **dependency inversion toward leaf modules** and
**composition-root orchestration**, never `@Global()` or compatibility re-exports. A real-boot gate
(`npm run test:boot`, a NestJS `AppModule.compile()` against live infra) is the authority for whether
a given `forwardRef` is removable; `madge` tracks file-level cycles and provides a CI ratchet.

Mechanisms applied:

1. **Defensive sweep.** Every module-import `forwardRef` whose target has no real back-edge was
   converted to a plain import, gate-verified one edge at a time. (42 edges removed.)
2. **Composition-root bootstrap (`BootstrapModule`).** Startup IAM-policy refresh moved out of
   `StartupSeedService`/`DatabaseModule` to a root `BootstrapService.onApplicationBootstrap`. This
   made `DatabaseModule` stop importing `SecurityModule`. **Data seeding stays in
   `DatabaseModule.onModuleInit`** so it still completes before consumers (e.g.
   `WorkflowEventTriggerService`) read seeded rows in their own `onModuleInit` — moving _all_ seeding
   to `onApplicationBootstrap` was rejected because it regressed that ordering.
3. **Leaf `AuditLogModule`.** `AuditLogService` (cross-cutting) moved out of `SecurityModule` into a
   leaf importing only `DatabaseModule`. `AuthorizationModule` depends on the leaf, breaking
   `Authorization ↔ Security`.
4. **Lazy `ModuleRef` resolution for `TELEMETRY_GATEWAY`.** `SessionModule` and
   `WorkflowRunOperationsModule` already resolved the gateway via `ModuleRef({ strict: false })`, so
   their `TelemetryModule` imports were redundant. Removing them broke `Session ↔ Telemetry` and
   `RunOperations ↔ Telemetry` **without any change to the WebSocket gateway's socket handlers** —
   the design's heavier event-inversion (Mechanism A) proved unnecessary.

Result: the four major architectural cycles (`Database ↔ Security`, `Authorization ↔ Security`,
`Session ↔ Telemetry`, `RunOperations ↔ Telemetry`) are eliminated; file-level circular chains
dropped from 52 to 32.

## Accepted remaining cycles

The remaining `forwardRef` edges are **genuine, tightly-coupled runtime cycles inside the workflow
engine**, where `forwardRef` is the legitimate NestJS mechanism and forcing them apart via interface
extraction would be disproportionate and high-risk without a live-stack behavioural test:

- The workflow-engine core: `WorkflowCoreModule`, `WorkflowStepExecutionModule`,
  `WorkflowRunOperationsModule`, `ExecutionLifecycleModule`, `WorkflowSpecialStepsModule` are mutually
  dependent (engine ↔ step execution ↔ special-step registry/executor).
- The **session hydration cluster**: ~13 workflow services inject `SessionHydrationService`; inverting
  to `SESSION_HYDRATION_SERVICE` + a leaf hydration module is a tracked follow-up.
- `Memory ↔ Learning` (bidirectional promotion dependency).
- `system-settings → {Authorization, Security}`.

These are governed by the ratchet below and are to be reduced incrementally (interface extraction or
lazy resolution), never grown.

## Enforcement

`apps/api/scripts/check-circular.mjs` (`npm run madge:ci`) fails when the circular-chain count exceeds
the **baseline of 32**. The baseline only moves DOWN: when a refactor removes cycles, lower it.
Reviewers must reject new `forwardRef` between modules; break the cycle with a leaf module or lazy
`ModuleRef` resolution instead.

## Consequences

- `DatabaseModule`, `AuditLogModule`, and the telemetry gateway provider are now leaf-er and
  independently reasonable; boot ordering for IAM refresh is explicit at the composition root.
- A reliable, fast DI-graph gate (`npm run test:boot`) now exists and is reusable for any future
  module-wiring change.
- The ratchet prevents regression while the remaining genuine engine cycles are addressed over time.
