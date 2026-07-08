# Orchestration Coordinator — `OrchestrationService` Role

Status: Current
Domain: Kanban orchestration module (`apps/kanban/src/orchestration`)
Scope: Work item `e69585f0-1f3b-47cc-a71c-81bf8f5f39e9-child-1-orchestration-service-refactor`
Supersedes: the pre-refactor monolithic `OrchestrationService` (553 LOC)
See also: [ADR-0002](ADR-0002-promote-orchestration-helpers-to-injectable-providers.md), [playbook-orchestration.md](playbook-orchestration.md), [ARCH-kanban-workflow.md](ARCH-kanban-workflow.md)

## 1. Role and Intent

`OrchestrationService` (`apps/kanban/src/orchestration/orchestration.service.ts`)
now functions as a thin **OrchestrationCoordinator**. It owns no domain logic;
it composes delegated calls to its injected helper services and a small set of
named private methods.

Pre-refactor, the file weighed in at **553 LOC** and interleaved seven
concern clusters: run dispatch / lease interaction; decision log
persistence (`recordDecision`, `clearPendingConsecutiveFailure`,
`filterDecisionLog` plumbing, persistence-rebuild); action-request
lifecycle; strategic-intent timeline + `ProjectStrategicState`
interaction; hydration recovery (`recoverImportedHydration`,
`RecordImportHydrationBlockedInput`); diagnostics summary aggregation;
and policy-mode transitions.

Post-refactor, the file is **335 LOC** coordinating delegations (net
119 insertions / 337 deletions across 456 changed lines). The seven
concern clusters are preserved as **routing targets** the coordinator
hands off to, not as inline implementations. The refactor is a
structural cleanup only — it does not alter the public method surface,
the injected helper roster, or the DI plumbing that the sibling
children (cycle-decision, continuation, controller) depend on.

## 2. Helpers living alongside the Coordinator

The eleven private helpers extracted in this refactor, each with one
responsibility, are anchored to the seven concern clusters:

| Helper | Responsibility | Concern cluster |
| ------ | -------------- | --------------- |
| `resolveStartupContext(project_id, input)` | Resolve startup route metadata (`nextMetadata`, `startupContext`) for `start()` from the existing persistence record and incoming input. | Run dispatch / lease interaction |
| `toProjectOrchestration(state)` | Project a persistence record into the public `ProjectOrchestration` shape via the state-lifecycle helper. | Run dispatch / lease interaction |
| `requireState(project_id)` | Convenience wrapper that loads and converts a persistence record to the `OrchestrationState` view. | Run dispatch / lease interaction |
| `requirePersistenceState(project_id)` | Load the persistence record or throw `NotFoundException`. | Decision log persistence |
| `savePersistenceState(existing, updates)` | Build the save payload, persist, and rebuild the saved record; shared by every write path. | Decision log persistence |
| `getDecisionLog(state)` | Thin delegator to `filterDecisionLog(state)`. | Decision log persistence |
| `getActionRequests(state)` | Thin delegator to `filterActionRequests(state)`. | Action-request lifecycle |
| `actionDeps(projectId, input)` | Compose the action-request dependency bundle (`{ projectId, input, ...persistenceBindings() }`). | Action-request lifecycle |
| `persistenceBindings()` | Compose the persistence-callback bundle (`requirePersistenceState`, `savePersistenceState`) shared with action/observability helpers. | Diagnostics summary aggregation |
| `updateStatus(project_id, status)` | Shared update path used by `pause`/`resume`/`complete`; delegates to `updateState`. | Policy-mode transitions |
| `updateState(project_id, updates)` | Shared update path used by `updateMode` and `updateStatus`; reconciles the state view with the persisted record and saves the merged payload. | Policy-mode transitions |

The hydration-recovery cluster (`recoverImportedHydration`) is delegated to
the standalone helper module
`./orchestration-imported-hydration-recovery.ts` rather than a private
method on the service — it is the largest single extracted body and
benefits from its own import surface and test surface.

Strategic-intent timeline mutation is delegated to the pure helpers in
`./strategic/strategic-intent-timeline.helpers.ts`
(`appendStrategicIntent`, `latestStrategicIntent`); the coordinator only
glues them into the persistence save path.

## 3. Public-API Contract Downstream Children Must Preserve

The class name **MUST stay `OrchestrationService`** — `OrchestrationController`,
its `providers` registration, and the module wiring depend on it. Do not
rename to `OrchestrationCoordinator`; the new *role* is conceptual, the
*class name* is part of the public surface.

### 3.1 Constructor invariants

The constructor has **18 slots**. The order is locked by the
`design:paramtypes` assertion in `orchestration.service.spec.ts` (see
`paramTypes[7]`/`[8]`/`[9]`/`[10]` and `[13]..[17]`); reordering or
dropping any of the following will silently re-introduce non-DI wiring.

| Slot | Type | Decorator |
| ---- | ---- | --------- |
| 0 | `CoreWorkflowRequester` (view of `CoreWorkflowClientService`) | `@Inject(CoreWorkflowClientService)` |
| 1 | `CoreRunProjectionService` | — |
| 2 | `BaseRequestContextService` | — |
| 3 | `KanbanOrchestrationRepository` | — |
| 4 | `ProjectService` | — |
| 5 | `KanbanWorkItemRepository` | — |
| 6 | `HumanDecisionResolutionPolicyService` | — |
| 7 | `KanbanRetrospectiveService` | — |
| 8 | `IKanbanRetrospectiveFailureThresholdService` (erased to `Object` in metadata) | `@Inject(KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE)` |
| 9 | `KanbanSettingsService` | — |
| 10 | `OrchestrationLeaseService` | — |
| 11 | `ProjectStrategicStateService` | — |
| 12 | `WorkItemService` | — |
| 13 | `OrchestrationCycleDecisionService` | `@Inject(forwardRef(() => OrchestrationCycleDecisionService))` |
| 14 | `OrchestrationActionRequestsService` | — |
| 15 | `OrchestrationObservabilityService` | — |
| 16 | `OrchestrationStateLifecycleService` | — |
| 17 | `OrchestrationRunRequestService` | — |

Both `@Inject(...)` decorators and the `forwardRef(...)` resolving the
cycle-decision cycle created by the
`ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` token MUST remain
exactly where they are.

### 3.2 Public method surface

Every entry below is consumed by `OrchestrationController`,
`OrchestrationContinuationService`, `OrchestrationCycleDecisionService`, or
the reconciler/wakeup paths. Signatures are byte-identical to the
pre-refactor service.

Run dispatch / lease interaction:

- `start(project_id, input: StartOrchestrationInput): Promise<ProjectOrchestration>`
- `recordCycleDecision(project_id, input): Promise<OrchestrationCycleDecisionResult>`
- `clearCycleDecision(project_id, input: { reason: string }): Promise<void>`
- `recoverImportedHydration(project_id): Promise<ProjectOrchestration>`
- `reconcileLinkedWorkflowRun(project_id, input): Promise<{ cleared: boolean }>`
- `isCycleActive(project_id): Promise<boolean>`
- `findOrchestratingStates(): Promise<OrchestrationPersistenceRecord[]>`
- `findOrchestratingStatesForContinuationCleanup(): Promise<OrchestrationPersistenceRecord[]>`
- `findByLinkedWorkflowRun(workflowRunId): Promise<OrchestrationPersistenceRecord | null>`
- `recordImportHydrationBlocked(project_id, input): Promise<void>`
- `clearImportHydrationBlocked(project_id, input): Promise<void>`
- `updateSpecsReady(project_id, specs_ready): Promise<void>`

Decision log persistence:

- `recordDecision(project_id, input): Promise<DecisionEntry>`
- `markPendingConsecutiveFailure(project_id, input): Promise<void>`
- `clearPendingConsecutiveFailure(project_id): Promise<void>`
- `recordDiscoveryCompleted(project_id, completedAt: string): Promise<void>`

Action-request lifecycle:

- `requestAction(project_id, input): Promise<ActionRequest>`
- `approveActionRequest(project_id, requestId, input): Promise<ActionRequest>`
- `rejectActionRequest(project_id, requestId, input): Promise<ActionRequest>`
- `listProjectActionRequests(project_id, status?): Promise<ActionRequest[]>`
- `listActionRequests(status?): Promise<ActionRequestListItem[]>`

Strategic-intent timeline:

- `recordStrategicIntent(project_id, input): Promise<StrategicIntentPayload>`
- `getStrategicState(project_id, initiatives: Initiative[]): Promise<ProjectStrategicState>`

Diagnostics summary aggregation / wakeup:

- `getDiagnostics(project_id, opts?): Promise<DiagnosticsResult>`
- `getActivitySummary(project_id, opts?): Promise<{ totalActionCount; recent }>`
- `getAutoWakeSuppressionState(project_id): Promise<{ suppressed; decision? }>`
- `getWakeupCooldownState(project_id): Promise<WakeupCooldownState | null>`
- `recordWakeup(project_id, input): Promise<void>`

Policy-mode transitions:

- `updateMode(project_id, mode: OrchestrationMode): Promise<OrchestrationState>`
- `pause(project_id): Promise<OrchestrationState>`
- `resume(project_id): Promise<OrchestrationState>`
- `complete(project_id): Promise<OrchestrationState>`
- `setModeMirror(projectId, mode: OrchestrationPolicyMode): Promise<void>`

Read-only view:

- `get(project_id, opts?): Promise<ProjectOrchestration>`

Siblings refactoring `orchestration-cycle-decision.service.ts`
([child 2](../work-items/e69585f0-1f3b-47cc-a71c-81bf8f5f39e9-child-2-cycle-decision-refactor.md)),
`orchestration-continuation.service.ts`
([child 3](../work-items/e69585f0-1f3b-47cc-a71c-81bf8f5f39e9-child-3-continuation-refactor.md)),
or `orchestration.controller.ts`
([child 4](../work-items/e69585f0-1f3b-47cc-a71c-81bf8f5f39e9-child-4-controller-refactor.md))
**MUST NOT** modify `OrchestrationService`'s signature surface, the
constructor slot ordering, the decorator placements, or the `forwardRef`
resolver. They consume this contract as-is.

## 4. Boundary Reminder

This refactor only touches `apps/kanban/src/orchestration/orchestration.service.ts`.
No Kanban identifier (`workItem`, `WorkItem`, `work_item`, `work-item`,
`kanban`, `Kanban`, `@nexus/kanban-contracts`) may leak into `apps/api/src`
or `packages/core/src`. The post-refactor boundary check
(`rg "workItem|WorkItem|work_item|work-item|kanban|Kanban|@nexus/kanban-contracts" apps/api/src packages/core/src`)
must remain at zero matches — see the lint rule
`nexus-boundaries/no-core-kanban-residue` enforced across the repo.

The `@nexus/kanban-contracts` import used inside the coordinator is a
Kanban-owned contract surface; it is permitted at the Kanban→contracts
boundary, not at the API→core or core→contracts boundary.

## 5. Validation Evidence

`npm run lint:kanban`, `npm run test:kanban -- orchestration` (63 files /
650 tests), and `npm run build:kanban` all pass; the boundary grep at
`apps/api/src` and `packages/core/src` returns 0 matches.
