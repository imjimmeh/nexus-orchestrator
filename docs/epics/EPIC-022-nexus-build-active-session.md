# EPIC: Nexus Build - Active Session Workspace (Deep Steering)

**Epic ID:** EPIC-022  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P0 - Critical  
**Theme:** Real-time Observability & Steering

---

## 1. Executive Summary

### 1.1 Problem Statement
Autonomous agents are often "black boxes" while they work. Users need to see the agent's thought process, its tool calls, and the live output of its terminal to trust and steer it effectively.

### 1.2 Solution Overview
Build the **Active Session Workspace**, a specialized real-time interface for "live" tickets. It features a **Cognitive Stream** (left pane) showing agent thoughts and chat, and an **Execution Terminal** (right pane) powered by `xterm.js` showing raw container output. It includes **HITL (Human-in-the-Loop)** controls to pause, resume, or abort agents.

### 1.3 Success Criteria
- WebSocket-driven real-time streaming of `text_delta` and `bash_output`.
- Collapsible "Thoughts" blocks for agent internal reasoning.
- Fully interactive `xterm.js` instance with ANSI color support.
- User input field to inject prompts into a running agent session.
- Sub-100ms UI latency for incoming telemetry.

---

## 2. Context & User Stories

### 2.1 Context
This is the "Deep Steering UI" from Journey 3 of the PRD. It is the most critical interface for high-trust autonomous collaboration.

### 2.2 User Stories
- **As a User**, I want to see the agent's reasoning before it executes a destructive command.
- **As a User**, I want to see the terminal output of `npm run test` as the agent runs it.
- **As a User**, I want to pause the agent when I see it going down the wrong path and give it a hint.
- **As a User**, I want to switch between the Terminal view and a "Git Diff" view of the agent's changes.

---

## 3. Technical Requirements

### 3.1 Backend (API)
- **Telemetry Bridge:** Logic to pipe Pi-Runner events from Redis/Streams to Socket.io.
- **Steering API:** Endpoints to send "User Injected Messages" to the Pi-Runner SDK.
- **Master Controls:** API to Pause/Resume/Abort the underlying Docker container.

### 3.2 Frontend (Web)
- **ActiveSessionPage Component:** Split-pane layout with `react-resizable-panels`.
- **CognitiveStream Component:** Renders thoughts, chat bubbles, and tool summaries.
- **Terminal Component:** Wraps `xterm.js` and handles stream chunk buffering.
- **DiffViewer Component:** Renders git diffs in real-time as files change.
- **SteeringControls:** Input bar for chatting with the live agent.

---

## 4. Tasks

### Phase 1: Real-time Streams
- [ ] Task 1: Connect Frontend to Socket.io for the specific `ticketId` namespace.
- [ ] Task 2: Build the `xterm.js` Terminal component and verify ANSI output.
- [ ] Task 3: Implement `text_delta` rendering for the Cognitive Stream.

### Phase 2: UI Blocks & Formatting
- [ ] Task 4: Create specialized blocks for "Thoughts", "Tool Calls", and "User Chat".
- [ ] Task 5: Implement collapsible thought blocks to reduce noise.
- [ ] Task 6: Implement the "Git Diff" tab in the terminal pane.

### Phase 3: HITL & Control
- [ ] Task 7: Implement the "Pause/Resume/Abort" control buttons and API.
- [ ] Task 8: Implement the chat input to inject prompts into the live session.
- [ ] Task 9: Implement "State Hydration" to fetch history on page refresh.
- [ ] Task 10: Build a "File Tree" viewer for the current worktree.

---

## 5. Acceptance Criteria
- [ ] Clicking an "In Progress" card opens the Active Session Workspace.
- [ ] Terminal shows live output of bash commands with colors.
- [ ] Cognitive stream shows agent "Thinking..." blocks.
- [ ] User can type a message, and the agent acknowledges it in the stream.
- [ ] Pausing the agent stops the terminal stream and prevents further tool calls.
- [ ] Refreshing the page repopulates the terminal and chat history.

---

## 6. Dependencies
- **EPIC-007 (WebSocket Telemetry):** Essential for the stream bridge.
- **EPIC-003 (Docker Orchestration):** Required for pause/kill controls.
- **EPIC-006 (Session Hydration):** Required for state persistence.

---

## 7. Risks & Mitigations
- **Risk:** High volume terminal output (e.g., `npm install`) crashing the browser.
- **Mitigation:** Directly pipe terminal data to `xterm.js` DOM; avoid React state for chunks; implement circular buffers.
- **Risk:** Synchronization issues between the chat and terminal logs.
- **Mitigation:** Use global sequence IDs (LSN) for all telemetry events.
