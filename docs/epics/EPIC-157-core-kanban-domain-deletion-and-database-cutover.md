# EPIC-157: Core Kanban Domain Deletion and Database Cutover

Status: Proposed
Priority: P0
Depends On: EPIC-151, EPIC-152, EPIC-153, EPIC-154, EPIC-155, EPIC-156
Related: EPIC-090, EPIC-091, EPIC-134, EPIC-158, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Delete kanban domain code from `apps/api` once kanban owns data, orchestration policy, frontend routing, runtime tools, and lifecycle projections. This is the final agent OS cleanup epic: core should compile and run without project, work-item, goals, or kanban mutation modules. War-room remains in core and must be made project-agnostic.

This epic is intentionally late because deletion should happen only after replacement paths are verified.

---

## 2. Current State Review

1. `apps/api/src/project` contains project, work-item, goals, orchestration, dispatch, intelligence, repository, steering, and amend-entity behavior.
2. `apps/api/src/war-room` contains core-owned war-room behavior but still carries optional project/work-item fields.
3. `apps/api/src/database/entities` contains project, project-member, project-agent-capacity, project-orchestration, work-item, work-item-dependency, work-item-subtask, goals, and war-room entities. The kanban-owned entities should leave core; war-room entities should remain only after their project/work-item coupling is removed.
4. `apps/api/src/database/repositories` contains project and work-item repositories.
5. `apps/api/src/workflow/workflow.module.ts` imports `ProjectModule`, `IntelligenceModule`, `WorkItemAutomationService`, `AmendEntityService`, and project/work-item domain ports.
6. `apps/api/src/workflow/workflow-internal-tools` still registers project/work-item tools.
7. `packages/core` and seeded workflows still contain some legacy kanban names until upstream epics remove them.

---

## 3. Goals

1. Delete `apps/api/src/project` after all replacement paths are live.
2. Keep `apps/api/src/war-room` and remove its project/work-item coupling.
3. Remove API database entities, repositories, migrations, seed data, and providers for kanban-owned tables.
4. Remove in-process project/work-item domain ports and adapters from workflow modules.
5. Remove core internal kanban tools and amend-entity remnants.
6. Add automated checks proving core is agent OS only.

---

## 4. Non-Goals

1. Do not delete generic workflow, agent, skill, tool, session, host mount, MCP, ACP, chat, war-room, or web-automation capabilities.
2. Do not drop production data without verified migration, backup, and rollback steps.
3. Do not preserve legacy re-export files for old API project modules.
4. Do not keep API compatibility project routes unless a user-approved rollback window requires them.

---

## 5. High-Level Work

1. Add a deletion readiness checklist that references replacement coverage from EPIC-151 through EPIC-156.
2. Remove `ProjectModule`, `ProjectGoalsModule`, and `IntelligenceModule` imports from core modules.
3. Delete API controllers and providers for project, work-item, goals, orchestration, dispatch, review, intelligence, and steering behavior.
4. Refactor API war-room entities, DTOs, and services to remove `project_id`, `work_item_id`, `projectId`, and `workItemId` as first-class fields, replacing them with generic workflow run/session/context metadata if needed.
5. Delete in-process project/work-item domain ports and adapters where no longer used.
6. Delete API database entities and repositories for kanban-owned tables.
7. Add database migrations or runbooks to drop or archive legacy API-owned kanban tables after successful migration.
8. Remove old seed data and workflow definitions that assume core-owned kanban mutation routes.
9. Add static grep/import-boundary checks for forbidden core terms and paths.
10. Run split-topology verification with core project routes absent and kanban serving all kanban domain APIs.

---

## 6. Deliverables

1. Removed API project/work-item/goals/orchestration/dispatch/intelligence code.
2. Project-agnostic core war-room module retained.
3. Removed API kanban database entities and repositories.
4. Database cutover and cleanup migrations or runbooks.
5. Import-boundary and forbidden-reference checks.
6. Split-topology verification report.

---

## 7. Acceptance Criteria

1. `apps/api` compiles with no imports from `apps/api/src/project`.
2. `apps/api` has no project/work-item/goals controllers.
3. `apps/api` workflow modules do not provide project/work-item domain ports or kanban-owned special-step handlers.
4. `apps/api` database module does not register kanban-owned project/work-item/goals entities.
5. A repository-wide search for `WorkItem`, `ProjectModule`, `ProjectGoals`, `projectId`, `workItemId`, and `amend_entity` in `apps/api/src` returns only allowed generic compatibility references, tests scheduled for deletion, or no results.
6. A repository-wide search for `WarRoom` in `apps/api/src` returns only core-owned project-agnostic collaboration references.
7. Split-topology tests pass with frontend calling kanban for project/work-item routes and core for war-room routes.

---

## 8. Suggested Quality Gates

1. `npm run test:api`
2. `npm run build:api`
3. `npm run test:kanban`
4. `npm run build:kanban`
5. `npm run test:unit:web`
6. Static forbidden-reference check for kanban terms in `apps/api/src`.
7. Migration dry-run and rollback rehearsal.

---

## 9. Risks

1. Risk: hidden consumers still call API project routes.
2. Mitigation: run split-topology tests with API project routes physically absent before deleting database tables.
3. Risk: deleting migrations breaks historical database bootstrap.
4. Mitigation: prefer additive cleanup migrations and archival runbooks instead of rewriting migration history unless explicitly approved.
5. Risk: core loses context needed for operational debugging.
6. Mitigation: keep generic context metadata and lifecycle projection diagnostics, but not kanban domain semantics.
