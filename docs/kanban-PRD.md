# Product Requirements Document (PRD): Nexus Build (Autonomous Kanban Workspace)

## 1. Executive Summary & Vision

**Nexus Build** is the visual command center for the Project Nexus Ecosystem. It is an AI-native project management tool where tickets are not just tracked—they are executed. It merges the planning capabilities of Jira, the code-execution isolation of Git worktrees, the automation of GitHub Actions, and the steering of a cloud IDE into a single, real-time interface.

## 2. Core Concepts & Architecture Alignment

To understand the UI, we must define how it maps to the headless Nexus Core backend:

- **Project = Repository:** A Nexus Project maps 1:1 with a Git repository.
- **Work Item = Task/Epic:** A database record mapping to a specific feature or bug.
- **Kanban Column = Workflow Trigger:** Moving a card changes its status. The backend emits `kanban.work_item.status_changed.v1`; seeded workflows route with conditions over `trigger.status` and use enriched `trigger.resource` to trigger autonomous YAML workflows (e.g., spawning a QA Agent).
- **Git Worktree = Agent Sandbox:** To allow 5 agents to work on 5 different tickets concurrently without Git lock conflicts, every active ticket provisions a dedicated Git worktree on the host, mounted into the agent's Heavy DevContainer.

---

## 3. Comprehensive User Journeys

### Journey 1: Project Inception (From Idea to Backlog)

1. User clicks **"New Project"** and enters the **Inception Workspace**.
2. User chats with the "Architect Agent" via the UI, explaining the project goals.
3. The Architect streams the generation of `PRD.md` and `SDD.md` into a live Markdown preview pane.
4. User clicks **"Generate Work Items."** The agent parses the specs and presents a hierarchical list of Epics and Tasks.
5. User tweaks the titles, clicks **"Approve,"** and the Kanban board is instantly populated. The specs are automatically committed to the repository's `main` branch.

### Journey 2: Task Dispatch & Configuration

1. User clicks a ticket in the "To Do" column to open the **Task Configuration Modal**.
2. User selects the **Base Branch** (e.g., branch this task off `develop` or `feature/epic-1`).
3. User selects the **Agent Persona** (e.g., "Frontend Specialist" or "Database Architect").
4. User attaches specific context (e.g., "@auth/login.ts") to guide the agent.
5. User drags the ticket to **"In Progress."**
6. _Backend Automation:_ The Orchestrator creates a new Git worktree (`git worktree add -b task/ticket-123`), spins up a Heavy DevContainer, mounts the worktree, and injects the selected Agent Persona.

### Journey 3: Deep Steering & HITL (Human-in-the-Loop)

1. User clicks a "Live" ticket on the board to enter the **Active Session Workspace**.
2. **Left Pane:** User watches the agent's thought process (`thinking_delta`) and tool calls stream in real-time.
3. **Right Pane:** User watches the raw `xterm.js` output as the agent runs `npm run test` inside the container.
4. The agent gets stuck in a loop trying to fix a test. User clicks **"Pause Agent,"** types _"You are missing the mock provider in the test setup,"_ and clicks **"Resume."**
5. The agent acknowledges the instruction, fixes the test, and commits the code.

### Journey 4: The Autonomous CI/CD Loop (Cycle Gates)

1. The developer agent finishes coding and uses the `update_ticket_status` tool to move the ticket to **"In Review."**
2. _Backend Automation:_ The Orchestrator pauses the DevContainer, dehydrates it to save RAM, and spawns a Light Container with a "QA Reviewer Agent."
3. The QA Agent reads the Git diff against the Acceptance Criteria.
4. **Failure Gate:** The QA Agent finds a bug. It moves the ticket back to "In Progress" with a comment. The backend rehydrates the original developer agent, injecting the QA feedback.
5. **Success Gate:** The QA Agent passes the code. It moves the ticket to "Ready to Merge." An automation rule auto-merges the PR, deletes the Git worktree, prunes the branch, and moves the ticket to "Done."

---

## 4. Detailed Functional Requirements

### 4.1. The Inception Workspace (Specs & Scoping)

- **Interactive Markdown Split-Pane:** Chat interface on the left; live, syntax-highlighted Markdown editor on the right.
- **Contextual Memory:** The Architect Agent must automatically read the existing `PRD.md` if the user is adding a new feature to an existing project.
- **Task Proposal UI:** A staging area where proposed tickets are displayed as a list of editable cards (Title, Acceptance Criteria, Estimated Effort) before being committed to the database.

### 4.2. Task Configuration & Dispatch Modal

Before a task begins, the user must define its execution parameters.

- **Agent Profile Selector:** Dropdown populating from the `AgentProfile` database (e.g., specifying model, temperature, and allowed tools).
- **Branch Configuration:** \* **Base Branch Picker:** Dropdown fetching current remote branches (e.g., `main`, `v2-refactor`).
  - **Target Branch Name:** Auto-generated (e.g., `nexus/task-42-login-fix`) but editable.
- **Context Attachment UI:** Allows users to explicitly "@-mention" files, folders, or URL documentation to inject into the agent's starting system prompt to save token discovery costs.
- **Cost/Limit Guards:** Input fields to set a "Max Token Spend" or "Max Loop Count" specific to this ticket before it requires human intervention.

### 4.3. The Kanban Board

- **Customizable Columns:** Defaulting to Backlog, To Do, In Progress, In Review, Done.
- **Automation Badges:** Columns with backend YAML triggers attached display a visual "⚡ Automation" icon.
- **Live Telemetry Badges:** Cards currently executing display real-time status:
  - 🟢 _Pulsing Green:_ Agent is actively thinking/typing.
  - 🟡 _Solid Yellow:_ Agent is paused, hibernating, or awaiting human input.
  - 🔴 _Pulsing Red:_ Agent hit an error or circuit breaker.
- **Token/Cost Burn Display:** A small metric on the card showing the estimated cost (e.g., "$0.45") burned by the agent on this ticket so far.

### 4.4. The Active Session Workspace (Deep Steering UI)

The critical Human-in-the-Loop interface, replacing the board view when a live ticket is clicked.

- **The Cognitive Stream (Left Pane):**
  - Renders WebSocket telemetry (`agent_telemetry` events).
  - Distinct UI blocks for: User Messages, Agent Thoughts (collapsible), Agent Chat, and Tool Summaries (e.g., "🛠️ _Ran bash command: `npm install`_").
- **The Execution Terminal (Right Pane):**
  - An `xterm.js` instance rendering ANSI output from the heavy container.
  - Tabbed interface allowing the user to switch between the Terminal, the Git Diff view, and the File Tree of the current worktree.
- **Steering Controls (Bottom/Header):**
  - Chat input box for manual prompt injection.
  - Master controls: Pause, Resume, Abort/Kill Container.

### 4.5. Git Worktree & Conflict Management UI

Because agents operate concurrently, conflicts will happen.

- **Worktree Provisioning:** Transparent to the user, but the UI must show a "Provisioning Workspace" loading state while the backend executes `git worktree add`.
- **Conflict Resolution Dashboard:** If a Merge Agent or QA Agent hits a Git merge conflict, the ticket is flagged "Blocked." The UI presents a dedicated diff-viewer where the human can resolve the conflict manually, or click "Instruct Agent to Resolve" to spawn a specialized conflict-resolution prompt.

---

## 5. Non-Functional Requirements

### 5.1. Performance & Latency

- **WebSocket Rendering:** The cognitive stream and `xterm.js` terminal must render incoming telemetry with < 100ms latency to feel truly real-time.
- **UI Hydration:** If a user refreshes the browser during an active session, the UI must seamlessly fetch the `XRANGE` Redis stream history from the backend and repopulate the terminal and chat without data loss.

### 5.2. State Management Strategies

- Due to the massive volume of terminal chunks (e.g., `npm install` output), terminal output must **not** be stored in React state. It must be piped directly to the `xterm.js` DOM ref to prevent crippling React re-renders.
- Kanban drag-and-drop state must implement Optimistic UI updates, reverting the card if the backend `PATCH` request fails.

---

## 6. Phase 1 Execution Plan (What to build first)

To avoid getting bogged down, the engineering team should tackle this in strict order:

1. **The Inception Flow:** Build the dual-pane chat + markdown editor, and the logic to parse a generated list into the database. (Proves LLM integration and DB schema).
2. **The Dumb Board & Task Config:** Build the Kanban board, drag-and-drop, and the Task Configuration modal (Branch selection, Agent selection). (Proves UI state management).
3. **The Active Session Telemetry:** Build the split-pane steering UI, hook up `Socket.io`, and render incoming `text_delta` and `xterm.js` output from the orchestrator. (Proves the real-time observability).
4. **The Automation Hooks:** Map Kanban column drops to backend webhook triggers to execute the full lifecycle. (Proves the autonomous CI/CD loop).
