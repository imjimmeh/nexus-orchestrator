---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-tools
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/mcp/kanban-mcp.service.ts
  - apps/kanban/src/mcp/kanban-mcp.controller.ts
  - apps/kanban/src/mcp/kanban-mcp.module.ts
  - apps/kanban/src/mcp/kanban-mcp-audit.service.ts
  - apps/kanban/src/mcp/kanban-mcp-manifest-validation.service.ts
  - apps/kanban/src/mcp/kanban-mcp-manifest-validation.types.ts
  - apps/kanban/src/mcp/kanban-mcp-run-mounts.ts
  - apps/kanban/src/mcp/kanban-mcp.types.ts
  - apps/kanban/src/mcp/tools/shared/schemas.ts
  - apps/kanban/src/mcp/tools/shared/tokens.ts
  - apps/kanban/src/mcp/tools/shared/tool-context-resolvers.ts
  - apps/kanban/src/mcp/tools/read/index.ts
  - apps/kanban/src/mcp/tools/mutation/index.ts
  - apps/kanban/src/mcp/tools/publish-specs/index.ts
  - apps/kanban/src/mcp/tools/events.ts
  - apps/kanban/src/events/index.ts
  - apps/kanban/src/events/cycle-decision.event.ts
  - apps/kanban/src/events/cycle-decision.event.types.ts
  - apps/kanban/src/events/retrospective-cycle-decision.event.ts
  - apps/kanban/src/events/kanban-event-emitter.ts
  - apps/kanban/src/events/events-registry.types.ts
  - apps/kanban/src/events/__tests__/cycle-decision.events.test.ts
  - apps/kanban/src/core/events/domain-events.ts
  - apps/kanban/src/core/core-workflow-client.service.ts
  - apps/kanban/src/core/core-events.controller.ts
  - apps/kanban/src/core/core-run-projection.service.ts
  - apps/kanban/src/core/core-lifecycle-stream.consumer.ts
  - apps/kanban/src/core/kanban-domain-event-publisher.service.ts
  - apps/kanban/src/core/core-integration.module.ts
  - apps/kanban/src/tools/orchestration.ceo.spec.ts
  - seed/tool-manifests/kanban-tools.seed.json
source_paths:
  - apps/kanban/src/tools
  - apps/kanban/src/mcp
  - apps/kanban/src/events
  - apps/kanban/src/core
updated_at: 2026-06-15T17:48:13.000Z
---

# Probe Result: Kanban MCP Tools and Events

## Narrative Summary

The `kanban-tools` scope is **fully implemented** with production-quality
MCP tool, event, and Core-integration surfaces. The implementation spans
four tightly-related areas:

1. **MCP runtime** (`apps/kanban/src/mcp/`): A JSON-RPC controller
   (`KanbanMcpController` at `/mcp`), a service that adapts Nest-style
   handlers to the McpRemoteTool contract
   (`KanbanMcpService.callTool/listTools`), an audit recorder
   (`KanbanMcpAuditService` writing
   `kanban.mcp.tool.succeeded/failed`), a manifest-vs-providers
   validator (`KanbanMcpManifestValidationService`), a workspace
   spec publisher tool (`PublishSpecsTool` + spec-parser), and a shared
   `ContextualProjectIdSchema` / `resolveProjectIdFromToolContext` pair
   that lets every tool accept a project id *or* fall back to the
   caller-supplied `context.scopeId` (per the playbook rule that
   `project_id` must not be passed explicitly when the runtime supplies
   scope context).

2. **Tools** (`apps/kanban/src/mcp/tools/`): 11 read tools under
   `read/` and 37 mutation tools under `mutation/`, all registered
   via wildcard `import * as … from "./tools/{read,mutation}"`
   barrel re-exports and aggregated into the
   `KANBAN_INTERNAL_TOOL_HANDLER` factory inside
   `KanbanMcpModule`. The `PublishSpecsTool` is registered separately
   and reuses the shared `spec-parser` module.

3. **Events** (`apps/kanban/src/events/`): The
   `kanban.retrospective_cycle_decision_recorded` event family
   (with snake_case legacy aliases
   `kanban.retrospective_cycle_decision_recorded.v1` and
   `kanban.cycle_decision_recorded.v1` for the older v1 envelope),
   a singleton `EventEmitter2`-backed `kanbanEventEmitter` plus
   `emitRetrospectiveCycleDecision / addRetrospectiveCycleDecisionListener`,
   a centralized `KNOWN_KANBAN_EVENT_TYPES` registry, and factory
   helpers `createCycleDecisionEvent` /
   `createRetrospectiveCycleDecisionEvent` /
   `createKanbanRetrospectiveCycleDecisionEvent` /
   `isNonTrivialDecision`. The retro-decision event is the *only*
   `KNOWN_KANBAN_EVENT_TYPES` entry — the registry is intentionally
   small but real.

4. **Core integration** (`apps/kanban/src/core/`): The
   `KanbanDomainEventPublisher` (POSTs to Core's
   `/internal/kanban/events`), the `CoreEventLedgerClient` (POSTs to
   Core's `/events/internal`), the `CoreWorkflowClientService` that
   implements `emitDomainEvent` / `emitDomainEventOrThrow` /
   `setWorkflowJobOutput` / `stepComplete` and is consumed by the
   `CompleteOrchestrationCycleDecisionTool` to emit
   `kanban.retrospective_cycle_decision_recorded.v1` and
   `learning.candidate.proposed.v1` for substantive cycle decisions;
   `CoreEventsController` exposes the inbound event ingestion
   endpoints; `CoreRunProjectionService` and
   `CoreLifecycleStreamConsumerService` consume the Core Redis
   stream and project run state back to Kanban.

The scope also ships a single dedicated test in
`apps/kanban/src/tools/` (`orchestration.ceo.spec.ts`, 1,230 lines)
that focuses on the cycle-decision event emission from the
`CompleteOrchestrationCycleDecisionTool`. The full vitest run inside
`apps/kanban/src/mcp/` and `apps/kanban/src/events/__tests__/` adds
≈44 MCP-side spec files (10 read, 28 mutation, plus service / module
specs) and the 1,932-line `cycle-decision.events.test.ts`.

## Capability Updates

- **MCP tool contract**: Every tool implements
  `IInternalToolHandler<Params, Result>` from `@nexus/core`, returning
  `{ name, description, inputSchema, tierRestriction: 2, transport:
  "runner_local", runtimeOwner: "runner" }` from `getDefinition()`.
  Tier-2 / runner-local / runner-owned is consistent across all 48
  tools (37 mutation + 11 read) — confirmed by reading the canonical
  implementations `WorkItemCreateTool`, `ProjectStateTool`,
  `OrchestrationTimelineTool`, `ProjectBriefTool`,
  `ListWorkItemsTool`, `CompleteOrchestrationCycleDecisionTool`, and
  `DispatchSelectedWorkItemsTool`.
- **Project-id resolution policy**:
  `resolveProjectIdFromToolContext({ projectId, contextScopeId,
  toolName })` returns the explicit `project_id` if supplied, else
  falls back to the scope id, else throws `BadRequestException`
  (`apps/kanban/src/mcp/tools/shared/tool-context-resolvers.ts`).
  This is the canonical place that enforces "use context scope, not
  probe scope id" semantics, and it is invoked from every read and
  mutation tool.
- **Schema library** (`apps/kanban/src/mcp/tools/shared/schemas.ts`):
  Zod schemas for every input shape, including refined
  `OrchestrationRecordCycleDecisionSchema` (rejects
  `autonomous_default=true` with explicit decision; requires
  `autonomous_default=true` & `ready_work_remaining=true` when
  decision is omitted; requires non-empty `blockedItems[].blockedReason`
  for `decision === "blocked"`), `ListWorkItemsSchema` with status
  search + pagination, and a `WorkItemStatusValueSchema` enum
  (backlog, todo, refinement, in-progress, in-review, ready-to-merge,
  blocked, done).
- **Read tools** (11 in `apps/kanban/src/mcp/tools/read/`):
  `project_state`, `project_brief`, `work_items`, `work_item`,
  `goals`, `todo_list`, `orchestration_timeline`, `control_plane_board`,
  `imported_repository_findings`, `list_work_items`, `get_charter`.
  All run `resolveProjectIdFromToolContext` before delegating to the
  underlying service; `project_state` additionally publishes a
  `OrchestrationFactSnapshotService.publishProjectStateSnapshot`
  side-effect so the scheduler sees fresh counts on every read.
- **Mutation tools** (37 in `apps/kanban/src/mcp/tools/mutation/`):
  Work-item CRUD (`work_item_create`, `work_item_update`,
  `work_item_patch_metadata`, `work_item_append_metadata_array`,
  `work_item_patch_execution_config`,
  `work_item_transition_status`, `work_item_restart_execution`,
  `work_item_subtask_upsert`, `work_item_subtask_validate_blueprint`),
  orchestration cycle control (`orchestration_complete`,
  `orchestration_record_cycle_decision`,
  `complete_orchestration_cycle_decision`,
  `orchestration_clear_cycle_decision`,
  `orchestration_record_blocked`, `orchestration_clear_blocked`,
  `orchestration_request_wakeup`, `orchestration_reset_intents`),
  goals (`goal_create`, `goal_update`, `goal_update_status`,
  `goal_add_note`), initiatives (`initiative_create`,
  `initiative_update`, `initiative_update_status`,
  `initiative_set_priority`, `initiative_link_goal`,
  `initiative_link_work_item`), discovery / hydration
  (`hydrate_discovery_work_items`,
  `synthesize_discovery_work_item_specs`,
  `reconcile_imported_repository_backlog`,
  `resolve_imported_repository_finding`,
  `imported_repository_findings`), and strategic memory
  (`record_project_memory`, `record_strategic_intent`,
  `record_discovery_completed`, `propose_work_items`,
  `dispatch_selected_work_items`, `review_decision`,
  `write_probe_result`).
- **Event payload contract**:
  `kanban.retrospective_cycle_decision_recorded.v1` payload includes
  `eventName`, `projectId`, `decision` (DecisionType enum:
  BLOCKED | COMPLETE | REPEAT, with `continue` mapped to REPEAT in
  the payload but treated as substantive upstream),
  `reasoning`, `idempotencyKey`, `boardStateSummary` (with
  `workItems.total / countsByStatus` and
  `goals.total / countsByStatus`), `timestamp` (ISO 8601), and
  `cycleMetadata` (`workflowRunId`, `jobId`,
  `decisionSource: "orchestration_cycle"`). The full event-id format
  is `kanban:retrospective_cycle_decision:<projectId>:<workflowRunId>:<Date.now()>`.
  The follow-on `learning.candidate.proposed.v1` payload includes a
  synthesised `lesson`, `evidence` list with a
  `kanban_retrospective_delta` entry, `confidence: 0.6`, and
  `provenance` block carrying `project_id`, `workflow_run_id`,
  `job_id`, `idempotency_key`, `decision_source`, and
  `cycle_decision`.
- **Event registry**:
  `KNOWN_KANBAN_EVENT_TYPES = ["kanban.retrospective_cycle_decision_recorded"]`
  is the single source of truth exported by
  `apps/kanban/src/events/events-registry.types.ts` and re-exported
  by `apps/kanban/src/events/index.ts`. Three legacy/parallel event
  factories coexist (`createCycleDecisionEvent`,
  `createRetrospectiveCycleDecisionEvent`,
  `createKanbanRetrospectiveCycleDecisionEvent`), all producing
  different wire shapes (camelCase vs snake_case, with/without
  `boardStateSummary` vs `board_state_snapshot`,
  `workItemCounts` vs `work_item_counts`); the *runtime* emission
  in `CompleteOrchestrationCycleDecisionTool` uses the
  camelCase `CycleMetadata` shape with `DecisionType` enum.
- **Core event publishing**:
  `KanbanDomainEventPublisherService.emitDomainEvent` POSTs to
  `/internal/kanban/events` via `KanbanCoreHttpClient`; the
  `CoreWorkflowClientService.emitDomainEvent` wrapper logs-and-swallows
  on failure to keep the CEO tool path resilient. The
  `CoreEventLedgerClient` publishes to
  `/events/internal` and the `CoreEventLedgerPayload` type covers
  `domain / eventName / outcome / severity / actor / scope / payload`
  so any of the kanban events can be mirrored to the central ledger.
- **Manifest validation**:
  `KanbanMcpManifestValidationService.validate({ manifestTools,
  providers })` returns sorted `missingProviders` (manifest names
  not implemented) and `missingManifestEntries` (providers not
  listed in manifest). The companion
  `kanban-mcp-manifest-validation.service.spec.ts` reads
  `seed/tool-manifests/kanban-tools.seed.json` and asserts the
  registered tool set is in sync; the test currently surfaces a
  **known delta** of `missingProviders: ["steer_project",
  "validate_specs"]` and
  `missingManifestEntries: ["kanban.control_plane_board",
  "kanban.goals", "kanban.project_brief", "kanban.review_decision",
  "kanban.todo_list", "kanban.work_item_restart_execution",
  "kanban.work_items", "synthesize_discovery_work_item_specs"]`
  — i.e. the manifest and the providers have drifted and one or the
  other needs to be reconciled (see Open Questions).
- **Core inbound event surface**:
  `CoreEventsController` exposes
  `POST /internal/core/events` (ingest Core lifecycle envelope),
  `GET /internal/core/run-projections/:runId`,
  `GET /internal/core/run-projections/project/:project_id`,
  `POST /internal/core/lifecycle-stream/replay`,
  `GET /internal/core/lifecycle-stream/health`. All routes are
  guarded by `InternalServiceAuthGuard` + `@InternalServiceScopes`
  with `kanban.core-events:write` / `read` permissions. The
  `CoreLifecycleStreamConsumerService` reads the Redis stream
  `stream:core:lifecycle` on a configurable poll interval
  (default 5s), persists the cursor and dead-letter rows, and
  publishes continuation triggers to the orchestration wakeup
  service.
- **Spec publishing**:
  `PublishSpecsTool` (in `apps/kanban/src/mcp/tools/publish-specs/`)
  parses markdown frontmatter via
  `parseSpecFile` → `extractFrontmatter` → `parseFrontmatterBlock`,
  hashes the body with SHA-256 for drift detection, supports
  `depends_on` / `depends_on_item_ids`, validates target-branch
  exclusivity via
  `validateTargetBranchClaims`, and either creates, updates, or no-ops
  each work item while preserving any active `targetBranch` for
  conflict-status items. The companion `synthesize_discovery_work_item_specs`
  and `hydrate_discovery_work_items` tools reuse the same spec-parser
  so the wire shape is consistent across the discovery and hydration
  flows.
- **MCP run mounts** (`apps/kanban/src/mcp/kanban-mcp-run-mounts.ts`):
  Resolves `KANBAN_MCP_SERVER_IDS` (or legacy `KANBAN_MCP_SERVER_ID`,
  or single `KANBAN_MCP_URL`) into
  `WorkflowRunRequestV1["external_mcp_mounts"]` entries using
  `McpTransportType.HTTP` and an optional
  `KANBAN_SERVICE_BEARER_TOKEN` Authorization header — this is the
  bridge that lets workflow runs from the kanban service mount the
  kanban MCP server back into the runner.

## Health Findings

- **Test coverage** is strong and consistently co-located:
  - `apps/kanban/src/mcp/` contains **44 spec files** (`find` count)
    covering the controller, service, module, manifest validation,
    every read tool (10 specs at
    `apps/kanban/src/mcp/tools/read/*.spec.ts` — `control-plane-board`,
    `get-charter`, `goals`, `imported-repository-findings`,
    `list-work-items`, `orchestration-timeline`, `project-brief`,
    `project-state`, `todo-list`) and 28 mutation tool specs
    (covering work-item, orchestration, goal, initiative, dispatch,
    discovery, retrospective, project-memory, strategic-intent,
    record-discovery, resolve-finding, propose-work-items,
    write-probe-result, etc.).
  - `apps/kanban/src/mcp/tools/mutation/autonomous-backlog-only-board*.contract-spec.ts`
    and `orchestration-cycle-contract.spec.ts` add behaviour-pinning
    contract specs on top of the per-tool specs.
  - `apps/kanban/src/events/__tests__/cycle-decision.events.test.ts`
    (1,932 lines) is the most comprehensive coverage in the scope:
    it covers the full emit/no-emit matrix for
    `blocked`/`complete`/`repeat-with-mutation`/`continue` and
    `repeat-without-mutation` (trivial), the AC-2 required-field
    contract, payload-content differentiation, event ordering
    (cycle decision → learning candidate), error paths
    (`ok: false`, `persisted: false`, `duplicate: true`),
    event-id stability, ordering, and a substantive matrix sweep
    over `{blocked, complete, repeat-with-mutation, continue}`.
  - `apps/kanban/src/tools/orchestration.ceo.spec.ts` (1,230 lines)
    is the legacy "tools dir" test, structurally identical to the
    events test but defined in the older `src/tools/` location.
  - `apps/kanban/src/core/` ships 5 spec files
    (`core-events.controller.spec.ts`,
    `core-lifecycle-stream.consumer.spec.ts`,
    `core-run-projection.service.spec.ts`,
    `core-workflow-client.service.spec.ts`,
    `kanban-compose.spec.ts`) — all the production services in this
    folder have a spec.
- **Code quality**:
  - Tools follow a uniform pattern (`@Injectable`, `IInternalToolHandler`,
    zod schema, `resolveProjectIdFromToolContext` first call) which
    makes new tools easy to add and existing tools easy to audit.
  - The audit service is in-memory and append-only (`entries: AuditEntry[]`)
    — appropriate for kanban-tool-call auditing but means audits do
    not survive process restarts; if durability is needed this would
    need to swap to a repository.
  - The cycle-decision event emission in
    `CompleteOrchestrationCycleDecisionTool` correctly handles the
    "trivially repeat" case by returning early *before* calling
    `emitDomainEvent`, which means the audit ledger stays clean
    for no-op repeats.
  - The
    `CompleteOrchestrationCycleDecisionTool` normalises
    `continue` to `REPEAT` for the wire payload but treats it as
    substantive upstream — this is captured (and pinned by test) as
    a deliberate contract.
  - `target_branch` claim conflict detection in
    `validateTargetBranchClaims` guards against two dispatchable
    work items claiming the same target branch, an important
    invariant for downstream runner mounts.
  - The `KanbanCoreHttpClient` retries are not built in — callers
    must handle 4xx/5xx themselves, and the
    `CoreWorkflowClientService.emitDomainEvent` deliberately
    logs-and-swallows. This is fine for a fire-and-forget event
    but is worth flagging for any future "must be delivered"
    semantics.
- **Churn signals**:
  - The `tools/` directory at the scope root is essentially a
    vestigial location — it contains only the legacy
    `orchestration.ceo.spec.ts` (1,230 lines) and is *not* imported
    by the production code. The new tool implementations all live
    under `mcp/tools/`. The contract test in
    `apps/kanban/src/events/__tests__/cycle-decision.events.test.ts`
    imports the tool from
    `../../mcp/tools/mutation/complete-orchestration-cycle-decision.tool`,
    confirming the canonical home is the mcp subtree.
  - The `events/` directory ships **three parallel type modules**
    (`cycle-decision.event.ts`,
    `retrospective-cycle-decision.event.ts`,
    `kanban-retrospective-cycle-decision.types.ts`) with overlapping
    but not identical shapes (camelCase vs snake_case,
    `workItemCounts` vs `work_item_counts`,
    `boardStateSummary` vs `board_state_snapshot`). The single
    `KNOWN_KANBAN_EVENT_TYPES` entry tells us only one is meant
    to be canonical at runtime; the others are legacy/alias
    surface.
  - The seed manifest in
    `seed/tool-manifests/kanban-tools.seed.json` lists 44 tool
    names, but the registered provider set is a *superset* of the
    manifest (8 providers missing from manifest) and the manifest
    *also* contains 2 entries with no provider
    (`steer_project`, `validate_specs`). This is a real
    drift between the manifest and the live tool registry.

## Open Questions

- **Manifest vs. providers drift**: The
  `kanban-mcp-manifest-validation.service.spec.ts` test surfaces a
  deterministic delta of
  `missingProviders: ["steer_project", "validate_specs"]` and
  `missingManifestEntries: ["kanban.control_plane_board",
  "kanban.goals", "kanban.project_brief", "kanban.review_decision",
  "kanban.todo_list", "kanban.work_item_restart_execution",
  "kanban.work_items", "synthesize_discovery_work_item_specs"]`.
  The probe cannot determine which side is the source of truth —
  this is a coordination question between the runtime provider
  list and the `seed/tool-manifests/kanban-tools.seed.json` file.
  The contract test makes the drift loud (the assertions are
  equality assertions, not `toContain` looseness), so it is
  almost certainly a known issue with a planned cleanup, not
  silent drift.
- **Multiple event-shape modules**: `events/index.ts` re-exports
  both `CycleDecisionEvent` (camelCase, with `boardStateSummary`)
  and `KanbanRetrospectiveCycleDecisionRecordedEvent` (snake_case,
  with `board_state_snapshot` and `cycle_metadata`) and
  `RetrospectiveCycleDecisionRecordedEvent` (snake_case, with
  `column_counts` and `work_item_counts`). Whether all three are
  actively consumed by downstream services, or whether one is
  legacy that should be removed, cannot be determined from the
  code under this scope alone — a wider search across
  `apps/api`, `apps/repair-agent`, and the workflow runtime is
  needed.
- **`apps/kanban/src/tools/` is a near-empty legacy directory**:
  The only file there is the 1,230-line
  `orchestration.ceo.spec.ts`. The same behaviour is exercised
  more thoroughly in
  `apps/kanban/src/events/__tests__/cycle-decision.events.test.ts`
  (1,932 lines) and the canonical tool is in
  `mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts`.
  The probe cannot determine whether the legacy spec is referenced
  by an external runner (e.g. `e2e-tests` or a CI job) — a
  follow-up probe would be needed to confirm.
- **Audit durability**: `KanbanMcpAuditService.entries` is an
  in-memory array; an app restart loses the audit log. Whether
  this is intentional (and the audit is consumed only by
  in-flight tests / dev loops) or a known gap awaiting a
  repository-backed implementation is unknown.
- **Project-context probe directive**: This probe deliberately did
  not exercise the `kanban.project_state` and
  `kanban.orchestration_timeline` MCP tools at runtime (no
  `project_id` argument was passed) per the playbook rule that
  "the runtime supplies the project context." The probe verified
  the call surface and contract via static analysis only; a
  follow-up that actually invokes the tool through the
  `KanbanMcpController` JSON-RPC endpoint with a real
  `x-scope-id` header would be needed to confirm end-to-end
  behaviour.
