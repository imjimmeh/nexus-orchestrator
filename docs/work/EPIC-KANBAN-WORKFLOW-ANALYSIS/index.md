# EPIC: Kanban Workflow Analysis

> Status: in_progress
> Priority: high
> Created: 2026-04-05
> Owner: TBD

---

## Purpose

Comprehensive documentation of kanban workflow processes with architecture diagrams, reviewing current implementation against existing docs and identifying gaps.

This Epic captures the analysis work required to produce a definitive, accurate record of how the kanban lifecycle operates today including the hybrid TypeScript/YAML implementation, frontend data flow, and the divergence between existing specification documents and the live codebase.

---

## Background

The kanban system operates as a hybrid architecture. YAML-based workflows drive agent execution (implementation, review, merge), while significant business logic remains hardcoded in TypeScript services (status transition effects, QA decision routing, container lifecycle management). Several Epic documents (EPIC-034, EPIC-042), analysis reports, and a kanban PRD exist, but no single document provides a complete, diagram-backed view of the full lifecycle as it currently stands.

---

## Scope

This Epic covers analysis and documentation only. No implementation changes are in scope.

### In Scope

- Documenting the current work item status state machine and all valid transitions.
- Documenting the seed workflow YAML files and their job and step structures.
- Documenting the frontend kanban components and their API interactions.
- Producing Mermaid architecture diagrams for the lifecycle, execution sequence, and component graph.
- Identifying gaps between existing documentation and the actual implementation.

### Out of Scope

- Any code changes to the workflow engine, TypeScript services, or frontend components.
- New workflow YAML authoring or migration planning.

---

## Related Documents

| Document | Location |
|----------|----------|
| Kanban PRD | `docs/kanban-PRD.md` |
| SDD | `docs/SDD.md` |
| EPIC-034: Workflow-Driven Kanban Lifecycle | `docs/epics/EPIC-034-workflow-driven-kanban-lifecycle.md` |
| EPIC-042: Deterministic Kanban Integration Tests | `docs/epics/EPIC-042-deterministic-kanban-integration-tests.md` |
| ANALYSIS-kanban-hardcoded-vs-workflow | `docs/analysis/ANALYSIS-kanban-hardcoded-vs-workflow.md` |
| ANALYSIS-qa-decision-stuck-in-review | `docs/analysis/ANALYSIS-qa-decision-stuck-in-review.md` |
| EVENT_DRIVEN_WORKFLOW_TRIGGERS | `docs/EVENT_DRIVEN_WORKFLOW_TRIGGERS.md` |

---

## Tasks

### Task 1: Kanban State Machine & Status Transitions

**Status:** pending

Document the work item status lifecycle end-to-end.

**Deliverables:**

- A written description of each status state: `backlog`, `todo`, `in-progress`, `in-review`, `ready-to-merge`, `done`, `blocked`.
- A complete table of all allowed transitions (source state to target state), including which transitions are user-initiated and which are automation-triggered.
- Documentation of the current hybrid implementation: which transitions are enforced by the hardcoded `ALLOWED_TRANSITIONS` constant in TypeScript and which are driven by workflow YAML `transition_status` steps.
- Reference to the relevant TypeScript source files (`work-item.constants.ts`, `work-item.service.ts`, `state-machine.service.ts`) and their roles in enforcing or executing transitions.

**Key source files to review:**

- `apps/api/src/project/work-item.constants.ts`
- `apps/api/src/workflow/state-machine.service.ts`
- `apps/api/src/project/work-item.service.ts`

---

### Task 2: Workflow YAML Architecture

**Status:** pending

Document all seed workflow YAML files, their structure, and their mapping to the kanban lifecycle.

**Deliverables:**

- An inventory of all seed workflow YAML files under `apps/api/src/database/seeds/`, including their trigger conditions.
- For each workflow: a description of its jobs, the step types used (execution, transition_status, manage_container, etc.), and the conditional transitions between jobs.
- A mapping table showing which kanban status transition triggers which seed workflow.
- Documentation of the `output_tool` capture mechanism and `suppress_automation` flag where present.

**Key source files to review:**

- `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`
- `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`
- `apps/api/src/database/seeds/work-item-ready-to-merge-default.workflow.yaml`
- `apps/api/src/workflow/workflow-run-reconciliation.service.ts`

---

### Task 3: Frontend Kanban Data Flow

**Status:** pending

Document the frontend components that make up the kanban board and how they interact with the backend.

**Deliverables:**

- A component inventory covering `KanbanBoard`, `TaskConfigModal`, `WorkItemDetailSheetContent`, and `WorkItemActionButtons`, with a brief description of each component responsibilities.
- Documentation of the API calls each component makes (endpoints, request shape, response shape).
- A description of how real-time backend state changes (workflow run status, work item status) are reflected in the UI, including any WebSocket or polling mechanisms.
- Notes on how the UI enforces or reflects the allowed transition state machine (e.g., which status transitions are available as user actions in the UI).

**Key source files to review:**

- `apps/web/src/pages/kanban/KanbanBoard.tsx`
- `apps/web/src/pages/kanban/TaskConfigModal.tsx`
- `apps/web/src/pages/kanban/WorkItemDetailSheetContent.tsx`
- `apps/web/src/pages/kanban/WorkItemActionButtons.tsx`
- `apps/web/src/lib/api/client.ts`
- `apps/web/src/lib/api/client.projects.ts`

---

### Task 4: Architecture Diagram Production

**Status:** pending

Produce Mermaid diagrams that visually represent the kanban lifecycle and system architecture.

**Deliverables:**

Three Mermaid diagrams, each embedded in the final architecture document:

1. **Kanban Lifecycle Flow** - A state diagram (`stateDiagram-v2`) showing all work item states, all allowed transitions, and annotations indicating whether each transition is user-initiated or workflow-driven.

2. **Workflow Execution Sequence** - A sequence diagram (`sequenceDiagram`) showing the actors and message flow for a representative end-to-end lifecycle: work item creation through to `done`. Participants should include: User, Frontend, API, WorkItemService, WorkflowEngine, WorkflowRun (container), and the seed YAML workflows.

3. **Component and Service Dependency Graph** - A graph diagram (`graph TD`) showing the relationships between the key backend services (WorkItemService, StateMachineService, WorkflowRunReconciliationService, TelemetryGateway, StateManagerService) and the key frontend components (KanbanBoard, TaskConfigModal, WorkItemDetailSheetContent).

**Dependencies:** Tasks 1, 2, and 3 must be complete before diagrams can be finalized.

---

### Task 5: Gap Analysis & Documentation

**Status:** pending

Compare the existing documentation against the actual implementation findings from Tasks 1-3, then produce or update the architecture document.

**Deliverables:**

- A gap analysis table listing each discrepancy found between existing documents (`kanban-PRD.md`, `SDD.md`, EPIC-034, analysis reports) and the current implementation. Each row should identify: the source document, the claim made, the actual behavior observed, and the severity of the gap.
- A written or updated architecture document at `docs/architecture/ARCH-kanban-workflow.md` that incorporates the findings from all previous tasks and the diagrams from Task 4.
- Updated references or a summary note in the relevant existing docs where significant gaps were found.

**Dependencies:** Tasks 1, 2, 3, and 4 must be complete before the gap analysis and final document can be authored.

---

## Definition of Done

- [ ] Task 1 complete: status state machine and transition table documented with hybrid implementation notes.
- [ ] Task 2 complete: all seed workflow YAMLs inventoried and mapped to kanban lifecycle stages.
- [ ] Task 3 complete: frontend component inventory and API interaction documented.
- [ ] Task 4 complete: all three Mermaid diagrams produced and reviewed for accuracy.
- [ ] Task 5 complete: gap analysis table authored and `docs/architecture/ARCH-kanban-workflow.md` written or updated.
- [ ] All task findings are consistent with each other (no contradictions between task outputs).
