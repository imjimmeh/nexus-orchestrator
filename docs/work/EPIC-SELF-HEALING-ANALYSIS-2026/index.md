# EPIC: Self-Healing & Repair Automation: Root Cause Analysis

> Status: in_progress
> Priority: high
> Created: 2026-06-09
> Owner: TBD

---

## Purpose

Investigate why automated self-healing functionality has stopped working since the kanban project was separated from the API project. Identify all broken wiring between repair components, establish the root cause, and produce a concrete remediation plan.

---

## Background

The nexus-orchestrator previously included an automated self-healing loop: when a workflow run stalled or errored, a repair-agent service would detect the fault, the `WorkflowRepairModule` would coordinate the fix, and a "doctor" trigger would resubmit or patch the affected run. Following the extraction of the kanban app into its own project, this repair loop has stopped firing reliably. The exact failure mode is unknown — events may not be reaching subscribers, WebSocket connections may have broken, or module boundaries may have been severed during the split.

This Epic captures the analysis work required to establish what exists, what is broken, and what must change. No implementation changes are in scope.

---

## Scope

This Epic covers analysis and documentation only. No code changes are in scope.

### In Scope

- Inventorying all self-healing components: services, modules, triggers, and event handlers.
- Mapping all event and message wiring between those components.
- Tracing how the kanban/API separation may have severed repair triggers.
- Reviewing the repair-agent WebSocket connection and its event subscriptions.
- Reviewing `WorkflowRepairModule` listeners and dispatch logic.
- Identifying concrete gaps and producing a prioritised remediation proposal.

### Out of Scope

- Implementing any fixes or refactors identified by the analysis.
- Changes to workflow YAML seed files or the workflow engine itself.
- Any work unrelated to the self-healing and repair automation path.

---

## Related Documents

| Document | Location |
|----------|----------|
| Kanban Workflow Analysis Epic | `docs/work/EPIC-KANBAN-WORKFLOW-ANALYSIS/index.md` |
| Event-Driven Workflow Triggers | `docs/EVENT_DRIVEN_WORKFLOW_TRIGGERS.md` |
| Codebase Analysis & Improvement Roadmap | `docs/work/EPIC-CODEBASE-ANALYSIS-2026/index.md` |
| SDD | `docs/SDD.md` |

---

## Tasks

- [ ] **Task 1: Map all self-healing components**
- [ ] **Task 2: Identify event/message wiring between components**
- [ ] **Task 3: Trace how kanban separation may have broken repair triggers**
- [ ] **Task 4: Review repair-agent WebSocket connection and event subscription**
- [ ] **Task 5: Review WorkflowRepairModule listeners and dispatch**
- [ ] **Task 6: Identify gaps and propose remediation**

---

### Task 1: Map All Self-Healing Components

**Status:** pending

Produce a complete inventory of every service, module, class, and configuration file involved in the self-healing loop.

**Deliverables:**

- A component inventory table listing: component name, file path, owning app/package, and a one-sentence description of its role in the repair loop.
- Identification of all "doctor trigger" entry points — the conditions or events that initiate a repair attempt.
- Notes on which components live in `apps/api`, which in `apps/kanban`, and which (if any) in shared packages.

**Key areas to review:**

- `apps/api/src/` — search for `repair`, `doctor`, `self-heal`, `WorkflowRepair`
- `apps/kanban/src/` — same search terms
- `packages/` — check for shared repair utilities or interfaces

---

### Task 2: Identify Event/Message Wiring Between Components

**Status:** pending

Document every event emission and subscription that forms the repair pipeline, from fault detection through to remediation dispatch.

**Deliverables:**

- A wiring table: for each event/message, record the emitter (file + method), the event name/topic, and the subscriber(s) (file + handler method).
- Identification of the transport mechanism for each link: EventEmitter2 in-process, WebSocket, HTTP callback, or other.
- A sequence diagram (Mermaid `sequenceDiagram`) showing the full repair flow from fault detection to remediation, including all intermediate events.

**Key areas to review:**

- EventEmitter2 `emit` and `on`/`onAny` call sites related to repair
- WebSocket gateway event registrations in the repair-agent service
- Any NestJS `@OnEvent` decorators in repair or doctor modules

---

### Task 3: Trace How Kanban Separation May Have Broken Repair Triggers

**Status:** pending

Establish the precise causal link between the kanban/API project split and the failure of the repair loop.

**Deliverables:**

- A timeline or description of what changed structurally when the kanban project was separated (module boundaries, shared imports, cross-app event subscriptions).
- A list of specific import paths, module registrations, or event subscriptions that were valid before the split but are now missing, moved, or unreachable.
- Identification of whether the break is at the event emission side, the subscription side, or the transport layer between them.

**Dependencies:** Task 1 and Task 2 must be complete before this analysis can be meaningful.

---

### Task 4: Review Repair-Agent WebSocket Connection and Event Subscription

**Status:** pending

Deep-dive into the repair-agent service's WebSocket lifecycle and its event subscription setup.

**Deliverables:**

- Documentation of how the repair-agent establishes and maintains its WebSocket connection to the API gateway (connection URL, auth handshake, reconnect logic).
- A list of all events the repair-agent subscribes to over WebSocket, with the expected payload shape for each.
- Identification of any connection lifecycle issues: missing reconnect handling, events subscribed before connection is ready, or events that are no longer emitted by the server after the split.
- Notes on whether the WebSocket gateway namespace/path changed as part of the kanban separation.

**Key areas to review:**

- Repair-agent WebSocket client initialisation
- NestJS WebSocket gateway (`@WebSocketGateway`) serving the repair-agent
- Any connection guards or middleware applied to the repair gateway

---

### Task 5: Review WorkflowRepairModule Listeners and Dispatch

**Status:** pending

Audit the `WorkflowRepairModule` to understand what it listens for, what decisions it makes, and what it dispatches.

**Deliverables:**

- Documentation of all `@OnEvent` handlers and WebSocket message handlers inside `WorkflowRepairModule` and its constituent services.
- A description of the repair decision logic: what conditions trigger a repair attempt vs. a dead-letter / escalation path.
- Documentation of the dispatch mechanism: how the module triggers the actual remediation (e.g., requeue a workflow run, patch a work item status, restart a container).
- Identification of any handler that is registered against an event that is no longer being emitted, or that depends on a service no longer injected after the split.

**Key areas to review:**

- `WorkflowRepairModule` and all services it provides
- `@OnEvent` decorator usage within the module
- Dependency injection graph: which services does the module depend on, and are they still resolvable?

---

### Task 6: Identify Gaps and Propose Remediation

**Status:** pending

Synthesise the findings from Tasks 1–5 into a prioritised gap list and a concrete remediation proposal.

**Deliverables:**

- A gap table with columns: Gap ID, Description, Root Cause, Severity (`critical` / `high` / `medium`), and Affected Component(s).
- A prioritised remediation plan listing the changes required to restore self-healing functionality, ordered by dependency (i.e., what must be fixed first to unblock subsequent fixes).
- For each remediation item: a description of the change, the files affected, and an estimated complexity (`small` / `medium` / `large`).
- A recommendation on whether any architectural changes are needed to make the repair loop robust across the now-separated app boundary (e.g., moving to an external message broker, extracting repair logic into a shared package).

**Dependencies:** Tasks 1–5 must be complete before the gap analysis can be authored.

---

## Definition of Done

- [ ] Task 1 complete: full component inventory produced with file paths and role descriptions.
- [ ] Task 2 complete: full event/message wiring table and Mermaid sequence diagram produced.
- [ ] Task 3 complete: causal link between kanban separation and repair loop failure documented.
- [ ] Task 4 complete: repair-agent WebSocket lifecycle and subscription gaps documented.
- [ ] Task 5 complete: `WorkflowRepairModule` listener and dispatch audit complete.
- [ ] Task 6 complete: gap table and prioritised remediation plan produced.
- [ ] All findings are consistent with each other and cross-referenced where relevant.
- [ ] Final analysis report saved to `docs/analysis/ANALYSIS-self-healing-repair-2026.md`.
