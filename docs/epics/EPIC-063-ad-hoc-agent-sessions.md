# EPIC: Ad-Hoc Agent Sessions (Chat with Any Agent)

**Epic ID:** EPIC-063
**Status:** Proposed
**Created:** 2026-04-07
**Priority:** P1 - High
**Theme:** User–Agent Interaction

---

## 1. Executive Summary

### 1.1 Problem Statement

Today every agent session is a side-effect of a workflow run triggered by the orchestration engine or a kanban status change. There is no way for a user to simply open a conversation with an agent on demand — e.g. ask the orchestrator to generate work items, ask the architect to refine a spec, or ask any agent to do something specific. This limits the system to fully-automated flows and prevents lightweight, human-directed agent interactions.

### 1.2 Solution Overview

Introduce **Ad-Hoc Agent Sessions**: a user can open a new chat-style session by selecting an agent profile, optionally scoping it to a project, typing an initial message, and having the system execute a lightweight workflow run behind the scenes. The web UI presents this as a first-class "New Chat" experience, not as "executing a workflow."

### 1.3 Key Design Decision — Reuse Workflow Infrastructure

Rather than building a parallel execution pipeline, ad-hoc sessions will **reuse the existing workflow engine**. We already have the `orchestration_invoke_agent_default` workflow — a generic single-job workflow that accepts `agent_profile`, `projectId`, `objective`, and `task_prompt` via trigger data. An ad-hoc session is simply a user-initiated execution of this workflow with purpose-built UX on top.

This gives us for free:
- Container lifecycle management (light/heavy tiers)
- Session tree persistence (PiSessionTree)
- Telemetry streaming (Redis → WebSocket → UI)
- Tool permissions, agent profile resolution, AI config precedence
- Pause/resume/abort controls

### 1.4 Success Criteria

- User can start a new session from the sidebar or a project context with 2 clicks + a message.
- User selects an agent profile from a dropdown (filterable).
- User can optionally scope the session to a project (or leave global).
- Session opens immediately into the existing ActiveSessionWorkspace chat UI.
- Session history is browsable after completion (via Sessions list).
- Works with any active agent profile — not hardcoded to specific agents.

---

## 2. User Stories

- **US-1:** As a user, I want to start a conversation with any agent so I can ask it to perform a specific task on demand.
- **US-2:** As a user, I want to optionally scope my session to a project so the agent has the right context (repo, work items, goals).
- **US-3:** As a user, I want to see my ad-hoc sessions in a browsable list so I can revisit past conversations.
- **US-4:** As a user, I want the ad-hoc chat experience to feel like opening a chat — not like "executing a workflow."
- **US-5:** As a user, I want to inject follow-up messages into a running ad-hoc session so it's a true conversation.

---

## 3. Architecture

### 3.1 Execution Model

```
User clicks "New Session"
  → Selects agent profile + optional project + types message
  → POST /api/sessions/ad-hoc
      {
        agentProfileName: "ceo-agent",
        projectId?: "uuid",         // optional
        initialMessage: "Generate work items for the auth module"
      }
  → API internally calls WorkflowEngineService.startWorkflow(
        "orchestration_invoke_agent_default",
        {
          agent_profile: "ceo-agent",
          projectId: "uuid",
          objective: "User-initiated ad-hoc session",
          task_prompt: "Generate work items for the auth module"
        }
      )
  → Returns { runId, sessionUrl }
  → UI navigates to /sessions/:runId (or /projects/:projectId/sessions/:runId)
  → ActiveSessionWorkspace renders — same live chat experience as today
```

### 3.2 Backend Changes

#### 3.2.1 New Endpoint: `POST /sessions/ad-hoc`

A thin endpoint in a new or existing sessions controller that:
1. Validates the agent profile exists and is active.
2. Validates the project exists (if provided).
3. Calls `WorkflowEngineService.startWorkflow()` with the invoke-agent workflow.
4. Returns `{ runId }` so the UI can navigate to the session.

**DTO:**
```typescript
interface CreateAdHocSessionDto {
  agentProfileName: string;   // required — which agent to talk to
  projectId?: string;         // optional — project context
  initialMessage: string;     // required — the user's opening message
}
```

**Response:**
```typescript
interface CreateAdHocSessionResponse {
  runId: string;              // The workflow run ID (used as session ID)
}
```

#### 3.2.2 Workflow Enhancement (Optional, Phase 2)

The existing `orchestration_invoke_agent_default` workflow works but has a single step that expects the agent to call `step_complete` when done. For true multi-turn conversation, we may want a variant workflow that:
- Loops on user input (pause → wait for inject → resume).
- Doesn't force the agent to call `step_complete` after every turn.

This can be deferred — the current inject/resume flow already supports multi-turn interaction within a single step.

#### 3.2.3 Session Metadata

Add optional metadata to `WorkflowRun` state variables or a new column to distinguish ad-hoc sessions from automated ones:
- `source: "ad-hoc" | "orchestration" | "kanban-trigger" | "manual-execute"`
- `initiatedBy: userId`
- `displayName: "Chat with ceo-agent"` (for the sessions list)

### 3.3 Frontend Changes

#### 3.3.1 "New Session" Entry Points

| Location | Trigger | Behaviour |
|----------|---------|-----------|
| **Sidebar** — new "New Chat" button (top) | Click | Opens NewSessionDialog — no project pre-selected |
| **Project Workspace** — Sessions tab | "New Session" button | Opens NewSessionDialog — project pre-filled |
| **Command Palette** (stretch) | Keyboard shortcut | Opens NewSessionDialog |

#### 3.3.2 NewSessionDialog Component

A modal or slide-over with:
1. **Agent Profile selector** — searchable dropdown of active agent profiles. Shows name + tier badge.
2. **Project selector** — optional searchable dropdown. Shows "No project (global)" option.
3. **Initial message** — textarea with placeholder: "What would you like the agent to do?"
4. **"Start Session" button** — calls `POST /sessions/ad-hoc`, then navigates to the session view.

#### 3.3.3 Routing

Add a new top-level route for non-project-scoped sessions:
```
/sessions/:runId  →  ActiveSessionWorkspace (with no project context)
```

Keep existing project-scoped routes as-is:
```
/projects/:projectId/runs/:runId/active-session  →  ActiveSessionWorkspace
```

#### 3.3.4 Sessions List Page

A new top-level page (or reuse of an existing view) showing all ad-hoc sessions:
```
/sessions  →  SessionsListPage
```

Table columns: Agent, Project (or "Global"), Status, Started, Duration, Initial Message (truncated).
Clicking a row navigates to the session view.

Add "Sessions" to the sidebar under the "Work" group.

#### 3.3.5 ActiveSessionWorkspace Adjustments

The existing component works well but assumes project context in some places:
- Make `projectId` optional in the workspace hooks.
- Show "Global Session" header when no project is bound.
- Ensure the workspace tree / diff panels gracefully handle no-project state (hide or show empty).

---

## 4. Task Breakdown

### Phase 1: Core API + Minimal UI (MVP)

| # | Task | Area | Estimate |
|---|------|------|----------|
| 1 | Create `CreateAdHocSessionDto` and response type in `@nexus/core` | packages/core | S |
| 2 | Add `POST /sessions/ad-hoc` endpoint in API sessions controller | apps/api | M |
| 3 | Add `source` + `initiated_by` + `display_name` metadata fields to workflow run state (or new columns) | apps/api | S |
| 4 | Create `NewSessionDialog` component (agent selector, project selector, message input) | apps/web | M |
| 5 | Add API client method `createAdHocSession()` + React Query mutation hook | apps/web | S |
| 6 | Add "New Chat" button to sidebar | apps/web | S |
| 7 | Add `/sessions/:runId` route pointing to `ActiveSessionWorkspace` | apps/web | S |
| 8 | Make `ActiveSessionWorkspace` handle optional `projectId` (no project = global session) | apps/web | M |
| 9 | Write unit tests for the ad-hoc session endpoint | apps/api | M |
| 10 | Manual E2E validation | - | S |

### Phase 2: Sessions List + History

| # | Task | Area | Estimate |
|---|------|------|----------|
| 11 | Add `GET /sessions/ad-hoc` endpoint — list ad-hoc sessions with filters | apps/api | M |
| 12 | Create `SessionsListPage` component | apps/web | M |
| 13 | Add "Sessions" link to sidebar navigation | apps/web | S |
| 14 | Show ad-hoc sessions (completed) with conversation replay | apps/web | M |

### Phase 3: Multi-Turn Conversation Enhancement

| # | Task | Area | Estimate |
|---|------|------|----------|
| 15 | Create a `ad-hoc-conversation` workflow variant with built-in pause/resume loop | apps/api | L |
| 16 | Persistent message storage (extend `inception_chat_messages` or new table) for long-lived session history beyond Redis TTL | apps/api | M |
| 17 | "Continue conversation" button on completed ad-hoc sessions (spawns continuation run referencing prior session tree) | apps/web + api | L |

### Phase 4: UX Polish

| # | Task | Area | Estimate |
|---|------|------|----------|
| 18 | "New Session" button in Project Workspace Sessions tab (pre-fills project) | apps/web | S |
| 19 | Recent agents / pinned agents in NewSessionDialog | apps/web | S |
| 20 | Session title auto-generation (LLM-based or from first message) | apps/api | S |

---

## 5. API Reference

### `POST /sessions/ad-hoc`

**Request:**
```json
{
  "agentProfileName": "ceo-agent",
  "projectId": "0d5aa233-a266-4b53-8efe-0d6632757be5",
  "initialMessage": "Generate work items for implementing OAuth2 authentication"
}
```

**Response (201):**
```json
{
  "runId": "a1b2c3d4-...",
  "wsUrl": "ws://localhost:3011",
  "telemetryToken": "eyJ..."
}
```

**Errors:**
- `400` — Missing required fields
- `404` — Agent profile not found or inactive; project not found
- `409` — Agent profile is not available (e.g. no container capacity)

### `GET /sessions/ad-hoc`

**Query Params:**
- `projectId` — filter by project (optional)
- `agentProfileName` — filter by agent (optional)
- `status` — filter by run status (optional)
- `limit`, `offset` — pagination

**Response (200):**
```json
{
  "data": [
    {
      "runId": "a1b2c3d4-...",
      "agentProfileName": "ceo-agent",
      "projectId": "0d5aa233-...",
      "projectName": "Todo App",
      "status": "COMPLETED",
      "displayName": "Chat with ceo-agent",
      "initialMessage": "Generate work items for...",
      "createdAt": "2026-04-07T12:00:00Z",
      "completedAt": "2026-04-07T12:05:00Z"
    }
  ],
  "total": 42
}
```

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Ad-hoc sessions consume container capacity needed for automated workflows | Phase 1: rely on existing concurrency controls. Phase 2: add a dedicated concurrency scope `ad-hoc` with configurable limits. |
| Redis TTL expires before user revisits a session | Phase 3 adds persistent message storage. Phase 1 is acceptable since PiSessionTree persists the full agent state. |
| Agent calls `step_complete` prematurely, ending the conversation | Document expected behavior in the ad-hoc workflow prompt. Phase 3 adds a looping workflow variant. |
| Existing ActiveSessionWorkspace breaks without projectId | Phase 1 Task 8 explicitly addresses this with graceful fallbacks. |

---

## 7. Dependencies

- Existing `orchestration_invoke_agent_default` workflow (already seeded).
- Existing `WorkflowEngineService.startWorkflow()` API.
- Existing `ActiveSessionWorkspace` component and telemetry gateway.
- Existing agent profiles CRUD (`/agents` endpoints).

---

## 8. Out of Scope (Future)

- Agent-to-agent delegation within ad-hoc sessions (use existing agent mesh).
- Rich tool UIs (file editor, terminal) in ad-hoc sessions (existing panels suffice).
- Voice/audio input.
- Persistent chat threads spanning multiple workflow runs (Phase 3 continuation is the stepping stone).
