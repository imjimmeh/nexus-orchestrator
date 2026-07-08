# EPIC-088: Control Plane and Domain Split Foundations and Guardrails

Status: Completed
Priority: P0
Depends On: None
Related: PLAN-REFACTOR, SDD-multi-service-control-and-domain-architecture
Last Updated: 2026-04-13

---

## 1. Epic Summary

Create the migration safety rails and delivery structure required to split the current backend into three bounded services without destabilizing production behavior:

1. Core Control Plane (existing apps/api, narrowed responsibility)
2. Kanban Domain Service (new apps/kanban)
3. Chat Domain Service (new apps/chat)

This epic does not move domain logic yet. It creates the constraints, inventory, and execution harness so downstream extraction epics are safe and measurable.

---

## 2. Context

Current baseline shows one deployment surface hosting all concerns:

1. App composition includes workflow, project, and session modules inside one Nest app.
2. Workflow module directly imports project and session modules and domain services.
3. Project and session modules both depend on workflow module.
4. One global database module registers workflow, project, and chat entities together.
5. Workspace currently contains apps/api and apps/web only.

Without guardrails, coupling can increase while extraction is in progress.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../specs/SDD-multi-service-control-and-domain-architecture.md
3. ../../apps/api/src/app.module.ts
4. ../../apps/api/src/workflow/workflow.module.ts
5. ../../apps/api/src/project/project.module.ts
6. ../../apps/api/src/session/session.module.ts
7. ../../apps/api/src/database/database.module.ts
8. ../../package.json

---

## 4. Scope

### In Scope

1. Produce a dependency and ownership baseline for workflow, project, project-goals, and session/chat modules.
2. Add architecture tests to enforce bounded-context import rules.
3. Scaffold empty service workspaces for apps/kanban and apps/chat with lint and test wiring.
4. Add CI-friendly scripts for lint/build/test by service workspace.
5. Define migration readiness and rollback checkpoints used by all follow-on epics.

### Out of Scope

1. Moving API routes or entity ownership.
2. Changing workflow execution behavior.
3. Introducing cross-service event processing.

---

## 5. Implementation Plan

### 5.1 Baseline Inventory

1. Generate module dependency graph for apps/api/src/workflow, apps/api/src/project, apps/api/src/project-goals, and apps/api/src/session.
2. Classify each dependency as control-plane, kanban-domain, chat-domain, or shared.
3. Persist the report in docs/analysis with a stable format that can be diffed over time.

### 5.2 Architecture Guardrails

1. Add static import boundary tests that fail on forbidden domain-to-control or control-to-domain imports.
2. Define temporary allowed exceptions with explicit expiry dates.
3. Gate pull requests with the boundary test suite.

### 5.3 Workspace Scaffolding

1. Add apps/kanban and apps/chat workspace roots with minimal Nest bootstrap.
2. Add package scripts at root for lint:kanban, lint:chat, test:kanban, test:chat, build:kanban, build:chat.
3. Wire tsconfig and eslint configs to existing strict monorepo policy.

### 5.4 Program Controls

1. Define a migration dashboard doc that tracks epic status and blocked dependencies.
2. Add phase exit checklist template (contracts, tests, docs, rollback path).

---

## 6. Deliverables

1. Dependency baseline report and ownership matrix.
2. Import-boundary architecture test suite.
3. Scaffolded apps/kanban and apps/chat workspaces compiling in CI.
4. Root script updates and CI workflow updates.
5. Phase exit checklist template.

---

## 7. Acceptance Criteria

1. A baseline dependency report exists and is reviewed by maintainers.
2. New boundary tests fail when control-plane imports domain internals directly (outside approved adapter seams).
3. apps/kanban and apps/chat are present as valid npm workspaces with passing lint and build skeleton checks.
4. CI exposes service-targeted checks for api, kanban, chat, web, and packages.
5. No behavior change to current production API routes.

---

## 8. Actionable Tasks

- [x] E088-001 Produce dependency map for workflow/project/session modules.
- [x] E088-002 Publish ownership matrix and import allow/deny policy.
- [x] E088-003 Implement architecture boundary tests in repo CI.
- [x] E088-004 Scaffold apps/kanban workspace (Nest app shell, lint, test config).
- [x] E088-005 Scaffold apps/chat workspace (Nest app shell, lint, test config).
- [x] E088-006 Add root scripts for kanban/chat lint/build/test workflows.
- [x] E088-007 Add migration phase checklist template and tracking doc.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. Service skeleton tests for apps/kanban and apps/chat
4. Boundary architecture tests added in this epic

---

## 10. Risks and Mitigations

1. Risk: Guardrails are too strict and block legitimate refactors.
   Mitigation: explicit temporary exception list with owner and expiry.
2. Risk: Scaffold churn causes CI instability.
   Mitigation: add service scripts incrementally with baseline passing checks.
3. Risk: Team starts extraction before baseline is accepted.
   Mitigation: enforce epic dependency chain in planning board.

---

## 11. Exit Criteria

1. Guardrails are active in CI.
2. New service workspaces compile and lint.
3. Dependency baseline report is published and linked by downstream epics.
