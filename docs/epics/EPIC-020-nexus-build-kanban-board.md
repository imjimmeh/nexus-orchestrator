# EPIC: Nexus Build - Kanban Board & Work Item Management

**Epic ID:** EPIC-020  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P0 - Critical  
**Theme:** Project Management & Visual Interface

---

## 1. Executive Summary

### 1.1 Problem Statement

Developers and project managers need a visual representation of work item statuses that isn't just a static board but an active interface that triggers backend processes. Existing tools separate planning from execution.

### 1.2 Solution Overview

Build a **Kanban Board** that serves as the central hub for the Nexus Build ecosystem. It supports drag-and-drop status changes, real-time automation triggers, and live execution badges. Moving a ticket triggers the underlying agent lifecycle.

### 1.3 Success Criteria

- Fully interactive Kanban board with draggable cards.
- Default Columns: Backlog, To Do, In Progress, In Review, Done.
- Live Telemetry Badges showing agent status (thinking, running, paused, error).
- Optimistic UI updates for card movements.
- Real-time synchronization of board state across multiple clients.

---

## 2. Context & User Stories

### 2.1 Context

This is the "Dumb Board" from Phase 1 of the execution plan, enhanced with "Live Badges". It serves as the primary dashboard for project oversight.

### 2.2 User Stories

- **As a User**, I want to drag a ticket to "In Progress" to trigger the autonomous coding agent.
- **As a User**, I want to see at a glance which tickets are being actively worked on by agents.
- **As a User**, I want to see how much each ticket has cost in terms of LLM tokens so far.
- **As a User**, I want to click a card to open its detailed configuration or active session.

---

## 3. Technical Requirements

### 3.1 Backend (API)

- **Work Item Entity Extension:** Add `status`, `assigned_agent_id`, `token_spend`, `current_execution_id`.
- **Status Change Webhooks:** Logic to emit events when a ticket status is patched.
- **Automation Trigger Service:** Maps status transitions (e.g., `TO_DO` -> `IN_PROGRESS`) to workflow invocations.

### 3.2 Frontend (Web)

- **Kanban Board Component:** Built with `dnd-kit` or `@hello-pangea/dnd`.
- **Card Component:** Displays Title, Priority, Agent Badge, Cost Indicator, and Status Icon.
- **Column Component:** Groups cards and displays automation icons.
- **Socket.io Integration:** Listen for board-wide updates and individual card telemetry.

---

## 4. Tasks

### Phase 1: Board UI & State

- [ ] Task 1: Extend `WorkItem` model with status and metadata fields.
- [ ] Task 2: Implement Kanban API (GET project tickets, PATCH ticket status).
- [ ] Task 3: Build the basic Kanban UI with draggable columns/cards.
- [ ] Task 4: Implement optimistic updates and error handling for card moves.

### Phase 2: Live Badges & Telemetry

- [ ] Task 5: Implement "Live Badge" component for cards (Pulsing Green/Yellow/Red).
- [ ] Task 6: Connect WebSocket listeners to update card badges in real-time.
- [x] Task 7: Implement token cost display logic (accumulating from execution events). Core attaches per-run `usage` totals (from `budget_usage_events`) to terminal `core.workflow.run.*` lifecycle events; the kanban lifecycle-stream consumer accrues them onto `kanban_work_items.token_spend`. See `docs/guide/24-kanban-core-integration.md`.

### Phase 3: Automation Integration

- [ ] Task 8: Implement backend logic to trigger workflows on status changes.
- [ ] Task 9: Add "Automation" icons to columns with active triggers.
- [ ] Task 10: Implement board-wide real-time sync for multi-user support.

---

## 5. Acceptance Criteria

- [ ] Cards can be dragged between columns.
- [ ] Refreshing the page persists the card's new column.
- [ ] If a card move fails on the server, it snaps back to its original position.
- [ ] Active agent tickets show a "Pulsing" status badge on the card.
- [ ] Columns can be collapsed or expanded.
- [ ] Board reflects status changes made by other users/agents in real-time.

---

## 6. Dependencies

- **EPIC-019 (Inception Flow):** Required for the data models and initial backlog.
- **EPIC-009 (REST API):** Required for ticket persistence.
- **EPIC-007 (WebSocket Telemetry):** Required for live card badges.

---

## 7. Risks & Mitigations

- **Risk:** High frequency of status updates causing UI lag.
- **Mitigation:** Throttle UI updates for rapid movements; use decentralized state (card-level updates).
- **Risk:** Race conditions between human drag-and-drop and agent status updates.
- **Mitigation:** Implement server-side versioning or "locking" for tickets currently in execution.
