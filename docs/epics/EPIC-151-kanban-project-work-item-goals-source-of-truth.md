# EPIC-151: Kanban Project, Work Item, and Goals Source of Truth

Status: Proposed
Priority: P0
Depends On: EPIC-149, EPIC-150
Related: EPIC-091, EPIC-148, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Move canonical project, work item, work item dependency, work item subtask, goals, repository metadata, and execution-config ownership from `apps/api` to `apps/kanban`. After this epic, `apps/kanban` is the source of truth for kanban domain data and `apps/api` no longer writes kanban tables.

This is the main domain-porting epic for the data model and CRUD/mutation paths.

---

## 2. Current State Review

1. `apps/api/src/project/project.module.ts` still owns `ProjectService`, `WorkItemService`, `ProjectGoalsModule`, repository acquisition helpers, goals controllers, and work-item controllers.
2. `apps/api/src/database/entities/project.entity.ts`, `work-item.entity.ts`, `work-item-dependency.entity.ts`, `work-item-subtask.entity.ts`, and project-goal migrations still define kanban-owned data in the core database module.
3. `apps/kanban/src/database/database.module.ts` has early `kanban_*` entities but uses TypeORM `synchronize` outside production and does not yet own the full model.
4. `apps/kanban/src/project/project.service.ts` and `apps/kanban/src/work-item/work-item.service.ts` still hydrate from core API instead of owning persistence.
5. `apps/api/src/project/amend-entity.service.*` and `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts` still mutate work items from core workflows.

---

## 3. Goals

1. Port the canonical kanban persistence model to `apps/kanban`.
2. Port project/work-item/goals/subtask/dependency mutation behavior to `apps/kanban`.
3. Replace kanban local projection entities with source-of-truth entities and migrations.
4. Keep core API interaction limited to generic workflow execution and runtime metadata.
5. Preserve domain invariants such as legal status transitions, dependency integrity, execution config validation, and audit trails.

---

## 4. Non-Goals

1. Do not port scheduling and dispatch policy in this epic unless required to keep status mutations correct.
2. Do not build the Kanban MCP server in this epic.
3. Do not remove all API project files until frontend and runtime cutover are complete.
4. Do not rely on TypeORM `synchronize` for the final kanban schema.

---

## 5. High-Level Work

1. Define kanban database migrations for projects, work items, dependencies, subtasks, goals, repository metadata, execution config, and audit/event tables.
2. Port `ProjectService` behavior from `apps/api/src/project/core` into `apps/kanban/src/project` behind kanban-owned repositories.
3. Port `WorkItemService` behavior from `apps/api/src/project/work-items` into `apps/kanban/src/work-item` behind kanban-owned repositories.
4. Port `ProjectGoalsModule` behavior into `apps/kanban` using kanban contract DTOs from EPIC-150.
5. Port work-item dependency and subtask behavior needed by refinement and planning workflows.
6. Rebuild kanban controllers directly against kanban services instead of `CoreWorkflowClientService` project routes.
7. Add data migration or backfill scripts from existing API-owned project/work-item tables to kanban-owned tables.
8. Add reconciliation checks proving migrated kanban rows match the old API source before cutover.
9. Disable API writes to kanban-owned tables behind a cutover flag before deleting the old code in EPIC-157.

---

## 6. Deliverables

1. Kanban-owned entities, repositories, migrations, and services for projects, work items, goals, dependencies, subtasks, and execution config.
2. Kanban controllers exposing project/work-item/goals APIs using shared contracts.
3. Migration and reconciliation tooling for existing data.
4. Tests covering legal status transitions, dependencies, subtasks, goals, and execution config.
5. No kanban domain write path in `apps/kanban` that calls core `/projects` routes.

---

## 7. Acceptance Criteria

1. Creating, listing, updating, and status-changing work items are handled entirely inside `apps/kanban`.
2. Project creation and listing are handled entirely inside `apps/kanban`.
3. Goals APIs are served by `apps/kanban` and use kanban-owned persistence.
4. Existing API-owned kanban rows can be migrated into kanban-owned tables with a repeatable script.
5. `apps/api` can be configured read-only for old project/work-item tables without breaking kanban service tests.

---

## 8. Suggested Quality Gates

1. `npm run test:kanban`
2. `npm run build:kanban`
3. Targeted migration dry-run against a disposable database.
4. Contract tests for kanban project/work-item/goals endpoints.
5. Regression tests for status transitions and dependency validation.

---

## 9. Risks

1. Risk: porting copies old API coupling into kanban unchanged.
2. Mitigation: run the deletion test on each ported module and remove core workflow/runtime imports during porting.
3. Risk: dual-write windows create divergent state.
4. Mitigation: prefer a controlled cutover with reconciliation over indefinite dual writes.
