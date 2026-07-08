# Work Item Types + Story Points — Design

**Date:** 2026-07-06
**Status:** Approved (design) — pending implementation plan
**Owner:** Kanban domain (`apps/kanban`, `packages/kanban-contracts`, `apps/web`)

## Context

Work items in Nexus are currently a single flat entity differentiated only by
`status`, `priority`, and `scope` (`standard | large`). There is **no
first-class work item type**.

A `type` column (with `epic`) existed historically. Migration EPIC-043
("flatten hierarchy", `apps/api/scripts/migrate-flatten-hierarchy.sql`) **deleted**
the `type` and `parent_id` columns entirely, mapping former epics to
`scope: large` and converting parent-child links into dependency edges. The
motivation was a real bug: **the orchestrator dispatched epics** — it sent a
high-level container to an execution container as if it were an actionable task.
The "fix" was to remove the concept rather than guard dispatch.

The dispatch path today gates **only** on `status === "todo"`. There is no type,
scope, or hierarchy filter anywhere in dispatch
(`apps/kanban/src/dispatch/dispatch-work-items.core.ts` `processCandidate()`), so
a `scope: large` item in `todo` would still be dispatched. That hole is the root
cause we must close when re-introducing types.

Above work items there is already a real planning hierarchy —
`Initiative → Goal → WorkItem` (`kanban_initiatives`, `kanban_project_goals`).
This design does **not** touch that layer; types live at the work-item level.

## Core insight

Dispatchability is **not** a fixed property of a type. It is a property of a
work item's **current shape**: an item is a _container_ when it has child work
items, and a container must be decomposed, not executed. Therefore:

> **An item is dispatchable iff `type !== 'epic'` AND it has no child work items.**

This single rule generalises the original bug fix — it was never _only_ epics
that should not be dispatched; **nothing with children should be**. A small story
is worked directly; the moment it is broken into tasks it becomes a rollup and
its tasks are what dispatch.

## Goals

1. Re-introduce first-class work item **types**: `epic | story | task | bug | spike`.
2. Make containment (**has children**) — not type alone — gate dispatch, so no
   container ever reaches an execution container.
3. Add **story points** (Fibonacci `1..13`) as the sizing signal, replacing `scope`.
4. Wire **pointing and decomposition into the orchestration process** so size and
   scope are discovered automatically, with human/CEO override.
5. Full **web UI** for types, points, and the epic/story → children hierarchy.
6. Prove the guard with a **regression test**: neither an epic nor a
   story-with-children in `todo` is ever dispatched.

## Non-Goals

- No change to the `Initiative → Goal → WorkItem` layer above work items.
- No change to the separate `kanban_work_item_subtasks` checklist table.
- No leakage of type/point/hierarchy vocabulary into `apps/api` or `packages/core`.

## Model

### Types

`WorkItemTypeSchema = z.enum(["epic", "story", "task", "bug", "spike"])`

| Type    | Role                      | Dispatchable                  | Own story points   |
| ------- | ------------------------- | ----------------------------- | ------------------ |
| `epic`  | container (always)        | **never**                     | none (rollup only) |
| `story` | deliverable               | **when it has no children**   | yes                |
| `task`  | breakdown unit of a story | always (cannot have children) | yes                |
| `bug`   | defect                    | always (cannot have children) | yes                |
| `spike` | investigation             | always (cannot have children) | yes                |

"What is a task?" — a **task is the breakdown unit of a story that was too big to
do in one run.** A small story is dispatched directly; a big story is split into
tasks and becomes a non-dispatchable rollup.

### Hierarchy

```
epic (container, never dispatches)
 ├─ story           (dispatches while childless)
 │   ├─ task        (dispatchable leaf)
 │   └─ bug         (dispatchable leaf)
 ├─ task            (leaf directly under epic — allowed)
 └─ bug

story (standalone, no epic)          ✓ allowed & dispatchable while childless
task / bug / spike (standalone)      ✓ allowed & dispatchable
epic → epic (nesting)                ✗ rejected
leaf → any child (task parents X)    ✗ rejected (task/bug/spike are terminal)
```

Parent rules (`canParent(parent, child)`):

- `epic` may parent `story | task | bug | spike`.
- `story` may parent `task | bug | spike`.
- `task | bug | spike` parent nothing (terminal leaves).
- Nothing may parent an `epic` (epics never nest, never have a parent).

This caps depth at `epic → story → leaf`. A leaf's parent is optional (standalone
leaves allowed); a story's parent is optional (standalone stories allowed).

### Dispatchability

A pure function of the item's current shape:

```
isDispatchable(item) = item.type !== 'epic' && !hasChildWorkItems(item)
```

- `epic` → never (type).
- `story` with children → no (rollup); `story` without children → yes.
- `task | bug | spike` → yes (they cannot have children).

### Story points

- Allowed values: `{1, 2, 3, 5, 8, 13}` (Fibonacci). Any other value is rejected.
- **Own points** allowed on `story | task | bug | spike`; setting `story_points`
  on an `epic` is rejected.
- `13` is the **"too big to fit one run" sentinel** — a leaf/story pointed `13`
  is a decomposition candidate (see below). No separate "unpointable" value.
- **Derived rollup** (`rolledUpPoints`, computed, never stored): for a container
  (any item with children) it is the recursive sum of its descendants' own
  points; for a childless item it is its own `story_points`. Shown in the UI for
  epics and decomposed stories.

### Single source of truth — type rules registry

`apps/kanban/src/work-item/work-item-type.rules.ts` — pure predicates, the only
place type literals live:

```ts
isEpicType(type): boolean                       // container-always
canHaveChildren(type): boolean                  // epic | story
canParent(parent: Type, child: Type): boolean   // per matrix above
allowsStoryPoints(type): boolean                // false only for epic
isDispatchable(type, hasChildren): boolean      // type !== 'epic' && !hasChildren
```

Every guard, validator, and workflow condition reads from this module.

## Data changes (`kanban_work_items`)

| Column                | Type     | Notes                                                       |
| --------------------- | -------- | ----------------------------------------------------------- |
| `type`                | enum     | `NOT NULL`, default `story`                                 |
| `parent_work_item_id` | UUID     | nullable, FK → `kanban_work_items(id)` `ON DELETE SET NULL` |
| `story_points`        | smallint | nullable; app-validated against the Fibonacci set           |
| ~~`scope`~~           | —        | **dropped**                                                 |

An index on `parent_work_item_id` supports the child-existence lookup the
dispatch guard needs.

Contract changes in `packages/kanban-contracts/src/work-item.schema.ts`:
add `type`, `parentWorkItemId`, `storyPoints` (and a derived, read-only
`rolledUpPoints` / `hasChildren` on the read schema) to `WorkItemRecordSchema` /
`WorkItemSchema` / `CreateWorkItemInputSchema`; remove `WorkItemScopeSchema` and
all `scope` references.

## Invariants (enforced in `WorkItemService`, sourced from the type-rules registry)

Validated on create and update:

1. `epic` cannot have a `parent_work_item_id` (epics never nest / never a child).
2. For any child with a parent, `canParent(parent.type, child.type)` must hold.
   Terminal leaves (`task | bug | spike`) may not be a parent.
3. `story_points` present on an `epic` → `BadRequestException`.
4. `story_points` not in `{1,2,3,5,8,13}` → `BadRequestException`.
5. Type flips re-validate all invariants. Promoting a `story` to an `epic` while
   it has a parent must first detach it (an epic cannot be a child); this is done
   atomically by the promotion path, not left to the caller.
6. A parent cannot be deleted out from under children silently — the FK is
   `ON DELETE SET NULL`, so orphaned children revert to standalone (and become
   dispatchable if they are non-epic leaves).

## Dispatch guard (the fix)

`isDispatchable(item.type, hasChildWorkItems(item))` is applied at **every** choke
point identified in the codebase exploration. The candidate projection is
extended with a `hasChildren` flag (single indexed query on `parent_work_item_id`,
batched across candidates).

**Hard gate** — `apps/kanban/src/dispatch/dispatch-work-items.core.ts`,
`processCandidate()`: a non-dispatchable item is recorded in `result.skipped`
with reason `container_not_dispatchable` and never launched, mirroring the
existing `not_dispatchable_status` check.

**Read predicates** (so the CEO never _sees_ a container as workable):

- `apps/kanban/src/mcp/tools/read/todo-list.tool.ts`
- `apps/kanban/src/mcp/tools/read/project-state.tool.ts` (`dispatchableTodoItems`,
  `isDispatchableTodoItem()`)
- `apps/kanban/src/orchestration/orchestration-cycle-decision-dispatch.helpers.ts`
  (`hasDispatchableTodoWork()`)
- `apps/kanban/src/orchestration/orchestration-continuation.handler.ts`
  (`isDispatchableWorkItem()`)
- `apps/kanban/src/orchestration/orchestration-branch-blockers.ts`

A container may still occupy board columns visually, but is structurally
un-dispatchable and invisible to "dispatchable todo work remaining" logic.

## Estimation & decomposition (seed workflows)

### Pointing in refinement

When a story/leaf enters `refinement`, an AI **estimation step** assigns
`story_points` from the item's title/description/acceptance-criteria. Humans and
the CEO can override via the update tool / UI at any time.

### Oversized item (points = 13)

Surfaced to the CEO orchestration cycle, which decides **per item**:

- **Decompose into child tasks** — the story keeps its type but gains child
  `task`/`bug` items (with `parent_work_item_id` set). It thereby becomes a
  non-dispatchable rollup automatically; the children dispatch. _(Primary path.)_
- **Promote to epic** — for genuinely epic-scale items: flip `type` to `epic`
  (detaching any parent) and decompose into child stories/leaves.

Both are supported (CEO decides), reworking the existing
`apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.ts` (aligning its enum
to the real persisted set and actually persisting children) and repointing
`work_item_split_default` to fire on the points/decomposition signal instead of
the retired `scope == large`.

### Rollup completion

A container (epic, or story-with-children) auto-completes to `done` when all its
children are `done`, reusing the umbrella-parent resolver
(`apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.ts`),
now driven by the real `parent_work_item_id` column instead of
`metadata.split.parentId`.

## Web UI (`apps/web`) — full scope

- **Type badge + color** per card.
- **Story-point chip** — view + inline edit via a Fibonacci picker; hidden for
  epics; shows the **derived rollup** on containers.
- **Hierarchy** — epic/story cards expand/collapse to show children, with a
  rollup point total.
- **Filter by type** on the board.
- **Create / convert type** in the item form (client-side enforcement of the
  parent/points rules for fast feedback; server remains source of truth).

## Migration

TypeORM migration under `apps/kanban/src/database/migrations/`:

1. Add `type` (`NOT NULL DEFAULT 'story'`), `parent_work_item_id`,
   `story_points`; add the `parent_work_item_id` index.
2. Data backfill:
   - **Default: every existing item → `type = 'story'`.**
   - **Decomposition parents preserved:** where existing metadata records split
     children (`metadata.split.parentId` / `metadata.split.proposedChildIds`),
     set each child's `parent_work_item_id` to that parent and the child's
     `type = 'task'`. The parent stays `story` and, now having children, becomes a
     non-dispatchable rollup automatically — matching today's behaviour.
   - **Subtasks untouched:** the `kanban_work_item_subtasks` checklist table is a
     within-item checklist, not work items; having subtasks does **not** change an
     item's type (it stays `story`).
   - `story_points` starts `NULL` (unpointed) for all rows.
3. Drop the `scope` column.

Notes: existing `scope: large` items become `story` like everything else (a big,
still-undecomposed story); they will be re-pointed in `refinement` and decomposed
if the CEO judges them oversized. Bug/spike identity is **not** inferred from
text; re-typing is a manual/CEO follow-up.

## Boundary compliance

All changes live Kanban-side (`apps/kanban`, `packages/kanban-contracts`,
`apps/web`). The API/core stay Kanban-neutral: the run-request payload simply
stops carrying `scope`; no `type`, `epic`, `story`, `story_points`, or hierarchy
vocabulary enters `apps/api` or `packages/core`. The
`nexus-boundaries/no-core-kanban-residue` lint rule must remain green with no new
allowlists or disables.

## Testing (TDD)

- **Contract/schema:** type enum, Fibonacci validation, points-forbidden-on-epic,
  `canParent` matrix.
- **`WorkItemService` invariants:** every rule above, create and update paths,
  including story→epic promotion auto-detach and `ON DELETE SET NULL` orphaning.
- **Dispatch guard regression (headline tests):**
  1. an `epic` in `status: todo` is never dispatched;
  2. a `story` **with children** in `status: todo` is never dispatched
     (`processCandidate` skips both with `container_not_dispatchable`), and
     neither appears in any "dispatchable todo" read predicate;
  3. a childless `story` **is** dispatched.
- **Rollup:** `rolledUpPoints` computed correctly across `epic → story → leaf`.
- **Workflows:** refinement estimation assigns points; oversized item
  decompose-vs-promote; child creation flips the parent to non-dispatchable;
  container rollup → done.
- **Web unit tests:** type badge, point chip edit, hierarchy expand + rollup sum,
  type filter.

## Decisions & alternatives considered

- **Type on the work item** (chosen) vs. mapping epic to the existing
  Initiative/Goal layer vs. flat taxonomy labels.
- **Container = "has children"** (chosen) vs. purely type-based dispatchability.
  The has-children rule keeps `story` a directly-workable deliverable while making
  any decomposed item a safe rollup, and it lets the migration default to `story`
  and preserve existing split hierarchies verbatim. It also generalises the
  original epic-dispatch fix to _all_ containers.
- **`epic` always a container, `story` conditionally** (chosen) vs. making `story`
  a pure always-container (which would force `default → task` and lose the
  "a small story is just done" ergonomics).
- **Story points replace `scope`** (chosen) — `scope` had no other consumer.
- **`13` as the too-big sentinel** (chosen) vs. a separate "unpointable" value.
- **CEO decides decompose-vs-promote** (chosen) vs. a single fixed path.
