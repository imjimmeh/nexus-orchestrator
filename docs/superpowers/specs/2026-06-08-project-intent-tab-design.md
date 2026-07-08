# Project Intent Tab — Design Spec

**Date:** 2026-06-08
**Epic:** EPIC-203 (follow-on)
**Status:** Approved

---

## Problem

EPIC-203 delivered a full charter capture pipeline (CEO workflow, goal tools, `record_project_memory`, `update_charter`) but the frontend was left in a half-wired state:

1. The "Refine Charter" button fires `api.launchCharterOnboarding` with `void` — the workflow launches but the user gets no feedback, no toast, no navigation.
2. The project goals page (`GoalsTab`) is unaware of the charter. Project memories (requirements, constraints, decisions, etc.) captured during onboarding are invisible to the user.

---

## Solution Overview

- Rename the "Goals" tab to **"Project Intent"** and replace its content with a two-column layout: goals on the left, structured charter categories on the right.
- Add four REST endpoints to expose project memory segments to the frontend.
- Fix the "Refine Charter" button to give user feedback and navigate to the launched workflow run.

---

## Architecture

### Data Sources

| Column | Source |
|--------|--------|
| Goals (left) | Existing `KanbanProjectGoalEntity` — no change |
| Charter categories (right) | `MemorySegment` rows where `entity_type='project'`, grouped by `metadata.category` |

Charter categories come from `PROJECT_MEMORY_CATEGORIES` (already defined in `packages/kanban-contracts/src/project-charter.schema.ts`):
`requirement`, `constraint`, `do_dont`, `non_goal`, `decision`, `preference`, `glossary`, `stakeholder`, `open_question`

### New REST Endpoints

All on `ProjectController` (`apps/kanban/src/project/project.controller.ts`), gated by existing project auth guard.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:project_id/charter-memories` | Returns all memory segments grouped by category: `{ [category]: { id, content, metadata }[] }` |
| `POST` | `/projects/:project_id/charter-memories` | Body: `{ category: ProjectMemoryCategory, content: string }`. Validates category, creates segment. |
| `PATCH` | `/projects/:project_id/charter-memories/:memoryId` | Body: `{ content: string }`. Updates segment content. |
| `DELETE` | `/projects/:project_id/charter-memories/:memoryId` | Deletes segment. |

`POST` uses the same `memoryType` mapping as the agent tool: `preference` category → `'preference'`, all others → `'fact'`, with `metadata.source = 'user_edit'`.

`PATCH` and `DELETE` require `updateMemorySegment` and `deleteMemorySegment` methods on `MemoryManagerService` — add them if not present.

---

## Frontend Components

All in `apps/web/src/pages/project-workspace/`.

### `ProjectIntentTab.tsx` (replaces `GoalsTab.tsx` as tab content)
- Two-column flex layout.
- Left column: existing goals list (extracted or inlined — no logic changes).
- Right column: `CharterColumn`.
- Fetches charter memories via `useCharterMemories(projectId)` hook on mount.
- Tab label in `ProjectWorkspace.tsx` changes from "Goals" to "Project Intent".

### `CharterColumn.tsx`
- Renders one `CharterCategorySection` per entry in `PROJECT_MEMORY_CATEGORIES`.
- Maps raw category keys to human labels: `do_dont` → "Dos & Don'ts", `non_goal` → "Non-Goals", `open_question` → "Open Questions", etc.
- All sections visible even when empty (shows "None yet") so the structure is always discoverable.

### `CharterCategorySection.tsx`
- Collapsible accordion per category.
- Lists memory items; each has click-to-edit inline text field and a delete button.
- "Add item" at the bottom opens an inline text input → calls `POST` on submit.
- Optimistic updates: add/edit/delete update local state immediately, roll back on API error.

### Button Fix (`ProjectWorkspace.tsx`)
Change the `onRefineCharter` handler from:
```tsx
onRefineCharter={() => {
  void api.launchCharterOnboarding(projectId, 'refine');
}}
```
to:
```tsx
onRefineCharter={async () => {
  try {
    const result = await api.launchCharterOnboarding(projectId, 'refine');
    toast.success('Charter refinement started');
    // navigate to workflow run using result.onboardingRunId
    // (same pattern as other workflow launch handlers)
  } catch (error) {
    toast.error('Failed to start charter refinement', getApiErrorMessage(error));
  }
}}
```

---

## Error States

- **Charter column empty:** Shows "No charter captured yet — use 'Refine Charter' to start a conversation with the CEO agent." with a button triggering the same launch handler.
- **Category section empty:** Shows "None yet" rather than hiding the section.
- **API errors on create/update/delete:** Inline toast (same pattern as rest of app); optimistic update rolled back.

---

## Testing

### Backend
- Unit tests for all four new controller endpoints (mirror existing project controller tests).
  - Cover: auth guard present, bad category rejected (400), delegation to `MemoryManagerService`.
- Unit tests for `updateMemorySegment` and `deleteMemorySegment` on `MemoryManagerService` if those methods are new.
- Existing `record-project-memory.tool.spec.ts` covers the agent path — no changes needed.

### Frontend
- No new component tests beyond existing patterns — components are straightforward API wrappers.
- Button fix verified by ensuring the handler is no longer `void` (type-level and integration test if one exists for workflow launch).

---

## Out of Scope

- Rendering or editing `CHARTER.md` as a document — structured memories are the source of truth for the UI.
- Bulk import from `CHARTER.md` into memory segments — future work if needed.
- Reordering items within a category.
- The existing goals CRUD functionality — no changes to goal create/edit/delete/status flows.
