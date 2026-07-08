# EPIC-108: Platform Global Scope and Project Decoupling

Status: In Progress
Priority: P0
Depends On: EPIC-078, EPIC-079, EPIC-090, EPIC-091, EPIC-107
Last Updated: 2026-04-16 (iteration 1)

---

## 1. Summary

Reframe the product so platform capabilities are global-first and project-optional, with Kanban implemented as a consumer of those shared capabilities rather than as a foundational dependency.

This epic covers the architectural and product shift required to make schedules, automation, memory, sessions, workflow launch, and future control-plane features operate independently of projects unless a project scope is explicitly selected.

Non-project CRON jobs are a required deliverable in this epic, not a side enhancement.

---

## 2. Problem

Current behavior still treats projects as a primary organizing constraint for multiple capabilities that should exist at the platform level.

Examples of the current coupling:

1. Scheduled jobs require `project_id` at the schema, contract, service, and UI layers.
2. The main web surface for schedules only exists inside Project Workspace.
3. Several workflow execution paths assume `trigger.projectId` exists even when the workflow behavior is conceptually global.
4. Kanban concepts continue to shape core product boundaries instead of being one higher-level operating mode built on top of generic workflow, session, automation, and memory primitives.

This makes the system harder to extend for global automation, cross-project workflows, personal/user-level workflows, and non-kanban operational use cases.

---

## 3. Goals

1. Establish global-first capability design as the default across API, contracts, storage, and frontend navigation.
2. Make scheduled jobs support both global and project-scoped execution, including true non-project CRON jobs.
3. Add frontend surfaces to view and manage schedules outside Project Workspace.
4. Introduce explicit scope modeling so project affiliation is optional rather than implied by table shape or route placement.
5. Reduce workflow runtime assumptions that require project context when the underlying feature is platform-wide.
6. Clarify that Kanban is a downstream product/domain built on shared platform services.

## 4. Non-Goals

1. Removing projects or Kanban from the product.
2. Rewriting every project-aware workflow or step in a single release.
3. Converting all domain logic to be cross-project immediately.
4. Delivering multi-tenant org/account scoping in this epic.

---

## 5. Architecture

### 5.1 Platform Scope Model

Introduce explicit scope semantics for platform capabilities:

1. `global`: no project ownership required.
2. `project`: tied to a specific project.
3. future-compatible extension point for other scopes such as `user` or `team`.

Rules:

1. Features must not infer scope solely from route placement.
2. Shared contracts should model optional project association explicitly.
3. UI should expose scope and affiliation, not hide them.

### 5.2 Scheduled Jobs and CRON

Scheduled jobs become the first major platform capability to adopt the new scope model.

Required changes:

1. Add explicit schedule scope to the persisted model.
2. Make `project_id` nullable for global schedules while preserving project linkage for project-scoped schedules.
3. Add list/filter support for `scope`, `project_id`, and `status`.
4. Add project display metadata in list responses for global/admin views.
5. Add a dedicated global schedules page in the web app.
6. Preserve Project Workspace schedules as a filtered view over the same capability.

### 5.3 Workflow Runtime and Execution Context

Global features cannot assume project context during execution.

Required direction:

1. `WorkflowEngineService.startWorkflow` should continue to accept nullable project context.
2. Schedule-triggered workflow launches must support runs without `trigger.projectId`.
3. Project-dependent step handlers must fail with clear validation when used from global runs without required context.
4. Project-agnostic workflows should be identifiable and eligible for global schedule binding.

### 5.4 Frontend Information Architecture

The web app should expose platform capabilities at the app level first, then allow project-filtered entry points where useful.

For schedules specifically:

1. Add a top-level schedules route and navigation item.
2. Show all schedules in a single global view with columns for scope and project.
3. Support filtering by scope, project, and status.
4. Keep the existing project tab as a scoped slice of the same data model.

### 5.5 Kanban Positioning

Kanban is a product/domain layer built on platform primitives.

Design rule:

1. core capabilities such as workflows, schedules, sessions, chat, memory, and automation must stand alone,
2. Kanban composes those capabilities for work-item orchestration and project management,
3. new shared capabilities must land in platform-owned boundaries before Kanban-specific adaptation.

---

## 6. Workstreams

1. Scope-model design across contracts, DTOs, entities, and query APIs.
2. Scheduled-jobs schema and API refactor for global and project scopes.
3. Workflow runtime validation for project-optional execution context.
4. Global schedules frontend route, filters, and table UX.
5. Project Workspace alignment so project schedules become a filtered view, not a separate subsystem.
6. Architecture and documentation updates clarifying platform-first and kanban-on-top boundaries.

---

## 7. Backlog

- [ ] E108-001 Define a shared scope model for platform capabilities in core contracts and API request/response types.
- [ ] E108-002 Refactor scheduled job entity and migration so schedules can be global or project-scoped.
- [ ] E108-003 Update scheduled job DTOs, service types, repository filters, and controller query surface for explicit scope support.
- [ ] E108-004 Add API response metadata needed for global schedule management, including project summary fields for project-scoped jobs.
- [ ] E108-005 Add workflow-level validation or metadata to distinguish project-agnostic workflows from project-required workflows.
- [ ] E108-006 Refactor schedule-triggered workflow dispatch so global schedules can launch without `trigger.projectId`.
- [ ] E108-007 Audit project-dependent step handlers and runtime tools; add explicit diagnostics for missing required project context.
- [ ] E108-008 Add a top-level web route and navigation entry for global schedules management.
- [ ] E108-009 Build an all-schedules UI with columns and filters for scope, project, status, next run, and last run.
- [ ] E108-010 Refactor Project Workspace schedules tab to consume the shared schedules capability as a project-filtered view.
- [ ] E108-011 Extend tests for schedule scope lifecycle, list filtering, UI rendering, and project-vs-global behaviors.
- [ ] E108-012 Update architecture docs to state that platform capabilities are project-optional by default and Kanban is layered on top.

---

## 8. Acceptance Criteria

1. The platform can create, persist, list, and run global scheduled jobs with no project binding.
2. Project-scoped scheduled jobs continue to work without regression.
3. The frontend includes a non-project schedules surface that can display all schedules and identify project ownership where present.
4. The Project Workspace schedules tab uses the same shared schedule model and APIs as the global schedules view.
5. Global schedule execution either runs successfully without project context or fails early with clear validation when a bound workflow requires a project.
6. Architecture and product documentation explicitly state that shared capabilities are platform-first and Kanban is a consumer layer.

---

## 9. Risks and Mitigation

1. Risk: Hidden workflow/runtime assumptions still require `projectId`.
   Mitigation: add targeted audits and explicit runtime validation before enabling global schedules broadly.
2. Risk: UI confusion between global and project-scoped records.
   Mitigation: make scope and project columns explicit and filterable.
3. Risk: Schema migration complexity for existing project-bound schedules.
   Mitigation: use additive migration steps with backward-compatible defaults before tightening API semantics.
4. Risk: Kanban-specific logic continues to leak into shared platform services.
   Mitigation: document ownership boundaries and require new shared features to land in platform-owned modules first.

---

## 10. Delivery Plan

1. Milestone A: Scope model and scheduled-job schema/API changes.
2. Milestone B: Workflow runtime validation and project-optional schedule dispatch.
3. Milestone C: Global schedules frontend route and shared list UI.
4. Milestone D: Project Workspace convergence on shared schedules surface.
5. Milestone E: Documentation, validation, and rollout notes.

---

## 11. Notes

This epic sets a general platform rule, not just a schedules rule:

1. features should be globally available unless there is a strong reason to bind them to a project,
2. project scope should be an overlay or filter where applicable,
3. Kanban should remain an opinionated orchestration/product layer built on shared capabilities rather than the defining center of the application.