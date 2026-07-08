# EPIC-110: Agent Skills, Goal Lifecycle Automation, and Goal Linking

> Status: Proposed (Detailed Plan)
> Priority: P1
> Depends On: EPIC-059, EPIC-061, EPIC-070
> Last Updated: 2026-04-17
> Owner: TBD

---

## 1. Executive Review of Current Plan

The direction is good and should ship, but the current draft is too high level to execute safely.

### 1.1 What is solid

1. The problem framing is correct: there is still manual coordination overhead between goals and delivery evidence.
2. The scope pillars are the right ones: skills, automation, linking, and UX.
3. The non-goals are reasonable and prevent scope explosion.

### 1.2 Issues with the current draft

1. It does not distinguish what already exists versus what must be built.
2. It has no PR-sized work breakdown, so ownership and sequencing are ambiguous.
3. It does not define trigger semantics (when automation changes goal state, and when it must not).
4. It does not define canonical linking behavior (current link is worklog-driven; detach/query semantics are missing).
5. It does not define acceptance criteria or epic-level Definition of Done.

### 1.3 Adjustments made in this version

1. Added code-grounded baseline and gap analysis.
2. Re-scoped work into incremental PR tasks with explicit acceptance criteria.
3. Added lifecycle automation rules with guardrails and idempotency expectations.
4. Added explicit goal-to-work-item linking contract (attach/list/detach) while preserving backward compatibility with worklogs.
5. Added test matrix, rollout plan, and Definition of Done.

---

## 2. Current-State Baseline (Code Context)

This epic starts from an already-implemented foundation.

### 2.1 Existing backend capabilities

1. Goal API exists in `apps/api/src/project-goals/project-goals.controller.ts`:
	- `GET /projects/:projectId/goals`
	- `POST /projects/:projectId/goals`
	- `PATCH /projects/:projectId/goals/:goalId`
	- `PATCH /projects/:projectId/goals/:goalId/status`
	- `PATCH /projects/:projectId/goals/reorder`
	- `POST /projects/:projectId/goals/:goalId/archive`
	- `POST /projects/:projectId/goals/:goalId/unarchive`
	- `GET /projects/:projectId/goals/:goalId/worklogs`
	- `POST /projects/:projectId/goals/:goalId/worklogs`
	- `POST /projects/:projectId/goals/:goalId/worklogs/link-work-item`
2. Goal business logic exists in `apps/api/src/project-goals/project-goals.service.ts`.
3. Goal status enum is established in `apps/api/src/project-goals/project-goals.constants.ts`:
	- `todo`, `in_progress`, `blocked`, `completed`, `cancelled`
4. Work-item status model exists in `apps/api/src/project/work-item.constants.ts`.
5. Event ledger read APIs already exist in `apps/api/src/observability/event-ledger.controller.ts`.

### 2.2 Existing web capabilities

1. Goals tab exists in `apps/web/src/pages/project-workspace/GoalsTab.tsx`.
2. Goal data and mutations are wrapped in `apps/web/src/hooks/useProjectGoals.ts`.
3. API client methods exist in `apps/web/src/lib/api/client.projects.ts`.
4. Users can currently link a work item to a goal via a worklog entry (`link-work-item` endpoint), but explicit attach/detach relationship management is not yet first-class.

### 2.3 Key gaps this epic closes

1. Skill/instruction quality is inconsistent for goal-aware agent behavior.
2. Goal lifecycle advancement is still largely manual.
3. Linking is represented as timeline entries, not a canonical relationship API with attach/list/detach semantics.
4. UX lacks explicit relationship inspection and quick navigation patterns for linked work items.

---

## 3. Goals

1. Standardize agent skill guidance for goal operations and lifecycle-safe behavior.
2. Automate eligible goal lifecycle transitions from deterministic execution signals.
3. Introduce canonical goal-to-work-item relationship APIs (attach/list/detach).
4. Add web UX for explicit linking/unlinking and relationship visibility.
5. Preserve and improve auditability across manual and automated changes.

## 4. Non-Goals

1. Fully autonomous planning without approval constraints.
2. Kanban process redesign or new status taxonomy.
3. External PM platform synchronization.
4. Replacing the full project workspace UI architecture.

---

## 5. Product and Technical Design

## 5.1 Linking model adjustment

Current behavior: link is encoded as a `project_goal_worklogs` row (`entry_type='link'`, optional `work_item_id`).

Target behavior:

1. Keep worklog link entries as historical evidence.
2. Add explicit canonical relationship storage for current links (`project_goal_work_item_links` table).
3. Support idempotent attach and explicit detach without deleting historical worklogs.

Rationale:

1. Worklogs are timeline evidence, not ideal as source of current truth.
2. Canonical linking enables efficient list/filter/query and clean UX.

## 5.2 Lifecycle automation rules (phase 1)

Automations are deterministic and conservative:

1. Goal auto-complete candidate:
	- Trigger when all currently linked work items are in terminal status (`done`).
	- Action: set goal to `completed` if not already terminal.
2. Goal auto-block candidate:
	- Trigger when at least one linked work item is `blocked` and none are active in `in-progress`/`in-review`/`ready-to-merge`.
	- Action: set goal to `blocked` unless goal is already `completed` or `cancelled`.
3. Goal auto-in-progress candidate:
	- Trigger when at least one linked work item is active.
	- Action: set goal to `in_progress` if current status is `todo`.

Guardrails:

1. Never auto-transition from `completed` to non-terminal states.
2. Never overwrite explicit human `cancelled` status.
3. Emit lifecycle automation events with reason and linkage context.
4. Run transitions idempotently (same signal should not create repeated writes/events).

## 5.3 Skills and instruction set updates

1. Introduce a goal-management skill package for orchestrator and planning agents.
2. Define required behavior:
	- Prefer canonical link APIs over ad hoc notes.
	- Include reason text for status changes.
	- Use attach/detach calls as explicit decisions.
3. Add anti-pattern guidance:
	- Do not mark goals completed without linked work-item evidence unless user explicitly requests manual override.

---

## 6. PR-Oriented Implementation Plan

Each task below is sized to be mergeable and reviewable independently.

### EPIC110-001: Canonical Goal-Work-Item Link Persistence

Scope:

1. Add new relation table and migration.
2. Preserve existing worklog link behavior.

Expected files:

1. `apps/api/src/database/migrations/*-create-project-goal-work-item-links.ts` (new)
2. `apps/api/src/project-goals/project-goals.service.ts`
3. `apps/api/src/project-goals/project-goals.sql.ts`
4. `apps/api/src/project-goals/project-goals.types.ts`

Acceptance criteria:

1. New table stores active links (`goal_id`, `project_id`, `work_item_id`, `linked_at`, `linked_by`).
2. Unique index prevents duplicate active link rows for same `(goal_id, work_item_id)`.
3. Existing worklog link creation remains intact and backward-compatible.
4. Migration is reversible and passes on a populated database.

### EPIC110-002: Linking API (Attach/List/Detach)

Scope:

1. Add explicit relationship endpoints.
2. Keep existing worklog endpoints unchanged.

Expected files:

1. `apps/api/src/project-goals/project-goals.controller.ts`
2. `apps/api/src/project-goals/project-goals.service.ts`
3. `apps/api/src/project-goals/dto/*` (new DTOs for attach/detach/list filters)
4. `apps/api/src/project-goals/project-goals.service.spec.ts`

Proposed endpoints:

1. `GET /projects/:projectId/goals/:goalId/work-items`
2. `PUT /projects/:projectId/goals/:goalId/work-items/:workItemId` (idempotent attach)
3. `DELETE /projects/:projectId/goals/:goalId/work-items/:workItemId` (detach)

Acceptance criteria:

1. Attach is idempotent.
2. Detach removes canonical link but appends a worklog system entry for traceability.
3. List endpoint returns linked work item summaries with stable ordering.
4. Permission model matches existing goal/work-item endpoints.

### EPIC110-003: Lifecycle Automation Service

Scope:

1. Implement deterministic automation rules triggered from work-item status updates.
2. Emit event ledger entries and goal worklog system entries.

Expected files:

1. `apps/api/src/project-goals/goal-lifecycle-automation.service.ts` (new)
2. `apps/api/src/project/work-item.service.ts`
3. `apps/api/src/project/events/work-item-status-changed.event.ts`
4. `apps/api/src/project-goals/project-goals.module.ts`
5. Tests in `apps/api/src/project-goals/*.spec.ts`

Acceptance criteria:

1. Automation transitions only occur for defined rules.
2. Terminal status guardrails are enforced (`completed` and `cancelled` protections).
3. Duplicate status events do not cause duplicate transitions.
4. Event ledger entries include project, goal, and work-item correlation metadata.

### EPIC110-004: Orchestration Skill and Prompt Hardening

Scope:

1. Add/refresh skill documentation for goal-aware orchestration.
2. Align orchestration prompts to prefer canonical link/status actions.

Expected files:

1. `.agents/skills/project-goals-orchestration/SKILL.md` (new or updated)
2. `.agents/skills/project-goals-orchestration/examples.md` (new)
3. Seeded prompt/instruction files used by orchestrator profiles (exact files to confirm in implementation PR)

Acceptance criteria:

1. Skill docs include lifecycle rules, attach/detach usage, and anti-patterns.
2. At least 3 concrete examples are provided (discovery, implementation progress, blocking scenario).
3. Updated prompts do not break existing workflow template rendering.

### EPIC110-005: Web Linking UX and Relationship Visibility

Scope:

1. Add explicit linked work-items panel in Goals tab.
2. Add attach/detach controls and quick navigation.

Expected files:

1. `apps/web/src/pages/project-workspace/GoalsTab.tsx`
2. `apps/web/src/pages/project-workspace/GoalsTab.worklogs.tsx`
3. `apps/web/src/hooks/useProjectGoals.ts`
4. `apps/web/src/lib/api/client.projects.ts`
5. `apps/web/src/lib/api/types.ts`

Acceptance criteria:

1. User can attach work items from goal context without creating manual note text.
2. User can detach links with confirmation and immediate UI refresh.
3. Linked items are displayed independently from historical worklog timeline.
4. Goal-to-work-item navigation path is one click.

### EPIC110-006: Auditability and Regression Coverage

Scope:

1. Add/extend tests across API and web.
2. Verify event ledger visibility and payload quality.

Expected files:

1. `apps/api/src/project-goals/project-goals.service.spec.ts`
2. `apps/api/src/project/work-item.service.spec.ts`
3. `apps/web/src/pages/project-workspace/GoalsTab.spec.tsx`
4. Optional targeted e2e in `packages/e2e-tests/` for link + lifecycle path

Acceptance criteria:

1. API tests cover attach/list/detach and lifecycle automation decisions.
2. Web tests cover attach, detach, linked-item display, and error states.
3. Event ledger verification test covers at least one automation transition.

---

## 7. Epic-Level Acceptance Criteria

1. Canonical goal-work-item relationship exists independently of worklog notes.
2. Goals can be linked and unlinked via explicit APIs and UI controls.
3. Lifecycle automation updates goal status deterministically from linked work-item signals.
4. Automation behavior is auditable through worklogs and event ledger entries.
5. Agent skill/prompt guidance for goal operations is explicit and versioned.
6. Existing goals/worklogs behavior remains backward-compatible.

---

## 8. Definition of Done

1. All PR tasks in Section 6 are merged and lint-clean in touched workspaces.
2. Database migration for canonical link model is applied and verified locally.
3. API unit/integration tests for linking and lifecycle automation pass.
4. Web unit tests for linking UX pass.
5. Event ledger entries are validated for at least one attach, detach, and automated lifecycle transition.
6. Documentation is updated:
	- this epic
	- relevant architecture/runbook pages if contracts changed
7. No lint suppressions or type-ignore workarounds are introduced.

---

## 9. Test Strategy

1. API focused:
	- project-goals service tests for idempotent attach/detach/list
	- lifecycle automation tests for status rules and guardrails
2. Web focused:
	- goals tab tests for linked item rendering and detach flow
3. Integration focused:
	- work-item status update triggers lifecycle recalculation for linked goals
4. Optional e2e slice (if touched behavior crosses orchestration runtime paths):
	- create goal
	- attach work item
	- transition work item to done
	- verify goal auto-completed and audited

---

## 10. Risks and Mitigations

1. Risk: status flapping from noisy work-item updates.
	- Mitigation: idempotent transition checks and guardrail rules.
2. Risk: confusion between historical links and active links.
	- Mitigation: clear API/UI separation and migration notes.
3. Risk: overlap with EPIC-061 scope.
	- Mitigation: EPIC-110 is treated as consolidation/hardening layer; reference EPIC-061 implementation outputs rather than duplicating contracts.
4. Risk: migration complexity in existing projects with many worklogs.
	- Mitigation: backfill script optional; preserve worklog history untouched.

---

## 11. Rollout Plan

1. Merge persistence and API changes behind backward-compatible contracts.
2. Release web attach/detach UI after API endpoints stabilize.
3. Enable lifecycle automation with conservative rules (phase 1 only).
4. Monitor event ledger and goal status transitions for one release cycle.
5. Expand automation heuristics only after observed stability.

---

## 12. Open Questions

1. Should auto-complete require all linked items to be `done`, or allow `done` + `ready-to-merge` under specific policy?
2. Should detach require role-based restriction beyond existing Admin/Developer boundaries?
3. Do we need a one-time backfill from historical `entry_type='link'` worklogs into canonical link rows?
4. Should goal automation run synchronously in work-item status update path or through queued async reconciliation?
