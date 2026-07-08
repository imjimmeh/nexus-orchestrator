# EPIC-132: Repository File Viewer & Add Files UI

**Epic ID:** EPIC-132  
**Status:** Proposed  
**Priority:** P1 - High  
**Theme:** Web UI, File Management, User Experience  
**Created:** 2026-04-19  
**Depends On:** EPIC-128 (Steering Foundation), EPIC-131 (Workflows)

---

## 1. Context

With the steering framework (EPIC-128) providing conversational control and the ingestion workflows (EPIC-131) ready to execute, users need a UI to view repository contents and add new files. This visibility is critical because all outputs from agents (analysis, PRD, SDD) are committed to the repository. Users need to see what the project contains and initiate ingestion through the UI.

**Current State:**
- Web UI exists at `apps/web/`
- Project dashboard shows basic project info
- Kanban board shows work items
- No file viewer exists at project level
- No way to upload files or add URLs through UI

**Target State:**
- File tree viewer on project dashboard
- "Add Files" button with upload/URL/Figma import options
- Ingestion work items rendered specially on kanban board
- Ingestion detail view shows files and analysis status
- Real-time file tree updates as agents commit in worktrees
- All visible in the same UI where users steer the project

---

## 2. References

**Architecture:**
- `docs/architecture/telemetry-gateway.md` — For real-time updates
- `docs/epics/WEB-001-nexus-web-interface.md`
- `docs/epics/EPIC-128-conversational-orchestrator-steering-foundation.md`
- `docs/epics/EPIC-131-design-ingestion-workflows.md`

**Implementation Files:**
- `apps/web/src/pages/projects/` — Project pages
- `apps/web/src/pages/kanban/` — Kanban board
- `apps/web/src/components/` — Shared components
- `apps/web/src/lib/api/` — API client
- `apps/api/src/project/` — Project API endpoints
- `apps/api/src/git/` — Git operations

**Related Skills:**
- `nestjs-module-conventions` — For API endpoints

---

## 3. PR-Ready Tasks

### Task 1: Create Project File Viewer Component

**Scope:** File tree viewer showing repository contents.

**Files:**
- Create: `apps/web/src/components/file-viewer/file-tree.tsx`
- Create: `apps/web/src/components/file-viewer/file-viewer.tsx`
- Create: `apps/web/src/components/file-viewer/file-content.tsx`
- Create: `apps/web/src/components/file-viewer/index.ts`
- Create: `apps/web/src/components/file-viewer/file-viewer.css`

**Acceptance Criteria:**
- Displays hierarchical file tree from project root
- Supports expanding/collapsing directories
- Clicking file shows content preview (markdown, text, JSON)
- Shows file sizes and last modified dates
- Handles large repos (virtual scrolling for >1000 files)
- Responsive design (collapses on mobile)

**Definition of Done:**
- [ ] Component renders file tree
- [ ] File content preview works
- [ ] Virtual scrolling for large repos
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 2: Add File Tree API Endpoint

**Scope:** Backend API to serve repository file tree.

**Files:**
- Create: `apps/api/src/project/project-files.controller.ts`
- Create: `apps/api/src/project/project-files.service.ts`
- Create: `apps/api/src/project/dto/file-tree.dto.ts`
- Modify: `apps/api/src/project/project.module.ts`

**Acceptance Criteria:**
- `GET /api/projects/:projectId/files` — Returns file tree
- `GET /api/projects/:projectId/files/:path` — Returns file content
- Supports pagination for large directories
- Respects file size limits (max 1MB for content)
- Returns 404 for paths outside project directory
- Caches file tree for 30 seconds

**Definition of Done:**
- [ ] API endpoints work
- [ ] Path validation secure
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 3: Create "Add Files" Button and Modal

**Scope:** Button and modal for initiating file ingestion.

**Files:**
- Create: `apps/web/src/components/add-files-button/add-files-button.tsx`
- Create: `apps/web/src/components/add-files-button/add-files-modal.tsx`
- Create: `apps/web/src/components/add-files-button/file-upload-tab.tsx`
- Create: `apps/web/src/components/add-files-button/url-input-tab.tsx`
- Create: `apps/web/src/components/add-files-button/figma-import-tab.tsx`
- Create: `apps/web/src/components/add-files-button/index.ts`

**Acceptance Criteria:**
- Button visible on project dashboard (top-right)
- Modal has 3 tabs:
  - **Upload Files**: Drag-and-drop or file picker; multiple files; shows file list
  - **Add URLs**: Text input for URLs; supports multiple URLs (one per line)
  - **Import from Figma**: Figma URL input; optional API token
- Shows file type icons and sizes
- Validates inputs before submission
- On submit: calls ingestion API and shows progress

**Definition of Done:**
- [ ] Button and modal render correctly
- [ ] All 3 tabs functional
- [ ] File upload works
- [ ] URL validation works
- [ ] Figma import triggers workflow
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 4: Create Ingestion API Endpoint

**Scope:** API endpoint that accepts files/URLs and triggers ingestion workflow.

**Files:**
- Create: `apps/api/src/project/project-ingestion.controller.ts`
- Create: `apps/api/src/project/project-ingestion.service.ts`
- Create: `apps/api/src/project/dto/ingestion-request.dto.ts`
- Modify: `apps/api/src/project/project.module.ts`

**Acceptance Criteria:**
- `POST /api/projects/:projectId/ingest` — Accepts files and URLs
- Request body: `{ files: [File], urls: [string], figmaUrls: [string], description: string }`
- Validates all inputs
- Creates ingestion work item
- Triggers `design-ingestion-existing-project` workflow
- Returns: `{ workItemId, workflowRunId, status }`
- Handles file storage temporarily (before worktree placement)

**Definition of Done:**
- [ ] API accepts multipart form data
- [ ] File validation works (type, size)
- [ ] Workflow triggered correctly
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 5: Style Ingestion Work Items on Kanban Board

**Scope:** Special rendering for ingestion work items.

**Files:**
- Modify: `apps/web/src/pages/kanban/components/work-item-card.tsx`
- Modify: `apps/web/src/pages/kanban/components/work-item-detail.tsx`
- Create: `apps/web/src/pages/kanban/components/ingestion-badge.tsx`

**Acceptance Criteria:**
- Ingestion cards show `📎` icon
- Card color slightly different (light blue tint)
- Detail view shows:
  - Input files list with download links
  - Analysis status (pending / analyzing / committing / complete)
  - Link to active session (if running)
  - Generated artifacts list (PRD, SDD, analysis)
- Can download individual files

**Definition of Done:**
- [ ] Cards styled correctly
- [ ] Detail view shows all info
- [ ] File downloads work
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 6: Real-Time File Tree Updates

**Scope:** Update file viewer when agents commit new files.

**Files:**
- Modify: `apps/web/src/components/file-viewer/file-tree.tsx`
- Modify: `apps/web/src/hooks/use-websocket.ts`
- Create: `apps/web/src/hooks/use-project-files.ts`

**Acceptance Criteria:**
- WebSocket listener for `file_committed` events
- Auto-refreshes file tree when new files committed
- Shows toast notification: "New files available: analysis.md, PRD.md"
- Debounced refresh (wait 2s after last event)
- Doesn't break if WebSocket disconnects

**Definition of Done:**
- [ ] Real-time updates work
- [ ] Toast notifications show
- [ ] Graceful degradation on disconnect
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 7: Write UI Documentation

**Scope:** Document the file viewer and ingestion UI.

**Files:**
- Create: `docs/guides/file-viewer-and-ingestion-ui.md`
- Modify: `docs/epics/WEB-001-nexus-web-interface.md`

**Acceptance Criteria:**
- Document covers:
  - How to use the file viewer
  - How to add files via UI
  - How to track ingestion progress
  - How to view agent-generated artifacts
  - Keyboard shortcuts and accessibility
- Screenshots of UI components
- Example user flow

**Definition of Done:**
- [ ] Documentation complete
- [ ] Screenshots included
- [ ] Peer reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] File viewer shows repository contents
- [ ] "Add Files" button and modal work
- [ ] Ingestion API accepts files/URLs
- [ ] Ingestion work items styled on board
- [ ] Real-time file tree updates
- [ ] All UI components tested with unit tests
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Responsive design works on mobile
- [ ] Accessibility audit passed
- [ ] Documentation updated
- [ ] No E2E tests required (deferred to future epic)

---

## 5. Dependencies

- **EPIC-128 (Steering Foundation):** UI integrates with steering sessions
- **EPIC-131 (Workflows):** UI needs workflows to trigger
- **EPIC-132 depends on:** EPIC-128, EPIC-131
- **Blocks:** EPIC-133

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Large repo performance | Virtual scrolling; pagination |
| File content security | Path validation; size limits |
| Mobile UX | Responsive design; touch-friendly |
| WebSocket reliability | Graceful fallback to polling |
