# EPIC: Project Workspace & Navigation Overhaul

**Epic ID:** EPIC-025  
**Status:** In Progress  
**Created:** 2026-03-25  
**Priority:** P0 – Critical  
**Theme:** User Experience & Project Management

## 1. Executive Summary

**Problem:** The current UI has a fragmented user journey. Projects are invisible after creation (no project list), PRD/SDD specs are disconnected from the kanban board (one-shot inception with no way to refine), the dashboard shows irrelevant infrastructure metrics, the kanban board has no work item hierarchy, and navigation is admin-focused rather than work-focused. The result is an unusable workflow that doesn't support the iterative project lifecycle Nexus is designed for.

**Solution:** A comprehensive overhaul comprising: a project-centric navigation model, a unified Project Workspace with tabbed views (Board, Specs, Sessions, Settings), epic grouping on the board, a work item detail panel, inline creation/editing, iterative spec refinement from the board, and active session status integration on kanban cards.

**Success Criteria:**

- Users can list, find, and navigate to any project from the sidebar and dashboard
- PRD/SDD specs are viewable and refinable from within the project workspace (not just inception)
- Work items are grouped by parent epic on the board
- Work items can be created, edited, and viewed in detail from the board
- Specs can be refined and additional work items generated at any time
- Active agent sessions show live status on board cards

## 2. User Stories

1. As a user, I want to see all my projects in a list so I can navigate to any one.
2. As a user, I want the dashboard to show project-level summaries (progress, active agents) instead of workflow infrastructure stats.
3. As a user, I want the sidebar to prioritize project navigation over configuration pages.
4. As a user, I want a unified project workspace with tabs for Board, Specs, Sessions, and Settings.
5. As a user, I want to view and edit PRD/SDD from within the project workspace at any time.
6. As a user, I want to chat with the Architect agent to refine specs without leaving the project.
7. As a user, I want work items grouped under their parent epics on the board.
8. As a user, I want to click a card to see its full details in a slide-over panel.
9. As a user, I want to create new work items directly from the board.
10. As a user, I want to edit work item title, description, priority, and type inline.
11. As a user, I want to generate additional work items from specs at any time.
12. As a user, I want to see live agent status (running, thinking, paused, error) directly on board cards.
13. As a user, I want to see a list of all execution sessions for the project.
14. As a user, I want to manage project settings (name, repo, description) after creation.

## 3. Technical Requirements

### Frontend

- New `useProjects` hook with `useProjectList()` and `useProject(id)` queries
- New `Projects` list page at `/projects`
- Restructured sidebar with "Work" and "Configuration" groups
- Redesigned dashboard showing project cards
- Unified `ProjectWorkspace` page at `/projects/:projectId` with `Tabs` component
- Specs tab reusing inception patterns (AgentChatPanel, ReactMarkdown, PRD/SDD toggle)
- Board tab with epic swimlane grouping, work item detail slide-over, inline create/edit
- Sessions tab listing workflow runs for the project
- Settings tab for project metadata editing
- New API client methods: `updateProject()`, `createWorkItem()`, `updateWorkItem()`

### Backend (API additions needed)

- `PUT/PATCH /projects/:id` — update project metadata (already exists)
- `POST /projects/:projectId/work-items` — create individual work item (new)
- `PATCH /projects/:projectId/work-items/:id` — update work item fields (new)

## 4. Tasks — 5 Phases

### Phase 1: Navigation & Project Hub

- [ ] Create `useProjects` hook (`useProjectList`, `useProject`)
- [ ] Create `Projects` list page with project cards
- [ ] Restructure `Sidebar` into "Work" (Projects, Dashboard) and "Config" groups
- [ ] Add `/projects` route in `App.tsx`
- [ ] Redesign `Dashboard` to show project summaries
- [ ] Unit tests for `useProjects` hook, project list utilities

### Phase 2: Unified Project Workspace

- [ ] Create `ProjectWorkspace` layout with Tabs (Board, Specs, Sessions, Settings)
- [ ] Extract Board tab from existing `KanbanBoard` into embeddable component
- [ ] Create Specs tab (PRD/SDD view, architect chat, generate work items)
- [ ] Create Sessions tab (list execution sessions for project)
- [ ] Create Settings tab (edit project metadata)
- [ ] Rewire routing: `/projects/:projectId` → ProjectWorkspace, remove `/projects/:projectId/board`
- [ ] Update navigation links throughout app
- [ ] Unit tests for workspace utilities

### Phase 3: Board UX Improvements

- [ ] Epic swimlane grouping on board (group tasks by parentId)
- [ ] Work item detail slide-over panel (Sheet component)
- [ ] Inline work item creation (Add Task button per column)
- [ ] Work item field editing (title, description, priority, type)
- [ ] API client methods: `createWorkItem`, `updateWorkItem`
- [ ] Unit tests for grouping logic, validation

### Phase 4: Iterative Spec Refinement

- [ ] "Generate More Tasks" workflow from board context
- [ ] Spec editing with Monaco/textarea in Specs tab
- [ ] Refine specs from board (select items → context-aware architect prompt)
- [ ] Unit tests for generation flow utilities

### Phase 5: Active Session Integration

- [ ] Live agent status badges on board cards using execution state
- [ ] Session list with filtering and status indicators
- [ ] Quick session peek on card hover/expand
- [ ] Unit tests for session status derivation

## 5. Dependencies

- EPIC-019 (Inception Flow) — reuses architect chat patterns
- EPIC-020 (Kanban Board) — refactors and extends current board
- EPIC-009 (REST API) — needs new work item CRUD endpoints

## 6. Risks & Mitigations

| Risk                                         | Mitigation                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Large refactor breaks existing functionality | Phase-by-phase implementation with tests after each phase          |
| New API endpoints not available              | Frontend stubs with `TODO` markers; graceful fallbacks             |
| Inception flow regression                    | Keep InceptionWorkspace as standalone entry point for new projects |
