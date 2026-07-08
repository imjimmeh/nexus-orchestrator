# Epic: Global App Liveness via WebSocket

**Status**: Analysis Complete — Awaiting User Approval  
**Area**: `apps/web` — Frontend Real-Time Architecture

---

## Problem Statement

The frontend web app has fragmented, per-page WebSocket connections that only activate when specific pages are visited. Most live-ish UI elements rely on HTTP polling instead of push updates. The result is a UI that feels stale: the sidebar session-count badge never updates, budget data is static until you navigate, and the notification socket duplicates itself when two pages are mounted.

---

## Current WebSocket Connections (5 total — all independent, no shared singleton)

### 1. Notification Socket (`hooks/useNotifications.ts`)
- **Namespace**: fetched from `GET /notifications/inbox/websocket-config` → `wsUrl + namespace`
- **Auth**: localStorage token `nexus_token`
- **Transport**: WebSocket + polling fallback; reconnects up to 10 attempts
- **Listens**:
  - `notification:new` → invalidates `['notifications-unread-count']` + `['notifications-inbox']`
  - `notification:read` → patches `['notifications-inbox']` in-place (optimistic)
- **Emits**: nothing
- **⚠️ Bug**: Called from both `Sidebar.tsx` and `Notifications.tsx`. When both are mounted simultaneously, **two independent sockets** connect to the same namespace.
- **Consumers**: Sidebar (unread badge), Notifications page

### 2. Work-Item Realtime — Kanban (`pages/kanban/useKanbanBoardData.ts`)
- **Namespace**: `GET /work-items/{projectId}/realtime-config` → `wsUrl + namespace: "/kanban"`
- **Auth**: **None** — no token passed
- **Listens**: `work-item-updated` → `setQueryData` on `['project-work-items', projectId]` (upserts, appends new items)
- **Emits**: `join-project` on connect
- **Consumer**: `KanbanBoard.tsx` only
- **⚠️ CRITICAL BUG**: The `/kanban` Socket.IO namespace **has no server-side implementation**. The endpoint `GET /projects/:id/work-items/realtime-config` is in `apps/kanban` (a plain HTTP service with no socket.io dependency). No `@WebSocketGateway` in the entire codebase declares `namespace: '/kanban'`. The frontend has been connecting to a ghost server. Work-item realtime has never worked.

### 3. Work-Item Realtime — Sessions Tab (`pages/project-workspace/SessionsTab.tsx`)
- Identical to #2 but **duplicated code** with a behavioral divergence:
  - Kanban: appends new items to cache
  - SessionsTab: only updates existing items (no append)
- **⚠️ Bug**: If KanbanBoard and SessionsTab are both mounted for the same project, two sockets subscribe to the same room and both write to `['project-work-items', projectId]`
- **Consumer**: Project workspace SessionsTab

### 4. Workflow Run Telemetry (`hooks/useWorkflowRunTelemetry.ts`)
- **URL**: per-run short-lived token from `GET /workflow-runs/{runId}/telemetry-auth`
- **Listens**: `replay` (bulk event history), `event` (single new event), connection state events
- All data stored in local React `useState` (not query cache)
- **Fallback**: HTTP poll at 2s → backs off to 10s when WebSocket connected
- **Consumers**: ActiveSessionWorkspace, WorkflowRunDetail, SessionConversationPane

### 5. Chat Session Telemetry (`hooks/useChatSessionTelemetry.ts`)
- **Structural clone of #4** — all helper functions copy-pasted verbatim
- **URL**: per-session token from `GET /chat-sessions/{sessionId}/telemetry-auth`
- Same `replay`/`event` pattern, same local state, same polling fallback
- **Consumers**: ActiveSessionWorkspace, SteeringChat, SessionConversationPane

---

## Current Update Mechanisms by UI Element

| UI Element | Location | Update Mechanism | Interval / Transport |
|---|---|---|---|
| Sessions nav badge (active run count) | Sidebar | **NO POLLING — stale after mount** | Never |
| Notifications nav badge (unread count) | Sidebar | WebSocket push + fallback poll | WS push + **30s** |
| Notifications inbox list | `/notifications` | WebSocket push only | WS only |
| Sessions list (chat) | SessionThreadList | Polling | **3,000ms** |
| Sessions list (workflow runs) | SessionThreadList | Polling | **3,000ms** |
| Chat session state | Conversation pane | Polling | **5,000ms** |
| Chat/workflow session events | Conversation pane | WebSocket + HTTP fallback | WS; 2s→10s |
| Workflow run status/step | WorkflowRunDetail | Adaptive polling | **2,000ms** while running |
| Workflow run graph | WorkflowRunDetail | Adaptive polling | **2,000ms** while running |
| Subagent execution list | SubagentExecutionPanel | Polling | **3,000ms** |
| Project orchestration status | Dashboard/Projects | Polling | **30,000ms** |
| Project orchestration (workspace) | Project workspace | Polling | **10,000ms** |
| Budget summary/timeline | Admin spend page | **NO POLLING — one-shot** | Never |
| Budget policies | Admin budget page | **NO POLLING — one-shot** | Never |
| Budget status banner | Session pane | **NOT WIRED** (prop missing at call site) | N/A |

---

## Root Problems

1. **Stale sidebar run-count badge**: `Sidebar.tsx` calls `useWorkflowRuns()` with no args → `refetchInterval: false`. Badge never updates after mount.
2. **No global session-lifecycle events**: When a new session starts/completes, sidebar badge and session lists only update on their own polling cadence (up to 30s for orchestration status).
3. **Budget/spend is entirely stale**: No polling, no WebSocket. Budget banner not wired in `SessionConversationPane` (prop exists in interface but is absent from the call site).
4. **Double notification socket**: `Sidebar` is always mounted; opening `/notifications` adds a second socket to the same namespace.
5. **Duplicated work-item subscription** with behavioral divergence between Kanban and SessionsTab.
6. **Duplicated telemetry hook logic**: `useWorkflowRunTelemetry` and `useChatSessionTelemetry` share zero code despite being structurally identical.

---

## Proposed Solution: `GlobalRealtimeProvider`

Introduce a **singleton persistent WebSocket context** mounted once in `Layout.tsx` (always alive, regardless of which page is shown).

### Architecture

```
Layout.tsx
  └── GlobalRealtimeProvider  ← single connection, always alive
        ├── global events namespace (new sessions, run counts, spend changes, orchestration state)
        └── per-session/per-run telemetry (remains scoped — high-frequency, session-specific)
```

### Global Events the Singleton Handles

| Server Event | UI Updates Triggered |
|---|---|
| `session:started` | Invalidate sessions list + sidebar run-count |
| `session:completed` | Invalidate sessions list + sidebar run-count |
| `run:status-changed` | Invalidate workflow runs list + sidebar run-count badge |
| `notification:new` | Invalidate unread count + inbox (already done, just centralize) |
| `notification:read` | Patch inbox cache |
| `work-item:updated` | Invalidate/patch `['project-work-items', projectId]` |
| `spend:updated` | Invalidate budget summary + timeline |
| `orchestration:state-changed` | Invalidate project orchestration status (replace 30s poll) |

### Hook API

```ts
const { isConnected } = useGlobalRealtime()
// Sidebar, Layout, etc. just mount GlobalRealtimeProvider — they don't need to call hooks
// The provider handles all invalidations internally via queryClient
```

---

## Implementation Tasks

### Phase 1 — Fix existing bugs
- [ ] **IMPL-001**: Fix double notification socket — `useNotificationSocket` must be a singleton; move it to `GlobalRealtimeProvider` or use a module-level ref guard
- [ ] **IMPL-002**: Deduplicate work-item realtime subscription — extract shared hook `useWorkItemRealtimeSubscription(projectId)`, fix append-vs-no-append divergence
- [ ] **IMPL-003**: Wire budget status banner in `SessionConversationPane.tsx` — pass `budgetDecision` from the session state

### Phase 2 — Global singleton + sidebar liveness
- [ ] **IMPL-004**: Create `GlobalRealtimeProvider` + `useGlobalRealtime` context
- [ ] **IMPL-005**: Fix stale sidebar run-count badge — wire to `run:status-changed` / `session:started` global events
- [ ] **IMPL-006**: Wire spend/budget to `spend:updated` global events (replace static one-shot queries)
- [ ] **IMPL-007**: Wire project orchestration status to `orchestration:state-changed` (replace 30s poll)

### Phase 3 — Code quality
- [ ] **REFACTOR-001**: Merge shared logic from `useChatSessionTelemetry` + `useWorkflowRunTelemetry` into a shared `createTelemetryHook` factory

---

## Files to Touch

| File | Change |
|---|---|
| `src/components/layout/Layout.tsx` | Wrap with `GlobalRealtimeProvider` |
| `src/context/GlobalRealtimeContext.tsx` | **New** — provider + hook |
| `src/hooks/useNotifications.ts` | Remove `useNotificationSocket`, delegate to global provider |
| `src/pages/kanban/useKanbanBoardData.ts` | Use shared `useWorkItemRealtimeSubscription` |
| `src/pages/project-workspace/SessionsTab.tsx` | Use shared `useWorkItemRealtimeSubscription` |
| `src/hooks/useWorkItemRealtimeSubscription.ts` | **New** — extracted shared hook |
| `src/components/sessions/SessionConversationPane.tsx` | Wire `budgetDecision` prop |
| `src/hooks/useTelemetry.ts` | **New** — shared factory for workflow/chat telemetry |
