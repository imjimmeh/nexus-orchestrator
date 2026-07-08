# Nexus Orchestrator Web App

Management interface for the Nexus Orchestrator API.

## Features

- Dashboard with system overview
- Workflow management with YAML editor
- Agent profile configuration
- AI provider and model management
- Secure secrets storage
- Real-time execution monitoring
- Workflow run detail view with:
  - live event timeline
  - streamed agent output
  - tool execution activity
  - runtime DAG visualization via React Flow (`/workflows/runs/:runId`)
  - run phase markers (planning/delegation/implementation/review handoff)
  - subagent execution observability table
  - per-step output inspection
- Active Session Workspace (`/projects/:projectId/work-items/:workItemId/active-session`) with:
  - split-pane deep steering layout (`react-resizable-panels`)
  - cognitive stream blocks (User, Agent, Tool Calls, collapsible Thoughts)
  - live `xterm.js` terminal from `bash_output` telemetry chunks
  - terminal/diff tabs with workspace file tree + git diff
  - HITL controls (Pause/Resume/Abort + prompt injection)
  - run phase badges and subagent execution observability
  - blocked-ticket conflict resolution panel (merge failure reason + "Instruct Agent to Resolve")
- Project creation form (`/projects/new`) with:
  - project name, description, repository mode (create without repo or connect existing)
  - optional repository URL, base path, and git auth secret selection
  - optional multi-goal setup (title, description, MoSCoW, priority)
  - immediate redirect to project workspace on creation
- Kanban board (`/projects/:projectId/board`) with:
  - drag-and-drop status transitions across Backlog/To Do/Refinement/In Progress/In Review/Ready to Merge/Blocked/Done
  - optimistic card moves with rollback on server failure
  - realtime board synchronization via Socket.IO (`/kanban` namespace)
  - execution-aware live-state badges derived from actual workflow run status (idle/queued/running/error/blocked/completed)
  - pre-flight summary rendering for refinement outputs (PM + Architect artifacts)
  - token spend display
  - column collapse/expand controls and automation indicators
  - readiness filters (all/ready/blocked/in-flight)
  - inline work item creation with scope and dependency selection
- Project orchestration workspace tab (`/projects/:projectId/workspace?tab=orchestration`) with:
  - orchestration lifecycle controls (start/approve/reject/pause/resume/complete)
  - decision timeline and orchestration activity feed
  - mode controls (`supervised`, `autonomous`, `notifications_only`)
  - mode hint banner with runtime behavior explanation
  - supervised pending action queue with approve/reject controls
  - agent mesh lifecycle notifications and communication-thread visibility
  - project-scoped workflow run hydration (`GET /workflows/runs?projectId=:projectId`) for fallback run discovery
- Project goals tab (`/projects/:projectId/workspace?tab=goals`) with:
  - goal CRUD/status/archive/reorder controls
  - goal worklog timeline and work-item linking actions
- Agent skills management (`/agent-skills`) with:
  - SKILL.md authoring/editing
  - reference file management (create/update/delete)
  - drag-and-drop or picker uploads for skill files
  - skill activation/deactivation
  - assignment to agent profiles from profile forms

- Authorization and fallback routes:
  - `/unauthorized` for role-protected access denials
  - in-app catch-all route rendering a not-found screen for unknown protected paths

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Web Ports

- Docker/nginx serves the built web app at `http://127.0.0.1:3120`.
- Vite preview serves at `http://127.0.0.1:3121` to avoid colliding with Docker's published web port.
- Vite dev and preview proxy `/api` and `/chat-api` to API port `3010`, and `/kanban-api` to Kanban port `3012`.

## Test

```bash
npm run test:e2e
```

## Runtime Configuration

The browser loads `public/config.json` at startup. In a split topology, set each service URL explicitly:

```json
{
  "apiUrl": "/api",
  "coreApiUrl": "/api",
  "kanbanApiUrl": "/kanban-api",
  "chatApiUrl": "/chat-api"
}
```

- `coreApiUrl`: core workflow/runtime/admin/auth/tool/user/war-room API base URL.
- `kanbanApiUrl`: kanban-owned project, work-item, goals, review, and orchestration API base URL. Required when `apps/kanban` runs separately from `apps/api`.
- `chatApiUrl`: chat session API base URL.
- `apiUrl`: legacy fallback used when a service-specific URL is omitted.

### `VITE_PUBLIC_APP_URL` (build-time env var)

Optional. Base URL used when building the copyable invite link shown in
`InviteDialog` (see [Invitations Flow](#invitations-flow-multi-tenant-phase-2)
below). When unset or empty, the link falls back to `window.location.origin`
at runtime. Set this in any deployment where the browser's own origin isn't
the URL invitees should land on (e.g. behind a reverse proxy, or when the
admin UI and the invitee-facing origin differ).

## Invitations Flow (Multi-Tenant Phase 2)

A scope admin invites a person into a scope node with a specific role via
`InviteDialog`, which shows a one-time copyable link
(`/accept-invite?token=...`) — delivery is link-only this phase, no email is
sent. The invitee opens the link and accepts either as their already-logged-in
account or by setting a new username/password. `PendingInvitationsList` (in
`ScopeMembersPanel`) shows still-pending invites with a revoke action.

See [docs/guide/multi-tenant-scopes.md](../../docs/guide/multi-tenant-scopes.md#phase-2--invitations-link-delivery)
for the full lifecycle, security posture, and the Phase-3 email seam.

## App-Wide Scope Framing (Multi-Tenant Phase 5)

The active scope lives in the URL (`?scope=<scopeNodeId>`; absent = the
platform root), with localStorage retained only as a back-compat fallback —
see `ScopeContext` (`src/context/ScopeContext.tsx`). The shell derives an
`AppPlane` (`"platform" | "workspace"`) from the active scope via
`resolvePlane` (`src/lib/scope/plane.ts`) and filters the sidebar
(`NAV_GROUPS`, `src/components/layout/navigation.config.ts`) by plane **and**
the caller's effective permissions at that scope
(`useEffectivePermissions`, `src/hooks/useEffectivePermissions.ts`) — not the
coarse JWT admin role. The header always renders `ScopeSwitcher`
(`src/components/scope/ScopeSwitcher.tsx`), a persistent breadcrumb that
replaced the old dismissible `ScopeBanner` (deleted, no re-export). Any new
list page should read `activeScopeNodeId` from `useScopeContext`, forward it
as `scopeNodeId` to its list query, and include it in the React Query
`queryKey` so a scope switch triggers a refetch.

Pages that follow this pattern today are `Providers`, `Secrets`,
`VariablesEditorPage`, and `AuditLogPage`. Several others (`Users`,
`Workflows`, `AgentProfiles`, `BudgetPoliciesTab`, `GitOpsStatus`) read the
active scope only for a badge/checkbox/client-side filter and do **not** yet
send it to their list query — they rely on the backend default-deny filter
to bound results, and per-page refilter is a tracked follow-up (see the guide
section below).

See [docs/guide/multi-tenant-scopes.md#phase-5--app-wide-scope-framing](../../docs/guide/multi-tenant-scopes.md#phase-5--app-wide-scope-framing)
for the full design, the plane/permission filtering rules, the backend
default-deny pattern, the current-vs-follow-up page status, and which list
endpoints/pages are and aren't scope-partitioned.

## Workflow Execution Live View

Execution history cards on the workflow detail screen now link to a dedicated run view:

- Route: `/workflows/:id/runs/:runId`
- Data sources:
  - `GET /workflows/runs/:runId`
  - `GET /workflows/runs/:runId/graph`
  - `GET /workflows/runs/:runId/events`
  - `GET /workflows/runs/:runId/telemetry-auth`
- Live transport: Socket.io connection using the telemetry auth token returned by the API.

## Agent Skills Flow (EPIC-057)

Primary route: `/agent-skills`

UI actions and API mapping:

- List skills -> `GET /ai-config/skills`
- Create skill -> `POST /ai-config/skills`
- Update skill -> `PATCH /ai-config/skills/:id`
- Delete skill -> `DELETE /ai-config/skills/:id`
- List skill files -> `GET /ai-config/skills/:id/files`
- Upsert skill file -> `PUT /ai-config/skills/:id/files`
- Delete skill file -> `DELETE /ai-config/skills/:id/files?path=<relative-path>`
- List profile skills -> `GET /ai-config/agent-profiles/:id/skills`
- Replace profile skills -> `PUT /ai-config/agent-profiles/:id/skills`

## Project Goals Flow (EPIC-059)

Primary route: `/projects/:projectId/workspace?tab=goals`

UI actions and API mapping:

- Load goals -> `GET /projects/:projectId/goals`
- Create goal -> `POST /projects/:projectId/goals`
- Update goal -> `PATCH /projects/:projectId/goals/:goalId`
- Update status -> `PATCH /projects/:projectId/goals/:goalId/status`
- Reorder goals -> `PATCH /projects/:projectId/goals/reorder`
- Archive/unarchive -> `POST /projects/:projectId/goals/:goalId/archive|unarchive`
- Goal worklogs -> `GET|POST /projects/:projectId/goals/:goalId/worklogs`
- Link work item to goal -> `POST /projects/:projectId/goals/:goalId/worklogs/link-work-item`

## Workflow Graph Flow (EPIC-060)

Workflow detail and run views use canonical graph snapshots from API read models:

- Run graph -> `GET /workflows/runs/:runId/graph`
- Static workflow graph -> `GET /workflows/:id/graph`

Shared status badges/mapping are applied across workflow detail, execution logs,
kanban run widgets, and orchestration workflow-status surfaces.

## Project Creation Flow

Primary route: `/projects/new`

UI actions and API mapping:

- Create project → `POST /projects`
  - `repositoryUrl`, `basePath`, and `githubSecretId` are optional
- On success, redirects to `/projects/:projectId`

## Work Item CRUD

Available from the kanban board or API client:

- Update work item → `PATCH /projects/:id/work-items/:workItemId`
- Delete work item → `DELETE /projects/:id/work-items/:workItemId`

Work item definitions are markdown-canonical and reconciled server-side from repository files under `docs/work-items/`.

## Kanban Board Flow (EPIC-020)

Primary route: `/projects/:projectId/board`

UI actions and API/socket mapping:

- Load board data → `GET /projects/:projectId/work-items`
- Move card between columns → `PATCH /projects/:projectId/work-items/:workItemId/status`
- Load automation indicators → `GET /projects/:projectId/work-items/automation-triggers`
- Load socket config → `GET /projects/:projectId/work-items/realtime-config`
- Subscribe realtime updates → Socket.IO namespace `/kanban`, event `work-item-updated`

## Task Configuration Flow (EPIC-021)

Kanban tickets now support a pre-dispatch Task Configuration modal.

- Open modal from per-ticket `Configure` action.
- On drag to `To Do` or `In Progress`, modal opens automatically when config is missing.
- Modal loads:
  - Agent profiles → `GET /ai-config/agent-profiles`
  - Branches → `GET /projects/:id/repository/branches`
  - Files for `@file` mentions → `GET /projects/:id/repository/files`
  - Existing config → `GET /projects/:projectId/work-items/:workItemId/execution-config`
- Save config → `PATCH /projects/:projectId/work-items/:workItemId/execution-config`
- After save, pending status transitions continue with configured payload parameters.

## Active Session Workspace Flow (EPIC-022)

Primary route: `/projects/:projectId/work-items/:workItemId/active-session`

UI actions and API/socket mapping:

- Open workspace from in-progress card click (with `currentExecutionId`)
- Hydrate stream history → `GET /workflows/runs/:runId/events`
- Get live socket auth → `GET /workflows/runs/:runId/telemetry-auth`
- Pause/Resume/Abort run → `POST /workflows/runs/:runId/control/:action`
- Inject guidance prompt → `POST /workflows/runs/:runId/inject`
- Fetch workspace tree → `GET /workflows/runs/:runId/workspace/tree`
- Fetch live diff → `GET /workflows/runs/:runId/workspace/diff`

## First-Login Setup Flow (EPIC-026)

Primary route: `/setup`

Behavior:

- Authenticated admins are redirected to `/setup` until platform setup is complete.
- Non-admin users continue to standard app routes without setup enforcement.
- Setup form initializes provider/model/profile using admin API and returns to dashboard.

API mapping:

- Setup status check → `GET /setup/status`
- Setup bootstrap submit → `POST /setup/initialize`
