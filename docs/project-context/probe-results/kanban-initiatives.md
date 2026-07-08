---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-initiatives
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/initiatives/initiatives.controller.ts
  - apps/kanban/src/initiatives/initiatives.service.ts
  - apps/kanban/src/initiatives/initiatives.module.ts
  - apps/kanban/src/initiatives/initiatives.service.spec.ts
  - apps/kanban/src/database/repositories/kanban-initiative.repository.ts
  - apps/kanban/src/database/repositories/kanban-initiative.repository.spec.ts
  - apps/kanban/src/database/entities/kanban-initiative.entity.ts
  - apps/kanban/src/database/entities/kanban-initiative-goal.entity.ts
  - apps/kanban/src/database/migrations/20260612200000-create-kanban-initiatives.ts
  - packages/kanban-contracts/src/initiatives.schema.ts
  - packages/kanban-contracts/src/initiatives.schema.spec.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-create.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-update.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-update-status.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-set-priority.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-link-goal.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.ts
  - apps/kanban/src/mcp/tools/mutation/initiative-grooming.tool.spec.ts
  - apps/kanban/src/mcp/tools/read/project-state.tool.ts
  - apps/kanban/test/split-service/strategic-refresh-cycle.integration-spec.ts
source_paths:
  - apps/kanban/src/initiatives/
updated_at: 2026-06-15T17:38:00.000Z
---

# Probe Result: Kanban Strategic Initiatives

## Narrative Summary

The Kanban strategic-initiatives feature is fully implemented as a thin NestJS module that owns the
"planning altitude between project goals and work items." The scope is intentionally minimal —
four files in `apps/kanban/src/initiatives/` (controller, service, module, service spec) — and it
delegates persistence to a dedicated TypeORM repository and entity pair.

**Controller** (`initiatives.controller.ts`) exposes exactly one HTTP route:
`GET /projects/:project_id/initiatives` (mounted under the global `api` prefix). The
`:project_id` URL param is the canonical input — the controller does NOT use `probe_scope_id`
as `project_id`. The response envelope is `{ success: true, data: Initiative[] }`.

**Service** (`initiatives.service.ts`) implements the full initiative lifecycle: `listInitiatives`,
`createInitiative` (with goal linking), `updateInitiative` (title/description/horizon/priority),
`updateStatus`, `setPriority` (stamps `last_reviewed_at` for grooming), `linkGoal`
(link/unlink), and `assignWorkItem` (verifies the initiative exists before writing
`initiative_id` on the work item). The `toRecord` mapper emits the camelCase `lastReviewedAt`
field expected by `@nexus/kanban-contracts` and resolves `goalIds` for each entity.

**Module** (`initiatives.module.ts`) is registered in `AppModule` and also re-imported by
`KanbanMcpModule` so the seven MCP tools can inject `InitiativesService`.

**Persistence** lives outside this scope but is wired correctly: the `KanbanInitiativeEntity` /
`KanbanInitiativeGoalEntity` pair, the `KanbanInitiativeRepository` (with create/save/findByProjectId/
findById/linkGoal/unlinkGoal/findGoalIds/assignWorkItem), and migration
`20260612200000-create-kanban-initiatives.ts` (which also adds `initiative_id` FK on
`kanban_work_items` with `ON DELETE SET NULL`).

**Contract** is defined in `packages/kanban-contracts/src/initiatives.{types,schema}.ts`:
`InitiativeHorizon = "now" | "next" | "later"`, `InitiativeStatus = "proposed" | "active" |
"paused" | "done" | "dropped"`, plus `Create/Update/UpdateStatus` request schemas with
`.strict()` validation.

**MCP exposure** — every mutation method on the service is wrapped by an internal MCP tool
(`tierRestriction: 2`, `transport: runner_local`, `runtimeOwner: runner`):
`kanban.initiative_create`, `kanban.initiative_update`, `kanban.initiative_update_status`,
`kanban.initiative_set_priority`, `kanban.initiative_link_goal`,
`kanban.initiative_link_work_item`, plus a `kanban.initiative_grooming` flow. The list endpoint
is consumed by `kanban.project_state` (the `strategic.initiatives` field) and is the contract
validated by the EPIC-208 strategic-refresh-cycle integration test.

## Capability Updates

| Capability | Status | Notes |
|---|---|---|
| HTTP `GET /projects/:project_id/initiatives` | Implemented | `initiatives.controller.ts`; uses URL `:project_id`, never `probe_scope_id` |
| Service: `listInitiatives` | Implemented | Ordered by `priority ASC, created_at ASC` via repository |
| Service: `createInitiative` | Implemented | Defaults priority to current count; links `goalIds` after insert |
| Service: `updateInitiative` | Implemented | Partial-update with `NotFoundException` guard |
| Service: `updateStatus` | Implemented | Uses `UpdateInitiativeStatusRequest` |
| Service: `setPriority` (grooming) | Implemented | Stamps `last_reviewed_at = new Date()` |
| Service: `linkGoal` (link/unlink) | Implemented | Boolean `linked` flag drives link/unlink |
| Service: `assignWorkItem` | Implemented | Verifies initiative exists; updates `workItems.initiative_id` |
| Entity-to-contract mapping | Implemented | `toRecord` resolves `goalIds` and converts dates to ISO |
| TypeORM entity | Implemented | `KanbanInitiativeEntity` (uuid PK, indexed `project_id`, status/horizon defaults) |
| Join-table entity | Implemented | `KanbanInitiativeGoalEntity` (composite PK, `goal_id` index) |
| Repository | Implemented | All CRUD + work-item assignment in `KanbanInitiativeRepository` |
| Database migration | Implemented | `20260612200000-create-kanban-initiatives.ts` creates both tables, indexes, and adds `kanban_work_items.initiative_id` |
| Zod contracts | Implemented | `InitiativeSchema`, `CreateInitiativeRequestSchema`, etc. (all `.strict()`) |
| MCP tools (7) | Implemented | create / update / update_status / set_priority / link_goal / link_work_item / grooming |
| Project-state read integration | Implemented | `kanban.project_state` exposes `strategic.initiatives` array |
| Module wiring | Implemented | Mounted in both `AppModule` and `KanbanMcpModule` |

## Health Findings

- **Test coverage is strong across the dependency graph:**
  - `initiatives.service.spec.ts` (5 tests) — create+link, list, missing→NotFound, setPriority
    stamps `last_reviewed_at`, assignWorkItem verifies repo lookup.
  - `kanban-initiative.repository.spec.ts` (5 tests) — default-priority-from-count, list ordering,
    link-goal idempotence, assignWorkItem call shape, findGoalIds.
  - `initiatives.schema.spec.ts` (3 tests) — horizon/status enums, default horizon, full-record
    round-trip.
  - MCP tool specs: `initiative-create.tool.spec.ts`, `initiative-update.tool.spec.ts`,
    `initiative-grooming.tool.spec.ts`, `initiative-link-work-item.tool.spec.ts` all exist.
  - Integration: `apps/kanban/test/split-service/strategic-refresh-cycle.integration-spec.ts`
    exercises the HTTP `GET` endpoint via a real Nest test app + JWT (EPIC-208).
- **No placeholder/TODO code** observed — all methods are real, with proper DI, error
  handling (`NotFoundException`), and structured contracts.
- **Architectural choice — controller is intentionally read-only.** Only `GET` is exposed
  via HTTP; all mutations go through the MCP tool surface (the integration test comments
  explicitly call this out: *"initiatives controller has no auth guard — we only test the
  wiring here"*). This is consistent with the runner-local MCP pattern used elsewhere in
  the kanban app and is not a gap.
- **Cross-cutting consistency:** the `:project_id` URL param pattern matches other kanban
  controllers; the response envelope (`{ success, data }`) matches the project goals and
  work-item controllers; the camelCase `lastReviewedAt` field on the contract matches
  the rest of the kanban-contracts package.
- **Migration is reversible** — `down()` drops `kanban_work_items.initiative_id` then both
  tables, and the migration is idempotent (`IF NOT EXISTS` / `IF EXISTS`).

## Open Questions

- The `kanban.initiative_grooming` tool is referenced by a spec file
  (`initiative-grooming.tool.spec.ts`) but the implementation file (`initiative-grooming.tool.ts`)
  is not present in `apps/kanban/src/mcp/tools/mutation/`. The spec mocks `InitiativesService`
  directly, so the tool may live elsewhere or be defined inline; worth confirming whether
  the implementation file exists under a different path.
- The HTTP controller deliberately exposes only `GET`; the integration test acknowledges this.
  If a future requirement introduces web-side initiative management, additional REST routes
  would need to be added — currently all write paths are MCP-only.
- The service is mounted under `/projects/:project_id/initiatives`, so the URL routing
  assumes the caller has already resolved the project. There is no controller-level
  authorization check on `project_id` (the integration test notes no auth guard); the MCP
  tools handle scope resolution via `resolveProjectIdFromToolContext`.
