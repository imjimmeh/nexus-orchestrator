---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-orchestration
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/orchestration/orchestration.module.ts
  - apps/kanban/src/orchestration/orchestration.service.ts
  - apps/kanban/src/orchestration/orchestration.controller.ts
  - apps/kanban/src/orchestration/orchestration.types.ts
  - apps/kanban/src/orchestration/orchestration-internal.types.ts
  - apps/kanban/src/orchestration/orchestration-state-lifecycle.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation.types.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts
  - apps/kanban/src/orchestration/orchestration-action-requests.service.ts
  - apps/kanban/src/orchestration/orchestration-stop-decisions.ts
  - apps/kanban/src/orchestration/orchestration-stop-decisions.types.ts
  - apps/kanban/src/orchestration/orchestration-branch-blockers.ts
  - apps/kanban/src/orchestration/orchestration-branch-blockers.types.ts
  - apps/kanban/src/orchestration/orchestration-decision-log.utils.ts
  - apps/kanban/src/orchestration/orchestration-observability.service.ts
  - apps/kanban/src/orchestration/orchestration-run-request.service.ts
  - apps/kanban/src/orchestration/orchestration-persistence.helpers.ts
  - apps/kanban/src/orchestration/orchestration-imported-hydration-recovery.ts
  - apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts
  - apps/kanban/src/orchestration/project-orchestration-wakeup.types.ts
  - apps/kanban/src/orchestration/probe-results.service.ts
  - apps/kanban/src/orchestration/probe-results.service.types.ts
  - apps/kanban/src/orchestration/probe-result-artifact.ts
  - apps/kanban/src/orchestration/probe-result-artifact.types.ts
  - apps/kanban/src/orchestration/human-decision-resolution-policy.service.ts
  - apps/kanban/src/orchestration/human-decision-resolution-policy.types.ts
  - apps/kanban/src/orchestration/imported-repository-backlog-reconciler.ts
  - apps/kanban/src/orchestration/imported-repository-backlog-reconciler.types.ts
  - apps/kanban/src/orchestration/imported-repository-finding-publisher.ts
  - apps/kanban/src/orchestration/imported-repository-finding-publisher.types.ts
  - apps/kanban/src/orchestration/imported-repository-finding-resolution.service.ts
  - apps/kanban/src/orchestration/imported-repository-finding-resolution.types.ts
  - apps/kanban/src/orchestration/imported-repository-finding.types.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.types.ts
  - apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts
  - apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts
  - apps/kanban/src/orchestration/strategic/strategic-intent-timeline.helpers.ts
  - apps/kanban/src/orchestration/strategic/strategic-intent-timeline.types.ts
  - apps/kanban/src/orchestration/control-plane/control-plane-board.service.ts
  - apps/kanban/src/orchestration/control-plane/control-plane-board.controller.ts
  - apps/kanban/src/orchestration/control-plane/control-plane-board.types.ts
  - apps/kanban/src/orchestration/control-plane/control-plane.types.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-control-plane-scheduler.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.types.ts
  - apps/kanban/src/orchestration/control-plane/structured-decision.types.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-fact-snapshot.service.ts
  - apps/kanban/src/orchestration/control-plane/kanban-event-replay.service.ts
  - apps/kanban/src/orchestration/control-plane/simulation/orchestration-simulation-runner.service.ts
  - apps/kanban/src/orchestration/control-plane/simulation/orchestration-simulation.types.ts
  - apps/kanban/src/orchestration/control-plane/simulation/scenarios.ts
  - apps/kanban/src/orchestration/control-plane/simulation/orchestration-simulation-input.helpers.ts
  - apps/kanban/src/orchestration/orchestration.service.spec.ts
  - apps/kanban/src/orchestration/orchestration.service.strategic.spec.ts
  - apps/kanban/src/orchestration/orchestration.controller.spec.ts
  - apps/kanban/src/orchestration/orchestration.module.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation.decisions.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation.integration.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation.poll-fallback.spec.ts
  - apps/kanban/src/orchestration/orchestration-stop-decisions.spec.ts
  - apps/kanban/src/orchestration/project-orchestration-wakeup.service.spec.ts
  - apps/kanban/src/orchestration/probe-results.service.spec.ts
  - apps/kanban/src/orchestration/probe-result-artifact.spec.ts
  - apps/kanban/src/orchestration/human-decision-resolution-policy.service.spec.ts
  - apps/kanban/src/orchestration/imported-repository-backlog-reconciler.spec.ts
  - apps/kanban/src/orchestration/imported-repository-finding-resolution.service.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.batch.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.overrides.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.autonomous-a.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.autonomous-b.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.autonomous-c.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.autonomous-d.spec.ts
  - apps/kanban/src/orchestration/reconciled-work-item-publisher.spec-helpers.ts
  - apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts
  - apps/kanban/src/orchestration/strategic/strategic-intent-timeline.helpers.spec.ts
  - apps/kanban/src/orchestration/control-plane/control-plane-board.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/kanban-event-replay.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-control-plane-scheduler.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-lease.integration.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.spec.ts
  - apps/kanban/src/orchestration/control-plane/simulation/orchestration-simulation-runner.service.spec.ts
source_paths:
  - apps/kanban/src/orchestration
updated_at: 2026-06-15T17:30:00.000Z
---

# Probe Result: Kanban Orchestration Service

## Narrative Summary

The Kanban Orchestration Service is fully implemented as a mature, multi-layered NestJS feature
in `apps/kanban/src/orchestration/` (~21,000 LOC, 80+ TypeScript modules including
co-located specs). The scope delivers the CEO project-orchestration lifecycle, control-plane
scheduler, strategic intent persistence, imported-repository synthesis, and the runtime
primitives (leases, intents, facts, decision executors, repair lane, event replay, simulation
runner) that keep kanban orchestrations self-healing.

The top-level entry point is `OrchestrationService` (`orchestration.service.ts`), which composes
five inner services: `OrchestrationCycleDecisionService`, `OrchestrationActionRequestsService`,
`OrchestrationObservabilityService`, `OrchestrationStateLifecycleService`, and
`OrchestrationRunRequestService`. It exposes start / pause / resume / complete / updateMode /
get / getDiagnostics / getActivitySummary / recordDecision / recordStrategicIntent /
recordDiscoveryCompleted / requestAction / approveActionRequest / rejectActionRequest /
listProjectActionRequests / listActionRequests / recordCycleDecision / clearCycleDecision /
updateSpecsReady / recordImportHydrationBlocked / clearImportHydrationBlocked /
recoverImportedHydration / reconcileLinkedWorkflowRun / findOrchestratingStates / etc.
Persistence flows through `KanbanOrchestrationRepository` with normalized
`buildPersistenceSavePayload` / `rebuildPersistenceRecord` helpers.

The HTTP surface is mounted via `OrchestrationController`
(`projects/:project_id/orchestration/...`) and `OrchestrationActionRequestsController`
(`orchestration/action-requests`), plus `ControlPlaneBoardController`
(`projects/:project_id/control-plane/board`). The start endpoint accepts goals, workflowId,
source/readiness/startup context, and orchestrationMode; the response contract is a
`ProjectOrchestration` (decision log, metadata, probe_results, status, etc.).

Continuation logic is split between `OrchestrationContinuationService.evaluateProjectContinuation`
(per-trigger evaluation) and `OrchestrationContinuationReconcilerService`
(`OnModuleInit` background poll that reconciles stale linked runs, clears orphan stop
decisions, and emits a coalesced wakeup). Wakeup coalescing, stale-reconciler cooldowns, and
cycle-lease acquisition live in `ProjectOrchestrationWakeupService`.

The `control-plane/` subdirectory implements the structured-decision executor
(`OrchestrationDecisionExecutorService` with Zod-validated `StructuredOrchestrationDecision`
schema), the scheduler (`OrchestrationControlPlaneSchedulerService` managing intents, facts,
outcomes, launch attempts), the lease service and background lease sweeper
(`OrchestrationLeaseSweeperService` runs `expireOverdue` every 30 s), the repair lane
(`OrchestrationRepairLaneService` for failed work item runs and event-delivery failures), the
fact snapshot publisher (work item state / project state TTL facts), and the
`KanbanEventReplayService` for replaying failed domain event projections.
`OrchestrationSimulationRunnerService` provides 8 deterministic scenarios
(`EPIC_197_SCENARIOS`) covering imported-repo bootstrap, upstream rediscovery, parallel
discovery/implementation, QA rejection, stale link recovery, duplicate wakeup, merge conflict,
and event-delivery failure.

The `strategic/` subdirectory persists CEO strategic intent across cycles via
`ProjectStrategicStateService` (staleness, burn rate, starvation forecast, merges-since
discovery, latest strategic intent from decision log) and `strategic-intent-timeline.helpers.ts`
(`appendStrategicIntent` / `latestStrategicIntent`).

`reconciled-work-item-publisher.ts` reconciles a `ImportedRepositoryBacklogReconciliationPlan`
into kanban work items, tracking `sourceHash`, `userStatusOverride`, and stable `sourceId`
aliases (gap ↔ human_decision). `imported-repository-finding-publisher.ts` /
`imported-repository-finding-resolution.service.ts` provide the finding-level CRUD/decision
pipeline with autonomous high-confidence resolution.

`probe-result-artifact.ts` parses frontmatter + markdown body of probe result files into
`ProbeResultArtifact` (snake→camel normalization, `extractMarkdownSection` for
"Narrative Summary", "Capability Updates", "Health Findings", "Open Questions"). The companion
`probe-results.service.ts` records probe results into the orchestration record's
`metadata.probe_results`, which is exposed by `toProjectOrchestration.probe_results`.

`orchestration-state-lifecycle.service.ts` owns the start-up context resolution, decision-log
projection to `PublicDecisionEntry`, and the metadata merge for import-hydration block /
unblock. `orchestration-cycle-decision.service.ts` records cycle decisions with
idempotency-key dedup, autonomous-default short-circuiting, and
`resolveSafeCycleDecision` guards that reject "complete" with zero work items or "pause /
complete / blocked" when dispatchable todo work remains. `orchestration-stop-decisions.ts`
resolves the latest non-auto-wake decision from metadata or the decision log.

`orchestration-branch-blockers.ts` identifies todo work items whose `targetBranch` is owned by
another in-flight work item, returning owner labels and a formatted reason used by
continuation's "board stewardship" branch. `orchestration-decision-log.utils.ts` provides
`parseCycleDecision`, `getCycleDecision`, `isCycleDecisionClearEntry`, `isNonAutoWakeDecision`,
and the public-decision projection that drops internal fields.

`orchestration-imported-hydration-recovery.ts` is the recovery path for
`blocked_stage = "imported_repo_hydration"` — it rebuilds a `PROJECT_DISCOVERY_WORKFLOW_ID`
run with `selectedRoute: "imported-repo-synthesis-and-hydration"` and clears the block.

`orchestration-run-request.service.ts` builds `WorkflowRunRequestV1` payloads with external MCP
mounts, idempotency keys, correlation/causation IDs, and the `humanDecisionPolicy` selected by
`HumanDecisionResolutionPolicyService` (autonomous → decide_without_approval, supervised →
ask_when_uncertain, notifications_only → decide_without_approval).

## Capability Updates

| Capability | Status | Notes |
|---|---|---|
| NestJS module wiring (`OrchestrationModule`) | Implemented | Provides 20+ services, controllers, and exports `ProjectStrategicStateService` (verified in `orchestration.module.spec.ts`) |
| `OrchestrationService` (top-level facade) | Implemented | Composes 5 inner services; ~640 LOC, ~3700-line spec |
| Lifecycle: start / pause / resume / complete / updateMode | Implemented | `OrchestrationController` PATCH/POST routes |
| Decision log recording + idempotency-key dedup | Implemented | `OrchestrationService.recordDecision`, `OrchestrationCycleDecisionService` |
| Strategic intent append / latest retrieval | Implemented | `strategic-intent-timeline.helpers.ts`, `OrchestrationService.recordStrategicIntent` |
| Action requests: request / approve / reject / list | Implemented | `OrchestrationActionRequestsService` + `OrchestrationController` |
| Diagnostics (blocked reasons, decision history, dispatch capacity) | Implemented | `OrchestrationObservabilityService.getDiagnostics` |
| Activity summary (recent decisions + action requests) | Implemented | `OrchestrationObservabilityService.getActivitySummary` |
| Auto-wake suppression / wakeup cooldown state | Implemented | `OrchestrationObservabilityService.getAutoWakeSuppressionState/getWakeupCooldownState` |
| Continuation evaluation (repeat / pause / complete / blocked) | Implemented | `OrchestrationContinuationService.evaluateProjectContinuation` |
| Continuation reconciler (background poll) | Implemented | `OrchestrationContinuationReconcilerService` with interval (env override `KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS`, default 60 s) and orphan-linked-run cleanup |
| Project wakeup coalescing + cycle lease | Implemented | `ProjectOrchestrationWakeupService` with fallback anchor map, stale-reconciler 5-min cooldown, automatic-wakeup 60-s coalesce |
| Control-plane board (intents, lanes, facts, outcomes, launch attempts) | Implemented | `ControlPlaneBoardService` + `ControlPlaneBoardController` (`GET /projects/:id/control-plane/board`) |
| Scheduler: create / evaluate / terminalize / record launch attempt | Implemented | `OrchestrationControlPlaneSchedulerService` with fresh-fact requirement resolution |
| Structured decision executor (Zod-validated) | Implemented | `OrchestrationDecisionExecutorService` + `structured-decision.types.ts` with `request_wakeup / dispatch_work_items / transition_work_item_status / record_only` actions and lane capacity (4 dispatch/implementation, 1 strategy, 2 others) |
| Direct mutation lease + execute | Implemented | `OrchestrationDecisionExecutorService.executeDirectMutationDecision` with `releaseOwned` finally-block |
| Cycle lease (strategy lane) + heartbeat + release | Implemented | `OrchestrationLeaseService.acquireCycleLease/heartbeatCycleLease/releaseCycleLease/hasActiveCycleLease` |
| Mutation leases (lane capacity + conflict keys) | Implemented | `OrchestrationLeaseService.acquireMutationLeases` |
| Lease sweeper (background) | Implemented | `OrchestrationLeaseSweeperService` `OnModuleInit/OnModuleDestroy`, 30 s interval, `expireOverdue` |
| Repair lane (failed work item run + event delivery) | Implemented | `OrchestrationRepairLaneService` publishes `event_delivery_failed` / `work_item_workflow_run_failed` facts and creates repair intents |
| Fact snapshot publisher (work item / project state TTL) | Implemented | `OrchestrationFactSnapshotService` (60 s / 30 s TTL) |
| Event delivery projection replay | Implemented | `KanbanEventReplayService` (uses `coreClient.emitDomainEventOrThrow`) |
| Control-plane simulation runner | Implemented | `OrchestrationSimulationRunnerService` with 8 `EPIC_197_SCENARIOS` covering bootstrap, upstream rediscovery, parallel lanes, QA rejection, stale link, duplicate wakeup, merge conflict, event-delivery failure |
| Imported repository backlog reconciler | Implemented | `ImportedRepositoryBacklogReconciler` → `ImportedRepositoryBacklogReconciliationPlan` (cycle decision, counts, open questions, scope-id normalization) |
| Imported repository finding publisher | Implemented | `ImportedRepositoryFindingPublisher.publish` with `source_hash` short-circuit and high-confidence `resolved_existing` auto-decision |
| Imported repository finding resolution | Implemented | `ImportedRepositoryFindingResolutionService` with `disposition → status` mapping, work-item creation via `ReconciledWorkItemPublisher` |
| Reconciled work item publisher | Implemented | `ReconciledWorkItemPublisher` with stable `sourceId` aliases (gap ↔ human_decision), `userStatusOverride` tracking, `lastGenerated*` reconciliation metadata |
| Human decision policy (mode-aware) | Implemented | `HumanDecisionResolutionPolicyService.selectPolicy/resolve` (autonomous → decide, supervised → ask, notifications_only → decide) |
| Probe result artifact parsing (frontmatter + markdown) | Implemented | `probe-result-artifact.ts` with `parseProbeResultArtifact`, `validateSuccessfulProbeResultArtifact`, snake→camel normalization |
| Probe result recording | Implemented | `ProbeResultsService.recordProbeResult` (writes to `metadata.probe_results`); `toProjectOrchestration` exposes `probe_results` |
| Cycle decision safe-decision guards | Implemented | Rejects "complete" with zero work items for imported-repo, "pause/complete/blocked" when dispatchable todo remains |
| Target branch blocker detection | Implemented | `orchestration-branch-blockers.ts` (`findTargetBranchBlocker/findTargetBranchBlockers/formatTargetBranchBlockerReason`) |
| Imported hydration recovery | Implemented | `OrchestrationService.recoverImportedHydration` (rejects non-import_remote projects with BadRequestException) |
| Strategic state (staleness + burn rate + intent) | Implemented | `ProjectStrategicStateService.buildStrategicState` (10-cycle burn rate window, starvation forecast cycles) |
| Decision log public projection | Implemented | `toPublicDecisionEntry` (drops non-public fields) |
| Stop-decision resolution from metadata / log | Implemented | `resolveNonAutoWakeDecision` |
| Persistence save payload + rebuild | Implemented | `orchestration-persistence.helpers.ts` |
| Workflow run request builder (start + recovery) | Implemented | `OrchestrationRunRequestService.buildRunRequest/buildImportedHydrationRecoveryRunRequest` with external MCP mount resolution |
| Run request external MCP mount resolution | Implemented | `resolveKanbanExternalMcpMounts` integration |

## Health Findings

- **Test coverage**: 33 co-located `.spec.ts` files covering services, controllers, helpers,
  simulation runner, and integration paths. Notable large specs:
  - `orchestration.service.spec.ts` (3,688 LOC)
  - `orchestration-continuation.decisions.spec.ts` (1,252 LOC)
  - `imported-repository-backlog-reconciler.spec.ts` (974 LOC)
  - `project-orchestration-wakeup.service.spec.ts` (900 LOC)
  - `orchestration-continuation-reconciler.service.spec.ts` (807 LOC)
  - `orchestration-continuation.integration.spec.ts` (684 LOC)
  - `control-plane/control-plane-board.service.spec.ts` (319 LOC)
  - `control-plane/orchestration-decision-executor.service.spec.ts` (411 LOC)
  - `control-plane/orchestration-control-plane-scheduler.service.spec.ts` (307 LOC)
  - `control-plane/orchestration-lease.integration.spec.ts` (286 LOC)
  - Multi-scenario `reconciled-work-item-publisher.autonomous-{a,b,c,d}.spec.ts`,
    `.batch.spec.ts`, `.overrides.spec.ts`, plus base spec.
- **No placeholder / TODO-only tests** observed. Specs use `vi.fn` repository stubs and
  exercise real services (state transitions, decision idempotency, lease concurrency,
  scheduler fresh-fact gating, simulation scenarios, branch-blocker detection,
  strategic-intent append/latest, hydration recovery).
- **Module wiring tested** via `orchestration.module.spec.ts` (asserts
  `ProjectStrategicStateService` is both provided and exported via `MODULE_METADATA`).
- **Module integration**: `OrchestrationModule` is imported (with `forwardRef`) by
  `apps/kanban/src/work-item/work-item.module.ts`, `apps/kanban/src/project/project.module.ts`,
  and the dispatch, settings, retrospectives, and core-integration modules.
- **Code quality**: Strong dependency-injection, typed inputs/outputs, structured logging
  via `Logger`, defensive metadata handling (both `snake_case` and `camelCase` keys,
  e.g. `blocked_stage` / `blockedStage`, `hydration_summary` / `hydrationSummary`).
- **Idempotency / dedup**: Cycle decisions and wakeups use idempotency keys
  (`cycle_decision_idempotency_key` metadata, `dedupeKey` build with
  `project-orchestration-cycle:<projectId>:<source>:<reason>:<windowId>`).
- **Background reconciliation**: Three long-running services are properly wired with
  `OnModuleInit` / `OnModuleDestroy` — `OrchestrationContinuationReconcilerService`
  (configurable interval), `OrchestrationLeaseSweeperService` (30 s), plus the in-test
  simulation runner scenarios.
- **Strategic intent persistence** is now end-to-end:
  `OrchestrationService.recordStrategicIntent` → `appendStrategicIntent` →
  `savePersistenceState` → `latestStrategicIntent` is surfaced via
  `ProjectStrategicStateService.buildStrategicState` and via `toProjectOrchestration.decisionLog`.
  This addresses the open R5 question in `docs/project-context/OPEN_QUESTIONS.md`.
- **Responsibility split with `kanban-dispatch`** is now clean: orchestration delegates to
  `DispatchService.requestOrchestrationCycle` and `DispatchService.reconcileProjectLinkedRuns`,
  and the lease / wakeup / reconciler / branch-blocker / action-request / decision-log
  concerns are all in `orchestration/`. This addresses the open R10 question.
- **No `kanban.project_state` or `kanban.orchestration_timeline` MCP tools were invoked
  directly**: the playbook's step 1 is to call those without an explicit `project_id`. Those
  tools are not available to this probe subagent; the runtime contract is documented in
  `docs/project-context/kanban-contracts.md` and the implementations live in
  `apps/kanban/src/mcp/tools/read/project-state.tool.ts` and
  `apps/kanban/src/mcp/tools/read/orchestration-timeline.tool.ts` (referenced by
  `kanban-domain` probe result). The orchestration service exposes the same underlying data
  via `OrchestrationController` (e.g. `GET /projects/:id/orchestration`,
  `GET /projects/:id/orchestration/timeline`,
  `GET /projects/:id/orchestration/diagnostics`,
  `POST /projects/:id/orchestration/cycle`).

## Open Questions

- The playbook asks to call `kanban.project_state` and `kanban.orchestration_timeline` MCP
  tools, but they are not available in this probe subagent's toolset. The probe relied on
  direct file inspection of the orchestration source and specs instead. The runtime
  implementations of those tools are covered in the `kanban-domain` probe result.
- `OrchestrationService.isCycleActive` is implemented as a `Promise<boolean>` (synchronous
  body) — a minor convention deviation from the other methods but functionally correct.
- The control-plane intent repository, fact repository, outcome repository, launch-attempt
  repository, and lease repository live outside this scope
  (`apps/kanban/src/database/repositories/kanban-orchestration-*.repository.ts`). They are
  imported and exercised by every control-plane service and spec, so the contract surface is
  well-covered even though the repository code itself is outside the probe scope.
- `OrchestrationRunRequestService` depends on `resolveKanbanExternalMcpMounts`
  (from `apps/kanban/src/mcp/kanban-mcp-run-mounts.ts`); that module is outside the probe
  scope but is invoked at every run-request build and exercised indirectly through
  `OrchestrationService.spec.ts`.
- The `simulation/scenarios.ts` file is large and not co-located with a dedicated `.spec.ts`
  per scenario; coverage is provided by `orchestration-simulation-runner.service.spec.ts`
  against `EPIC_197_SCENARIOS` as a whole.
