# EPIC-156: Web Kanban Service Cutover

Status: Proposed
Priority: P0
Depends On: EPIC-151, EPIC-152, EPIC-153
Related: EPIC-073, EPIC-111, EPIC-134
Last Updated: 2026-04-29

---

## 1. Summary

Cut the frontend over so kanban screens call `apps/kanban` directly instead of routing through `apps/api`. The web app already has runtime configuration for `kanbanApiUrl`, but project/work-item routes are currently forced to core.

This epic makes service ownership visible in the browser client layer.

---

## 2. Current State Review

1. `apps/web/src/lib/config.ts` returns `core` for `/projects` and `/projects/*` via `isCoreOwnedProjectRoute`.
2. `apps/web/src/lib/config.spec.ts` currently asserts that project, work-item, orchestration, goals, and work-item routes resolve to core.
3. `apps/web/src/lib/api/client.projects.ts` contains project, orchestration, goals, war-room, work-item, repository, and active-session requests under `/projects/*`.
4. `apps/web/src/lib/api/client.workflow.steering.ts` still calls core workflow-runtime project steering and amend-entity endpoints.
5. `apps/web/src/pages/projects`, `project-workspace`, `kanban`, and `work-items` depend on the project client APIs.

---

## 3. Goals

1. Route kanban-owned API calls to `kanbanApiUrl`.
2. Keep core workflow/admin/session/debug/war-room calls routed to `coreApiUrl`.
3. Make service routing explicit enough that future frontend code does not accidentally call core for kanban state.
4. Replace frontend-local kanban types with the shared kanban contract package from EPIC-150.
5. Remove frontend use of core project steering and amend-entity endpoints after kanban replacements exist.

---

## 4. Non-Goals

1. Do not redesign the project workspace UI in this epic.
2. Do not move generic workflow screens to kanban.
3. Do not leave compatibility proxy assumptions hidden in route resolution.
4. Do not cut over a route until kanban owns the corresponding API behavior.

---

## 5. High-Level Work

1. Split the frontend API client into explicit core and kanban clients or add explicit service targeting per method.
2. Change runtime route resolution so `/projects`, `/projects/*`, `/work-items`, kanban goals, review, and kanban orchestration routes use `kanbanApiUrl`.
3. Keep `/workflows`, `/workflow-runtime`, `/sessions` excluding chat, tools, users, auth, war-room, and core admin routes on `coreApiUrl`.
4. Keep war-room routes on `coreApiUrl` because war-room is core-owned generic collaboration.
5. Update config tests to assert kanban-owned route resolution.
6. Update project/work-item/orchestration frontend methods to use kanban shared contracts.
7. Replace or remove frontend calls to project steering and amend-entity core endpoints.
8. Add smoke tests proving kanban screens use the kanban base URL and workflow screens use the core base URL.
9. Update deployment config examples so `kanbanApiUrl` is required for split topology.

---

## 6. Deliverables

1. Explicit frontend service targeting for core versus kanban calls.
2. Project/work-item/goals/review/orchestration client methods routed to kanban.
3. War-room client methods routed to core as generic collaboration.
4. Updated config tests and API client tests.
5. Shared kanban contract usage in frontend API methods.
6. Deployment documentation for `kanbanApiUrl`.

---

## 7. Acceptance Criteria

1. `resolveRuntimeServiceTarget('/projects')` returns `kanban`.
2. `resolveRuntimeServiceTarget('/projects/:id/work-items')` returns `kanban`.
3. Workflow run, workflow definition, tool, user, auth, and core admin routes still return `core`.
4. Frontend project workspace behavior works against `apps/kanban` without relying on API compatibility project routes.
5. No frontend method calls core project steering or amend-entity routes after kanban replacements are available.

---

## 8. Suggested Quality Gates

1. `npm run test:unit:web`
2. `npm run build:web`
3. API client tests with different `coreApiUrl` and `kanbanApiUrl` values.
4. Project workspace smoke test against split local services.
5. Type-check proving frontend consumes shared kanban contracts.

---

## 9. Risks

1. Risk: some project routes mix core and kanban concerns, such as active session links.
2. Mitigation: route by API ownership, not browser path, and keep core workflow session reads on core.
3. Risk: compatibility proxies mask missed frontend calls.
4. Mitigation: run split-topology tests with core project routes disabled.
