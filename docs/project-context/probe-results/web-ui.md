---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: web-ui
outcome: success
inferred_status: implemented
confidence_score: 0.85
evidence_refs:
  - apps/web/src/pages/Dashboard.tsx
  - apps/web/src/hooks/useProjectOrchestration.ts
  - apps/web/src/hooks/useProjectOrchestrationSummaries.ts
  - apps/web/src/features/control-plane/ControlPlaneBoard.tsx
  - apps/web/src/components/workflow/WorkflowVisualizer.tsx
  - apps/web/src/components/workflow/WorkflowActivityFeed.tsx
  - apps/web/src/components/workflow/WorkflowLaunchDialog.tsx
  - apps/web/src/pages/kanban/useKanbanBoardData.ts
  - apps/web/src/stores/auth.store.ts
  - apps/web/src/lib/api/client.ts
source_paths:
  - apps/web/src
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Web Management UI

## Narrative Summary

The Web UI scope (`apps/web/src`) is fully implemented with a well-structured React/Vite application. The codebase features comprehensive orchestration management including a dashboard with project stat cards, project orchestration hooks with polling and mutations, a control-plane board visualizing intent lanes, workflow components (visualizer, activity feed, launch dialog), a Kanban board with realtime WebSocket subscription, and an auth store with token persistence. Test coverage is extensive with 50+ spec files covering hooks, components, and pages. The architecture cleanly separates concerns: API layer (`lib/api/`), hooks (`hooks/`), stores (`stores/`), and pages/components (`pages/`, `components/`).

## Capability Updates

| Capability | Status | Evidence |
|------------|--------|----------|
| Dashboard with project stats | Implemented | `Dashboard.tsx` — stat cards for projects, active orchestrations, runs, agents with trend charts |
| Project orchestration state | Implemented | `useProjectOrchestration.ts` — query, start, approve, reject, pause, resume, complete mutations |
| Orchestration summaries by project | Implemented | `useProjectOrchestrationSummaries.ts` — batch queries with 30s polling interval |
| Control plane board | Implemented | `ControlPlaneBoard.tsx` — lanes (dispatch/repair), intents, facts, no-launch reasons, stale links |
| Workflow visualizer | Implemented | `WorkflowVisualizer.tsx` — ReactFlow with job/step nodes, edges, animated sequences |
| Workflow activity feed | Implemented | `WorkflowActivityFeed.tsx` — accordion list with search, quick filters, failure highlighting |
| Workflow launch dialog | Implemented | `WorkflowLaunchDialog.tsx` — preset save/load, JSON mode, contract validation |
| Kanban board | Implemented | `KanbanBoard.tsx`, `useKanbanBoardData.ts` — CRUD, status updates, realtime via socket.io |
| Work item detail panel | Implemented | `WorkItemDetailSheet.tsx`, `WorkItemDetailSections.tsx` |
| Auth store with persistence | Implemented | `auth.store.ts` — Zustand persist, token refresh, validation, logout |
| API client | Implemented | `lib/api/client.ts` — Axios, project/workflow/admin methods, event ledger |

## Health Findings

- **Test coverage**: 50+ spec files (`*.spec.tsx`) covering hooks (`useProjectOrchestration.spec.tsx`, `Dashboard.spec.tsx`), components (`ControlPlaneBoard.spec.tsx`, `WorkflowActivityFeed.spec.tsx`), and pages (`Projects.spec.tsx`, `SessionsListPage.spec.tsx`)
- **Test patterns**: Consistent use of `vi.mock()` for API, `QueryClientProvider` for hooks, `renderHook`/`waitFor` for hook tests
- **Code quality**: Component props consistently typed with `Readonly<>`, hooks use `useMemo`/`useQuery` properly, real-time subscriptions properly cleaned up via `useEffect` return
- **Churn indicators**: No stale imports, consistent naming conventions, TypeScript strict typing throughout
- **Missing**: No E2E tests visible in scope; `docs/` directory not examined within `apps/web/src`

## Open Questions

1. **Runtime config loading** — `getRuntimeConfig()` in `lib/api/client.ts` resolves URL from `@/lib/config` which was not examined; runtime config may come from environment or window global
2. **Backend API contract** — Type imports from `@nexus/core` suggest shared types package; whether API shapes match backend is unverifiable from UI code alone
3. **Realtime WS namespace** — `useKanbanBoardData.ts` uses socket.io with configurable namespace; whether the server emits `work-item-updated` events on that namespace is unconfirmed
4. **Orchestration polling trade-offs** — `useProjectOrchestrationSummaries` polls every 30s; for high-cardinality project lists this may cause N+1 query load on backend