# EPIC: Epic → Child Work Item Lifecycle Management

**Epic ID:** EPIC-040  
**Status:** Not Started  
**Created:** 2026-04-01  
**Priority:** P0 - Critical  
**Theme:** Workflow-Driven Kanban Automation  
**Depends On:** EPIC-034 (Workflow-Driven Kanban Lifecycle), EPIC-037 (Spec-Driven Work Item Hydration), EPIC-038 (Work Item Priority, Dependencies, Auto-Dispatch), EPIC-039 (Agent-Session Dispatch Selection)

---

## 1. Executive Summary

### 1.1 Problem Statement

When the dispatch coordinator selects an **epic** for execution, the epic moves through the full kanban lifecycle (`todo → in-progress → in-review → ready-to-merge → done`) as though it were a single task. Its **child stories and tasks remain stranded** in their original status (`backlog` or `todo`), producing an inconsistent board state where an epic can be `done` while its children have never been touched.

Furthermore, if multiple children of an epic are promoted and dispatched concurrently without dependency ordering, agents working on dependent tasks (e.g., "use the database models" before "create the database models") will either **fail** because prerequisite code doesn't exist on the branch, or **duplicate** each other's work, causing merge conflicts.

The system has no concept of an epic as a **parent container** that coordinates its children's execution. It treats every work item type identically.

### 1.2 Solution Overview

Implement a hierarchical work item lifecycle system that:

- **detects the execution mode** for an epic (direct-implement vs. route-to-children) based on whether children exist,
- **promotes child work items** from `backlog` to `todo` when the parent epic enters `in-progress`, making them eligible for the existing dispatch coordinator,
- **enforces execution ordering** between sibling children via the existing dependency graph (`depends_on` field in spec frontmatter + dispatch coordinator filtering),
- **auto-completes parent epics** when all children reach `done`,
- **cascades blocking status** from parent to children and vice versa,
- **enriches agent context** so implementation agents know whether they're working on an epic or a child, and always have access to the full hierarchy context.

All new behavior is implemented through the existing event-driven workflow architecture — no hardcoded cascade logic in `updateStatus()`.

### 1.3 Success Criteria

- An epic with children, when dispatched, promotes its children instead of being implemented directly.
- Child work items are dispatched in dependency-safe order; no child starts before its declared dependencies are `done`.
- An epic with no children is implemented directly by an agent with full epic-scope context.
- When all children of an epic reach `done`, the parent epic auto-transitions to `done`.
- When an epic is moved to `blocked`, its active children are also blocked.
- The dispatch agent sees work item `type` in the candidate list and can reason about epic vs. story vs. task.
- Implementation agents receive parent epic context when working on a child item.
- Decomposition agents produce spec files with `depends_on` declarations between sibling items.
- A `sequential` fallback mode guarantees serial child execution when explicit dependencies are not declared.
- All new behavior is backwards compatible — existing epics without children work exactly as before.

---

## 2. Context & Background

### 2.1 Current System Architecture

The kanban work item system is built on a fully event-driven workflow architecture:

| Component                   | Current State                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Work Item Entity**        | Supports `type` (epic/story/task), `parentId` for hierarchy, `status` for kanban column, `executionConfig` for branch/agent/context configuration.                                                                 |
| **Status Transitions**      | `updateStatus()` validates allowed transitions, triggers automation workflows via `WorkItemAutomationService.triggerStatusTransition()`, and emits dispatch reconcile events.                                      |
| **Dispatch Coordinator**    | Queries `todo` candidates sorted by priority, filters by dependency readiness (`filterDependencyReadyCandidates`), emits `WorkItemDispatchSelectEvent` for agent-based selection.                                  |
| **Dependency System**       | Directed edge table (`work_item_dependencies`), cycle detection (DFS), `dependencyIds` in create/update DTOs, dispatch filtering that only releases items whose ALL dependencies are `done`.                       |
| **Spec Hydration**          | `step-hydrate-work-items-special-step.handler.ts` parses YAML frontmatter from `docs/work-items/*.md`, creates work items with `parent` slug resolution via `slugToId` map. Does NOT currently parse `depends_on`. |
| **Implementation Workflow** | `work-item-in-progress-default.workflow.yaml`: provisions worktree → heavy agent implements → commit loop → transition to `in-review`.                                                                             |
| **Review Workflow**         | `work-item-in-review-default.workflow.yaml`: QA agent reviews → accept/reject via `submit_qa_decision`.                                                                                                            |
| **Merge Workflow**          | `work-item-ready-to-merge-default.workflow.yaml`: auto-merge → conflict resolution → cleanup worktree → transition to `done` → emit `WorkItemMergeCompletedEvent`.                                                 |
| **Post-Merge Hydration**    | `work-item-post-merge-spec-hydration.workflow.yaml`: scans merged branch for new spec files → creates work items on kanban board.                                                                                  |

### 2.2 Current Gaps

| #   | Gap                                                    | Location                                          | Impact                                                                                                                                               |
| --- | ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **No type-aware dispatch**                             | `WorkItemDispatchCoordinatorService`              | Epics are dispatched and executed identically to tasks. The `WorkItemCandidate` interface doesn't expose `type` to the dispatch agent.               |
| G2  | **No cascade on status change**                        | `WorkItemService.updateStatus()`                  | Transitions only affect the single work item. No code queries or updates children.                                                                   |
| G3  | **No parent-child query method**                       | `WorkItemRepository`                              | No `findByParentId()` or `findByParentIdAndStatuses()` method exists. Children are only discoverable by filtering the full project list client-side. |
| G4  | **In-progress workflow is type-blind**                 | `work-item-in-progress-default.workflow.yaml`     | Agent prompt injects `title`, `description`, `contextFiles` — but NOT `type`, child items, or parent epic context.                                   |
| G5  | **No child promotion on epic start**                   | `transition_status` handler                       | After epic → in-progress, nothing touches children.                                                                                                  |
| G6  | **No auto-completion of parent**                       | `applyStatusTransitionEffects()`                  | When last child → done, nothing checks or completes the parent epic.                                                                                 |
| G7  | **No `depends_on` in spec frontmatter**                | `step-hydrate-work-items-special-step.handler.ts` | The frontmatter parser only supports `type`, `title`, `priority`, `parent`. Sibling dependencies cannot be declared at spec authoring time.          |
| G8  | **No dependency instruction in decomposition prompts** | Inception/decomposition workflows                 | The agent that generates spec files is never told to declare ordering dependencies between items.                                                    |
| G9  | **No parent context for child agents**                 | Trigger payload construction                      | When a child story/task is dispatched, the agent has no knowledge of the parent epic's title, description, or context files.                         |
| G10 | **No epic progress tracking in UI**                    | `KanbanBoard.tsx`                                 | Epic cards don't show child completion progress (e.g., "3/5 tasks done").                                                                            |

### 2.3 Why This Matters

Without this epic, the system's ability to handle multi-item projects is fundamentally broken:

1. **Wasted compute:** An agent implements an entire epic as a monolithic task, miss the granular stories/tasks which were carefully decomposed.
2. **Board inconsistency:** Users see an epic marked `done` while its sub-items are `backlog` — eroding trust in the system.
3. **Concurrency conflicts:** If children are naively promoted together, dependent tasks race each other, producing failures or duplicated work.
4. **Lost context:** Child agents don't know they're part of a larger epic and may make decisions that conflict with the epic's overall design.

---

## 3. User Stories

### 3.1 Epic Execution with Children

> **As a PM**, I want the system to automatically promote an epic's child stories/tasks when the epic is dispatched, so I don't have to manually move each child across the board.

> **As a PM**, I want children to execute in the correct order based on declared dependencies, so Task B ("use the database models") doesn't start before Task A ("create the database models") is done and merged.

> **As a PM**, I want the epic to auto-complete when all its children finish, so the board accurately reflects project progress without manual intervention.

### 3.2 Small Epic (Direct Implementation)

> **As a PM**, I want small epics with no children to be implemented directly by a single agent, treating them like a large task with full epic-scope context.

### 3.3 Agent Context

> **As a Developer Agent**, when I'm implementing a child task, I want to see the parent epic's title, description, and context files so I understand the larger feature I'm contributing to.

> **As a Developer Agent**, when I'm implementing a small epic directly, I want to see the full list of planned child stories/tasks (if any) so I can implement everything in scope.

### 3.4 Dependency Declaration

> **As a Decomposition Agent**, when I generate spec files for an epic's children, I want clear instructions to declare `depends_on` relationships so the dispatch system can order execution correctly.

> **As a QA Reviewer Agent**, I want to flag spec decompositions that are missing dependency declarations between items that clearly have implicit ordering requirements.

### 3.5 Dispatch Intelligence

> **As a Dispatch Agent**, I want to see the `type` of each candidate work item (epic/story/task), so I can make informed decisions about what to dispatch.

### 3.6 Safety & Configuration

> **As an Admin**, I want a project-level setting to choose between `parallel` (dependency-driven) and `sequential` (one-at-a-time) child dispatch, so I can trade off speed for safety.

> **As a PM**, I want the system to block active children when I manually block an epic, preventing wasted compute on a paused feature.

### 3.7 Observability

> **As a PM**, I want epic cards on the kanban board to show child progress (e.g., "3/5 done"), so I can see at a glance how a feature is progressing.

---

## 4. Technical Design

### 4.1 Epic Execution Mode Router

When a work item of type `epic` transitions to `in-progress`, the system must determine an execution mode before starting any workflow:

| Mode                   | Condition               | Behavior                                                                                                                                                                                |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`direct-implement`** | Epic has 0 children     | Execute the epic like a task — full implementation workflow with enhanced context.                                                                                                      |
| **`children-exist`**   | Epic has ≥1 child items | Don't implement the epic itself. Promote eligible children to `todo` based on dispatch mode setting. Epic remains `in-progress` as a passive tracker — no worktree, no agent container. |

**Implementation approach:** A new workflow `work-item-epic-router.workflow.yaml` triggered by `kanban.ticket.in_progress` for epics. Uses conditional transitions based on `trigger.childCount` injected by the enriched trigger payload.

For `direct-implement` mode, the router delegates to the existing `work-item-in-progress-default` workflow (or a variant with enhanced epic context). For `children-exist` mode, it runs a `promote_children` special step.

### 4.2 Trigger Payload Enrichment

**Current trigger payload** (from `WorkItemAutomationService.triggerStatusTransition`):

```typescript
{
  (event,
    projectId,
    workItemId,
    fromStatus,
    toStatus,
    workItem,
    executionConfig);
}
```

**Enriched trigger payload** (for epics):

```typescript
{
  ...existingPayload,
  children: WorkItem[],        // all children of this epic
  childCount: number,          // children.length
  childrenByStatus: Record<WorkItemStatus, WorkItem[]>,  // grouped
}
```

**Enriched trigger payload** (for stories/tasks with a parent):

```typescript
{
  ...existingPayload,
  parentEpic: {
    id: string,
    title: string,
    description: string,
    type: string,
    contextFiles: string[],
  },
}
```

### 4.3 `promote_children` Special Step Type

A new special step handler registered alongside existing types (`transition_status`, `emit_event`, etc.):

**Type name:** `promote_children`

**Inputs:**

```yaml
inputs:
  parent_id: "{{ trigger.workItemId }}"
  from_status: backlog
  to_status: todo
  mode: "{{ trigger.dispatchMode }}" # parallel | sequential
```

**Behavior:**

- Queries children by `parentId` with status matching `from_status`.
- In `parallel` mode: promotes ALL matching children to `to_status`.
- In `sequential` mode: promotes only the FIRST child (sorted by priority p0→p3, then `createdAt` ASC, then `id` ASC).
- Calls `updateStatus()` for each promoted child with `suppressAutomation: false` (allowing downstream dispatch reconciliation).
- Returns count of promoted items in step output.

### 4.4 Spec Frontmatter `depends_on` Support

**Current frontmatter:**

```yaml
---
type: task
title: Create auth API endpoints
priority: p1
parent: EPIC-user-authentication
---
```

**Extended frontmatter:**

```yaml
---
type: task
title: Create auth API endpoints
priority: p1
parent: EPIC-user-authentication
depends_on: TASK-implement-database-models, TASK-setup-middleware
---
```

**Parsing:** The frontmatter parser is key-value based (no YAML array support). `depends_on` is parsed as a comma-separated string of slugs (file names without `.md`), split and trimmed.

**Resolution:** In `createWorkItemBatches()`, after each batch is created and IDs are mapped into `slugToId`, dependency slugs are resolved to UUIDs. The resolved `dependencyIds` array is passed to `createMany()`, which calls `setDependencies()` per item — leveraging the full existing dependency pipeline (cycle detection, validation, etc.).

**Ordering concern:** Items are created in type-precedence order (epics → stories → tasks). For same-type dependencies (e.g., task depends on task), both are in the same batch. Since `createMany` returns items in input order and `slugToId` is populated after each sub-batch, we may need to process the batch in two passes: (1) create all items, (2) set dependencies after all IDs are known. This avoids the case where a task references another task that hasn't been created yet.

### 4.5 Auto-Complete Parent When All Children Done

**Trigger:** Any work item transitions to `done`.

**Logic (in `applyStatusTransitionEffects` or a new event listener):**

```
if (workItem.parentId) {
  parent = findById(workItem.parentId)
  if (parent.type === 'epic' && parent.status === 'in-progress') {
    siblings = findByParentId(workItem.parentId)
    if (siblings.every(s => s.status === 'done')) {
      updateStatus(projectId, parent.id, {
        status: 'done',
        suppressAutomation: true  // prevent triggering implementation on the parent
      })
    }
  }
}
```

**Guards:**

- Only fires for items that have a `parentId`.
- Only auto-completes if parent is `in-progress` (not if it was manually moved elsewhere).
- Uses `suppressAutomation: true` to prevent the parent's `done` transition from triggering implementation/merge workflows on the epic itself.
- The parent status transition _does_ emit a dispatch reconcile event (other items may be waiting).

### 4.6 Auto-Complete Orphan Children When Epic Done Directly

**Trigger:** An epic transitions to `done` (from direct-implement mode).

**Logic:**

```
if (workItem.type === 'epic') {
  children = findByParentId(workItem.id)
  for (child of children) {
    if (child.status in ['backlog', 'todo']) {
      updateStatus(projectId, child.id, {
        status: 'done',
        suppressAutomation: true,
        metadata: { autoCompletedReason: 'parent_epic_done_directly' }
      })
    }
  }
}
```

### 4.7 Block Cascade (Epic → Blocked)

**Trigger:** An epic transitions to `blocked`.

**Logic:**

```
if (workItem.type === 'epic') {
  children = findByParentIdAndStatuses(workItem.id, ['in-progress', 'todo'])
  for (child of children) {
    updateStatus(projectId, child.id, {
      status: 'blocked',
      suppressAutomation: true,
      metadata: { blockedReason: 'parent_epic_blocked' }
    })
  }
}
```

**Note:** In-progress children with active agent sessions will need their workflows cancelled or paused. This may hook into the existing workflow cancellation mechanism.

### 4.8 Sequential Next-Child Promotion

**Trigger:** A child transitions to `done` AND the parent's dispatch mode is `sequential`.

**Logic:**

```
if (workItem.parentId) {
  parent = findById(workItem.parentId)
  dispatchMode = getProjectSetting('work_item_epic_child_dispatch_mode')
  if (dispatchMode === 'sequential' && parent.status === 'in-progress') {
    nextChild = findFirstByParentIdAndStatus(parent.id, 'backlog')  // priority-sorted
    if (nextChild) {
      updateStatus(projectId, nextChild.id, { status: 'todo' })
    }
    // (If no backlog children remain, auto-complete check from 4.5 handles it)
  }
}
```

### 4.9 Dispatch Candidate Type Visibility

The `WorkItemCandidate` interface currently omits `type`:

```typescript
interface WorkItemCandidate {
  id: string;
  projectId: string;
  title: string;
  priority: string;
  status: string;
  updatedAt?: Date;
  dependsOn?: string[];
}
```

Add `type: string` to the interface. The full `WorkItem` entity already carries `type` — just surface it in the candidate projection.

The dispatch workflow prompt should be updated to indicate type:

```yaml
Candidate work items (already dependency-eligible and priority-sorted):
{{ trigger.candidates }}

Each candidate includes: id, type, title, priority, dependsOn.
Consider work item type when making selection decisions.
```

### 4.10 Implementation Workflow Prompt Enhancement

**For all work items** — add `type` to the prompt:

```yaml
- Type: { { trigger.workItem.type } }
```

**For epics in direct-implement mode** — add children context:

```yaml
{{#if trigger.children.length}}
This is an EPIC with the following planned child stories/tasks.
You must implement ALL of them as part of this epic:
{{#each trigger.children}}
- [{{this.type}}] {{this.title}} (priority: {{this.priority}})
  {{this.description}}
{{/each}}
{{/if}}
```

**For child items** — add parent context:

```yaml
{{#if trigger.parentEpic}}
This task is part of a larger epic:
- Epic: {{trigger.parentEpic.title}}
- Epic Description: {{trigger.parentEpic.description}}
- Epic Context Files: {{trigger.parentEpic.contextFiles}}

Ensure your implementation aligns with the epic's overall design.
{{/if}}
```

---

## 5. End-to-End Flow: Epic with Children (Parallel Mode)

```
Phase 1 — Dispatch Selection
─────────────────────────────
1. Dispatch coordinator reconciles
   → Finds available slots
   → Queries todo candidates (includes Epic X, type: epic)
   → Filters by dependency readiness
   → Emits WorkItemDispatchSelectEvent

2. Dispatch agent sees candidates including "Epic X (type: epic)"
   → Calls `kanban.dispatch_selected_work_items` with `epic-x-id`

3. Backend transitions Epic X → in-progress
   → Emits kanban.ticket.in_progress


Phase 2 — Epic Router (NEW)
────────────────────────────
4. Epic router workflow triggers
   → Trigger payload includes:
     children: [A, B, C, D, E], childCount: 5
   → Router detects childCount > 0 → children-exist mode

5. promote_children step runs (parallel mode)
   → All 5 children promoted: backlog → todo
   → Dispatch reconcile emitted

   Board state:
   Epic X:    in-progress (tracker — no agent, no worktree)
   Task A:    todo  (depends_on: none)
   Task B:    todo  (depends_on: [A])
   Task C:    todo  (depends_on: [B])
   Task D:    todo  (depends_on: [B])
   Task E:    todo  (depends_on: [A])


Phase 3 — Dependency-Aware Dispatch (existing)
───────────────────────────────────────────────
6. Dispatch coordinator reconciles
   → filterDependencyReadyCandidates:
     A: deps=[]  → ✅ eligible
     B: deps=[A] → A is todo, not done → ❌ blocked
     C: deps=[B] → B is todo, not done → ❌ blocked
     D: deps=[B] → B is todo, not done → ❌ blocked
     E: deps=[A] → A is todo, not done → ❌ blocked
   → Only A dispatched

7. Task A: implement → review → merge → done
   (each child goes through the FULL lifecycle:
    in-progress → in-review → ready-to-merge → done)


Phase 4 — Cascade Unlock (existing dispatch + NEW parent check)
───────────────────────────────────────────────────────────────
8. A → done triggers reconcile
   → B: deps=[A] → A is done → ✅ eligible
   → E: deps=[A] → A is done → ✅ eligible
   → B and E dispatched CONCURRENTLY (safe: no dep between them)
   → Both branch off main which now contains A's merged code

9. B → done, E → done → reconcile →
   → C: deps=[B] → B done → ✅ eligible
   → D: deps=[B] → B done → ✅ eligible
   → C and D dispatched concurrently

10. C → done, D → done


Phase 5 — Epic Auto-Completion (NEW)
─────────────────────────────────────
11. When D (last child) → done:
    → Check: all siblings A,B,C,D,E are done? YES
    → Auto-transition Epic X → done (suppressAutomation=true)

    Final board state:
    Epic X: done ✅     Task D: done ✅
    Task A: done ✅     Task E: done ✅
    Task B: done ✅
    Task C: done ✅


Timeline Visualization
──────────────────────
Time →

Slot 1: ████ A ████████░░░░░░░░████ B ████████░░████ C ████████░░
Slot 2: ░░░░░░░░░░░░░░░░░░░░████ E ████████░░████ D ████████░░
                                                              ↑ epic auto-done
```

---

## 6. End-to-End Flow: Small Epic (No Children)

```
1. Dispatch agent picks Epic Y (type: epic, 0 children)
2. Epic Y → in-progress
3. Epic router detects childCount == 0 → direct-implement mode
4. work-item-in-progress-default fires with enhanced prompt:
   - Type: epic
   - Full epic description
   - Context files (auto-linked EPIC-*.md spec)
5. Agent implements all scope in a single session
6. Epic Y → in-review → ready-to-merge → done
7. Post-merge hydration scans for specs:
   - If agent created child spec files → hydrate_work_items creates children
   - Children are created in backlog with autoCompletedReason metadata
     (parent already done — or they remain in backlog for future work)
```

---

## 7. Implementation Tasks

### Phase 1: Foundation — Backend Query & Payload Plumbing

All tasks in this phase are backend-only with no user-facing changes.

#### Task 1.1: Add `findByParentId()` Repository Method

**File:** `apps/api/src/database/repositories/work-item.repository.ts`

**Description:** Add a method to query all child work items for a given parent ID, ordered by priority (p0→p3), then `createdAt` ASC, then `id` ASC (deterministic tie-breaker matching dispatch ordering).

**Acceptance Criteria:**

- [ ] Method `findByParentId(parentId: string): Promise<WorkItem[]>` exists.
- [ ] Returns all work items where `parent_id = :parentId`.
- [ ] Results are ordered by priority precedence, then `created_at ASC`, then `id ASC`.
- [ ] Unit test: returns correct children for a parent; returns empty for parent with no children; does not return items from other parents.

#### Task 1.2: Add `findByParentIdAndStatuses()` Repository Method

**File:** `apps/api/src/database/repositories/work-item.repository.ts`

**Description:** Add a method to query children filtered by one or more statuses. Used by promote_children (filter backlog), block cascade (filter in-progress/todo), and auto-complete check (verify all are done).

**Acceptance Criteria:**

- [ ] Method `findByParentIdAndStatuses(parentId: string, statuses: WorkItemStatus[]): Promise<WorkItem[]>` exists.
- [ ] Filters by `parent_id = :parentId AND status IN (:...statuses)`.
- [ ] Same ordering as `findByParentId()`.
- [ ] Unit test: returns only matching-status children; returns empty when no children match.

#### Task 1.3: Add `type` to `WorkItemCandidate` Interface

**File:** `apps/api/src/project/work-item-dispatch-coordinator.service.ts`

**Description:** Expose the `type` field in the `WorkItemCandidate` interface so the dispatch agent can see whether a candidate is an epic, story, or task.

**Acceptance Criteria:**

- [ ] `WorkItemCandidate` includes `type: string`.
- [ ] Type is populated from the `WorkItem.type` field in candidate queries.
- [ ] Dispatch select event payload includes `type` for each candidate.
- [ ] Unit test: verify candidate objects include type.

#### Task 1.4: Enrich Trigger Payload with Children (Epics)

**File:** `apps/api/src/project/work-item-automation.service.ts`

**Description:** When `triggerStatusTransition()` fires for a work item of type `epic`, query its children and attach them to the trigger payload.

**Acceptance Criteria:**

- [ ] When `workItem.type === 'epic'`, trigger payload includes `children: WorkItem[]`, `childCount: number`, and `childrenByStatus: Record<string, WorkItem[]>`.
- [ ] When `workItem.type !== 'epic'`, no additional fields are added (no overhead).
- [ ] Unit test: trigger payload for epic includes correct children; for task/story, children fields are absent.

#### Task 1.5: Enrich Trigger Payload with Parent Epic (Children)

**File:** `apps/api/src/project/work-item-automation.service.ts`

**Description:** When `triggerStatusTransition()` fires for a work item with a `parentId`, query the parent and attach summary context.

**Acceptance Criteria:**

- [ ] When `workItem.parentId` is set, trigger payload includes `parentEpic: { id, title, description, type, contextFiles }`.
- [ ] `contextFiles` is sourced from `parent.executionConfig?.contextFiles` merged with `parent.metadata?.contextFiles`.
- [ ] When `workItem.parentId` is null, `parentEpic` is absent.
- [ ] Unit test: trigger payload for child includes parent context; for orphan items, parentEpic is absent.

---

### Phase 2: Spec Frontmatter `depends_on` Support

#### Task 2.1: Parse `depends_on` in Spec Frontmatter

**File:** `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`

**Description:** Extend `parseSpecFile()` to extract a `depends_on` field from YAML frontmatter. The value is a comma-separated list of slugs (spec file names without `.md`).

**Acceptance Criteria:**

- [ ] `ParsedSpec` interface includes `dependsOn?: string[]`.
- [ ] `parseSpecFile()` reads `depends_on` from frontmatter, splits by comma, trims whitespace.
- [ ] Missing `depends_on` results in `undefined` (not an empty array).
- [ ] Single-slug value works: `depends_on: TASK-foo` → `['TASK-foo']`.
- [ ] Multi-slug value works: `depends_on: TASK-foo, TASK-bar` → `['TASK-foo', 'TASK-bar']`.
- [ ] Empty value results in `undefined`.
- [ ] Unit test: all above parsing scenarios.

#### Task 2.2: Resolve Dependency Slugs to IDs During Hydration

**File:** `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`

**Description:** In `createWorkItemBatches()`, after creating each batch and populating `slugToId`, resolve `dependsOn` slugs to UUIDs and set dependencies via the existing `setDependencies()` pipeline.

**Implementation note:** For same-type dependencies (task depends on task), both items are created in the same `createMany` call. Dependencies must be set in a second pass after all items in the batch have IDs. Refactor batch creation to:

1. Create all items in the batch (without dependencies).
2. Populate `slugToId` for all newly created items.
3. For each item with `dependsOn`, resolve slugs → IDs and call `setDependencies()`.

**Acceptance Criteria:**

- [ ] `depends_on: TASK-foo` in frontmatter creates a dependency edge from this item to TASK-foo's work item ID.
- [ ] Cross-type dependencies work (story depends on another story, task depends on task).
- [ ] Missing slug (not found in `slugToId`) produces a warning but does not block creation.
- [ ] Circular dependency is rejected with a warning (leverages existing cycle detection).
- [ ] Self-dependency in spec is rejected with a warning.
- [ ] Unit test: dependency edges are correctly created; missing slug logs warning; cycle is caught.
- [ ] Integration test: hydrate specs with `depends_on` → verify dispatch coordinator correctly blocks dependent items.

#### Task 2.3: Update Decomposition Agent Prompts

**Files:** Inception/decomposition workflow YAML seeds

**Description:** Instruct the agent that generates spec files to declare `depends_on` relationships between sibling items.

**Acceptance Criteria:**

- [ ] Decomposition agent prompt includes explicit instructions to use `depends_on: <slug>` in frontmatter.
- [ ] Instructions specify comma-separated format for multiple dependencies.
- [ ] Instructions specify to only declare DIRECT dependencies (not transitive).
- [ ] Instructions include an example spec file with `depends_on`.

---

### Phase 3: Epic Router & Child Promotion

#### Task 3.1: Create `promote_children` Special Step Handler

**Files:**

- `apps/api/src/workflow/step-promote-children-special-step.handler.ts` (new)
- `apps/api/src/workflow/workflow.module.ts` (register handler)
- `apps/api/src/workflow/step-special-step.types.ts` (add type)

**Description:** Implement a new special step handler that promotes children of a parent work item from one status to another, respecting the dispatch mode setting.

**Inputs:**

```yaml
parent_id: string # parent work item ID
from_status: string # status to match (e.g., 'backlog')
to_status: string # status to transition to (e.g., 'todo')
mode: string # 'parallel' | 'sequential'
```

**Acceptance Criteria:**

- [ ] In `parallel` mode: ALL children with matching `from_status` are transitioned to `to_status`.
- [ ] In `sequential` mode: only the FIRST child (priority-sorted, then `createdAt`, then `id`) is transitioned.
- [ ] Each child transition calls `updateStatus()` (which triggers dispatch reconciliation).
- [ ] Step output includes `{ promoted_count, promoted_ids, remaining_count }`.
- [ ] Unit test: parallel promotes all; sequential promotes one; no-match returns zero.
- [ ] Handler is registered in the special step type union.

#### Task 3.2: Add `work_item_epic_child_dispatch_mode` Setting

**Files:**

- `apps/api/src/settings/system-settings.service.ts`
- System settings seed/default

**Description:** Add a project-scoped setting controlling how epic children are dispatched.

**Acceptance Criteria:**

- [ ] Setting `work_item_epic_child_dispatch_mode` with valid values: `'parallel'`, `'sequential'`.
- [ ] Default value: `'sequential'` (safe default).
- [ ] Retrievable via `systemSettings.get()` (same pattern as `work_item_dispatch_max_active_per_project`).
- [ ] Unit test: default value is correct; overridden value is respected.

#### Task 3.3: Create Epic Router Workflow YAML

**File:** `apps/api/src/database/seeds/work-item-epic-in-progress-router.workflow.yaml` (new)

**Description:** A workflow triggered by `kanban.ticket.in_progress` for epics that detects the execution mode and either promotes children or delegates to direct implementation.

**Workflow structure:**

```yaml
trigger:
  type: webhook
  event: kanban.ticket.in_progress

jobs:
  # Job 1: Check if this is an epic with children
  - id: route
    type: promote_children # (if children-exist mode)
    tier: light
    # conditional: only runs if trigger.workItem.type == 'epic' && trigger.childCount > 0
    inputs:
      parent_id: "{{ trigger.workItemId }}"
      from_status: backlog
      to_status: todo
      mode: "{{ trigger.dispatchMode }}"

  # Job 2: If NOT an epic, or epic with no children → delegate to default implementation
  # (fallback path)
```

**Acceptance Criteria:**

- [ ] Non-epic work items are routed to the standard implementation workflow (no behavioral change).
- [ ] Epics with children trigger child promotion; epic itself stays `in-progress` with no agent session.
- [ ] Epics with no children are routed to the standard implementation workflow with enhanced context.
- [ ] Workflow seed is registered and loaded on startup.
- [ ] E2E test: create epic with 3 children → dispatch epic → children promoted to todo → original in-progress workflow does NOT fire for the epic.

#### Task 3.4: Modify Automation Service for Type-Aware Routing

**File:** `apps/api/src/project/work-item-automation.service.ts`

**Description:** When resolving workflows for `kanban.ticket.in_progress`, distinguish between epics (trigger router) and stories/tasks (trigger implementation directly). This may involve workflow matching based on trigger metadata or a dedicated event name for epics (e.g., `kanban.epic.in_progress` vs `kanban.ticket.in_progress`).

**Design decision:** Prefer using the enriched trigger payload (with `childCount`) and conditional logic inside the router workflow, rather than splitting event names. This keeps the event system simple and the routing logic in one place.

**Acceptance Criteria:**

- [ ] Epic with children entering in-progress → router workflow fires, NOT default implementation.
- [ ] Story/task entering in-progress → default implementation workflow fires.
- [ ] Epic with 0 children entering in-progress → default implementation workflow fires (with enhanced prompt context).
- [ ] No regression: existing stories/tasks continue to work unchanged.
- [ ] Unit test: correct workflow selected based on work item type and child count.

---

### Phase 4: Cascade Completion & Blocking

#### Task 4.1: Auto-Complete Epic When All Children Done

**File:** `apps/api/src/project/work-item.service.ts` (in `applyStatusTransitionEffects` or new listener)

**Description:** When any work item transitions to `done` and has a `parentId`, check if all siblings are also `done`. If yes, auto-complete the parent.

**Acceptance Criteria:**

- [ ] When last child → done and parent is `in-progress`, parent auto-transitions to `done`.
- [ ] Parent transition uses `suppressAutomation: true` (prevents triggering implementation on done epic).
- [ ] Parent transition does NOT use `suppressAutomation` for the dispatch reconcile event (other items may unblock).
- [ ] Does not fire if parent is already `done` (idempotent).
- [ ] Does not fire if parent is `blocked` (blocked epic should not auto-complete).
- [ ] Does not fire for items without a `parentId`.
- [ ] Cascade protection: parent auto-completing to `done` does not re-trigger this check on a grandparent.
- [ ] Unit test: all above scenarios.
- [ ] Integration test: 3 children → first two done (no parent change) → third done → parent auto-completes.

#### Task 4.2: Auto-Complete Orphan Children When Epic Done Directly

**File:** `apps/api/src/project/work-item.service.ts`

**Description:** When an epic transitions to `done`, auto-complete any children still in `backlog` or `todo`.

**Acceptance Criteria:**

- [ ] When `type === 'epic'` transitions to `done`, children in `backlog`/`todo` are auto-completed.
- [ ] Auto-completed children have metadata: `{ autoCompletedReason: 'parent_epic_done_directly' }`.
- [ ] Children in `in-progress`, `in-review`, or `blocked` are NOT auto-completed (they have active work).
- [ ] Uses `suppressAutomation: true` for child transitions.
- [ ] Unit test: backlog/todo children auto-completed; in-progress children untouched; metadata set.

#### Task 4.3: Block Cascade (Epic → Blocked)

**File:** `apps/api/src/project/work-item.service.ts`

**Description:** When an epic is moved to `blocked`, cascade the block to active children.

**Acceptance Criteria:**

- [ ] When `type === 'epic'` transitions to `blocked`, children in `todo` and `in-progress` are transitioned to `blocked`.
- [ ] Blocked children have metadata: `{ blockedReason: 'parent_epic_blocked' }`.
- [ ] Children already `done` or already `blocked` are not touched.
- [ ] Uses `suppressAutomation: true` for child transitions (children's blocking shouldn't trigger further cascades).
- [ ] Unit test: todo/in-progress children blocked; done children untouched; metadata set.

#### Task 4.4: Sequential Next-Child Promotion on Child Done

**File:** `apps/api/src/project/work-item.service.ts` or dedicated listener

**Description:** When a child transitions to `done` and the project's dispatch mode is `sequential`, promote the next backlog child under the same parent to `todo`.

**Acceptance Criteria:**

- [ ] Only fires when dispatch mode setting is `'sequential'`.
- [ ] Only fires when `workItem.parentId` is set and parent is `in-progress`.
- [ ] Promotes the first `backlog` child (priority-sorted) to `todo`.
- [ ] If no `backlog` children remain, does nothing (auto-complete check from 4.1 handles epic completion).
- [ ] Unit test: sequential mode promotes next child; parallel mode does nothing extra; no backlog children remaining is handled gracefully.

---

### Phase 5: Agent Context Enhancement

#### Task 5.1: Add Work Item `type` to Implementation Workflow Prompt

**File:** `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`

**Description:** Add `Type: {{trigger.workItem.type}}` to the agent prompt so the agent knows if it's working on an epic, story, or task.

**Acceptance Criteria:**

- [ ] Implementation agent prompt includes `Type: {{trigger.workItem.type}}`.
- [ ] No behavioral change — informational only.

#### Task 5.2: Add Children List to Epic Implementation Prompt

**File:** `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`

**Description:** When the work item is an epic (direct-implement mode), include the list of planned child stories/tasks in the prompt so the agent can implement the full scope.

**Acceptance Criteria:**

- [ ] When `trigger.children` is present and non-empty, each child's type, title, priority, and description are listed.
- [ ] Prompt instructs agent to implement ALL child items as part of this epic.
- [ ] When `trigger.children` is empty or absent, the section is omitted.

#### Task 5.3: Add Parent Epic Context to Child Implementation Prompt

**File:** `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`

**Description:** When the work item has a `parentEpic`, include the parent's title, description, and context files in the prompt.

**Acceptance Criteria:**

- [ ] When `trigger.parentEpic` is present, agent sees epic title, description, and context files.
- [ ] Prompt instructs agent to align implementation with the epic's overall design.
- [ ] When `trigger.parentEpic` is absent, the section is omitted.

#### Task 5.4: Add `type` to Dispatch Selector Prompt

**File:** `apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml`

**Description:** Update the dispatch agent's prompt to indicate that `type` is available in the candidate list.

**Acceptance Criteria:**

- [ ] Prompt mentions `type` as a field in each candidate.
- [ ] Prompt guides agent: "Consider work item type when making selection decisions."

#### Task 5.5: Add `type` to Review Workflow Prompt

**File:** `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`

**Description:** Add `Type: {{trigger.workItem.type}}` to the QA agent prompt for better review context.

**Acceptance Criteria:**

- [ ] Review agent prompt includes `Type: {{trigger.workItem.type}}`.
- [ ] Review agent can differentiate spec decomposition items from implementation items using both type and description.

---

### Phase 6: UI Enhancements

#### Task 6.1: Show Child Progress on Epic Cards

**Files:** `apps/web/src/pages/kanban/KanbanBoard.tsx`, `apps/web/src/pages/kanban/WorkItemCard.tsx` (or equivalent)

**Description:** Epic cards on the kanban board should display child completion progress.

**Acceptance Criteria:**

- [ ] Epic cards show a progress indicator (e.g., "3/5 done" or a progress bar).
- [ ] Progress is computed from children's statuses.
- [ ] Non-epic cards do not show progress indicator.
- [ ] Updates in real-time via WebSocket broadcasts.

#### Task 6.2: Indicate Auto-Completed Items

**Files:** `apps/web/src/pages/kanban/kanban.utils.ts`, relevant card components

**Description:** Work items that were auto-completed (by parent cascade) should be visually distinguished.

**Acceptance Criteria:**

- [ ] Cards with `metadata.autoCompletedReason` display a subtle badge or icon.
- [ ] Tooltip or label explains: "Auto-completed: parent epic completed directly."

#### Task 6.3: Epic Dispatch Confirmation in UI

**Files:** Kanban drag-and-drop handlers

**Description:** When a user manually drags an epic with children to "In Progress", show a confirmation prompt explaining that children will be promoted instead of the epic being implemented directly.

**Acceptance Criteria:**

- [ ] Drag-and-drop of epic with children to in-progress shows confirmation dialog.
- [ ] Dialog explains: "This epic has N children. They will be promoted to Todo and dispatched based on dependencies."
- [ ] User can confirm or cancel.
- [ ] Epics with no children proceed without confirmation (standard behavior).

---

## 8. Acceptance Criteria (Epic-Level)

- [ ] An epic with children, when dispatched to in-progress, promotes its children to `todo` without implementing the epic itself.
- [ ] In parallel mode, all children are promoted; in sequential mode, only the first (priority-sorted) is promoted.
- [ ] The dispatch coordinator only dispatches children whose declared dependencies are `done`.
- [ ] Concurrent sibling execution never causes dependency-related failures (code exists on main before dependent branches).
- [ ] An epic with no children is implemented directly by an agent with full epic-scope context.
- [ ] When all children of an epic reach `done`, the parent epic auto-transitions to `done`.
- [ ] When an epic is marked `blocked`, its active children are also blocked.
- [ ] When an epic is directly completed, remaining backlog/todo children are auto-completed.
- [ ] Spec frontmatter supports `depends_on: SLUG-a, SLUG-b` for declaring sibling dependencies.
- [ ] Hydration correctly creates dependency edges from `depends_on` slugs.
- [ ] Decomposition agents are instructed to declare `depends_on` in generated specs.
- [ ] Implementation agents receive parent epic context when working on child items.
- [ ] The dispatch agent sees work item `type` in the candidate list.
- [ ] Epic cards on the kanban board show child progress.
- [ ] All new behavior is backwards compatible — existing items without children or parents work exactly as before.
- [ ] Unit, integration, and E2E tests cover all new behavior.

---

## 9. Risks & Mitigations

| #   | Risk                                                                                                | Likelihood | Impact   | Mitigation                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Infinite cascade loops** — epic `done` → children `done` → triggers parent check again → re-fires | Medium     | High     | Use `suppressAutomation: true` on all cascade-triggered transitions. Auto-complete guard checks parent is `in-progress`, not `done`.                 |
| R2  | **Sibling children executed concurrently cause code conflicts**                                     | High       | Critical | `depends_on` in spec frontmatter + dispatch coordinator's existing dependency filtering ensures ordering. Sequential mode as safety net.             |
| R3  | **Decomposition agent forgets to add `depends_on`**                                                 | Medium     | Medium   | Sequential mode as default. QA review agent can flag missing dependencies. Documentation/prompt instructs agent clearly.                             |
| R4  | **Capacity exhaustion from promoting many children**                                                | Low        | Medium   | Promotion only moves to `todo` — dispatch coordinator's `maxActive` still applies. Only capacity-bounded items execute.                              |
| R5  | **Agent confused by epic-level prompt**                                                             | Low        | Low      | Direct-implement mode prompt is explicit about scope. Children are listed if present.                                                                |
| R6  | **Backwards compatibility regression**                                                              | Medium     | High     | Comprehensive test coverage. Epics without children = existing behavior. Items without parents = existing behavior. Feature-flag dispatch mode.      |
| R7  | **`slugToId` resolution for same-type dependencies**                                                | Medium     | Medium   | Two-pass creation within batch: (1) create all, (2) set dependencies. Unresolved slugs produce warnings, not failures.                               |
| R8  | **Blocking cascade interrupts active agent sessions**                                               | Low        | Medium   | Phase-2 concern. Initially, blocking may only update status without killing containers. Full session cancellation can be a follow-up.                |
| R9  | **Epic with pending hydration dispatched before children exist**                                    | Medium     | Medium   | Post-merge hydration emits `WorkItemSpecGenerationFinishedEvent` which triggers dispatch reconcile. Children materialize before next dispatch cycle. |
| R10 | **UI re-render performance with progress tracking**                                                 | Low        | Low      | Progress computed from locally cached work item state. WebSocket broadcasts already update individual items.                                         |

---

## 10. Implementation Order & Dependencies

```
Phase 1: Foundation (no user-facing changes)
  ├─ 1.1 findByParentId
  ├─ 1.2 findByParentIdAndStatuses
  ├─ 1.3 Type in WorkItemCandidate
  ├─ 1.4 Trigger enrichment (children)
  └─ 1.5 Trigger enrichment (parent)

Phase 2: Spec depends_on (enables dependency declaration)
  ├─ 2.1 Parse depends_on in frontmatter
  ├─ 2.2 Resolve slugs to IDs
  └─ 2.3 Update decomposition prompts

Phase 3: Epic Router (core new behavior)
  ├─ 3.1 promote_children handler ─────────── depends on 1.1, 1.2
  ├─ 3.2 Dispatch mode setting
  ├─ 3.3 Router workflow YAML ──────────────── depends on 3.1, 3.2, 1.4
  └─ 3.4 Type-aware routing ───────────────── depends on 3.3

Phase 4: Cascade completion (epic lifecycle bookends)
  ├─ 4.1 Auto-complete parent on all done ── depends on 1.1
  ├─ 4.2 Auto-complete orphan children ───── depends on 1.2
  ├─ 4.3 Block cascade ────────────────────── depends on 1.2
  └─ 4.4 Sequential next-child promotion ── depends on 1.2, 3.2

Phase 5: Agent context (prompt quality)
  ├─ 5.1 Type in implementation prompt
  ├─ 5.2 Children in epic prompt ──────────── depends on 1.4
  ├─ 5.3 Parent in child prompt ───────────── depends on 1.5
  ├─ 5.4 Type in dispatch prompt ──────────── depends on 1.3
  └─ 5.5 Type in review prompt

Phase 6: UI (observability)
  ├─ 6.1 Child progress on epic cards
  ├─ 6.2 Auto-completed badge
  └─ 6.3 Epic dispatch confirmation
```

---

## 11. Testing Strategy

### Unit Tests

| Area                      | Test Cases                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Repository**            | `findByParentId` returns correct children; empty for no children; correct ordering. `findByParentIdAndStatuses` filters correctly. |
| **Trigger enrichment**    | Epic payload includes children/childCount. Story payload includes parentEpic. Non-applicable items have no extra fields.           |
| **Spec parsing**          | `depends_on` single slug, multi slugs, empty, missing.                                                                             |
| **Dependency resolution** | Slugs resolved to IDs. Missing slug = warning. Circular = warning.                                                                 |
| **promote_children**      | Parallel: all promoted. Sequential: one promoted. From-status filter works. Empty children = zero promoted.                        |
| **Auto-complete parent**  | All done = parent completes. Not all done = no change. Parent already done = no-op. No parentId = no-op.                           |
| **Auto-complete orphans** | Backlog/todo children completed. In-progress untouched. Metadata set.                                                              |
| **Block cascade**         | Todo/in-progress children blocked. Done children untouched. Metadata set.                                                          |
| **Sequential next-child** | Promotes next when sequential. No-op when parallel. No more backlog = no-op.                                                       |

### Integration Tests

| Scenario                                                                    | Verification                              |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| Hydrate specs with `depends_on` → dispatch filtering respects dependencies. | Dependent item is held until dep is done. |
| Epic dispatch → child promotion → dependency-ordered execution.             | Correct execution order observed.         |
| Full lifecycle: epic start → children execute → epic auto-completes.        | Board consistent end-to-end.              |

### E2E Tests

| Scenario                                                             | Verification                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Create project with epic + 3 children (with dependencies) → dispatch | Children execute in correct order; epic auto-completes when all done. |
| Small epic (no children) → dispatch                                  | Epic implemented directly; standard lifecycle.                        |
| Epic blocked → children blocked                                      | All active children moved to blocked.                                 |
| Sequential mode: children execute one at a time                      | Only one child in-progress at any time.                               |

---

## 12. Out of Scope

- **Cross-project epic orchestration** — epics spanning multiple Git repositories.
- **Automatic dependency inference** — using AI to detect implicit ordering without explicit `depends_on` declarations.
- **Gantt/timeline visualization** — visual dependency graph rendering on the frontend.
- **Partial epic completion** — marking an epic as "partially done" if some children are intentionally skipped.
- **Story decomposition into tasks** — recursive parent-child decomposition (story → tasks). The `parentId` field supports this, but workflow changes are scoped to epic → story/task only.
- **Agent session cancellation on block cascade** — Phase 1 will update status only; killing active containers is a follow-up.

---

## 13. Glossary

| Term                      | Definition                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Epic**                  | A high-level work item (type: `epic`) that may contain child stories and tasks. Can be implemented directly (if small) or decomposed into children. |
| **Direct-implement mode** | Execution mode where an epic with no children is implemented by a single agent, like a large task.                                                  |
| **Children-exist mode**   | Execution mode where an epic with children acts as a passive tracker while its children are promoted and dispatched individually.                   |
| **Child promotion**       | Transitioning child work items from `backlog` to `todo`, making them eligible for the dispatch coordinator.                                         |
| **Dispatch mode**         | Project-level setting (`parallel` or `sequential`) controlling whether all children are promoted at once or one at a time.                          |
| **Dependency filtering**  | The dispatch coordinator's existing mechanism that only allows items whose ALL `dependsOn` items are `done` to be dispatched.                       |
| **Auto-completion**       | Automatic transition of a parent epic to `done` when all its children have reached `done`.                                                          |
| **Cascade**               | Propagation of a status change from parent to children (e.g., blocking all children when epic is blocked).                                          |
| **Slug**                  | The filename (without `.md`) of a spec file, used as an identifier in `parent` and `depends_on` frontmatter fields.                                 |
| **suppressAutomation**    | Flag on `updateStatus()` that prevents automation workflows from triggering for a transition, used to avoid infinite loops in cascade operations.   |
