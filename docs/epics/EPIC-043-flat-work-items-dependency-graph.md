# EPIC-043 Flat Work Items — Remove Hierarchy, Adopt Dependency Graph

## Status

Planned

## Parent SDD

[SDD: Flat Work Items & Orchestrated Execution — Phase 1](../specs/SDD-flat-work-items-and-orchestrated-execution.md#4-phase-1--flatten-the-hierarchy)

## Problem Statement

The epic/story/task hierarchy is designed for human team coordination and is fundamentally mismatched with AI agent execution:

1. **Capacity deadlock** — Parent epics consume dispatch slots (`in-progress` counts toward `max_active`), blocking their own children from ever being dispatched. This was observed live in project `51a9c717` on 2026-04-04 where the "Data Persistence" epic filled the single slot and its 3 promoted children sat in `todo` indefinitely.
2. **Context fragmentation** — Each child story/task runs in an isolated agent session. Agent A (Story 1) has no awareness of Agent B's (Story 2) decisions, leading to inconsistent implementations of related functionality.
3. **Overhead multiplication** — A 5-story epic generates 5× dispatch cycles, container provisions, review cycles, and merge cycles for what could be one coherent implementation.
4. **Coordination machinery** — Cascade helpers, promote-children, epic routers, parent/child filters, slug prefix resolution — significant complexity that exists solely to manage a decomposition model mismatched with the execution model.

## Goals

1. Remove the `type` (epic/story/task) and `parentId` columns from `work_items`.
2. Replace the parent-child hierarchy with the existing `WorkItemDependency` graph as the sole ordering mechanism.
3. Add a `scope` column to hint execution strategy (Phase 2 will use this).
4. Delete all hierarchy-specific code: cascade helpers, promote-children, epic router.
5. Simplify the dispatch coordinator to: capacity + dependencies + priority.
6. Update the PM breakdown flow to produce fewer, richer spec files.
7. Migrate existing hierarchical data without loss.

## Non-Goals

- Implementing the planning step or subagent delegation (Phase 2 — EPIC-044).
- Changing the review or merge workflows.
- Altering the container/agent execution pipeline.
- Modifying the web UI beyond removing type-specific rendering (a follow-up web task).

## Current-State Analysis

### Hierarchy Model

- `work_items.type` = `'epic' | 'story' | 'task'`
- `work_items.parentId` = FK to parent work item (nullable)
- `WorkItemDependency` = separate directed graph for dependency ordering

### Hierarchy-Dependent Code Paths

| Component            | File                                                                          | Hierarchy Usage                                                                      |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Automation routing   | `apps/api/src/project/work-item-automation.service.ts`                        | `matchesInProgressRouterPolicy()` routes epics-with-children to epic router workflow |
| Cascade effects      | `apps/api/src/project/work-item-cascade.helpers.ts`                           | `autoCompleteParent`, `orphanChildren`, `cascadeBlock`, `promoteNextChild`           |
| Dispatch filtering   | `apps/api/src/project/work-item-dispatch-coordinator.service.ts`              | `PARENT_ACTIVE_STATUSES`, hierarchy readiness filter, parent-before-child ordering   |
| Promote children     | `apps/api/src/workflow/step-promote-children-special-step.handler.ts`         | Promotes backlog children to todo when epic goes in-progress                         |
| Epic router workflow | `apps/api/src/database/seeds/work-item-epic-in-progress-router.workflow.yaml` | Single-job workflow that runs promote_children                                       |
| Spec parser          | `apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts`                | `type` and `parent` frontmatter fields                                               |
| Batch helpers        | `apps/api/src/workflow/step-hydrate-work-items-batch.helpers.ts`              | `resolveSlugFromMap` prefix matching, `parentId` in create payload                   |
| Hydration handler    | `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`       | Type-precedence sorting (epics first), `backfillMissingParentIds`                    |
| Repository           | `apps/api/src/database/repositories/work-item.repository.ts`                  | `findByParentId`, `findByParentIdAndStatuses`                                        |
| Service              | `apps/api/src/project/work-item.service.ts`                                   | Parent-child queries and validation                                                  |

### Dependency Model (Unchanged)

- `WorkItemDependency` entity with `workItemId` + `dependsOnWorkItemId`
- Composite unique index prevents duplicates
- Dispatch coordinator already checks dependency readiness: "all `depends_on` items must be `done`"

## Detailed Task List

### Task 1: Database Entity Changes

**Goal:** Modify the `WorkItem` entity to remove hierarchy columns and add `scope`.

**Files:**

- `apps/api/src/database/entities/work-item.entity.ts`

**Changes:**

- Remove `type` column and its type enum/validation
- Remove `parentId` column and its `@ManyToOne` / `@JoinColumn` relationship
- Remove `parent` and `children` relation properties
- Add `scope` column: `VARCHAR(10)`, default `'standard'`, enum: `['standard', 'large']`

**Acceptance Criteria:**

- [ ] `work_items` table has no `type` or `parent_id` columns
- [ ] `work_items` table has `scope` column with default `'standard'`
- [ ] Entity compiles with no type errors
- [ ] No `@ManyToOne` / `@OneToMany` parent-child relationships exist on the entity

---

### Task 2: Data Migration Script

**Goal:** Migrate existing hierarchical data to dependency edges before dropping columns.

**Files:**

- Create: `apps/api/scripts/migrate-flatten-hierarchy.sql`

**Changes:**

```sql
-- 1. Add scope column
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'standard';

-- 2. Mark former epics as large scope
UPDATE work_items SET scope = 'large' WHERE type = 'epic';

-- 3. Convert parent-child into dependency edges
INSERT INTO work_item_dependencies (id, work_item_id, depends_on_work_item_id)
SELECT gen_random_uuid(), wi.id, wi.parent_id
FROM work_items wi
WHERE wi.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM work_item_dependencies wid
    WHERE wid.work_item_id = wi.id AND wid.depends_on_work_item_id = wi.parent_id
  );

-- 4. Drop hierarchy columns
ALTER TABLE work_items DROP COLUMN IF EXISTS parent_id;
ALTER TABLE work_items DROP COLUMN IF EXISTS type;
```

**Acceptance Criteria:**

- [ ] Script is idempotent (safe to run multiple times via `IF NOT EXISTS` / `IF EXISTS`)
- [ ] All parent-child relationships converted to dependency edges
- [ ] No data loss — every former child has a dependency on its former parent
- [ ] Former epics have `scope = 'large'`
- [ ] Former stories/tasks have `scope = 'standard'`

**Note:** In dev, TypeORM `synchronize: true` handles schema changes from entity modifications. This script is for production environments where `synchronize: false`.

---

### Task 3: Delete Cascade Helpers

**Goal:** Remove all parent-child cascade lifecycle effects.

**Files:**

- Delete: `apps/api/src/project/work-item-cascade.helpers.ts`
- Delete: Test file if exists (check for `work-item-cascade.helpers.spec.ts`)

**Changes:**

- Delete the file entirely
- Remove all imports of `applyCascadeLifecycleEffects` from callers
- Remove cascade invocations from `work-item.service.ts` (in the `updateStatus` method or wherever cascades are called)

**Acceptance Criteria:**

- [ ] File deleted
- [ ] No remaining imports or references to `applyCascadeLifecycleEffects`, `checkAndAutoCompleteParent`, `autoCompleteOrphanChildren`, `cascadeBlockToChildren`, or `promoteNextChildInSequentialMode` anywhere in the codebase
- [ ] `work-item.service.ts` compiles without cascade calls
- [ ] Existing unit tests updated or removed to reflect cascade removal

---

### Task 4: Delete Promote-Children Handler

**Goal:** Remove the promote-children special step handler and its workflow.

**Files:**

- Delete: `apps/api/src/workflow/step-promote-children-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-promote-children-special-step.handler.spec.ts`
- Delete: `apps/api/src/database/seeds/work-item-epic-in-progress-router.workflow.yaml`

**Changes:**

- Delete all three files
- Remove `StepPromoteChildrenSpecialStepHandler` from the special step handler registry/module
- Remove the `promote_children` step type from any handler maps or switch statements
- Remove the workflow seed from the database seeder that loads `work-item-epic-in-progress-router.workflow.yaml`

**Acceptance Criteria:**

- [ ] All three files deleted
- [ ] `promote_children` step type no longer registered
- [ ] Epic router workflow no longer seeded to database
- [ ] No compilation errors in special step handler registry
- [ ] No references to `promote_children` or `epic_in_progress_router` remain in source

---

### Task 5: Simplify Work Item Automation Service

**Goal:** Remove type-based workflow routing — all items use the same workflow.

**Files:**

- `apps/api/src/project/work-item-automation.service.ts`
- Test file if exists

**Changes:**

- Remove `matchesInProgressRouterPolicy()` method — no epic-specific routing
- Remove `childCount` and `type` checks from `triggerStatusTransition()`
- Remove the `children`, `childCount`, `childrenByStatus` fields from `buildTriggerPayload()`
- Remove `dispatchMode` system setting reads (no sequential/parallel child dispatch)
- Simplify to: find matching workflows for the status event, trigger them. No type branching.

**Acceptance Criteria:**

- [ ] No references to `epic`, `story`, or `task` types in automation service
- [ ] No `matchesInProgressRouterPolicy` method
- [ ] No `childCount` or `childrenByStatus` in trigger payloads
- [ ] All work items route through the same workflow regardless of (former) type
- [ ] Unit tests updated to reflect simplified routing

---

### Task 6: Simplify Dispatch Coordinator

**Goal:** Remove hierarchy-based filtering from the dispatch reconciliation algorithm.

**Files:**

- `apps/api/src/project/work-item-dispatch-coordinator.service.ts`
- Test file if exists

**Changes:**

- Remove `PARENT_ACTIVE_STATUSES` constant
- Remove `filterByHierarchyReadiness()` or equivalent hierarchy filter logic
- Remove parent-before-child ordering logic
- Remove any `parentId` checks in candidate selection
- Simplified algorithm:
  1. Lock project
  2. Count active items (in-progress + in-review + ready-to-merge)
  3. Calculate `available_slots = max_active - active_count`
  4. If no slots → `capacity_full`, return
  5. Find all `todo` items for the project
  6. Filter: all `depends_on` items are `done`
  7. Sort by priority (p0 > p1 > p2 > p3), then `createdAt`
  8. Take `min(available_slots, eligible.length)` candidates
  9. Emit dispatch event

**Acceptance Criteria:**

- [ ] No references to `parentId`, `PARENT_ACTIVE_STATUSES`, or hierarchy filtering
- [ ] Dispatch decision based solely on: capacity, dependency readiness, priority
- [ ] An item whose dependencies are all `done` and capacity is available is dispatched
- [ ] No capacity deadlock possible (no parent consuming slot before children)
- [ ] Unit tests validate simplified dispatch logic

---

### Task 7: Update Spec Parser

**Goal:** Remove `type` and `parent` frontmatter parsing, add `scope`.

**Files:**

- `apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts`
- Test file if exists

**Changes:**

- Remove `type` field parsing and validation
- Remove `parent` field parsing
- Add `scope` field parsing: optional, enum `['standard', 'large']`, default `'standard'`
- Update `ParsedSpec` type: remove `type` and `parent`, add `scope`

**Acceptance Criteria:**

- [ ] `ParsedSpec` has no `type` or `parent` fields
- [ ] `ParsedSpec` has `scope: 'standard' | 'large'`
- [ ] Specs without explicit `scope` default to `'standard'`
- [ ] Invalid `scope` values logged as warning, default to `'standard'`
- [ ] Unit tests cover new format

---

### Task 8: Update Batch Helpers

**Goal:** Remove parent-id resolution and type-based logic from hydration batch helpers.

**Files:**

- `apps/api/src/workflow/step-hydrate-work-items-batch.helpers.ts`
- `apps/api/src/workflow/step-hydrate-work-items-batch.helpers.spec.ts`

**Changes:**

- Remove `resolveSlugFromMap()` function (prefix matching was for parent slug resolution)
- Remove `parentId` from `buildHydratedCreatePayload()` output
- Add `scope` to `buildHydratedCreatePayload()` output
- Simplify `resolveHydratedDependencyIds()` to use direct `Map.get()` (exact slug match only)

**Acceptance Criteria:**

- [ ] No `resolveSlugFromMap` function
- [ ] `buildHydratedCreatePayload` returns `scope` instead of `parentId`
- [ ] Dependency resolution uses exact slug matching
- [ ] All unit tests updated and passing

---

### Task 9: Update Hydration Handler

**Goal:** Remove type-precedence sorting and parent backfill from spec hydration.

**Files:**

- `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`
- `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.spec.ts`

**Changes:**

- Remove `TYPE_PRECEDENCE` sorting (no need to create epics before stories)
- Remove `backfillMissingParentIds()` method entirely
- Remove any `parentId`-related logic in `deduplicateSpecs()`
- Items sorted only by `priority` and `createdAt` for deterministic ordering

**Acceptance Criteria:**

- [ ] No type-based sorting
- [ ] No `backfillMissingParentIds` method or calls
- [ ] Hydration creates flat work items with `scope` and `depends_on` only
- [ ] All unit tests updated and passing

---

### Task 10: Update Repository and Service

**Goal:** Remove parent-child query methods and validation from the data access layer.

**Files:**

- `apps/api/src/database/repositories/work-item.repository.ts`
- `apps/api/src/project/work-item.service.ts`

**Changes in Repository:**

- Remove `findByParentId()` method
- Remove `findByParentIdAndStatuses()` method
- Remove any query builder usage filtering on `parentId`

**Changes in Service:**

- Remove parent-child validation logic
- Remove `findByParentId` calls
- Remove any `type`-based branching
- Remove imports of cascade helpers

**Acceptance Criteria:**

- [ ] No `findByParentId` or `findByParentIdAndStatuses` methods in repository
- [ ] No `type` or `parentId` references in service
- [ ] All callers of removed methods updated
- [ ] Compilation clean, tests passing

---

### Task 11: Update Workflow Seeds

**Goal:** Remove the epic router workflow seed and update any type references in other seeds.

**Files:**

- `apps/api/src/database/seeds/` — seed runner/loader file
- Delete: `apps/api/src/database/seeds/work-item-epic-in-progress-router.workflow.yaml` (if not already deleted in Task 4)

**Changes:**

- Remove `work-item-epic-in-progress-router.workflow.yaml` from the workflow seed list
- Update any YAML workflow definitions that reference `type`, `parentId`, or children in their trigger/condition logic
- Ensure `work-item-in-progress-default.workflow.yaml` handles all items uniformly

**Acceptance Criteria:**

- [ ] Epic router workflow not seeded to database
- [ ] No YAML workflows reference `type` or `parentId` in conditions
- [ ] Implementation workflow triggers for all work items equally

---

### Task 12: Update System Settings

**Goal:** Remove hierarchy-related system settings that are no longer needed.

**Files:**

- System settings seed/initialization code (search for `work_item_epic_child_dispatch_mode`)

**Changes:**

- Remove `work_item_epic_child_dispatch_mode` setting (sequential/parallel child dispatch is irrelevant)
- Any setting specifically for epic routing or child promotion

**Acceptance Criteria:**

- [ ] No system settings reference epic children or dispatch mode for children
- [ ] System settings service has no dead references

---

### Task 13: Comprehensive Test Sweep

**Goal:** Ensure all existing tests pass with the hierarchy removal and update tests to match new model.

**Changes:**

- Run full `vitest` unit test suite — fix any failures from removed fields/methods
- Run `vitest` e2e test suite — fix any failures from hierarchy assumptions
- Update test factories/fixtures: remove `type`, `parentId` from work item creation helpers
- Add new tests for `scope` field behavior in dispatch and hydration

**Acceptance Criteria:**

- [ ] All unit tests pass (`npx vitest run` in `apps/api`)
- [ ] All e2e tests pass (`npm run test:e2e:kanban`)
- [ ] TypeScript compilation clean (`npx tsc --noEmit` in `apps/api`)
- [ ] ESLint clean (`npx eslint .` in `apps/api`)

---

### Task 14: PM Breakdown Prompt Update

**Goal:** Update the product-manager agent profile's system prompt to produce the new spec format.

**Files:**

- `apps/api/src/database/seeds/agent-profiles/` — PM profile definition
- Review workflow prompts that reference spec structure

**Changes:**

- Update PM system prompt: produce fewer, richer specs per feature (not 20+ tiny files)
- Each spec should have: overview, deliverables sections, acceptance criteria, technical notes
- Instruct PM to set `scope: large` for multi-module features and use `depends_on` for ordering
- Remove instructions about creating epic/story/task type files

**Acceptance Criteria:**

- [ ] PM agent prompt no longer references `type: epic`, `type: story`, or `type: task`
- [ ] PM agent prompt instructs producing cohesive specs with `scope` and `depends_on`
- [ ] Review workflow prompt updated to validate new spec format (no type checking)

## File Plan

### Files to Create

| File                                             | Purpose                          |
| ------------------------------------------------ | -------------------------------- |
| `apps/api/scripts/migrate-flatten-hierarchy.sql` | Production data migration script |

### Files to Delete

| File                                                                          | Reason                   |
| ----------------------------------------------------------------------------- | ------------------------ |
| `apps/api/src/project/work-item-cascade.helpers.ts`                           | No parent-child cascades |
| `apps/api/src/workflow/step-promote-children-special-step.handler.ts`         | No children to promote   |
| `apps/api/src/workflow/step-promote-children-special-step.handler.spec.ts`    | Test for deleted handler |
| `apps/api/src/database/seeds/work-item-epic-in-progress-router.workflow.yaml` | Epic router workflow     |

### Files to Modify

| File                                                                         | Changes                          |
| ---------------------------------------------------------------------------- | -------------------------------- |
| `apps/api/src/database/entities/work-item.entity.ts`                         | Remove type, parentId; add scope |
| `apps/api/src/project/work-item-dispatch-coordinator.service.ts`             | Remove hierarchy filtering       |
| `apps/api/src/project/work-item-automation.service.ts`                       | Remove type-based routing        |
| `apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts`               | Update frontmatter parsing       |
| `apps/api/src/workflow/step-hydrate-work-items-batch.helpers.ts`             | Remove parent resolution         |
| `apps/api/src/workflow/step-hydrate-work-items-batch.helpers.spec.ts`        | Update tests                     |
| `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`      | Remove type sorting, backfill    |
| `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.spec.ts` | Update tests                     |
| `apps/api/src/project/work-item.service.ts`                                  | Remove parent-child methods      |
| `apps/api/src/database/repositories/work-item.repository.ts`                 | Remove parent-child queries      |
| PM agent profile in `apps/api/src/database/seeds/agent-profiles/`            | New spec format instructions     |

## Risks and Mitigations

| Risk                                              | Impact                                                   | Mitigation                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Large work items overwhelm single agent session   | Agent cannot complete all deliverables in context window | `scope: large` advisory hint prepared for Phase 2 (EPIC-044). Until then, PM should keep scope reasonable.                            |
| Existing in-flight epics break mid-execution      | Data integrity issue                                     | Only apply migration to idle projects. In-flight items (`in-progress`, `in-review`) continue on current code until they reach `done`. |
| PM produces specs that are too large or too small | Quality degradation                                      | Review workflow validates spec completeness and scope. System setting for max spec size can be added.                                 |
| Dependency cycles block dispatch indefinitely     | Deadlock                                                 | Existing cycle detection in `WorkItemDependency` creation prevents cycles. No new risk.                                               |
| Web UI breaks from missing `type` field           | Frontend crashes                                         | Coordinate with web team. `type` removal should be handled gracefully (default rendering).                                            |

## Dependencies

- None — this is a foundation phase with no prerequisites.

## Operational Notes

- TypeORM `synchronize: true` in dev means entity changes auto-apply on restart.
- Production environments need the SQL migration script run manually before deployment.
- The `scope` column is purely advisory in this phase — it has no behavioral effect until Phase 2 (EPIC-044) implements the planning step.

## Definition of Done

- [ ] All hierarchy-related code deleted (cascade helpers, promote children, epic router)
- [ ] Entity has no `type` or `parentId`, has `scope`
- [ ] Dispatch coordinator uses only: capacity + dependency readiness + priority
- [ ] Spec parser handles new frontmatter format (no `type`/`parent`, has `scope`)
- [ ] All unit tests pass
- [ ] E2E kanban lifecycle test passes
- [ ] TypeScript compilation clean
- [ ] ESLint clean
- [ ] Migration script tested against existing data
- [ ] PM agent prompt updated for new spec format
