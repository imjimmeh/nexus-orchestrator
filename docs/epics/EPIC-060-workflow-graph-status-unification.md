# EPIC-060: Workflow Graph Visualization and Status Unification

> Status: Implemented (v1 shipped)  
> Priority: Critical  
> Estimate: 4-6 weeks  
> Created: 2026-04-06  
> Last Updated: 2026-04-06  
> Owner: TBD

---

## 1. Epic Summary

Workflow visualization and workflow status display are currently fragmented across multiple frontend surfaces, with duplicated status mappings and a YAML regex-based visualizer that does not reflect the runtime job graph accurately.

This epic introduces a canonical workflow graph read model from the API, a React Flow-based graph experience in the web app, and a shared status semantics layer used everywhere workflow run status or step/job status is rendered.

The outcome is one source of truth for status interpretation and one graph model for visualization, improving correctness, operator trust, and troubleshooting speed.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. Backend read-model service for workflow graph/runtime projection (`WorkflowGraphReadModelService`).
2. API endpoints:
   - `GET /workflows/runs/:runId/graph`
   - `GET /workflows/:id/graph`
3. Shared workflow run/node status contracts and mapping utilities.
4. React Flow visualizer replacement path in workflow detail views.
5. Shared status components (`WorkflowStatusBadge`, `WorkflowNodeStatusBadge`) and status utility module.
6. Surface migration across workflow detail/run detail/logs/kanban/orchestration cards to use unified status mapping.
7. API and Web test coverage for graph contracts and status rendering behavior.

---

## 2. Problem Statement and Current-State Gaps

### 2.1 Current behavior

1. The workflow visualizer parses workflow YAML with regex and renders a largely linear card layout.
2. Frontend status mapping logic is duplicated across workflow pages, execution logs, kanban surfaces, and orchestration cards.
3. Surfaces infer step/job state from partial signals (run status + current step index), which can drift from actual execution telemetry.
4. Run telemetry and event logs contain richer execution signals, but they are not normalized into a reusable graph snapshot contract.

### 2.2 Product and operational issues

1. Users cannot reliably see true DAG state (queued, active, blocked, failed, completed) for each job/step.
2. Status badges can disagree between pages for the same run.
3. Incidents require log-diving because graph state is not reconstructed server-side.
4. Frontend maintenance cost is high due to duplicated mapping utilities and ad hoc heuristics.

---

## 3. Request Coverage Mapping

This epic directly covers the requested outcomes:

1. Proper graph visualization:
   - Replace legacy visualizer with React Flow-driven DAG rendering.
2. Status of each step/job:
   - Add canonical per-node runtime status in API snapshot and render it in graph nodes.
3. Workflow statuses everywhere:
   - Unify run/job/step status mapping through shared utilities and UI components.
4. Codebase-wide alignment:
   - Update all workflow status surfaces (workflow detail, run detail, execution logs, kanban-linked run cards, orchestration status surfaces).

---

## 4. Scope and Non-Goals

### 4.1 In scope

1. Backend read model endpoint(s) for workflow graph and run snapshot state.
2. Canonical status derivation from run entity + queued/completed markers + event logs/telemetry history.
3. React Flow-based renderer for workflow structure and run-aware node status.
4. Shared frontend status taxonomy, badges, and mapping helpers.
5. Migration of all existing workflow-status UI surfaces to shared mapping.
6. Regression tests across API, web unit tests, and targeted e2e.

### 4.2 Out of scope

1. Rewriting workflow execution engine behavior or scheduling semantics.
2. Replacing telemetry transport (WebSocket/Redis stream architecture remains).
3. Editing historical event schemas beyond additions needed for read model stability.
4. Building a multi-run comparative analytics dashboard.

---

## 5. Target Design

### 5.1 Canonical status taxonomy

Define one normalized node status set for jobs/steps:

1. `idle`
2. `queued`
3. `running`
4. `blocked`
5. `waiting_input`
6. `succeeded`
7. `failed`
8. `cancelled`
9. `skipped`

Run status remains canonical at run level (`pending`, `running`, `completed`, `failed`, plus existing lifecycle values), with explicit mapping to presentation badges through one shared utility.

### 5.2 API read model

Add a workflow run graph snapshot contract:

1. Static graph definition:
   - jobs, steps, edges (`depends_on`, transition edges)
2. Runtime snapshot:
   - run status, active node IDs, queued node IDs, completed node IDs, failed node IDs
3. Node details:
   - node type (`job` or `step`), normalized status, timestamps, last event summary, error summary
4. Event cursor info:
   - latest sequence/timestamp for client merge and polling stability

### 5.3 Frontend visualization

React Flow-based graph in workflow details:

1. Custom node components for job and step nodes.
2. Status-aware styling and iconography from shared status utilities.
3. Layout strategy:
   - deterministic DAG layout with stable node IDs
   - viewport fit on load and persisted position overrides only when user explicitly adjusts view
4. Interaction model:
   - click node to open node detail panel with recent events/log summary
   - highlight current active path

### 5.4 Status unification across surfaces

Replace local status interpretation with one source:

1. Shared client status module (single mapping table and helper API).
2. Shared `WorkflowStatusBadge` and `WorkflowNodeStatusBadge` components.
3. Surface migration for:
   - Workflow detail visualization tab
   - Workflow run detail headers/timelines
   - Execution logs list
   - Kanban work item run widgets
   - Orchestration status cards with workflow run context

---

## 6. Contract and Endpoint Plan

### 6.1 API endpoint additions

1. `GET /workflows/runs/:runId/graph`
   - Returns normalized graph + runtime node statuses.
2. Optional extension:
   - `GET /workflows/:workflowId/graph` for static structure preview (no runtime state).

### 6.2 Contract ownership

1. Place shared DTO interfaces in `packages/core` when reused by API and web.
2. Keep transformation logic server-side so web does not reconstruct execution truth from raw events.

### 6.3 Backward compatibility

1. Existing run and event endpoints stay unchanged.
2. New graph endpoint is additive.
3. Existing pages continue to function during migration using old paths behind feature guard until switched.

---

## 7. Implementation Plan

## Phase 1: Canonical Status Semantics and Shared Contracts

### Phase 1 Task 1: Define shared status enums and mapping boundaries

Files (expected):

1. `packages/core/src/interfaces/index.ts`
2. `apps/web/src/lib/api/types.ts`
3. `apps/web/src/lib/api/utils.ts`

Acceptance criteria:

1. One normalized node status type exists and is imported wherever needed.
2. Existing ad hoc status literals are replaced by canonical types in touched files.
3. Type checks pass without widening to `string`.

### Phase 1 Task 2: Create frontend status utility module and badges

Files (expected):

1. `apps/web/src/components/workflow/WorkflowStatusBadge.tsx` (new)
2. `apps/web/src/components/workflow/WorkflowNodeStatusBadge.tsx` (new)
3. `apps/web/src/lib/workflow-status.ts` (new)

Acceptance criteria:

1. Badge text/color/icon derives only from shared utility.
2. No duplicate mapping tables remain in migrated components.

## Phase 2: API Graph Snapshot Read Model

### Phase 2 Task 1: Build graph snapshot service

Files (expected):

1. `apps/api/src/workflow/workflow-graph-read-model.service.ts` (new)
2. `apps/api/src/workflow/workflow.module.ts`
3. `apps/api/src/workflow/workflow.controller.ts`
4. `apps/api/src/workflow/dto/workflow-run-graph.dto.ts` (new)

Acceptance criteria:

1. Service reconstructs static DAG from workflow definition jobs/steps.
2. Service overlays runtime status from run state and persisted events.
3. Missing/partial telemetry does not break response; fallback states are deterministic.

### Phase 2 Task 2: Add endpoint and test coverage

Files (expected):

1. `apps/api/src/workflow/workflow.controller.spec.ts`
2. `apps/api/test/workflow-graph-read-model.e2e-spec.ts` (new)

Acceptance criteria:

1. `GET /workflows/runs/:runId/graph` returns stable schema with ordered nodes/edges.
2. Endpoint is scoped and protected consistently with existing workflow run endpoints.
3. Contract tests validate representative statuses (`queued`, `running`, `failed`, `completed`).

## Phase 3: React Flow Visualizer Replacement

### Phase 3 Task 1: Introduce React Flow rendering path

Files (expected):

1. `apps/web/package.json`
2. `apps/web/src/components/workflow/WorkflowVisualizer.tsx`
3. `apps/web/src/components/workflow/WorkflowGraphNode.tsx` (new)
4. `apps/web/src/components/workflow/WorkflowGraphLegend.tsx` (new)

Acceptance criteria:

1. Visualization renders true DAG with directional edges and branch fan-out.
2. Node status updates as run data changes.
3. Mobile and desktop layouts remain usable.

### Phase 3 Task 2: Data wiring for graph endpoint

Files (expected):

1. `apps/web/src/lib/api/client.ts`
2. `apps/web/src/lib/api/queryKeys.ts`
3. `apps/web/src/hooks/useWorkflowRunGraph.ts` (new)
4. `apps/web/src/pages/workflows/WorkflowDetail.tsx`

Acceptance criteria:

1. Workflow detail visualization tab uses graph endpoint data.
2. Legacy YAML regex parser path is removed from runtime rendering path.

## Phase 4: Status Surface Migration

### Phase 4 Task 1: Workflow run detail and execution logs

Files (expected):

1. `apps/web/src/pages/workflows/WorkflowRunDetail.tsx`
2. `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`
3. `apps/web/src/components/workflow/ExecutionLogs.tsx`

Acceptance criteria:

1. All run/status badges use shared status utility and shared badge components.
2. Current-step messaging aligns with canonical active node states.

### Phase 4 Task 2: Kanban and orchestration-linked surfaces

Files (expected):

1. `apps/web/src/pages/kanban/WorkItemDetailSheetContent.tsx`
2. `apps/web/src/pages/kanban/kanban.utils.ts`
3. `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`

Acceptance criteria:

1. Workflow-linked badges show same status text/colors as workflow pages.
2. No local fallback mappings remain except intentional unknown-state fallback.

## Phase 5: Live Updates and Reliability

### Phase 5 Task 1: Integrate telemetry updates into graph cache

Files (expected):

1. `apps/web/src/hooks/useWorkflowRunTelemetry.ts`
2. `apps/web/src/hooks/useWorkflowRunGraph.ts`

Acceptance criteria:

1. Live events update relevant node statuses without full page refresh.
2. Event dedupe remains stable and does not regress existing timeline behavior.

### Phase 5 Task 2: Fallback and stale-run handling

Files (expected):

1. `apps/web/src/components/workflow/WorkflowVisualizer.tsx`
2. `apps/web/src/lib/workflow-status.ts`

Acceptance criteria:

1. Partial data states render clear placeholders, not incorrect success/failure states.
2. Disconnected/live-offline scenarios preserve last known snapshot with explicit stale indicator.

## Phase 6: Testing, Rollout, and Cleanup

### Phase 6 Task 1: Unit and integration tests

Files (expected):

1. `apps/web/src/components/workflow/WorkflowVisualizer.spec.tsx`
2. `apps/web/src/components/workflow/ExecutionLogs.spec.tsx`
3. `apps/web/src/pages/workflows/WorkflowRunDetailContent.spec.tsx`
4. `apps/api/src/workflow/workflow-graph-read-model.service.spec.ts` (new)

Acceptance criteria:

1. Tests cover status normalization, graph render states, and API graph contract.
2. Regression tests verify status consistency across multiple surfaces.

### Phase 6 Task 2: E2E regression and cutover

Files (expected):

1. `packages/e2e-tests/` (targeted workflow visualization/status specs)

Acceptance criteria:

1. End-to-end checks verify status consistency between workflow detail and kanban-linked run surfaces.
2. End-to-end checks verify node-level status progression for a representative run.
3. Legacy visualizer dead code is removed after green validation.

---

## 8. Execution-Ready Checklist

### 8.1 Discovery and contract freeze

1. Confirm final normalized node status list and mapping policy.
2. Freeze graph DTO schema with example payloads.
3. Identify all UI surfaces still using local status mappings.

### 8.2 Build order gates

1. Merge shared status utilities before feature migration begins.
2. Merge API graph endpoint and contract tests before React Flow replacement.
3. Complete workflow detail graph migration before kanban/orchestration status migration.

### 8.3 Quality gates

1. API lint and targeted tests green.
2. Web lint and targeted unit tests green.
3. Targeted e2e workflow status consistency suite green.

### 8.4 Cutover checklist

1. Remove legacy YAML regex status inference path.
2. Remove duplicate status mapping helpers that are no longer referenced.
3. Validate docs and screenshots in workflow-related documentation.

---

## 9. Acceptance Criteria (Epic-Level)

1. Workflow visualization renders a true graph (DAG) rather than linear heuristic cards.
2. Every job/step node displays canonical runtime status from backend graph snapshot.
3. Workflow status labels and badges are consistent across workflow detail, run detail, execution logs, kanban-linked surfaces, and orchestration status surfaces.
4. Frontend no longer parses workflow YAML with regex at render time for execution status.
5. API graph endpoint is stable, tested, and additive (no regressions to existing endpoints).
6. Targeted API/web/e2e tests pass for status consistency and graph progression.

---

## 10. Risks and Mitigations

1. Risk: status divergence between telemetry stream and persisted event history.
   - Mitigation: deterministic precedence rules in read model and test fixtures for race conditions.
2. Risk: React Flow layout churn causing unstable node positions between updates.
   - Mitigation: stable node IDs + deterministic layout seed + limited relayout triggers.
3. Risk: performance degradation on large workflows.
   - Mitigation: memoized graph transforms, viewport virtualization tactics, and bounded event patching.
4. Risk: migration misses an obscure status surface.
   - Mitigation: repository-wide grep audit and shared component adoption checklist.

---

## 11. Dependencies

1. Existing workflow jobs/steps model and run lifecycle semantics.
2. Workflow event log persistence and telemetry history APIs.
3. Shared contracts in `packages/core` and web query layer.

---

## 12. Test Strategy

1. API unit tests:
   - Graph reconstruction from workflow definition.
   - Node status normalization from run + event log inputs.
2. API integration/e2e tests:
   - Endpoint contract and auth behavior.
   - Representative run state transitions.
3. Web unit/component tests:
   - Graph rendering for branching and dependency cases.
   - Badge consistency for all canonical statuses.
4. Workflow-focused e2e tests:
   - Run a representative workflow and validate node status transitions over time.
   - Assert same status presentation in workflow and kanban-linked views.

---

## 13. Rollout Plan

1. Stage 1: Ship shared status utilities and badges behind no functional change.
2. Stage 2: Ship backend graph endpoint and contract tests.
3. Stage 3: Enable React Flow graph in workflow detail under feature flag.
4. Stage 4: Migrate remaining status surfaces and remove flag after validation.
5. Stage 5: Remove legacy status mapping code and parser-based visualizer logic.

---

## 14. Definition of Done

1. Graph endpoint and shared status semantics are the canonical source for UI status rendering.
2. Workflow detail uses React Flow graph with accurate per-node execution states.
3. All known workflow status surfaces use shared status mapping and shared badge components.
4. Targeted lint/tests and workflow-related e2e regression checks pass.
5. Documentation reflects new graph/status architecture and migration completion.
