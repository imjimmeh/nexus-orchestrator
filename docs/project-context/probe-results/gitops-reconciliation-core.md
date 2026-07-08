---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: gitops-reconciliation-core
outcome: success
inferred_status: implemented
confidence_score: 0.88
evidence_refs:
  - apps/api/src/gitops/reconciliation.service.ts
  - apps/api/src/gitops/reconciliation.service.spec.ts
  - apps/api/src/gitops/reconciliation.service.types.ts
  - apps/api/src/gitops/reconciliation-apply.service.ts
  - apps/api/src/gitops/reconciliation-apply.service.spec.ts
  - apps/api/src/gitops/reconciliation-apply.service.types.ts
  - apps/api/src/gitops/reconciliation-diff.service.ts
  - apps/api/src/gitops/reconciliation-diff.service.spec.ts
  - apps/api/src/gitops/reconciliation-diff.service.types.ts
  - apps/api/src/gitops/reconciliation.types.ts
  - apps/api/src/gitops/reconciliation.types.spec.ts
  - apps/api/src/gitops/reconciliation.integration.spec.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.spec.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.types.ts
  - apps/api/src/gitops/drift-detection.service.ts
  - apps/api/src/gitops/drift-detection.service.spec.ts
  - apps/api/src/gitops/gitops.module.ts
  - apps/api/src/gitops/gitops.module.spec.ts
  - apps/api/src/gitops/gitops-inbound-reconcile.service.ts
source_paths:
  - apps/api/src/gitops/reconciliation.service.ts
  - apps/api/src/gitops/reconciliation.service.spec.ts
  - apps/api/src/gitops/reconciliation.service.types.ts
  - apps/api/src/gitops/reconciliation-apply.service.ts
  - apps/api/src/gitops/reconciliation-apply.service.spec.ts
  - apps/api/src/gitops/reconciliation-apply.service.types.ts
  - apps/api/src/gitops/reconciliation-diff.service.ts
  - apps/api/src/gitops/reconciliation-diff.service.spec.ts
  - apps/api/src/gitops/reconciliation-diff.service.types.ts
  - apps/api/src/gitops/reconciliation.types.ts
  - apps/api/src/gitops/reconciliation.types.spec.ts
  - apps/api/src/gitops/reconciliation.integration.spec.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.spec.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.types.ts
  - apps/api/src/gitops/drift-detection.service.ts
  - apps/api/src/gitops/drift-detection.service.spec.ts
updated_at: 2026-06-15T19:45:00.000Z
---

# Probe Result: GitOps Reconciliation Core

## Narrative Summary

The GitOps Reconciliation Core scope is **substantially implemented**. The 17 source files (10 production + 7 spec) provide a complete, well-tested pipeline covering the four core reconciliation primitives — `plan` (read-only diff), `apply` (transactional mutate), `detectDrift` (drift classification), and a periodic `GitOpsReconciliationLoop` tick driver. The orchestrator (`ReconciliationService`) composes five collaborators: `DesiredStateLoaderService` (git clone + validate), `ActualStateReaderService` (DB read of nodes/roles/assignments), `ReconciliationDiffService` (plan computation), `ReconciliationApplyService` (DB write), and `DriftDetectionService` (drift classification). All services are wired into `GitOpsModule` and the orchestrator is exported for use by the controller and `GitOpsInboundReconcileService`.

The diff engine implements a comprehensive set of safety guards: never touches unmanaged objects (even when they appear in desired-state), downgrades deletions to noop when `prune` is false or when the node is locked or has foreign descendants, blocks locked updates, and reconciles conflicts between inbound desired-state and outbound pending changes (a `baseRevision === lastAppliedRevision` match lets the inbound change proceed). Apply runs inside a single `dataSource.transaction`, writes a `GitOpsReconcile` audit row per non-noop change, supports `dryRun`, and dispatches per-type handlers via the `GitOpsObjectRegistryService` for `role_assignment`/`workflow`/`agent_profile`/`skill`, with direct SQL for `scope_node`/`role`.

## Capability Updates

- **Reconciliation orchestrator (`ReconciliationService`)** — implemented. Three public methods (`plan`, `apply`, `detectDrift`) all share a private `loadAndDiff` helper that materializes the desired → actual → plan → object-map pipeline once and forwards to the appropriate downstream. Constructor-injected collaborators enable straightforward mocking in the 4 spec tests.
- **Plan computation (`ReconciliationDiffService.computePlan`)** — implemented and exhaustively tested (11 spec cases). Produces a `ReconciliationPlan { changes, summary }` with sorted changes (scope_node → role → role_assignment → workflow → agent_profile → skill → config_override, deletes last and in reverse order), per-op summary, and field-level diffs.
  - Skips desired-state objects that exist in DB under non-gitops ownership (cannot claim ownership of manually-managed objects).
  - Honors `prune` flag and refuses to delete locked or foreign-descendant nodes.
  - Marks `lock`-blocked updates as `noop` with `skippedReason: 'object is locked'`.
  - Detects pending outbound-change conflicts and downgrades to `noop` with `conflict: true` and `skippedReason: 'pending outbound change requires review'`, unless the pending change is based on the current `lastAppliedRevision`.
- **Apply (`ReconciliationApplyService.apply`)** — implemented with a single transaction wrapping all non-noop changes, audit logging per change (`event_type: 'GitOpsReconcile'`, action = op, metadata = `{ type, key, diff }`), and `dryRun` short-circuit (no transaction, no writes, no audit, `planned = actionable.length`).
  - Per-type dispatch: `scope_node` and `role` use direct SQL with whitelisted column lists (`SCOPE_NODE_ALLOWED_COLUMNS`, `ROLE_ALLOWED_COLUMNS`); all others delegate to `GitOpsObjectRegistryService.getHandler(...).apply(...)`.
  - `scope_node` create uses `ScopeService.createNode` and patches `managed_by = 'gitops'` post-create (since `CreateScopeNodeInput` has no `managedBy` field).
  - **Partial gap**: `applyOverride` is a stub that throws `Error('config_override apply not yet implemented for key: ...')` for any `config_override` change. The diff engine produces these changes; the applier does not.
- **Drift classification (`DriftDetectionService.classify`)** — implemented as a stateless pure function from `ReconciliationPlan` → `DriftReport`. Mapping: `create → git_only`, `delete → db_only`, `update → field_divergence`, `noop` with `skippedReason` → `field_divergence` (desired diverges but could not be applied). True `noop` (no `skippedReason`) counts as `inSync`.
- **Reconciliation loop (`GitOpsReconciliationLoop`)** — implemented as a standalone class with `start()`/`stop()` and a private `runTickGuarded()` that prevents overlapping ticks and uses `setTimeout(...).unref?.()` so timers never keep the Node process alive. `scheduleNext` re-checks `isEnabled()` between ticks so a runtime toggle cleanly stops the loop. Logger warnings are emitted for overlapping ticks and for thrown errors. **Partial gap**: the class is not registered as a provider in `GitOpsModule` and is not instantiated anywhere in the production tree — only the two spec tests construct it. The `GitOpsConfig` provider does include `intervalMs`, but no module-level lifecycle hook (e.g. `OnModuleInit`) starts the loop.
- **Shared types (`reconciliation.types.ts`)** — implemented: `ReconcileOp`, `DesiredObject`, `ActualObject`, `ReconcileChange`, `ReconciliationPlan`, `DesiredState`, `ActualState`, `DriftCategory`, `DriftReport`. Used uniformly across the diff/apply/drift services and tests. The `hasForeignDescendants` field is populated by `ActualStateReaderService` and consumed by the diff engine's `pruneGuard`.
- **Type guards / constants (`gitops.constants.ts`)** — implemented. `GITOPS_MANAGED_BY = 'gitops'`, `RECONCILE_OBJECT_TYPES` (7 entries), `RECONCILE_ORDER`, `isReconcileObjectType`, `reconcileKey(type, key) => '${type}::${key}'` (used consistently as the composite identity across desired/actual/diff).
- **Module wiring** — confirmed in `gitops.module.ts`: all five core collaborators + the orchestrator are provided; `ReconciliationService` is exported for the controller and `GitOpsInboundReconcileService`. `GITOPS_CONFIG` is provided via factory from `ConfigService` with `enabled/repoUrl/ref/intervalMs` keys. `gitops.module.spec.ts` verifies DI resolution.

## Health Findings

- **Test coverage is high and well-structured**: 7 spec files cover the 10 production files (every production source has at least one adjacent `*.spec.ts`).
  - `reconciliation-diff.service.spec.ts` — 11 cases including the trickiest paths: unmanaged objects in both actual and desired, prune guard, ordering, summary counts, and pending-change conflicts (with both a `baseRevision` mismatch and a `baseRevision === lastAppliedRevision` match).
  - `reconciliation-apply.service.spec.ts` — 4 cases covering transactional grouping, audit-log cardinality, rollback propagation through the `dataSource.transaction` callback, and dry-run.
  - `reconciliation.service.spec.ts` — 4 cases asserting that `plan()` never calls `apply.apply`, that `apply()` does, that `reader.read` is passed the desired keys (foreign-descendant detection), and that `detectDrift()` returns a `DriftReport` without applying.
  - `drift-detection.service.spec.ts` — 3 cases covering op→category mapping, diff propagation, and the `skippedReason` carve-out (must not count as `inSync`).
  - `gitops-reconciliation-loop.spec.ts` — 2 cases: disabled start does not call `runTick`, and an in-flight tick blocks an overlapping second call.
  - `reconciliation.types.spec.ts` — 3 cases for the constants used by the diff engine (despite the file name, this is a constants spec).
  - `gitops.module.spec.ts` — 1 case asserting DI resolution of the orchestrator and diff service.
- **Integration coverage exists but is gated** — `reconciliation.integration.spec.ts` is `describe.skipIf(!DB_AVAILABLE)`, where `DB_AVAILABLE = Boolean(process.env['DATABASE_URL'])`. Without a live Postgres, the integration scenarios (plan, detectDrift, prune:empty, org-only prune) are not exercised. The integration spec uses a hand-wired `TestingModule` rather than the full `GitOpsModule`, so a real Postgres run would also require a test database with `scope_nodes`/`roles`/`role_assignments` tables.
- **Code quality** — the four core services are single-responsibility, constructor-injected, and free of side effects in their public surface (audit log and DB writes are isolated inside `apply`). The diff engine's `withPendingConflict` and `pruneGuard` helpers are tight and well-commented. The apply service uses allowed-column whitelists (`SCOPE_NODE_ALLOWED_COLUMNS`, `ROLE_ALLOWED_COLUMNS`) and a `toColumn` camelCase→snake_case mapper to keep user-controlled field names out of SQL identifiers. The `unref?.()` on the loop timer is a thoughtful testability touch.
- **Churn** — file mtimes in this scope cluster around 2026-06-12 to 2026-06-15, consistent with the 204I (reconciliation) and 204J (status/binding) milestones mentioned in the existing `gitops.md` probe. No files in this scope appear stale.
- **Architectural consistency** — the `ReconciliationService` orchestrator and `GitOpsInboundReconcileService` both call into the same `ReconciliationDiffService` and `ReconciliationApplyService`; both build a `(desiredObjects, actualObjects)` map keyed by `reconcileKey(type, key)`. The `apply()` flow at the `ReconciliationService` level is a thin wrapper that hardcodes `dryRun: false`; the `GitOpsInboundReconcileService` is the binding-aware caller that passes `bindingId` and `conflictPolicy` and also runs the plan through conflict-detection before applying.
- **Risks / partials**:
  - The reconciliation loop class is implemented with tests but **not wired** into the module — there is no scheduled reconcile tick in the running application today.
  - `config_override` apply is a stub that throws — diffs and drift reports will surface these as `field_divergence`/`create`/`delete`/`noop` but the apply path will fail until the handler is implemented.

## Open Questions

- Whether the `GitOpsReconciliationLoop` is intended to be wired up via a lifecycle hook (e.g. `OnModuleInit` in a separate `GitOpsLoopService`) or whether scheduling has been intentionally deferred. The class and its spec are present, the `intervalMs` config exists, but no provider or lifecycle wiring exists in `GitOpsModule`.
- Whether `config_override` apply is intentionally deferred to a later milestone or blocked on a design decision (override source policy, conflict policy, and merge/replace semantics live in `packages/gitops-contracts/overrides.schema.ts` but are not yet exercised end-to-end).
- Whether the integration test (`reconciliation.integration.spec.ts`) is exercised in CI — the `DATABASE_URL` gate means it is silently skipped in any environment without a Postgres reachable, and the spec uses a standalone `DataSource` factory rather than the shared test database setup in `testing/`.
- Whether the `ReconciliationService.apply()` thin wrapper (which hardcodes `dryRun: false`) is intended to remain, or whether all apply flows are expected to go through `GitOpsInboundReconcileService.apply()` (which does pass `bindingId`/`conflictPolicy` and is the only path that records a `GitOpsReconcileRun` row).
- Whether the `apply()` transaction's per-change audit-log pattern is sufficient for forensic needs — the audit row is written *after* the DB write succeeds, so a crash between the write and the audit would leave a silent change. This is consistent with the documented design but is a latent gap worth confirming.
- Whether the diff engine's silent skip of desired-state objects that exist in DB under non-gitops ownership is the desired UX — the comment says "intentionally skipped with no output", but a real reconcile against a polluted DB could mask ownership conflicts from operators.
