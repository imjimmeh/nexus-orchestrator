---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-goals
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/kanban/src/goals/project-goals.controller.ts
  - apps/kanban/src/goals/project-goals.service.ts
  - apps/kanban/src/goals/project-goals.module.ts
  - apps/kanban/src/goals/project-goals.service.spec.ts
  - apps/kanban/src/database/entities/kanban-project-goal.entity.ts
  - apps/kanban/src/database/entities/kanban-project-goal-worklog.entity.ts
  - apps/kanban/src/database/repositories/kanban-project-goal.repository.ts
  - packages/kanban-contracts/src/goals.schema.ts
  - packages/kanban-contracts/src/goals.types.ts
  - apps/kanban/src/mcp/tools/read/goals.tool.ts
  - apps/kanban/src/mcp/tools/mutation/goal-create.tool.ts
  - apps/kanban/src/mcp/tools/mutation/goal-update.tool.ts
  - apps/kanban/src/mcp/tools/mutation/goal-add-note.tool.ts
  - apps/kanban/src/mcp/tools/mutation/goal-update-status.tool.ts
  - apps/kanban/src/database/migrations/20260429015100-create-kanban-source-of-truth.ts
  - apps/kanban/src/database/migrations/20260502130000-migrate-legacy-kanban-data.ts
source_paths:
  - apps/kanban/src/goals/
updated_at: 2026-06-15T17:45:00.000Z
---

# Probe Result: Kanban Project Goals

## Narrative Summary

The Kanban Project Goals scope (`apps/kanban/src/goals/`) is fully implemented as a first-class NestJS feature module that delivers the EPIC-059 goals capability: CRUD on project goals, MoSCoW prioritization, status transitions, reordering, archive/unarchive, and an audit worklog (with work-item link entries). The scope is self-contained — four files (controller, service, module, service spec) — and integrates with the rest of the system through the `KanbanProjectGoalRepository` (TypeORM-backed), `CharterRegenEnqueuer` (BullMQ debounced charter regen on any goal mutation), the `KanbanPermissionsGuard` (`goals:read` / `goals:write` permissions), and the `kanban-contracts` Zod schemas (the canonical contract).

End-to-end coverage exists in adjacent scopes: the database layer (entity, repository, migration creating the `kanban_project_goals` and `kanban_project_goal_worklogs` tables, legacy-data migration with a dedicated `.spec.ts`), the MCP tool surface (read `kanban.goals`, mutation `kanban.goal_create`, `kanban.goal_update`, `kanban.goal_update_status`, `kanban.goal_add_note` — each with a tool-level `.spec.ts`), and the consuming services (`charter-aggregate.service.ts` and `charter-doc-render.service.ts` use `ProjectGoalsService` to assemble the project charter).

The goals feature is mounted in `AppModule` (top-level) and `ProjectModule` (via `forwardRef`), and the same `ProjectGoalsModule` is re-imported by `KanbanMcpModule` so the MCP tools can resolve the service.

## Capability Updates

| Capability | Status | Evidence |
|---|---|---|
| Project goals CRUD (list / create / update / patch status) | Implemented | `ProjectGoalsController` (GET/POST/PATCH `/projects/:project_id/goals` + `:goalId` + `:goalId/status`); `ProjectGoalsService.listGoals / createGoal / updateGoal / updateStatus` |
| Goal archive / unarchive | Implemented | `ProjectGoalsService.setArchived` via `POST :goalId/archive` and `POST :goalId/unarchive` |
| Goal reordering | Implemented | `PATCH reorder` -> `ProjectGoalsService.reorderGoals` enforces "all active goals exactly once" via `BadRequestException` |
| Goal worklog (note / status_change / link) | Implemented | `ProjectGoalsService.createWorklog` and `listWorklogs`; `linkWorkItem` shortcut creates a `link`-type worklog |
| Permission gating | Implemented | `@UseGuards(KanbanPermissionsGuard)` with `@RequirePermission("goals:read" | "goals:write")` on every route |
| Charter regeneration side-effect | Implemented | `CharterRegenEnqueuer.enqueue(project_id)` called from `createGoal`, `updateGoal`, `updateStatus`, `reorderGoals`, `setArchived` |
| Work-item cross-reference validation | Implemented | `requireWorkItem` throws `NotFoundException` if `work_item_id` is not in the same project |
| Contract schemas (Zod) | Implemented | `packages/kanban-contracts/src/goals.schema.ts` defines `ProjectGoalSchema`, `ProjectGoalWorklogSchema`, create/update/status/reorder/link request schemas, plus `goals.types.ts` inferred types |
| TypeORM entity + repository | Implemented | `KanbanProjectGoalEntity` (table `kanban_project_goals`), `KanbanProjectGoalWorklogEntity` (table `kanban_project_goal_worklogs`), `KanbanProjectGoalRepository` (create/save/findByProject/findById/setArchived/reorder/listWorklogs/createWorklog/deleteByProjectId) |
| Database migrations | Implemented | `20260429015100-create-kanban-source-of-truth.ts` creates both tables + index `idx_kanban_project_goals_project_id`; `20260502130000-migrate-legacy-kanban-data.ts` migrates legacy data (with `.spec.ts` covering both tables) |
| MCP read tool | Implemented | `mcp/tools/read/goals.tool.ts` -> `kanban.goals` (tierRestriction 2, transport `runner_local`) |
| MCP mutation tools | Implemented | `kanban.goal_create`, `kanban.goal_update`, `kanban.goal_update_status`, `kanban.goal_add_note` (all tierRestriction 2, transport `runner_local`) |
| Module wiring | Implemented | `AppModule` imports `ProjectGoalsModule`; `ProjectModule` imports via `forwardRef(() => ProjectGoalsModule)`; `KanbanMcpModule` imports `ProjectGoalsModule` |
| Downstream consumption | Implemented | `charter-aggregate.service.ts` and `charter-doc-render.service.ts` consume `ProjectGoalsService` to compose the project charter |
| Service-level unit tests | Implemented | `project-goals.service.spec.ts` covers create+list, status update + completed_at, NotFound on missing goal, archive/unarchive/reorder, worklog create/list + link work item |
| MCP tool-level unit tests | Implemented | `goals.tool.spec.ts`, `goal-create.tool.spec.ts`, `goal-update.tool.spec.ts`, `goal-add-note.tool.spec.ts`, `goal-update-status.tool.spec.ts` each validate delegation and `context.scopeId`/`workflowRunId` fallbacks |
| Migration-level unit tests | Implemented | `20260502130000-migrate-legacy-kanban-data.spec.ts` covers both goals tables |
| Controller-level tests | Missing | No `project-goals.controller.spec.ts` exists |
| Repository-level tests | Missing | No `kanban-project-goal.repository.spec.ts` (sibling repos such as `kanban-initiative.repository` and `kanban-work-item.repository` do have specs) |
| E2E / API tests for goals routes | Missing | No E2E spec references the goals endpoints or MCP tool surface |

## Health Findings

- **Test coverage at service level is solid.** `project-goals.service.spec.ts` exercises all major service paths (create+list, status change with `completed_at`, NotFound, archive/unarchive/reorder, worklog create+list+link). It uses hand-rolled mocks for the repository, work-item repository, and `CharterRegenEnqueuer`, and asserts against camelCase DTO shape via `expect.objectContaining`.
- **MCP tool specs are thorough.** Each tool spec covers the happy path, optional-field passthrough, and `context.scopeId` / `context.workflowRunId` fallbacks — important for the goals feature because `goal_add_note` and the read tool rely on tool-context resolution when `project_id` is omitted.
- **Charter regen coupling is consistent.** Every mutating service method awaits `charterRegen.enqueue(project_id)`, so charter documents are always eventually consistent with the goal state; the enqueuer itself debounces via BullMQ `jobId: "charter-regen:${projectId}"` and a 2-second delay.
- **Cross-project work-item linking is validated.** `requireWorkItem` enforces that linked work items belong to the same project, preventing cross-project contamination in the worklog.
- **Reorder contract is strict.** `reorderGoals` rejects any payload that does not contain all active goals exactly once (`BadRequestException`), preventing partial or duplicate reorders.
- **Status change auto-logs worklog.** `updateStatus` automatically creates a `status_change` worklog entry (with an auto-generated note when no `note` is provided) and stamps `completed_at` when transitioning to `completed`.
- **Module wiring via `forwardRef`** between `ProjectModule` and `ProjectGoalsModule` is correctly bidirectional and the `KanbanMcpModule` re-imports `ProjectGoalsModule` so MCP tools resolve the same service singleton.
- **Migration test covers goals tables.** The legacy data migration spec explicitly asserts that `kanban_project_goals` and `kanban_project_goal_worklogs` queries are issued.
- **Gap: no controller spec.** The controller has rich route behavior (route ordering with `:goalId` vs `:goalId/status` vs `:goalId/archive` etc., `ParseBoolPipe` for `include_archived`, permission decorators) that is not exercised by unit tests; coverage comes indirectly through the service and tool specs.
- **Gap: no repository spec.** Sibling repositories (`kanban-initiative.repository.ts`, `kanban-work-item.repository.ts`, `kanban-orchestration-intent.repository.ts`) have dedicated specs; `kanban-project-goal.repository.ts` does not, so its `reorder` (uses `Map` keyed reordering with a per-row save) and `setArchived` behavior is uncovered at that boundary.
- **Gap: no API/E2E coverage of the HTTP routes** under `/projects/:project_id/goals`; the route surface is reachable only via in-process Nest module composition tests.
- **Code quality is consistent with the rest of `apps/kanban/src`**: Nest DI, typed DTOs from `@nexus/kanban-contracts`, `NotFoundException` / `BadRequestException` for failure modes, `ParseBoolPipe` for query coercion, and a `toRecord`/`toWorklogRecord` mapping layer that converts entity columns (snake_case) to DTO shape (camelCase).

## Open Questions

- The probe could not invoke the `kanban.project_state` and `kanban.orchestration_timeline` runtime tools (they are not exposed in this investigation context); behavior of the goals controller under live HTTP traffic is therefore inferred from source, not exercised. Existing `kanban-domain.md` confirms both tools are implemented and surface goals data.
- No e2e spec was found that exercises the goals REST routes or the four mutation tools end-to-end. Whether goals flows are covered indirectly by other e2e specs (e.g. project lifecycle) was not confirmed.
- The `KanbanProjectGoalRepository.reorder` method issues a `save` per reordered row; under high-volume goal lists this could become N writes. The probe did not see an alternative bulk update, but performance under load is unverified.
- `charterRegen.enqueue` swallows errors and logs a warning (see `charter-regen.enqueuer.ts`); a silent failure in charter regen is not surfaced to the API caller. Whether this is intentional and whether operators can detect/recover from a failed enqueue is not in scope here.
- The probe did not verify whether `apps/web/` (the React management UI) renders goals or whether the web app consumes these endpoints; the goals surface may currently be API/MCP-only.
