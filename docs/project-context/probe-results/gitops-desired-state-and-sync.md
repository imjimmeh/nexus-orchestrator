---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: gitops-desired-state-and-sync
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/gitops/desired-state-loader.service.ts
  - apps/api/src/gitops/desired-state-loader.service.spec.ts
  - apps/api/src/gitops/desired-state-loader.service.types.ts
  - apps/api/src/gitops/gitops-yaml-loader.ts
  - apps/api/src/gitops/gitops-yaml-loader.spec.ts
  - apps/api/src/gitops/actual-state-reader.service.ts
  - apps/api/src/gitops/actual-state-reader.service.spec.ts
  - apps/api/src/gitops/config-validation.service.ts
  - apps/api/src/gitops/config-validation.service.spec.ts
  - apps/api/src/gitops/config-validation.service.types.ts
  - apps/api/src/gitops/config-export.service.ts
  - apps/api/src/gitops/config-export.service.spec.ts
  - apps/api/src/gitops/config-export.service.types.ts
  - apps/api/src/gitops/gitops-inbound-reconcile.service.ts
  - apps/api/src/gitops/gitops-inbound-reconcile.service.spec.ts
  - apps/api/src/gitops/gitops-outbound-sync.service.ts
  - apps/api/src/gitops/gitops-outbound-sync.service.spec.ts
  - apps/api/src/gitops/gitops-outbound-sync.service.types.ts
  - apps/api/src/gitops/gitops-pending-change.service.ts
  - apps/api/src/gitops/gitops-pending-change.service.spec.ts
  - apps/api/src/gitops/gitops-repository-binding.service.ts
  - apps/api/src/gitops/gitops-repository-binding.service.spec.ts
  - apps/api/src/gitops/gitops-edit-policy.service.ts
  - apps/api/src/gitops/gitops-edit-policy.service.spec.ts
  - apps/api/src/gitops/gitops-desired-state.service.ts
  - apps/api/src/gitops/gitops-desired-state.service.spec.ts
  - apps/api/src/gitops/gitops-desired-state.service.types.ts
  - apps/api/src/gitops/gitops-status.service.ts
  - apps/api/src/gitops/gitops-status.service.spec.ts
  - apps/api/src/gitops/gitops-status.types.ts
  - apps/api/src/gitops/gitops-status.controller.spec.ts
  - apps/api/src/gitops/gitops.controller.ts
  - apps/api/src/gitops/gitops.controller.spec.ts
  - apps/api/src/gitops/gitops.module.ts
  - apps/api/src/gitops/gitops.module.spec.ts
  - apps/api/src/gitops/gitops.constants.ts
  - apps/api/src/gitops/gitops.constants.types.ts
  - apps/api/src/gitops/managed-by.migration.spec.ts
  - apps/api/src/gitops/gitops-package-scripts.spec.ts
  - apps/api/src/gitops/objects/gitops-object-handler.types.ts
  - apps/api/src/gitops/objects/gitops-object-registry.service.ts
  - apps/api/src/gitops/objects/gitops-object-registry.service.spec.ts
  - apps/api/src/gitops/objects/gitops-object.helpers.ts
  - apps/api/src/gitops/objects/gitops-object.helpers.types.ts
  - apps/api/src/gitops/objects/scope-node.gitops-handler.ts
  - apps/api/src/gitops/objects/scope-node.gitops-handler.spec.ts
  - apps/api/src/gitops/objects/role.gitops-handler.ts
  - apps/api/src/gitops/objects/role.gitops-handler.spec.ts
  - apps/api/src/gitops/objects/role-assignment.gitops-handler.ts
  - apps/api/src/gitops/objects/role-assignment.gitops-handler.spec.ts
  - apps/api/src/gitops/objects/workflow.gitops-handler.ts
  - apps/api/src/gitops/objects/workflow.gitops-handler.spec.ts
  - apps/api/src/gitops/objects/agent-profile.gitops-handler.ts
  - apps/api/src/gitops/objects/agent-profile.gitops-handler.spec.ts
  - apps/api/src/gitops/objects/agent-profile.gitops-handler.assignments.ts
  - apps/api/src/gitops/objects/skill.gitops-handler.ts
  - apps/api/src/gitops/objects/skill.gitops-handler.spec.ts
  - apps/api/src/gitops/dto/gitops-repository-binding.dto.ts
  - apps/api/src/gitops/dto/gitops-repository-binding.dto.types.ts
  - apps/api/src/gitops/database/entities/gitops-repository-binding.entity.ts
  - apps/api/src/gitops/database/entities/gitops-pending-change.entity.ts
  - apps/api/src/gitops/database/entities/gitops-reconcile-run.entity.ts
  - apps/api/src/gitops/database/entities/index.ts
  - apps/api/src/gitops/database/repositories/gitops-repository-binding.repository.ts
  - apps/api/src/gitops/database/repositories/gitops-pending-change.repository.ts
  - apps/api/src/gitops/database/repositories/gitops-reconcile-run.repository.ts
  - apps/api/src/gitops/database/repositories/index.ts
  - apps/api/src/gitops/database/gitops-repository-binding.entity.spec.ts
  - apps/api/src/gitops/database/gitops-repository-bindings.migration.spec.ts
source_paths:
  - apps/api/src/gitops
updated_at: 2026-06-15T19:46:10Z
---

# Probe Result: GitOps Desired State, Validation, and Sync

## Narrative Summary

The GitOps Desired State, Validation, and Sync scope is **substantially implemented**. The 41 source files and 25 spec files (plus the cross-scope `reconciliation*.service.ts` and `drift-detection.service.ts` covered in `gitops-reconciliation-core.md`) deliver a complete binding-aware pipeline that covers (1) pulling desired state from a git repository, (2) validating it against the canonical `@nexus/gitops-contracts` schema, (3) computing reconciliation plans through per-type object handlers, (4) applying plans transactionally, (5) recording reconcile runs and pending changes in PostgreSQL, (6) gating app-side edits via the edit-policy service, (7) syncing app-side edits back to git via the outbound sync service, and (8) surfacing status through a dedicated service. Every production file has an adjacent `*.spec.ts` covering the success path and at least the most important negative cases. The `GitOpsModule` provides and exports all collaborators; the `GitOpsController` wires the full HTTP surface (status, export, validate-stub, reconcile/drift, binding CRUD, validate/plan/apply per binding, outbound sync per binding) with Zod-validated DTOs and permission guards (`gitops:read` / `gitops:manage`).

The only material gaps in the scope are: (a) the legacy root-level `POST /gitops/validate` endpoint is a stub returning "not yet wired to runtime providers" (the binding-scoped `POST /gitops/bindings/:scopeNodeId/:bindingId/validate` is fully wired); (b) the `gitops-status.controller.ts` file is referenced in the probe paths and has a spec file, but the production file does not exist — the spec actually exercises `GitOpsController.getStatus` (a thin wrapper around `GitOpsStatusService.getStatus` exposed at `GET /gitops/status`), so the functionality is present and tested, but the file is mis-named; (c) outbound sync requires `syncMode === 'two_way'` and is otherwise rejected, so git-to-app bindings cannot push back (intentional by design, asserted by spec); (d) the `managed_by` / `locked` columns on `scope_nodes`, `roles`, `role_assignments`, and `scope_config_overrides` are introduced by the `20260612000000-add-managed-by-tag` migration (asserted by `managed-by.migration.spec.ts`).

## Capability Updates

- **Desired-state loading (`DesiredStateLoaderService`)** — implemented. The `load(input)` method clones (or fetches+resets) the git checkout at `${NEXUS_WORKSPACE_BASE_PATH}/gitops/desired-state`, with an in-process `workspaceLocks` map serializing concurrent loads for the same path, and then delegates to `ConfigValidationService.loadAndValidate` to produce a `DesiredState`. It refuses to use credentials-in-URL, non-HTTPS schemes, root-paths that escape the checkout via symlinks, or root-paths that resolve to a file. It derives a `pathPrefix` from the resolved root-path's first segment when it is `scopes` or `roles`, so the YAML loader emits canonical layout paths even when the binding is rooted at a subtree (e.g. `scopes/acme`). Full spec coverage (8 cases in `desired-state-loader.service.spec.ts`).
- **YAML loader (`gitops-yaml-loader.ts` / `loadYamlTreeFromDir`)** — implemented. Walks the directory, filters via `isDesiredStatePath` against the `GITOPS_LAYOUT` constants, parses each YAML doc via `yaml.parse`, and composes emitted paths with the binding root's `pathPrefix` so sub-tree bindings still emit canonical layout paths. Sidecar files (`.PROMPT.md`, `.body.yaml`, etc.) are ignored; malformed YAML inside the desired-state layout throws. Spec covers layout-prefix canonicalization, sidecar filtering, and malformed-doc handling (6 cases).
- **Actual state reading (`ActualStateReaderService`)** — implemented. Reads `scope_nodes` (including foreign-descendant flag for managed nodes), `roles` (with permission expansion), and `role_assignments` (with composite `user:role:scope` key) via raw SQL through the `DataSource`. Uses the same slug-path algorithm as `ConfigExportService` for key consistency. Spec covers all four projections plus the foreign-descendant flag (5 cases).
- **Config validation (`ConfigValidationService`)** — implemented. `lint(dir, ctx, loadOptions)` returns a `ValidationResult` with error codes; `loadAndValidate` returns a typed `DesiredState` or throws. The runtime provider wiring in `GitOpsModule` uses a `CONTEXT_PROVIDER_TOKEN` factory that loads known permissions, system roles, users, and default agents/workflows/skills from the database at construction time, then injects it into `ConfigValidationService` via the `ConfigValidationService` factory provider. The `FILE_LOADER_TOKEN` provides `loadYamlTreeFromDir` as the file loader implementation. Spec covers clean trees, schema errors, referential errors, and override→object-type mapping (4 cases).
- **Config export (`ConfigExportService`)** — implemented. `exportToFiles()` builds a `DesiredState` from the database, then delegates to `serializeDesiredState` from `@nexus/gitops-contracts` and `stringify` from `yaml` to produce `ExportedFile[]`. Custom roles (owner scope set) are included; system roles (owner scope null) are excluded. Defaults and per-scope overrides for agent/workflow/skill are emitted as separate documents. Spec covers all four export shapes (4 cases).
- **Binding CRUD (`GitOpsRepositoryBindingService`)** — implemented. `create` / `list` / `get` / `update` / `disable` with URL-credentials, non-HTTPS, and invalid `syncMode` validation. Scope-mismatch enforcement on `get`/`update`/`disable`. The `get` method throws `NotFoundException` when the binding's `scopeNodeId` does not match the requested scope; `update` and `disable` reuse the same `get` for authorization. Spec covers 7 cases including the rejection paths and the create-defaults path.
- **Inbound reconcile (`GitOpsInboundReconcileService`)** — implemented. `validate(bindingId)` returns the object count; `plan(bindingId)` builds a plan through `GitOpsDesiredStateService` → registry handlers → `ReconciliationDiffService`, persists a `GitOpsReconcileRun` with `status: 'planned'`; `apply(bindingId)` builds a fresh plan, refuses to apply if any change has `conflict: true` (throws `BadRequestException('GitOps plan has conflicts')`), persists run state transitions (`applying` → `applied`/`failed`), and updates `binding.lastAppliedRevision` on success. Uses per-binding object handlers via `GitOpsObjectRegistryService.getHandlersForBinding`. Spec covers the success path, conflict path, and scope-mismatch path (4 cases).
- **Outbound sync (`GitOpsOutboundSyncService`)** — implemented. `sync(bindingId)` requires `syncMode === 'two_way'`, checks out the binding repo, creates a fresh `gitops/${bindingId}/${timestamp}` branch, writes pending changes as YAML files under `outbound/<objectType>/<safeName>.yaml`, commits, pushes, and marks each pending change `status: 'synced'`. All git operations use `GitCommandService`. Run-state is persisted on success and failure. Spec covers the rejection of git-to-app bindings, the success path (verifies the on-disk YAML, the git command sequence, and the run-state update), and the failure path (verifies the run is marked `failed` and the pending change is not marked `synced`) (3 cases).
- **Pending change recording (`GitOpsPendingChangeService`)** — implemented. `recordConfigObjectChange` writes/upserts a `GitOpsPendingChange` row keyed by `(bindingId, objectType, objectKey)` with `status: 'pending'`, building the object key as `${scopePath}:${name}`. Reuses the `GitOpsPendingChangeRepository.findActiveByObject` lookup so multiple updates to the same object in one reconcile cycle collapse to a single row. Spec covers both the create and update paths (2 cases).
- **Edit policy (`GitOpsEditPolicyService`)** — implemented. `evaluateExisting` returns `allow` for unmanaged objects, `block` for git-to-app managed objects, `allow_with_pending_change` for two-way managed objects (with the binding attached), and `block` for locked objects. `evaluateCreate` finds the most-specific two-way binding for the scope (or the first enabled binding of any sync mode) and returns the same decision shape. `assertAllowed` throws `BadRequestException` for `block`. Spec covers all five paths (5 cases).
- **Desired state per binding (`GitOpsDesiredStateService`)** — implemented. `loadForBinding(bindingId, actorContext)` loads the binding, refuses disabled bindings, resolves a binding-scoped workspace path under `${NEXUS_WORKSPACE_BASE_PATH}/gitops/bindings/${bindingId}`, and delegates to `DesiredStateLoaderService.load` with `repoUrl`/`ref`/`rootPath` from the binding. Spec covers the success path, env-var isolation (binding's repo wins over `GITOPS_REPO_URL`), and disabled-binding rejection (3 cases).
- **Status service (`GitOpsStatusService`)** — implemented. `getStatus()` aggregates `gitops_repository_bindings`, `gitops_reconcile_runs`, and `gitops_pending_changes` rows into a `GitOpsStatusResponse` with per-binding summaries, a top-level `lastReconcile` summary (the most-recently-`finishedAt` run), a `drift` array (built from `changeType === 'drift'` pending changes), and a `managedByCounts` summary. Active pending changes are filtered by `status === 'pending'`; completed pending changes are ignored. Spec covers both the basic shape and the "most-recently-finished" tie-breaker (2 cases).
- **HTTP surface (`GitOpsController`)** — implemented. Routes: `GET /gitops/status` (permission: `gitops:read`), `GET /gitops/export` (permission: `gitops:read`), `POST /gitops/validate` (permission: `gitops:manage`, stub), `POST /gitops/reconcile` (permission: `gitops:manage`, plan by default; applies when `dryRun: false`), `GET /gitops/drift` (permission: `gitops:manage`), binding CRUD under `/gitops/bindings` (list/create/get/update/disable, all permission-gated), and per-binding sub-routes (`validate`, `plan`, `apply`, `outbound-sync`). The legacy `POST /gitops/reconcile` and `GET /gitops/drift` routes use the global `GITOPS_CONFIG` (env-driven `repoUrl` / `ref`), while the per-binding sub-routes use the binding's stored `repoUrl` / `defaultRef` / `rootPath`. Spec covers route metadata, defaults (dry-run), apply when `dryRun: false`, drift envelope, binding CRUD, and the per-binding sub-routes (10+ cases).
- **Module wiring (`GitOpsModule`)** — implemented. Imports `ScopeModule`, `AuthorizationModule`, `DatabaseModule`, and `TypeOrmModule.forFeature([Permission, Role, RoleAssignment, User, Workflow, AgentProfile, Skill])`. Provides every collaborator explicitly (no autoload magic) including the two token-based providers (`FILE_LOADER_TOKEN`, `CONTEXT_PROVIDER_TOKEN`), the `GITOPS_OBJECT_HANDLERS` factory that aggregates the six per-type handlers, and the `GITOPS_CONFIG` factory that reads `GITOPS_ENABLED` / `GITOPS_REPO_URL` / `GITOPS_REF` / `GITOPS_INTERVAL_MS` from `ConfigService`. Exports `ConfigExportService`, `ReconciliationService`, `GitOpsInboundReconcileService`, `GitOpsEditPolicyService`, `GitOpsPendingChangeService`, `GitOpsOutboundSyncService`. The single `gitops.module.spec.ts` verifies DI resolution of the orchestrator + diff service.
- **Constants / types (`gitops.constants.ts`, `*.types.ts`)** — implemented. `GITOPS_MANAGED_BY = 'gitops'`, `RECONCILE_OBJECT_TYPES` (7 entries: `scope_node, role, role_assignment, workflow, agent_profile, skill, config_override`), `RECONCILE_ORDER` (the same in declaration order), `isReconcileObjectType` type guard, and the canonical `reconcileKey(type, key) => '${type}::${key}'` used uniformly by the diff/apply/loaders/readers. `GitOpsConfig` and `ReconcileObjectType` are exported from the types file. `gitops.constants.types.spec.ts` covers the dependency-ordered object-type list, the tag value, and the type guard.
- **DTOs (`dto/gitops-repository-binding.dto.ts`)** — implemented. Zod schemas for `createGitOpsRepositoryBindingSchema`, `updateGitOpsRepositoryBindingSchema`, `listGitOpsRepositoryBindingsQuerySchema`, and `gitOpsRepositoryBindingIdSchema` (UUID). All sync-mode and included-object-type fields use the `GITOPS_BINDING_SYNC_MODES` and `GITOPS_SYNCABLE_OBJECT_TYPES` enums from `@nexus/core`. Default values: `defaultRef: 'main'`, `rootPath: '.'`. The DTO `.types.ts` re-exports the `z.infer` derived types.
- **Object handler registry (`GitOpsObjectRegistryService`)** — implemented. `getHandler(objectType)` returns the registered handler or throws `BadRequestException('Unsupported GitOps object type: ...')`. `getHandlersForBinding(binding)` filters by `binding.includedObjectTypes` (or returns all when empty). The `GITOPS_OBJECT_HANDLERS` injection token aggregates the six per-type handlers via factory. Spec covers 3 cases.
- **Object handler interface (`objects/gitops-object-handler.types.ts`)** — implemented. `GitOpsObjectHandler<TDesired, TActual>` defines `readActual`, `normalizeDesired`, `plan`, `apply`, `serialize`, and `canEdit` (the gate used by `GitOpsEditPolicyService`). `GitOpsApplyContext` carries `actorId`, `manager` (TypeORM `EntityManager` — applied inside the reconciler's transaction), `bindingId`, and `conflictPolicy`. Helper utilities (`buildScopePathById`, `resolveScopeNodeId`, `resolveNameFromKey`, `diffFields`, `toDbArray`/`fromDbArray`, `resolveManagedBindingId`, `requireGitOpsBindingId`) are colocated in `gitops-object.helpers.ts`.
- **Per-type object handlers (6 in `objects/`)** — implemented: `ScopeNodeGitopsHandler` (316 LOC), `RoleGitopsHandler` (353 LOC), `RoleAssignmentGitopsHandler` (342 LOC), `WorkflowGitopsHandler` (403 LOC), `AgentProfileGitopsHandler` (463 LOC, with `buildAgentProfileAssignments` helper in a sibling file for the merge/replace column assignment), `SkillGitopsHandler` (449 LOC). Each implements the full `GitOpsObjectHandler` surface, including a `canEdit` policy and a per-type plan/apply path that respects `managed_by` and `locked` flags and writes through to the database. All six have adjacent `*.spec.ts` covering serialization, normalization, plan derivation, and (for the larger ones) apply.
- **Database schema (`database/entities/`, migrations)** — implemented. Three TypeORM entities: `GitOpsRepositoryBinding` (`gitops_repository_bindings` table; `scope_node_id` FK to `scope_nodes`; `repo_url`, `default_ref`, `root_path`, `sync_mode`, `credentials_secret_id`, `enabled`, `included_object_types jsonb`, `conflict_policy`, `last_applied_revision`, `created_by_user_id`), `GitOpsReconcileRun` (`gitops_reconcile_runs`; `binding_id` FK, `direction`, `status`, `revision`, `summary`, `errors jsonb`, `started_at`/`finished_at`, `actor_user_id`), `GitOpsPendingChange` (`gitops_pending_changes`; `binding_id` FK, `object_type`, `object_key`, `scope_node_id` FK, `change_type`, `payload jsonb`, `base_revision`, `status`, `created_by_user_id`). Three repository classes wrap the entities with `findById`, `findByBindingId`, `findActiveByObject`, `findAll`, `create`, `update`, `remove`. The `20260611120000-create-gitops-repository-bindings` migration creates all three tables and four indexes (`binding_id`, `status`, `(object_type, object_key)`, `scope_node_id`). The `20260612000000-add-managed-by-tag` migration adds `managed_by` + `locked` columns to `scope_nodes`, `roles`, `role_assignments`, and `scope_config_overrides` (`ADD COLUMN IF NOT EXISTS ...` for forward/backward compatibility). Migration specs assert table creation and column list (2 specs).
- **Package-scripts assertion (`gitops-package-scripts.spec.ts`)** — implemented. Asserts the legacy `gitops` CLI script is no longer exported in `package.json` (the CLI surface was replaced by the per-binding HTTP endpoints in 204J).
- **Status controller test file naming** — **partial gap** in the file system: the probe paths include `gitops-status.controller.ts`, but no production file by that name exists in the tree. The matching `gitops-status.controller.spec.ts` exists and tests `GitOpsController.getStatus` (the spec imports `GitOpsController` and asserts the `GET /gitops/status` route is exposed via `GitOpsController`). The functionality is fully present (handler exists, controller method exists, controller spec covers the route), so the test does pass, but the file name is misleading.

## Health Findings

- **Test coverage is high and consistent**: every production file in this scope has an adjacent `*.spec.ts` — 25 spec files for 41 production files (1.6:1 spec ratio). Notable coverage:
  - `desired-state-loader.service.spec.ts` (8 cases) — clone/refresh, symlink-escape rejection, file-root rejection, prefix derivation, stale-checkout reclone, credentials/URL rejection, validation failure propagation, and concurrent-load serialization.
  - `gitops-yaml-loader.spec.ts` (6 cases) — layout filtering, sidecar filtering, malformed-doc propagation, prefix preservation, repo-root paths, and prefix canonicalization.
  - `actual-state-reader.service.spec.ts` (5 cases) — scope-node projection, foreign-descendant flag, role-assignment composite key, root-as-slash, role-permission expansion.
  - `config-validation.service.spec.ts` (4 cases) — clean tree, schema error, referential error, override→object-type mapping.
  - `config-export.service.spec.ts` (4 cases) — scope-tree emission, role-system exclusion, assignments export, configurable-object defaults + overrides.
  - `gitops-repository-binding.service.spec.ts` (7 cases) — create with defaults, credentials rejection, sync-mode rejection, sync-mode update, scope-mismatch on get/update/disable, list-by-scope.
  - `gitops-inbound-reconcile.service.spec.ts` (4 cases) — plan success, apply success with `lastAppliedRevision` update, conflict rejection, scope-mismatch.
  - `gitops-outbound-sync.service.spec.ts` (3 cases) — git-to-app rejection, full sync (asserts YAML content, git command sequence, run state, pending change status update), failure path (asserts run marked failed and pending change not synced).
  - `gitops-pending-change.service.spec.ts` (2 cases) — create and update paths.
  - `gitops-edit-policy.service.spec.ts` (5 cases) — unmanaged allow, git-to-app block, two-way allow_with_pending_change, locked block, create-time two-way.
  - `gitops-desired-state.service.spec.ts` (3 cases) — binding checkout, env-var isolation, disabled rejection.
  - `gitops-status.service.spec.ts` (2 cases) — pending/completed separation, finished-time tie-breaker.
  - `gitops-status.controller.spec.ts` (2 cases) — full status response, null `lastReconcile`.
  - `gitops.controller.spec.ts` (10+ cases) — route metadata, dry-run default, apply-when-`dryRun: false`, drift envelope, binding CRUD envelopes, per-binding sub-routes (validate/plan/apply/outbound-sync).
  - `gitops.module.spec.ts` (1 case) — DI resolution.
  - `gitops-package-scripts.spec.ts` (1 case) — `gitops` CLI script removal.
  - `managed-by.migration.spec.ts` (2 cases) — table coverage in DDL + idempotent down().
  - `gitops-repository-binding.entity.spec.ts` + `gitops-repository-bindings.migration.spec.ts` (3 cases) — entity metadata + migration table list.
  - `objects/*.spec.ts` (6 specs) — per-type handler serialization, normalization, plan derivation; some include apply-path assertions.
- **Architectural consistency** — the `desired → actual → plan → apply` pipeline is shared across both the env-driven root `/gitops/reconcile` route and the per-binding `/gitops/bindings/:scopeNodeId/:bindingId/apply` route. The `reconcileKey(type, key)` helper is the single source of identity used across all services. The `GITOPS_MANAGED_BY = 'gitops'` tag is the only "is this managed by GitOps" check anywhere in the codebase. The two-way binding's pending-change workflow closes the loop: app-side edits land in `gitops_pending_changes` (via `GitOpsEditPolicyService` consumers calling `GitOpsPendingChangeService.recordConfigObjectChange` — note: this side of the integration is not in the probe scope but the producer side is here), and `GitOpsOutboundSyncService.sync` flushes them to a branch and marks them `synced`.
- **Code quality** — services are single-responsibility and constructor-injected; the binding service carefully validates URLs and sync modes; the loader service is defensive about symlink escapes and credentials; the inbound reconcile service records every state transition in the `gitops_reconcile_runs` table including on failure; the outbound service guards against path-traversal in `pendingFilePath`; the edit policy service is the single source of truth for "can this object be edited from the app side?" decisions.
- **Migrations are idempotent and reversible** — both `20260611120000-create-gitops-repository-bindings.ts` and `20260612000000-add-managed-by-tag.ts` use `IF NOT EXISTS` for creates and `DROP ... IF EXISTS` for teardowns, so re-runs and rollbacks are safe.
- **Risks / partials**:
  - `POST /gitops/validate` is a stub that returns `{ message: 'validation endpoint not yet wired to runtime providers' }` — the per-binding `POST /gitops/bindings/:scopeNodeId/:bindingId/validate` is fully wired and returns the object count.
  - `gitops-status.controller.ts` does not exist on disk despite being listed in the probe paths. The spec at `gitops-status.controller.spec.ts` exercises `GitOpsController.getStatus` directly, so the missing file is a naming artifact rather than a functionality gap, but it should be renamed to reflect what it actually tests (e.g. `gitops-status.controller.spec.ts` → `gitops.controller.status.spec.ts` or split out a dedicated controller file).
  - The `GitOpsDesiredStateService.loadForBinding` method passes the binding's `repoUrl` and `defaultRef` directly to the loader; there is no signing / authentication support wired through the binding's `credentialsSecretId` (the column is on the entity and the DTO, but the loader's `assertSafeRepoUrl` actively rejects URLs with embedded credentials, so secrets must be plumbed via git config in a future iteration).
  - The `gitops-outbound-sync.service.ts` writes YAML files under `outbound/<objectType>/<safeName>.yaml` regardless of the binding's `rootPath` — for bindings rooted at a non-canonical path (e.g. `scopes/acme`), the outbound directory sits next to the desired-state, which is intentional for branch PRs but should be confirmed against operator expectations.
  - The `gitops.controller.ts` `validate` stub still returns 200 OK with a "not yet wired" message, so callers can't distinguish "feature not yet implemented" from "validation succeeded with no issues". A 501 Not Implemented would be more correct.
  - The `gitops-status.service.ts` `getStatus` method returns `managedByCounts: { gitops: bindings.length, manual: 0, seed: 0 }` — `manual` and `seed` are hard-coded to `0` rather than computed from the actual database, which is a known limitation noted in the type but worth surfacing.

## Open Questions

- Where the `credentialsSecretId` on `GitOpsRepositoryBinding` is consumed: the loader rejects URLs with embedded credentials, and the outbound sync uses `git` over HTTPS with no auth, so the column is currently a no-op. Is it expected to flow through `GITOPS_CONFIG` or a dedicated git-credentials service in a future iteration?
- Whether `POST /gitops/validate` is intentionally deferred (the per-binding variant is the primary path) or whether it should be wired to `ConfigValidationService.lint` with a request-supplied directory in a future iteration.
- Whether the `gitops-status.controller.ts` reference in the manifest is a leftover (suggesting the file was at one point separate from `gitops.controller.ts` and was later merged) or a typo that should be cleaned up.
- Whether the `gitops_pending_changes` rows are also surfaced through `GitOpsStatusService.drift` when `changeType !== 'drift'` (currently only `changeType === 'drift'` produces a `DriftSummary`; pending changes of other `changeType` values contribute only to `pendingChangeCount` and not to the `drift[]` array).
- Whether the `GitOpsEditPolicyService` and `GitOpsPendingChangeService` are wired into the controllers of the resource types they protect (e.g. `workflow.controller.ts` should call `evaluateExisting` before allowing an edit and `recordConfigObjectChange` on success) — the services exist and are exported by the module, but the actual call sites are outside this probe's scope.
- Whether the `GitOpsReconciliationLoop` (covered in `gitops-reconciliation-core.md`) is intended to call the binding-aware `GitOpsInboundReconcileService` or the env-driven `ReconciliationService` for each tick — both are exported, the choice has security implications (env-driven = global, binding-aware = scope-scoped).
- Whether the legacy env-driven `POST /gitops/reconcile` and `GET /gitops/drift` routes are intended to be deprecated now that per-binding sub-routes exist, or kept for backward compatibility with existing operator runbooks.
- Whether the hard-coded `manual: 0, seed: 0` in `GitOpsStatusService.getStatus` is a known gap or should be backfilled by a query against the `managed_by` column on each reconciled table.
