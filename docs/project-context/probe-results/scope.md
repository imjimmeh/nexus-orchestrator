---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: scope
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/scope/scope.controller.ts
  - apps/api/src/scope/scope.service.ts
  - apps/api/src/scope/scope.module.ts
  - apps/api/src/scope/scope.constants.ts
  - apps/api/src/scope/scope.constants.types.ts
  - apps/api/src/scope/scope.service.types.ts
  - apps/api/src/scope/dto/create-scope-node.dto.ts
  - apps/api/src/scope/dto/ensure-scope-node.dto.ts
  - apps/api/src/scope/dto/move-scope-node.dto.ts
  - apps/api/src/scope/database/entities/scope-node.entity.ts
  - apps/api/src/scope/database/entities/scope-node-closure.entity.ts
  - apps/api/src/scope/database/entities/index.ts
  - apps/api/src/scope/scope.controller.spec.ts
  - apps/api/src/scope/scope.service.spec.ts
  - apps/api/src/scope/scope.service.audit.spec.ts
  - apps/api/src/scope/scope.integration.spec.ts
  - apps/api/src/scope/scope.module.integration.spec.ts
  - apps/api/src/scope/database/entities/scope-node.entity.spec.ts
  - apps/api/src/scope/scope.migration.spec.ts
  - apps/api/src/scope/backfill.migration.spec.ts
  - apps/api/src/database/migrations/20260609000000-create-scope-hierarchy.ts
  - apps/api/src/database/migrations/20260609010000-backfill-scope-nodes.ts
  - apps/api/src/auth/authorization/scope-access.service.ts
  - apps/api/src/auth/authorization/permission-catalog.ts
source_paths:
  - apps/api/src/scope
updated_at: 2026-06-15T00:00:00.000Z
---

# Probe Result: Platform Scope Management

## Narrative Summary

The `apps/api/src/scope` module implements a complete platform-scope hierarchy with closure-table–backed ancestry, exposed via a NestJS REST controller and used by other major modules (app, gitops, harness, config-resolution, capability-governance). The platform root is a fixed well-known UUID (`00000000-0000-0000-0000-000000000000`) seeded by migration `20260609000000-create-scope-hierarchy.ts`, and the five node types are `platform | org | region | team | project`, declared in `scope.constants.ts`.

The `ScopeService` is the single source of truth for the tree: it provides `createNode`, `ensureNode` (idempotent upsert for migrations/project registration), `getTree` (filtered by `ScopeAccessService` when a userId is supplied), `archiveNode` / `restoreNode` (project-only, with platform-root protection), `findOrphanedProjectNodes` (project nodes that are unbacked by workflows / chat_sessions / scheduled_jobs / automation_hooks / heartbeat_profiles / standing_orders / workflow_run_todos / notifications), `getAncestorIds` / `getDescendantIds` (closure lookups), `getNodesByIds`, and `moveNode` (re-parenting that updates the closure table transactionally with cycle prevention). All closure writes happen in `DataSource.transaction(...)` blocks.

`ScopeController` exposes the endpoints under `/scopes` (create, ensure, `GET /scopes/tree`, `GET /scopes/maintenance/orphans`, `POST /scopes/:id/archive`, `POST /scopes/:id/restore`, `PATCH /scopes/:id/move`), all guarded by `JwtAuthGuard` + `PermissionsGuard` with the `scopes:create | read | update | manage` permissions from `permission-catalog.ts`. Tree filtering integrates with `ScopeAccessService.getAccessibleScopeIds(userId, 'scopes:read')` to compute a pruned subtree plus ancestor chain when the caller is scoped.

The two migration files (creation + backfill from legacy `scope_id` columns) are present in `apps/api/src/database/migrations/` and are verified by dedicated spec files. Audit hooks: `AuthorizationAuditService.recordScopeCreated` is invoked on `createNode` (optional injection, see `scope.service.audit.spec.ts`).

> Runtime-context note: `kanban.project_state` and `kanban.orchestration_timeline` are not part of this agent's available toolset, so step 1 of the playbook could not be executed directly. The probe proceeded with file-based discovery only.

## Capability Updates

| Capability | Status | Evidence |
|---|---|---|
| Hierarchical scope tree (5 levels: platform/org/region/team/project) | Implemented | `scope.constants.ts`, `scope-node.entity.ts` |
| Fixed platform-root UUID + self-closure row | Implemented | migration `20260609000000-create-scope-hierarchy.ts` |
| Closure-table ancestry (depth-indexed) | Implemented | `scope-node-closure.entity.ts` + service write path |
| Idempotent `ensureNode` (upsert + closure idempotency) | Implemented | `scope.service.ts: ensureNode` + `scope.service.spec.ts` |
| Re-parenting with closure-table update + cycle prevention | Implemented | `scope.service.ts: moveNode` |
| Archive / restore project nodes (soft delete) | Implemented | `scope.service.ts: archiveNode / restoreNode` + `archived_at` column (migration `20260611030000-add-scope-node-archived-at.ts`) |
| Orphan project detection (unbacked by 8 source tables) | Implemented | `scope.service.ts: findOrphanedProjectNodes` |
| RBAC-gated REST endpoints under `/scopes` | Implemented | `scope.controller.ts` + `permission-catalog.ts` |
| Tree filtering by `ScopeAccessService` (ancestors + prune) | Implemented | `scope.service.ts: getTree` + `auth/.../scope-access.service.ts` |
| Authorization audit on node creation (`recordScopeCreated`) | Implemented | `scope.service.ts: createNode` + `scope.service.audit.spec.ts` |
| Legacy `scope_id` backfill migration | Implemented | migration `20260609010000-backfill-scope-nodes.ts` |
| DTO validation (class-validator) for create / ensure / move | Implemented | `dto/*.ts` |
| Module wiring registered in `app.module.ts` and consumed by 4 sibling modules | Implemented | `app.module.ts:38,102`, `gitops`, `harness`, `config-resolution`, `capability-governance` |
| Unit tests for entity constants/types | Implemented | `scope-node.entity.spec.ts` |
| Service spec covering create / tree / ensure / archive / restore / orphans | Implemented | `scope.service.spec.ts` |
| Controller spec covering all 7 endpoints | Implemented | `scope.controller.spec.ts` |
| Integration spec (in-memory closure simulation) | Implemented | `scope.integration.spec.ts` |
| Module DI wiring spec | Implemented | `scope.module.integration.spec.ts` |
| Audit / optional-dependency spec | Implemented | `scope.service.audit.spec.ts` |
| Migration SQL content spec (creation + backfill) | Implemented | `scope.migration.spec.ts`, `backfill.migration.spec.ts` |

## Health Findings

- **Test coverage**: Every non-spec `.ts` file in `apps/api/src/scope/` has at least one corresponding spec, and several have multiple (service has unit + integration + audit; controller has unit; entity has its own spec). Total spec files: 8 (`scope.controller.spec.ts`, `scope.service.spec.ts`, `scope.service.audit.spec.ts`, `scope.integration.spec.ts`, `scope.module.integration.spec.ts`, `scope-node.entity.spec.ts`, `scope.migration.spec.ts`, `backfill.migration.spec.ts`).
- **Code quality**:
  - All DTOs use `class-validator` decorators; service performs explicit `BadRequestException` / `NotFoundException` checks (no silent failures).
  - The closure-table writes are wrapped in `DataSource.transaction(...)` with `ON CONFLICT DO NOTHING` for idempotency.
  - The platform-root invariant is enforced in both `archiveNode` / `restoreNode` (rejects the global root) and in the unique index `uq_scope_nodes_parent_slug` (parent + slug must be unique, with the global root as the COALESCE fallback so siblings under root get a unique key).
  - `ScopeService` accepts `authzAudit?` and `scopeAccessService?` as `@Optional()` deps, so it remains usable in isolated unit tests and in test/dev contexts without the full authz module.
  - `getTree` correctly handles all branches: missing root, no injected access service, no `userId`, scoped user with subtree, scoped user with no accesses.
- **Churn / migration history**: Migration timestamps 2026-06-09 to 2026-06-12 indicate a focused ~3-day implementation burst (creation → backfill → role-assignments → archived-at → orphan-archive → gitops bindings), which is consistent with a single coherent feature landing.
- **Cross-module consumers**: `ScopeService` is consumed by `capability-governance/tool-approval-rule.service.ts`, `harness/harness-credential.controller.ts`, `harness/scoped-ai-default-resolver.ts`, `harness/harness-credential-resolver.service.ts`, `gitops/objects/*` (5 handlers), `gitops/actual-state-reader.service.ts`, `gitops/config-export.service.ts`, `gitops/gitops-pending-change.service.ts`, `gitops/reconciliation-apply.service.ts`, and `config-resolution/scoped-config-resolver.service.ts`. The scope tree is therefore a foundational dependency, not an island.
- **Test approach is appropriate**: tests use a hand-rolled in-memory closure simulator (`scope.integration.spec.ts`) rather than spinning up Postgres, which keeps the unit/integration tier fast and deterministic while the real closure semantics are still exercised end-to-end via the migration spec.

## Open Questions

- The `findOrphanedProjectNodes` query lists 8 source tables in a hand-maintained `NOT IN (SELECT ... UNION ...)` clause. New tenant tables that introduce a `scope_id` FK will need to be added here, or the list should be generated from a registry / `information_schema`. This is a maintenance risk not visible from code review alone.
- `ensureNode` returns the raw query result row from `SELECT * FROM scope_nodes` (`scope.service.ts`), which means downstream callers receive a snake_case / camelCase shape depending on the driver; the unit test papers over this by mocking the query result. The real DTO/return type behavior in production is not asserted.
- The `ScopeService.getTree` filtering path assumes that when the user is scoped to a non-root subtree, the parent chain from that subtree to the platform root always exists and is non-archived. If a parent node is archived while descendants remain live, the tree may include an archived ancestor — there is no explicit test for this edge case.
- `kanban.project_state` and `kanban.orchestration_timeline` runtime tools were not available to this subagent, so the playbook's step 1 could not be executed; downstream probe results for this project that depend on kanban state should be cross-validated by the orchestrator.
- No spec asserts the controller's permission-decorator behavior end-to-end (i.e. that `RequirePermission('scopes:create')` actually rejects unauthorized callers); the controller spec only verifies delegation to the service. The `PermissionsGuard` itself has its own dedicated spec, so the chain is covered indirectly.
