# EPIC-170: Agent-Driven Orchestration and Event Wakeups

Status: Proposed
Priority: P0
Created: 2026-05-12
Last Updated: 2026-05-12
Owner: Kanban + Workflow Platform
Depends On: EPIC-148, EPIC-166, EPIC-167, EPIC-168
Related Analysis: `docs/analysis/2026-05-12-hardcoded-kanban-logic.md`
Related Plan: `docs/plans/2026-05-12-agent-driven-orchestration-event-wakeups.md`
Related ADR: `docs/adrs/0026-agent-driven-orchestration-authority.md`

---

## 1. Why This Epic Exists

Kanban still contains orchestration policy in TypeScript. Services inspect workflow IDs, classify project continuation, select dispatch candidates, infer imported-repository routes, and decide whether an orchestration should repeat, pause, block, or dispatch. That makes Kanban an orchestration brain even though the intended architecture is that the orchestrator agent owns judgment, workflow YAML owns durable process automation, events wake the system up, and runtime services enforce safety guarantees.

This epic makes `project_orchestration_cycle_ceo` the canonical orchestration authority. Kanban becomes a project/work-item state store, event publisher, and mutation guard. The API workflow runtime becomes the event router and execution-guarantee layer. Status-driven automations become workflow triggers rather than TypeScript transition policy.

This epic supersedes the remaining hardcoded continuation and dispatch authority described in EPIC-148 and updates the direction established by EPIC-168: the Advisor remains read-only advice, while the CEO cycle is the single mutating orchestration authority.

---

## 2. Desired Outcomes

1. Kanban no longer decides orchestration continuation through TypeScript heuristics.
2. Kanban no longer hardcodes workflow IDs such as `project_discovery_ceo` or `project_spec_revision_ceo` to mutate orchestration readiness.
3. Kanban no longer selects dispatch candidates through priority/dependency/capacity policy branches.
4. Work item statuses are flexible event-producing columns, not a restricted transition state machine.
5. Status changes publish durable domain events that can trigger workflow YAML definitions.
6. `ProjectOrchestrationCycleRequestedEvent` is emitted on relevant project wakeups and consumed by `project_orchestration_cycle_ceo`.
7. `project_orchestration_cycle_ceo` reads project state and orchestration timeline, records its decision, and invokes workflows or mutation tools as needed.
8. Runtime services enforce execution guarantees: idempotency, run/context linking, duplicate launch suppression, concurrency ceilings, and terminal reconciliation.
9. Status-specific workflows such as implementation, review, and merge are triggered through workflow definitions and trigger conditions.
10. ADR-0026 supersedes ADR-0002's scheduler-authority model so scheduler-driven dispatch is no longer an authoritative orchestration path.

---

## 3. Scope

### In Scope

1. Event emission from Kanban to API workflow triggers.
2. Domain event ingestion that both records events and emits them into the workflow trigger runtime.
3. Removal of work item transition graph validation while keeping valid status values and audit/event behavior.
4. Replacement of `OrchestrationContinuationService` policy decisions with wakeup-only behavior.
5. Replacement or demotion of `DispatchService` candidate selection into a runtime mutation guard used by agent-selected dispatch.
6. Prompt and seed updates for `project_orchestration_cycle_ceo` so the CEO cycle is the explicit orchestration authority.
7. Workflow YAML trigger migration for status-driven workflows.
8. Runtime primitives for idempotency, run/context links, terminal reconciliation, and concurrency guardrails when missing.
9. Tests proving policy can change through workflow/agent behavior without TypeScript service edits.
10. Documentation updates, including ADR-0026 superseding the scheduler-authority portions of ADR-0002.

### Out of Scope

1. Replacing the entire workflow engine.
2. Making agents responsible for enforcing execution safety invariants.
3. Fully dynamic custom board column schema unless a later epic explicitly adds it.
4. Removing `WorkItemService.updateStatus()` as the canonical status mutation path.
5. Removing workflow YAML status automation.
6. Rewriting every seed workflow in one branch.
7. Removing EventLedger or realtime broadcast coverage.
8. Building a generic policy engine before the event and orchestration seams are fixed.

---

## 4. Non-Goals

1. Do not replace hardcoded TypeScript orchestration policy with a different hardcoded router table.
2. Do not make `project_orchestration_advisor` a second mutating orchestrator.
3. Do not rely on prompt-only safety for duplicate launch prevention or concurrency limits.
4. Do not keep legacy continuation logic as a hidden fallback once the event-driven wakeup path is verified.
5. Do not let workflow status triggers depend on Kanban knowing specific workflow IDs.
6. Do not weaken authorization, persistence, audit, or runtime execution guarantees.

---

## 5. Target Architecture

### 5.1 Responsibility Split

| Layer                | Owns                                                                                                                   | Does Not Own                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Kanban service       | Project/work-item state, status persistence, domain event publication, audit/realtime fanout, mutation guard adapters  | Project strategy, dispatch selection, workflow route inference, continuation decisions |
| API workflow runtime | Event routing, workflow trigger execution, idempotency, concurrency, run/context links, terminal lifecycle fanout      | Project strategy or work selection                                                     |
| Workflow YAML        | Durable procedures, status-triggered automation, workflow concurrency declarations, trigger conditions                 | Hidden service-side routing policy                                                     |
| Orchestrator agent   | Judgment: next action, workflow selection, dispatch selection, human escalation, project completion/blocking rationale | Low-level runtime safety enforcement                                                   |
| Advisor workflow     | Read-only evidence gathering and recommendations                                                                       | Mutations, launches, automatic execution                                               |

### 5.2 Event-Driven Wakeup Flow

```text
Kanban fact changes
  -> publish domain event
  -> API records event and emits to EventEmitter2
  -> workflow trigger registry starts matching workflows
  -> ProjectOrchestrationCycleRequestedEvent starts project_orchestration_cycle_ceo
  -> CEO reads kanban.project_state and kanban.orchestration_timeline
  -> CEO records decision and invokes authorized tools/workflows
  -> runtime enforces idempotency, links, concurrency, and terminal reconciliation
```

Wakeup events should be emitted for:

1. Work item status changes.
2. Workflow terminal events linked to a project or work item.
3. Specs published or hydrated.
4. Capacity freed after a run completes or fails.
5. Project imported or created.
6. Manual orchestration requests.
7. Periodic watchdog checks that only emit wakeups, not decisions.

### 5.3 Statuses As Event Columns

Work item status values remain meaningful because workflows and agents use them as signals. The old allowed-transition graph is removed. A status update should validate only that the status value is supported by the current board model, persist the update, emit an event, and write audit/realtime records.

The first implementation can keep the existing status enum while removing from-to transition restrictions. Dynamic/custom statuses can be added later behind an explicit board-column model.

### 5.4 Runtime Guarantees

Runtime guarantees are not orchestration policy. They are platform invariants that make workflow-driven and agent-driven orchestration safe.

| Guarantee               | Example                                                                                               | Target Owner                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Event idempotency       | The same `ProjectOrchestrationCycleRequestedEvent` replay does not start duplicate equivalent cycles. | API domain event/workflow trigger runtime           |
| Run/context linking     | Work item `WI-1` launched run `run-123`, and the projection records that relationship.                | Workflow launch adapter / Kanban projection         |
| Terminal reconciliation | `run-123` completes, clears active links, writes terminal projection, emits wakeup.                   | Workflow lifecycle projection                       |
| Concurrency             | One CEO cycle per project; bounded implementation runs per project/agent.                             | Workflow YAML declarations plus runtime enforcement |
| Launch guardrails       | Refuse to launch a work item already linked to an active run.                                         | Runtime mutation guard                              |

These guarantees should be workflow-configurable where useful and runtime-enforced always. Agents may request actions; services decide whether requests are safe to execute.

---

## 6. Workstreams

### WS-1: Event Seam Hardening (P0)

Goal:

Make Kanban-originated events actually reach API workflow triggers.

Deliverables:

1. Replace or fix Kanban `emitDomainEvent` endpoint usage.
2. Ensure API domain event ingestion records EventLedger data and emits the event name to `EventEmitter2`.
3. Implement real publishing in `KanbanLifecycleEventPublisher`.
4. Add integration tests proving a Kanban status event triggers a matching workflow binding.

Acceptance:

1. `kanban.work_item.status_changed.v1` can start a workflow with `trigger.type: event`.
2. Event payload includes project/work-item IDs, current status, previous status, and actor/provenance where available.
3. Event ingestion is idempotent when an event ID or dedupe key is supplied.

### WS-2: Flexible Status Mutations (P0)

Goal:

Remove rigid from-to transition policy from the Kanban service-owned work item lifecycle while keeping canonical mutations inside `WorkItemService.updateStatus()`.

Deliverables:

1. Delete allowed from-to transition validation.
2. Keep canonical status mutation through `WorkItemService.updateStatus()`.
3. Keep known status value validation for the current enum-backed board.
4. Preserve audit, lifecycle event, and realtime behavior.

Acceptance:

1. Any known status can move to any other known status.
2. Same-status updates remain safe no-ops or non-eventing updates.
3. Unknown statuses are rejected until dynamic board columns are implemented.

### WS-3: Wakeup-Only Kanban Orchestration (P0)

Goal:

Remove TypeScript continuation policy from Kanban and replace it with event wakeups.

Deliverables:

1. Replace `OrchestrationContinuationService` decision branches with `ProjectOrchestrationWakeupService`.
2. Convert terminal workflow run handling into projection reconciliation plus wakeup emission.
3. Convert stale continuation reconciliation into a watchdog that only emits wakeups.
4. Delete imported-repo bootstrap feedback/blocker heuristics from Kanban services.

Acceptance:

1. No Kanban service records `repeat`, `pause`, or `blocked` based on local heuristics.
2. Terminal workflow events produce wakeups without selecting the next action.
3. The CEO cycle is the only mutating orchestration decision maker.

### WS-4: Agent-Selected Dispatch With Runtime Guards (P0)

Goal:

Demote `DispatchService` from scheduler authority to guarded launch adapter.

Deliverables:

1. Remove priority sorting as an authoritative scheduler policy.
2. Remove automatic candidate selection as an orchestration authority.
3. Keep or create a launch guard that validates agent-selected work items.
4. Return explicit guardrail errors to the agent when selected dispatch is unsafe.

Acceptance:

1. Agents choose which work items to dispatch after reading project state.
2. Runtime refuses duplicate active launches.
3. Runtime refuses launches that exceed configured concurrency ceilings.
4. Runtime responses distinguish blocked-by-guardrail from successful launch.

### WS-5: Workflow Trigger Migration (P0)

Goal:

Move status-driven workflows to event triggers that do not require Kanban to know workflow IDs.

Deliverables:

1. Migrate or bridge `kanban.ticket.*` webhook triggers to event triggers.
2. Use `kanban.work_item.status_changed.v1` with trigger conditions for status-specific workflows.
3. Validate seed workflow trigger contracts.
4. Keep compatibility only long enough to prove the new event path works.

Acceptance:

1. `in-progress` starts the implementation workflow through YAML trigger configuration.
2. `in-review` starts the review workflow through YAML trigger configuration.
3. `ready-to-merge` starts the merge workflow through YAML trigger configuration.
4. No Kanban service contains status-to-workflow mapping logic.

### WS-6: CEO Cycle Authority And Prompt Contract (P0)

Goal:

Make `project_orchestration_cycle_ceo` explicitly own orchestration judgment.

Deliverables:

1. Update the CEO cycle prompt to require project state and timeline inspection.
2. Require decision recording before mutating actions.
3. Allow Advisor consultation but keep Advisor read-only.
4. Instruct CEO to use Kanban-owned selected dispatch (`kanban.dispatch_selected_work_items`), `invoke_agent_workflow`, `kanban.publish_specs`, work item mutation tools, or completion tools as appropriate.

Acceptance:

1. Seed tests prove the prompt describes CEO authority.
2. Prompt forbids relying on Kanban continuation heuristics.
3. Prompt requires explicit rationale for dispatch, workflow invocation, blocked state, or completion.

### WS-7: Remove Workflow-ID Routing And Runtime Inference (P1)

Goal:

Delete remaining workflow-specific orchestration branches.

Deliverables:

1. Remove spec-readiness updates keyed to `project_discovery_ceo` and `project_spec_revision_ceo`.
2. Replace readiness mutation with workflow-produced event/tool output.
3. Remove imported-repo route inference from `WorkflowRuntimeOrchestrationActionsService`.
4. Move imported-repo strategy into CEO prompt/playbook/workflow output.

Acceptance:

1. Grep finds no Kanban orchestration branch checking those workflow IDs.
2. API runtime no longer sets `selectedRoute` or `selectedRuleId` based on workflow ID.
3. Imported-repo orchestration still works through explicit agent/workflow decisions.

### WS-8: ADR And Documentation Update (P0)

Goal:

Make the architecture decision explicit so future work does not reintroduce scheduler authority.

Deliverables:

1. Add ADR-0026 superseding the scheduler-authority portions of ADR-0002.
2. Update relevant docs that describe status transition validation or dispatcher authority.
3. Link this epic from the implementation plan and related analysis.

Acceptance:

1. ADR states that the Orchestrator Agent is canonical dispatch/orchestration authority.
2. ADR states that services enforce runtime invariants, not strategy.
3. Documentation no longer claims the status transition graph is a process safety boundary.

---

## 7. Existing Hardcoded Logic To Remove

| File                                                                                       | Hardcoded Behavior                                                                                 | Replacement                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`                                   | Workflow-ID checks for spec readiness and terminal continuation classification.                    | Generic terminal projection plus wakeup events; workflow-produced readiness events/tools. |
| `apps/kanban/src/orchestration/orchestration-continuation.service.ts`                      | Repeat/pause/blocked decisions, imported-repo heuristics, dependency/status dispatchability rules. | CEO cycle reads state and decides; service emits wakeups only.                            |
| `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts`           | Polling reapplication of continuation policy.                                                      | Watchdog wakeup emitter.                                                                  |
| `apps/kanban/src/dispatch/dispatch.service.ts`                                             | Priority sorting, candidate selection, automatic dispatch authority.                               | Agent-selected dispatch through guarded launch adapter.                                   |
| `apps/kanban/src/work-item/work-item.service.helpers.ts`                                   | Allowed status transition graph.                                                                   | Known status validation only.                                                             |
| `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts`                            | Event construction without real publication.                                                       | Domain event publisher adapter.                                                           |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts` | Imported-repo route inference by workflow ID.                                                      | Explicit agent/workflow decision.                                                         |

---

## 8. Testing Strategy

1. Unit tests for event ingestion emitting to workflow trigger runtime.
2. Unit tests for status mutation allowing any known status transition.
3. Integration tests for status event to workflow trigger execution.
4. Unit tests for wakeup service proving no continuation decision is recorded by services.
5. Unit tests for dispatch guard refusing duplicate active launches and concurrency overflow.
6. Seed validation tests for CEO cycle prompt and status workflow triggers.
7. Regression grep/test proving removed workflow IDs no longer appear in service routing branches.

---

## 9. Success Metrics

1. `project_orchestration_cycle_ceo` is the only mutating project orchestration authority.
2. Work item status changes trigger workflows through events, not service-side status-to-workflow maps.
3. Kanban can emit wakeups continuously without deciding what the next step should be.
4. Duplicate or unsafe launches are rejected by runtime guardrails, not by agent prompt instructions.
5. New orchestration behavior can be changed through workflow YAML, prompts, playbooks, or agent tools without editing Kanban orchestration services.
