# EPIC-154: Kanban MCP Tools and Dynamic Core Mounting

Status: Proposed
Priority: P0
Depends On: EPIC-151, EPIC-152, EPIC-153
Related: EPIC-080, EPIC-114, EPIC-115, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Expose kanban project/work-item/orchestration tools from `apps/kanban` through an MCP server and mount those tools dynamically into core workflow runs only when the run request supplies that external MCP mount. Core should not register built-in kanban tools or hard-code kanban mount rules.

This epic turns kanban from an in-process tool dependency into an external tool provider used by the agent OS.

---

## 2. Current State Review

1. `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts` still registers project and work-item tools such as `GetProjectStateTool`, `GetProjectBriefTool`, `GetWorkItemsTool`, `GetWorkItemTool`, `GetTodoListTool`, and `GetOrchestrationTimelineTool`.
2. `apps/api/src/workflow/workflow-internal-tools/handlers/project-tools.handler.ts` and `work-item-tools.handler.ts` still expose kanban behavior from core.
3. `packages/pi-runner/src/tools/orchestrator/orchestrator-handlers.work-items.ts` contains kanban-facing bridge behavior; war-room handlers should remain only if they target core-owned generic collaboration.
4. `packages/core/src/schemas/mcp` contains MCP contracts, and `apps/api/src/mcp` contains MCP runtime infrastructure.
5. No `apps/kanban/src/mcp` implementation currently exists.

---

## 3. Goals

1. Implement a Kanban MCP server inside `apps/kanban`.
2. Move project, work-item, goal, orchestration timeline, todo-list, and review tools out of core internal tools.
3. Keep war-room tools in core only as project-agnostic collaboration tools, not as kanban tools.
4. Add dynamic per-run MCP mounting in core based on generic run-provided mount configuration and workflow/run policy.
5. Ensure kanban tools are unavailable in non-kanban workflow runs.
6. Preserve tool governance, approval, audit, and capability policy.

---

## 4. Non-Goals

1. Do not expose core workflow execution internals as kanban MCP tools.
2. Do not make MCP the transport for every kanban REST API.
3. Do not mount kanban tools globally.
4. Do not keep duplicate core internal kanban tools after cutover.
5. Do not move generic war-room collaboration tools to kanban.

---

## 5. High-Level Work

1. Add `apps/kanban/src/mcp` with tool registration, request validation, auth, and audit.
2. Implement kanban MCP tools backed by kanban-owned services from EPIC-151 and EPIC-152.
3. Define a tool naming and versioning convention for kanban tools.
4. Extend core MCP runtime mounting so a workflow run can mount external MCP servers supplied by the run request or workflow policy.
5. Update agent/session tool assembly so kanban tools are mounted only when the run supplies the kanban MCP mount.
6. Remove project/work-item/orchestration tools from `WorkflowInternalToolsModule` after equivalent MCP tools are verified.
7. Update `packages/pi-runner` bridge tools so kanban-specific handlers call mounted MCP tools or are removed.
8. Add tests proving non-kanban runs cannot access kanban MCP tools.

---

## 6. Deliverables

1. Kanban MCP server module.
2. Kanban tool schemas and handlers.
3. Core dynamic MCP mounting support for per-run external MCP servers, with no hard-coded kanban branch.
4. Removed core internal project/work-item tools.
5. Tool governance and audit tests for kanban tool calls.

---

## 7. Acceptance Criteria

1. Core workflow runs can access kanban tools only when the run explicitly supplies the kanban MCP mount.
2. Non-kanban runs do not list or invoke kanban tools.
3. Project/work-item/orchestration timeline tools are served by `apps/kanban`, not `apps/api`.
4. Tool calls are authorized, validated, audited, and correlated to the workflow run.
5. `apps/api/src/workflow/workflow-internal-tools` contains no kanban-owned project or work-item tools after cutover.

---

## 8. Suggested Quality Gates

1. `npm run test:kanban`
2. `npm run test:api`
3. MCP contract tests for kanban tool schemas.
4. Per-run mounting tests in core.
5. Runner/session tests proving tool availability changes by context.

---

## 9. Risks

1. Risk: tool latency or MCP failures break agent workflows.
2. Mitigation: add explicit retry, timeout, and user-visible tool failure diagnostics.
3. Risk: global mounting leaks kanban capabilities into agent OS workflows.
4. Mitigation: enforce context-scoped mounting and add negative tests.
