# EPIC-037: Spec-Driven Work Item Hydration

## Summary

Replace tool-based work item generation (`nexus_orchestrator → create_work_items`) with a two-phase, event-driven approach: a PM agent authors structured markdown spec files with YAML frontmatter in the project repository, and after merge a deterministic publishing flow parses them into kanban work items.

## Motivation

### Current State

When a Product Manager agent breaks down a PRD, it calls `nexus_orchestrator(action: "create_work_items")` to create work items via WebSocket → API. Two problems:

| # | Problem | Impact |
|---|---------|--------|
| 1 | **No files are written to the repo** | The in-review workflow fails — QA has no diff to review |
| 2 | **Work items lack depth** | Tool schema limits each item to `{title, description, type, priority}` — no room for acceptance criteria, technical notes, or context |

### Why This Approach

| Approach | Rejected Reason |
|----------|----------------|
| Improve `create_work_items` tool fields | Still bypasses review; no committed files |
| Agent writes files → second agent reads and calls tool | Wastes LLM tokens on mechanical parsing |
| **Agent writes spec files → deterministic code hydrates** | Files go through review, parsing is deterministic, zero extra LLM cost. Superseded implementation path: Kanban-owned resource publishing via `kanban.publish_specs`. |

## Goals

1. PM agent writes structured markdown spec files (`docs/work-items/*.md`) with YAML frontmatter
2. Spec files go through standard review → merge pipeline (quality gate)
3. After merge, a Kanban-owned resource publishing flow deterministically parses spec files into work items via `kanban.publish_specs`
4. Parent-child relationships resolved via file slug references (not fragile title matching)
5. Spec files persist as living documentation in the repo
6. Zero overhead for non-spec work items (hydration short-circuits if no spec files exist)

## Non-Goals

1. Removing the existing `create_work_items` tool (remains available for other use cases)
2. Custom spec file schemas per project
3. Bi-directional sync between spec files and work items

---

## Technical Approach

### Spec File Format

Files in `docs/work-items/` with naming convention `{TYPE}-{slug}.md`:

```markdown
---
type: story
title: "As a user, I want to create a new todo item"
priority: p1
parent: EPIC-todo-management
---

## Description
Users should be able to create new todo items...

## Acceptance Criteria
- [ ] A "New Todo" button is visible
- [ ] Submitting creates the todo and it appears in the list
```

### Components

This section records the historical design. The old API-owned hydration special step was superseded and removed; current spec-to-work-item reconciliation is owned by Kanban resource publishing through `kanban.publish_specs`.

#### 1. `emit_event` Special Step Type

Generic, reusable step that emits a NestJS EventEmitter2 event from any workflow.

```yaml
- id: emit_merge_completed
  type: emit_event
  tier: light
  inputs:
    event_name: WorkItemMergeCompletedEvent
    payload:
      projectId: "{{ trigger.projectId }}"
```

#### 2. Historical `hydrate_work_items_from_specs` Special Step Type (Removed/Superseded)

The removed API special step was originally intended as a deterministic handler that reads spec files from the project repo and creates work items. Do not implement or register this special step in current workflows. Use the Kanban-owned `kanban.publish_specs` resource publishing boundary instead.

1. Reads `docs/work-items/*.md` from the project basePath
2. Parses YAML frontmatter + markdown body
3. Validates required fields (type, title)
4. Creates in type-precedence order: epics → stories → tasks
5. Resolves parent-child via slug map
6. Deduplicates against existing work items (title + type + projectId)

#### 3. `WorkItemMergeCompletedEvent`

Event emitted by the merge workflow after successful merge + done transition.

#### 4. `work-item-post-merge-spec-hydration.workflow.yaml`

Event-triggered workflow that listens for merge events and runs the Kanban resource publishing flow.

---

## Implementation Phases

### Phase 1: Foundation - Historical Step Handler Plan (Removed/Superseded)

The tasks below describe the superseded API special-step implementation plan. They are retained as historical context only. Current implementations must not add or register the removed hydration special step; use `kanban.publish_specs` / resource publishing instead.

| Task | Type |
|------|------|
| Create `WorkItemMergeCompletedEvent` event class | New file |
| Create `StepEmitEventSpecialStepHandler` + tests | New files |
| Historical only: `StepHydrateWorkItemsSpecialStepHandler` was superseded by `kanban.publish_specs` resource publishing | Removed/superseded |
| Historical only: the removed `hydrate_work_items_from_specs` job type must not be added to `IJob.type`; use the current `kanban.publish_specs` path | Removed/superseded |
| Add supported entries only for current resource publishing primitives | Edit types |
| Register current Kanban-owned resource publishing providers, not the removed hydration special step | Edit |
| Add job validators | Edit |
| Register providers in the narrow Kanban/resource publishing module boundary | Edit |

### Phase 2: Workflow Wiring

| Task | Type |
|------|------|
| Add `emit_event` steps to merge workflow YAML | Edit |
| Create `work-item-post-merge-spec-publishing.workflow.yaml` using `kanban.publish_specs` | New file |

### Phase 3: PM Agent Profile Update

| Task | Type |
|------|------|
| Update `product-manager.profile.ts` to write spec files | Edit |

### Phase 4: Documentation

| Task | Type |
|------|------|
| Update API README with new step types | Edit |
| Update SDD with hydration architecture | Edit |
| Update workflow seeding guide | Edit |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| PM agent writes malformed frontmatter | Validation in handler + QA review catches issues |
| Duplicate work items on re-merge | Deduplicate by title + type + projectId |
| Missing parent slug reference | Create without parent, log warning |
| `emit_event` fires for ALL merges | Hydration workflow short-circuits if no spec files |

## Related

- [PLAN-spec-driven-work-item-hydration.md](../plans/PLAN-spec-driven-work-item-hydration.md)
- [EPIC-034: Workflow-Driven Kanban Lifecycle](EPIC-034-workflow-driven-kanban-lifecycle.md)
