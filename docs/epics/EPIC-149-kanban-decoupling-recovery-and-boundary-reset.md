# EPIC-149: Kanban Decoupling Recovery and Boundary Reset

Status: Proposed
Priority: P0
Depends On: EPIC-089, EPIC-090, EPIC-091, EPIC-134, EPIC-148
Related: docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Restart the kanban extraction from a known-good service boundary instead of continuing to patch the current partial facade. The current `apps/kanban` service has useful bootstrapping, request context, internal auth, database, and core-integration scaffolding, but its domain modules are mostly incomplete projections or BFF calls back into `apps/api`.

This epic removes the misleading kanban facade code and establishes the guardrails for the rest of the extraction: `apps/api` is the agent OS and workflow runtime, while `apps/kanban` owns project, work item, goals, review, and kanban orchestration domain behavior. War-room stays in core as project-agnostic multi-agent collaboration.

---

## 2. Current State Review

1. `apps/kanban/src/project/project.service.ts` creates and lists projects by calling `CoreWorkflowClientService` against `/projects` in `apps/api`.
2. `apps/kanban/src/work-item/work-item.service.ts` creates local work items but reads, updates, restarts, and hydrates most work item behavior from core API project routes.
3. `apps/kanban/src/core/core-workflow-client.service.ts` still exposes project and work-item methods such as `listProjects`, `createProject`, `listProjectWorkItems`, and `updateWorkItemStatus`.
4. `apps/api/src/project/project.module.ts` still owns project, work-item, goals, orchestration, dispatch, intelligence, and amend-entity services.
5. `apps/api/src/workflow/workflow.module.ts` still imports `ProjectModule`, `IntelligenceModule`, and in-process project/work-item domain adapters.
6. `apps/web/src/lib/config.ts` still routes `/projects` and `/projects/*` requests to core instead of kanban.
7. `docs/epics/EPIC-134-extract-kanban-service.md` is cancelled, and `EPIC-091` is marked implemented even though the extraction is not authoritative.

---

## 3. Goals

1. Delete misleading kanban domain facade code before rebuilding the service as the authoritative kanban domain module.
2. Preserve only service bootstrap and generic cross-cutting infrastructure in `apps/kanban/src`.
3. Record the target seam between agent OS runtime behavior and kanban domain behavior.
4. Add import and dependency guardrails so the reset does not regress into a facade over `apps/api` project routes.
5. Create a clear migration order for the downstream epics.

---

## 4. Non-Goals

1. Do not delete `apps/api/src/project` in this epic.
2. Do not migrate data in this epic.
3. Do not cut the frontend over in this epic.
4. Do not remove core workflow execution APIs needed by kanban.
5. Do not preserve old kanban facade modules for compatibility unless a downstream epic explicitly requires a temporary shim.

---

## 5. Target Boundary

| Concern | Target Owner |
| --- | --- |
| Workflow definitions, runs, steps, agents, skills, tools, sessions, host mounts, lifecycle events | `apps/api` |
| Projects, work items, goals, subtasks, kanban status lifecycle, review policy, dispatch policy | `apps/kanban` |
| War-room sessions, participants, messages, blackboard, signoff, consensus | `apps/api` as generic multi-agent collaboration |
| Shared core execution contracts | Existing `@nexus/core` package |
| Shared kanban domain contracts | New kanban contract package from EPIC-150 |
| Kanban UI routes and project workspace API calls | `apps/kanban` via `kanbanApiUrl` |

---

## 6. High-Level Work

1. Inventory `apps/kanban/src` and mark files as preserve, delete, or rebuild.
2. Preserve bootstrap files such as `main.ts`, `app.module.ts`, request context, internal auth, health endpoint, and any ACP/MCP-specific infrastructure that is genuinely kanban-owned.
3. Delete proxy/facade domain modules under `project`, `work-item`, `orchestration`, `review`, local `war-room` policy facades, and any local database projection code that will be rebuilt by later epics.
4. Replace the deleted modules with empty module placeholders only where downstream epics need stable compile-time imports.
5. Restrict `CoreWorkflowClientService` to core workflow execution, status, control, lifecycle event, MCP, and runtime APIs.
6. Add lint or test guardrails blocking new kanban calls to core `/projects`, `/work-items`, `/goals`, `/war-room`, or other kanban-owned routes.
7. Update documentation to state that EPIC-149 through EPIC-157 supersede the partial EPIC-091/EPIC-134 extraction path.

---

## 7. Deliverables

1. A slim `apps/kanban/src` containing only bootstrapping and generic infrastructure after reset.
2. A documented preserve/delete/rebuild inventory for kanban service files.
3. Guardrails preventing kanban from depending on core-owned project/work-item HTTP routes.
4. A migration dependency map linking EPIC-150 through EPIC-157.

---

## 8. Acceptance Criteria

1. `apps/kanban` compiles after deleting the misleading facade modules.
2. `CoreWorkflowClientService` no longer contains project/work-item CRUD or status mutation methods.
3. New kanban code cannot call core `/projects` or `/projects/*` endpoints.
4. The only allowed kanban-to-core calls are generic agent OS operations such as workflow run request/status/control, lifecycle replay, MCP/ACP integration, and runtime metadata.
5. The reset leaves a clear skeleton for the source-of-truth port in EPIC-151 and orchestration-brain port in EPIC-152.

---

## 9. Suggested Quality Gates

1. `npm run lint:kanban`
2. `npm run build:kanban`
3. `npm run test:kanban`
4. A targeted guardrail test proving `apps/kanban` cannot import or call core project/work-item facade routes.

---

## 10. Risks

1. Risk: deleting facade code temporarily reduces visible functionality.
2. Mitigation: make this an explicit reset epic and keep downstream porting epics small and ordered.
3. Risk: downstream work reintroduces BFF behavior.
4. Mitigation: add import and HTTP-route guardrails before porting domain behavior.
