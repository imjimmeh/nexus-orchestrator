# EPIC-059: Project Goals as a First-Class Product Object

> Status: Implemented (v1 shipped)  
> Priority: Critical  
> Estimate: 5-7 weeks  
> Created: 2026-04-06  
> Last Updated: 2026-04-06  
> Owner: TBD

---

## 1. Epic Summary

Project goals are currently modeled as a single free-text field (`project_orchestrations.goals`) provided when orchestration starts. This makes goals runtime-scoped instead of project-scoped, hard to maintain over time, and difficult to link to execution evidence.

This epic introduces a true goal domain model so goals are created with the project, managed in a dedicated UI, tracked to completion with status, and auditable through per-goal worklogs linked to work items and agent notes.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. DB migration and persistence model for `project_goals` and `project_goal_worklogs`.
2. API endpoints for goal CRUD, status transitions, reorder/archive, and worklog operations.
3. Project creation flow now supports initial `goals[]` payload.
4. Web project creation UI supports multi-goal authoring with MoSCoW/priority metadata.
5. Dedicated project workspace Goals tab with status updates, archival controls, and worklog timeline/actions.
6. Orchestration surfaces now treat goals as project-managed objects (not start-dialog source of truth).
7. Test coverage across API services/controllers and Web hooks/components/state flows.

---

## 2. Problem Statement and Current-State Gaps

### 2.1 Current behavior

1. Goals are entered in orchestration start flow (`/projects/:projectId/orchestration/start`).
2. Goals are persisted as one nullable text field on `project_orchestrations`.
3. Orchestration prompts consume the free text via `{{trigger.goals}}` / `{{inputs.goals}}`.
4. No first-class goal list exists in API or UI.
5. No goal completion state, no per-goal ownership, no goal-specific history.

### 2.2 Product and operational issues

1. Goals are tied to orchestration lifecycle instead of project lifecycle.
2. Users cannot maintain goals without restarting orchestration flow.
3. Multi-goal planning is forced into unstructured text.
4. Completion is not trackable at goal level.
5. Evidence is fragmented across work items and telemetry with no goal timeline.
6. Prioritization intent (for example MoSCoW + P0..P3) is not captured.

---

## 3. Request Coverage Mapping

This epic explicitly covers the requested outcomes:

1. Goals set at project creation:
   - Create project API and UI accept an initial goal list.
2. Dedicated goals tab/page:
   - New Goals tab in Project Workspace with create/edit/archive/status controls.
3. Multiple goals:
   - Goal entity with one-to-many relation from project.
4. Goal status tracking:
   - Goal status lifecycle with completion semantics.
5. Goal worklogs:
   - Per-goal worklog entries that can link to work items and include agent notes.
6. Additional prioritization model:
   - MoSCoW + existing P0..P3 priority captured and surfaced.

---

## 4. Scope and Non-Goals

### 4.1 In scope

1. New project goal domain entities, repositories, migration, and API contracts.
2. Project creation updates to collect/store goals.
3. Goal CRUD, status transitions, ranking, and archival behavior.
4. Goal worklog capture and retrieval, including work item linkage.
5. Web UI for creation-time goals and ongoing maintenance in dedicated tab.
6. Orchestration/workflow integration to consume canonical project goals.
7. Test coverage across API, web unit tests, and targeted e2e scenarios.

### 4.2 Out of scope

1. Multi-project portfolio rollups.
2. External analytics dashboards.
3. Fully automated semantic extraction of goals from unstructured documents.
4. New role-based permissions model beyond existing Admin/Developer access.

---

## 5. Target Domain Model

### 5.1 Entity: `project_goals`

Proposed fields:

1. `id` (uuid, pk)
2. `project_id` (uuid, fk -> projects.id)
3. `title` (varchar, required)
4. `description` (text, nullable)
5. `status` (varchar, required)
   - Phase 1 values: `todo`, `in_progress`, `blocked`, `completed`, `cancelled`
   - `completed` is the done state used for success metrics
6. `moscow` (varchar, nullable)
   - `must`, `should`, `could`, `wont`
7. `priority` (varchar, nullable)
   - `p0`, `p1`, `p2`, `p3`
8. `sort_order` (int, default 0)
9. `target_date` (timestamp, nullable)
10. `completed_at` (timestamp, nullable)
11. `owner_agent_profile_id` (uuid, nullable)
12. `metadata` (jsonb, nullable)
13. `is_archived` (boolean, default false)
14. timestamps

### 5.2 Entity: `project_goal_worklogs`

Proposed fields:

1. `id` (uuid, pk)
2. `goal_id` (uuid, fk -> project_goals.id)
3. `project_id` (uuid, fk -> projects.id, denormalized for query efficiency)
4. `work_item_id` (uuid, nullable, fk -> work_items.id)
5. `entry_type` (varchar)
   - `note`, `status_change`, `agent_update`, `system_event`, `link`
6. `author_type` (varchar)
   - `user`, `agent`, `system`
7. `author_id` (varchar, nullable)
8. `author_name` (varchar, nullable)
9. `note` (text, required for note-like entries)
10. `linked_run_id` (varchar, nullable)
11. `metadata` (jsonb, nullable)
12. timestamps

### 5.3 Backward compatibility model

1. Keep `project_orchestrations.goals` during transition.
2. Add canonical goal summary rendering from `project_goals`.
3. Continue populating legacy `goals` string for workflow templates until all templates and tooling are migrated.

---

## 6. API and Contract Design

### 6.1 Project creation/update

1. Extend create project request with `goals` array:
   - `title`, optional `description`, optional `moscow`, optional `priority`, optional `target_date`.
2. Optional update endpoint support for setting initial goals during setup wizard completion.

### 6.2 Goal management endpoints

1. `GET /projects/:projectId/goals`
2. `POST /projects/:projectId/goals`
3. `PATCH /projects/:projectId/goals/:goalId`
4. `PATCH /projects/:projectId/goals/:goalId/status`
5. `PATCH /projects/:projectId/goals/reorder`
6. `POST /projects/:projectId/goals/:goalId/archive`
7. `POST /projects/:projectId/goals/:goalId/unarchive`

### 6.3 Goal worklog endpoints

1. `GET /projects/:projectId/goals/:goalId/worklogs`
2. `POST /projects/:projectId/goals/:goalId/worklogs`
3. `POST /projects/:projectId/goals/:goalId/worklogs/link-work-item`

### 6.4 Orchestration contract changes

1. Start orchestration endpoint no longer requires goals if project goals exist.
2. Start endpoint accepts optional override/append behavior only if explicitly requested.
3. Runtime tools (`get_project_state`, `get_project_brief`) return structured goals array plus summary counts.

---

## 7. UX and Interaction Requirements

### 7.1 Project creation flow

1. Add Goals section to new project form.
2. Allow adding multiple goals before submit.
3. Per-goal inputs: title, description, MoSCoW, priority, optional target date.
4. Validation: at least one non-empty goal title for guided mode (configurable).

### 7.2 Project workspace goals tab

1. New tab: `Goals` in project workspace navigation.
2. Goal list view with sorting/filtering:
   - by status, MoSCoW, priority, archived state.
3. Inline status transitions and completion timestamp display.
4. Worklog panel per goal with chronological timeline.
5. Quick link to related work item and active session/run when available.

### 7.3 Orchestration tab adjustments

1. Remove goals as primary required input for start dialog.
2. Show read-only goal summary in orchestration controls/details.
3. Keep optional text prompt field only for run-specific directives (not canonical goals).

---

## 8. Workflow and Runtime Integration

1. Workflow triggers should consume canonical goals summary instead of only free-text `goals`.
2. Prompt templates should include:
   - goal title
   - status
   - MoSCoW
   - priority
   - latest worklog highlights (bounded)
3. Runtime tool `get_project_brief` returns:
   - `goals.total`
   - `goals.completed`
   - `goals.blocked`
   - top priorities and Must goals.
4. Goal worklog entries may be appended automatically by orchestration actions:
   - spec approved/rejected
   - dispatch decisions
   - QA decision outcomes tied to related work items.

---

## 9. Implementation Plan

## Phase 1: Core Goal Domain, API, and UX

### Phase 1 Task 1: Schema and Persistence

Files (expected):

1. `apps/api/src/database/entities/project-goal.entity.ts` (new)
2. `apps/api/src/database/entities/project-goal-worklog.entity.ts` (new)
3. `apps/api/src/database/database.module.ts` (register entities/repositories)
4. `apps/api/src/database/repositories/project-goal.repository.ts` (new)
5. `apps/api/src/database/repositories/project-goal-worklog.repository.ts` (new)
6. `apps/api/src/database/migrations/20260406xxxxxx-create-project-goals-and-worklogs.ts` (new)

Acceptance criteria:

1. Project can store multiple goals with status and ordering.
2. Worklogs persist per goal and optionally link to work item.
3. Migration applies cleanly on empty and populated DB.
4. Default indexes support list by `project_id`, `status`, and recent worklogs.

### Phase 1 Task 2: DTOs, Service Layer, and Controllers

Files (expected):

1. `apps/api/src/project/dto/create-project-goal.dto.ts` (new)
2. `apps/api/src/project/dto/update-project-goal.dto.ts` (new)
3. `apps/api/src/project/dto/update-project-goal-status.dto.ts` (new)
4. `apps/api/src/project/dto/create-project-goal-worklog.dto.ts` (new)
5. `apps/api/src/project/project-goals.service.ts` (new)
6. `apps/api/src/project/project-goals.controller.ts` (new)
7. `apps/api/src/project/project.module.ts` (register service/controller)

Acceptance criteria:

1. CRUD and status endpoints work with validation and project scoping.
2. Goal status transitions set/clear `completed_at` correctly.
3. Archived goals are excluded by default but queryable.
4. Worklog create/list endpoints support link to `work_item_id`.

### Phase 1 Task 3: Project Creation Integration

Files (expected):

1. `apps/api/src/project/dto/create-project.dto.ts` (extend with goals array)
2. `apps/api/src/project/project.service.ts` (persist initial goals transactionally)
3. `apps/web/src/lib/api/types.ts` (extend `CreateProjectRequest`)
4. `apps/web/src/lib/api/client.projects.ts` (pass goals payload)
5. `apps/web/src/pages/projects/ProjectCreate.tsx` (goals input UI)

Acceptance criteria:

1. New project supports creating 0..N goals at creation time.
2. If create project fails, goals are not partially persisted.
3. Existing create behavior remains backward-compatible for clients not sending goals.

### Phase 1 Task 4: Goals Workspace Tab and Components

Files (expected):

1. `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx` (add `Goals` tab)
2. `apps/web/src/pages/project-workspace/GoalsTab.tsx` (new)
3. `apps/web/src/components/goals/GoalList.tsx` (new)
4. `apps/web/src/components/goals/GoalEditorDialog.tsx` (new)
5. `apps/web/src/components/goals/GoalStatusBadge.tsx` (new)
6. `apps/web/src/components/goals/GoalWorklogPanel.tsx` (new)
7. `apps/web/src/hooks/useProjectGoals.ts` (new)

Acceptance criteria:

1. Users can create, edit, archive, and complete goals from goals tab.
2. Users can add worklog entries and link entries to work items.
3. List supports filtering by status and searching by title.
4. UI is responsive on desktop and mobile breakpoints.

### Phase 1 Task 5: Orchestration Alignment

Files (expected):

1. `apps/web/src/pages/project-workspace/OrchestrationStartDialog.tsx` (remove canonical goals dependency)
2. `apps/web/src/pages/project-workspace/OrchestrationTab.state.tsx` (read goals from goals API for summary)
3. `apps/api/src/project/dto/start-orchestration.dto.ts` (de-emphasize direct goals input)
4. `apps/api/src/project/project-orchestration.service.ts` (read canonical project goals when starting)

Acceptance criteria:

1. Start orchestration succeeds when project has goals and start payload omits goals.
2. Legacy payload with `goals` string still works during transition.
3. Orchestration UI clearly points users to Goals tab for maintenance.

### Phase 1 Task 6: Tests

Files (expected):

1. API unit tests under `apps/api/src/project/**/*.spec.ts`
2. Web tests under `apps/web/src/pages/project-workspace/*.spec.tsx` and hooks tests
3. E2E scenarios under `packages/e2e-tests/`

Acceptance criteria:

1. Unit tests cover CRUD, status transitions, archive behavior, and worklog linking.
2. Web tests cover create-project goals form and goals tab workflows.
3. E2E validates:
   - create project with multiple goals
   - complete one goal
   - link worklog to work item
   - start orchestration without start-goals override.

## Phase 2: Prioritization, Telemetry, and Governance Hardening

### Phase 2 Task 1: Prioritization Semantics (MoSCoW + Priority)

1. Add ranking utilities for deterministic ordering:
   - MoSCoW bucket, then `priority`, then `sort_order`, then creation time.
2. Add UI grouped sections by MoSCoW with drag-to-reorder.
3. Expose API query params for prioritized goal retrieval.

Acceptance criteria:

1. Sorting is deterministic and test-covered.
2. Users can reorder goals within and across MoSCoW groups.
3. API and UI remain stable when MoSCoW is unset.

### Phase 2 Task 2: Automated Goal Worklog Ingestion

1. Add service hooks to append system/agent worklog events from orchestration decisions.
2. Attach related work item/run context when available.
3. Add lightweight deduplication for repeated automated events.

Acceptance criteria:

1. Major orchestration events append machine-readable goal worklogs.
2. Duplicate bursts do not flood timeline.
3. Linked work item/run references resolve to valid entities when provided.

### Phase 2 Task 3: Runtime Tools and Prompt Enrichment

1. Update runtime tool payloads to include structured goals and progress summary.
2. Update seeded workflow templates to consume structured goal context.
3. Keep compatibility shim for templates still expecting plain `goals`.

Acceptance criteria:

1. `get_project_state` and `get_project_brief` include structured goals.
2. Discovery/cycle prompts can consume goal status and priority signals.
3. Existing workflows continue to run during migration window.

### Phase 2 Task 4: Reporting and Alerts

1. Add goal health counters to orchestration details.
2. Add notifications for:
   - goal completed
   - goal blocked
   - overdue target date.

Acceptance criteria:

1. Goal counters render on orchestration/project dashboard surfaces.
2. Notification events are test-covered and user-visible.

---

## 10. Acceptance Criteria (Epic-Level)

1. Goals can be created at project creation time and maintained without orchestration restart.
2. A dedicated project Goals tab/page exists and is discoverable in workspace navigation.
3. Multiple goals per project are fully supported.
4. Every goal has trackable completion state and status history.
5. Every goal supports worklogs with optional work item linkage and agent/system notes.
6. MoSCoW and priority are represented in model, API, and UI.
7. Orchestration consumes canonical project goals and no longer treats start-dialog free text as source of truth.
8. Regression coverage exists across API, web unit tests, and relevant e2e flows.

---

## 11. Risks and Mitigations

1. Risk: Contract churn between orchestration legacy `goals` string and new structured goals.
   - Mitigation: compatibility shim and phased template migration.
2. Risk: Goal worklog volume growth.
   - Mitigation: pagination, bounded default query window, index strategy.
3. Risk: User confusion between project goals and work item objectives.
   - Mitigation: explicit UX copy and linkage from goal to contributing work items.
4. Risk: Inconsistent prioritization semantics.
   - Mitigation: define single deterministic ranking utility and shared constants in core contracts.

---

## 12. Dependencies

1. Existing orchestration and project workspace capabilities from EPIC-046 through EPIC-058.
2. Runtime tools and telemetry surfaces used by orchestration details.
3. Database migration pipeline in `apps/api`.

---

## 13. Definition of Done

1. Project goals are first-class persisted objects with dedicated CRUD and status lifecycle.
2. Goals are entered during project creation and managed in a dedicated Goals tab.
3. Goal worklogs support manual and automated entries, including work-item linking.
4. MoSCoW and priority are available and operational in sorting/filtering.
5. Orchestration start flow no longer depends on manually re-entering project goals.
6. Targeted API/web/e2e tests pass and documentation is updated where contracts changed.
