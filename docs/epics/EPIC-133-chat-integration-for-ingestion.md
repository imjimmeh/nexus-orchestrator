# EPIC-133: Chat Integration for Ingestion

**Epic ID:** EPIC-133  
**Status:** Proposed  
**Priority:** P1 - High  
**Theme:** Chat Sessions, Commands, Multi-Agent Collaboration  
**Created:** 2026-04-19  
**Depends On:** EPIC-128 (Steering Foundation), EPIC-131 (Workflows), EPIC-132 (UI)

---

## 1. Context

With the steering framework (EPIC-128) providing conversational control, the ingestion workflows (EPIC-131) ready to execute, and the UI (EPIC-132) providing visual entry points, users should also be able to initiate design ingestion from chat sessions using slash commands. Chat sessions also host the multi-agent analysis phase where agents discuss and analyze inputs. This epic adds chat commands and session templates that integrate with the steering framework.

**Current State:**
- Chat sessions exist (EPIC-064, EPIC-092)
- Telegram ingress supported
- Slash commands exist for some operations
- No ingestion-specific chat commands
- No session templates for design analysis

**Target State:**
- `/ingest <url>` command creates ingestion work item
- `/ingest-file <file>` uploads file and triggers ingestion
- `/analyze-design <work-item-id>` re-runs analysis
- `design_analysis_session` template for multi-agent analysis
- Chat sessions can display file previews and analysis progress
- Real-time updates in chat as workflow progresses
- CEO can invoke ingestion workflows from steering sessions

---

## 2. References

**Architecture:**
- `docs/architecture/chat-sessions.md`
- `docs/epics/EPIC-064-decoupled-chat-sessions.md`
- `docs/epics/EPIC-092-chat-service-bootstrap-telegram-ingress-and-session-persistence.md`
- `docs/epics/EPIC-097-telegram-conversational-ux-live-progress-and-command-discoverability.md`
- `docs/epics/EPIC-128-conversational-orchestrator-steering-foundation.md`

**Implementation Files:**
- `apps/api/src/chat/` — Chat session services
- `apps/api/src/session/` — Session management
- `apps/api/src/workflow/` — Workflow triggers
- `apps/web/src/pages/chat/` — Chat UI
- `seed/workflows/` — Session templates

**Related Skills:**
- `kanban-work-item-lifecycle` — For work item creation from chat

---

## 3. PR-Ready Tasks

### Task 1: Implement `/ingest` Chat Command

**Scope:** Slash command to ingest a URL from chat.

**Files:**
- Modify: `apps/api/src/chat/chat-command.service.ts`
- Create: `apps/api/src/chat/commands/ingest.command.ts`
- Create: `apps/api/src/chat/commands/ingest.command.spec.ts`

**Acceptance Criteria:**
- Syntax: `/ingest <url> [description]`
- Validates URL format
- Creates ingestion work item
- Triggers `design-ingestion-existing-project` workflow
- Responds in chat with work item ID and status
- Supports multiple URLs in single command (comma-separated)

**Definition of Done:**
- [ ] Command parsed correctly
- [ ] URL validation works
- [ ] Work item created
- [ ] Workflow triggered
- [ ] Chat response shows progress
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 2: Implement `/ingest-file` Chat Command

**Scope:** Command to upload and ingest files from chat.

**Files:**
- Modify: `apps/api/src/chat/chat-command.service.ts`
- Create: `apps/api/src/chat/commands/ingest-file.command.ts`
- Create: `apps/api/src/chat/commands/ingest-file.command.spec.ts`

**Acceptance Criteria:**
- Syntax: `/ingest-file` (with file attachment)
- Supports drag-and-drop in web chat
- Supports file upload in Telegram
- Validates file types (no executables)
- Creates ingestion work item
- Responds with work item ID
- Shows file processing status

**Definition of Done:**
- [ ] Command accepts file attachments
- [ ] File validation works
- [ ] Upload progress shown
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 3: Implement `/analyze-design` Chat Command

**Scope:** Command to re-run analysis on existing ingestion.

**Files:**
- Modify: `apps/api/src/chat/chat-command.service.ts`
- Create: `apps/api/src/chat/commands/analyze-design.command.ts`
- Create: `apps/api/src/chat/commands/analyze-design.command.spec.ts`

**Acceptance Criteria:**
- Syntax: `/analyze-design <work-item-id>`
- Validates work item exists and is ingestion type
- Re-triggers analysis workflow
- Responds with new workflow run ID
- Shows comparison with previous analysis

**Definition of Done:**
- [ ] Command validates work item
- [ ] Workflow re-triggered
- [ ] Chat shows status updates
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 4: Create `design_analysis_session` Template

**Scope:** Session template for multi-agent design analysis.

**Files:**
- Create: `seed/workflows/session-templates/design-analysis-session.yaml`
- Create: `seed/workflows/prompts/design-ingestion/session-analysis.md`

**Acceptance Criteria:**
- Pre-configures session with 2 agents: Design Analyst + Requirements Extractor
- Sets up shared context (uploaded files, URLs)
- Agents can invoke tools (analyze_image, read_document, fetch_url)
- Session produces structured `analysis_findings` document
- Has timeout (default 30 minutes)
- Can be paused/resumed

**Definition of Done:**
- [ ] Template seeds correctly
- [ ] Session creates 2 agents
- [ ] Agents can use tools
- [ ] Analysis document produced
- [ ] Unit tests pass

---

### Task 5: Create `requirements_elicitation_session` Template

**Scope:** Session template for requirements discussion.

**Files:**
- Create: `seed/workflows/session-templates/requirements-elicitation-session.yaml`

**Acceptance Criteria:**
- Pre-configures session with: Product Manager + Requirements Extractor
- Focuses on extracting and validating requirements
- Produces structured requirements document
- Can reference existing PRD/SDD for context
- Supports human participation for clarification

**Definition of Done:**
- [ ] Template seeds correctly
- [ ] Session produces requirements
- [ ] Unit tests pass

---

### Task 6: Add File Previews to Chat Sessions

**Scope:** Show file attachments and previews in chat UI.

**Files:**
- Create: `apps/web/src/components/chat/file-attachment.tsx`
- Create: `apps/web/src/components/chat/image-preview.tsx`
- Modify: `apps/web/src/components/chat/message-list.tsx`
- Modify: `apps/web/src/components/chat/chat-input.tsx`

**Acceptance Criteria:**
- Uploaded files show as attachments in message list
- Images show thumbnail preview (click to expand)
- Documents show filename, size, type icon
- Clicking attachment opens preview or download
- Drag-and-drop files into chat input
- Progress indicator during upload

**Definition of Done:**
- [ ] File attachments render
- [ ] Image previews work
- [ ] Drag-and-drop works
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 7: Real-Time Workflow Progress in Chat

**Scope:** Show ingestion workflow progress in chat session.

**Files:**
- Modify: `apps/api/src/chat/chat-telemetry.service.ts`
- Modify: `apps/web/src/components/chat/message-list.tsx`
- Create: `apps/web/src/components/chat/workflow-progress.tsx`

**Acceptance Criteria:**
- When ingestion triggered, chat shows workflow progress card
- Progress card shows:
  - Current step name
  - Steps completed / total
  - Agent currently working
  - Links to work item and session
- Updates in real-time via WebSocket
- Shows completion or failure status
- Can be dismissed

**Definition of Done:**
- [ ] Progress card renders
- [ ] Real-time updates work
- [ ] Completion/failure shown
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 8: Add Chat Command Discovery

**Scope:** Help users discover ingestion commands.

**Files:**
- Modify: `apps/web/src/components/chat/chat-input.tsx`
- Modify: `apps/api/src/chat/chat-command.service.ts`

**Acceptance Criteria:**
- Typing `/` shows command suggestions
- Commands have descriptions
- `/help ingest` shows detailed usage
- Commands autocomplete on tab
- Mobile-friendly command picker

**Definition of Done:**
- [ ] Command suggestions work
- [ ] Autocomplete works
- [ ] Help text accurate
- [ ] Unit tests pass
- [ ] Lint passes

---

### Task 9: Write Chat Integration Documentation

**Scope:** Document the chat commands and session templates.

**Files:**
- Create: `docs/guides/chat-ingestion-commands.md`
- Modify: `docs/architecture/chat-sessions.md`

**Acceptance Criteria:**
- Document covers:
  - All chat commands with syntax and examples
  - Session templates and when to use them
  - How to track workflow progress in chat
  - File upload limitations and supported formats
  - Troubleshooting common issues
- Example conversations showing full flow
- Command reference table

**Definition of Done:**
- [ ] Documentation complete
- [ ] Examples included
- [ ] Peer reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] 3 chat commands implemented with unit tests
- [ ] 2 session templates created
- [ ] File previews in chat
- [ ] Real-time workflow progress
- [ ] Command discovery works
- [ ] All chat commands tested
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Works in both web and Telegram chat
- [ ] Documentation updated
- [ ] No E2E tests required (deferred to future epic)

---

## 5. Dependencies

- **EPIC-128 (Steering Foundation):** Chat commands trigger workflows through steering
- **EPIC-131 (Workflows):** Chat commands trigger workflows
- **EPIC-132 (UI):** File viewer and upload components
- **EPIC-133 depends on:** EPIC-128, EPIC-131, EPIC-132
- **Blocks:** None (last epic in series)

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Chat UI becomes cluttered | Collapsible progress cards; clean design |
| File upload size limits | Validate before upload; show clear errors |
| Command parsing conflicts | Namespace commands (`/ingest` not `/i`) |
| Session timeout during analysis | Configurable timeouts; resume support |
