# Workflow Engine Architecture

The workflow engine orchestrates YAML-defined jobs, status-driven lifecycle automation, and event-triggered orchestration workflows.

## Core Responsibilities

1. Parse and validate workflow YAML definitions.
2. Resolve execution order for DAG jobs and conditional transitions.
3. Execute jobs through BullMQ workers and special-step handlers.
4. Persist run state and event history.
5. Start workflows from manual, webhook, and event-driven triggers.

## Main Services

- **WorkflowEngineService** - High-level coordinator for starts, resumes, and retries.
- **WorkflowPersistenceService** - Encapsulates all CRUD and repository access for Workflow and Run entities.
- **WorkflowConcurrencyManager** - Manages exclusive execution, queuing, and deduplication logic.
- **WorkflowRepositoryAggregator** - Groups related repositories (Workflows, Runs, AgentProfiles) to reduce constructor bloat.
- **WorkflowRuntimeToolsService** - Provides tool discovery and capability snapshots for agents.
- **Tool Handlers** - Decomposed handlers for specific tool categories (`ProjectToolsHandler`, `WorkItemToolsHandler`, `MemoryToolsHandler`, `ScheduleToolsHandler`, `WorkflowMetaToolsHandler`).
- **WorkflowParserService** - Standard YAML parser for definition hydration.
- **WorkflowValidationService** - Schema and structural validator.
- **DAGResolverService** - Dependency graph resolver for parallel step execution.
- **StateManagerService** - Runtime variable and state persistence.
- **StateMachineService** - Workflow status transition logic.
- **StepExecutionOrchestratorService** - Top-level job enqueuing and completion handler.
- **StepSpecialStepExecutorService** - Handler for synchronous special-step types.
- **WorkflowEventTriggerService** - Router for event-to-workflow triggering.
- **WorkflowGraphReadModelService** - Canonical read-projections for UI and CLI clients.

## Trigger and Input Model

Workflow definitions support trigger.type values:

- manual
- webhook
- event

Trigger payload is mapped into run state as trigger.\* and can be referenced from job inputs.

Common Kanban status workflow examples:

- trigger.scopeId
- trigger.contextId
- trigger.status
- trigger.previousStatus
- trigger.resource.executionConfig

Generic project events may expose `trigger.projectId`; status workflows use `trigger.scopeId` and `trigger.contextId`.

## Governed Host Mounts (EPIC-100)

Execution jobs may declare `host_mounts` requests by alias.

Runtime behavior:

1. Workflow validation enforces alias/mode/subpath safety.
2. Host mount resolution applies layered allow-list intersection and deny overrides.
3. Read-write requests can return `approval_required` preflight outcomes.
4. Resolved bindings are injected into container provisioning under `/workspace/host-shares/*`.
5. Event ledger emits request, approval, denial, attach, and remove lifecycle events.

Diagnostics:

1. `GET /api/workflows/runs/:runId/host-mounts/diagnostics`
2. Operations Doctor runtime integrity includes stale host-share mount diagnostics.

## External Prompt Files (EPIC-070)

Workflow agent step prompts can be stored inline or in external files.

Prompt file layout:

- `seed/workflows/prompts/<workflow-name>/<job-or-step>.md`

Step contract:

1. Use `prompt` for inline prompt text.
2. Use `prompt_file` for external prompt content.
3. `prompt` and `prompt_file` are mutually exclusive.

Runtime behavior:

1. `PromptLoaderService` resolves `prompt_file` content before execution.
2. Missing prompt files fall back to inline `prompt` when present.
3. If no fallback prompt exists, execution fails with file-specific error details.
4. Development mode reads prompt files directly (hot-reload friendly).
5. Production mode caches resolved prompt content.

Feature toggle:

- `EXTERNAL_PROMPTS_ENABLED` (default true)

## Event-Driven Lifecycle Automation

Status transitions emit the canonical `kanban.work_item.status_changed.v1` event consumed by event-triggered workflows.

Workflow-owned status trigger routing:

- `trigger.status == "refinement"` -> `work_item_refinement_default`
- `trigger.status == "in-progress"` -> `work_item_in_progress_default`
- `trigger.status == "in-review"` -> `work_item_in_review_default`
- `trigger.status == "ready-to-merge"` -> `work_item_ready_to_merge_default`
- `trigger.status == "refinement"` and large-scope split condition -> `work_item_split_default`

Dispatch-driven todo processing can route items to refinement or in-progress based on pre-flight policy settings.

## Special Step Execution

The engine supports synchronous special steps that do not require agent containers.

Core special-step handlers are registered statically through the workflow module. Trusted in-process plugin handlers are additive: at API startup, `SpecialStepPluginLoaderService` scans `NEXUS_SPECIAL_STEP_PLUGIN_DIR`, loads one plugin package per subdirectory, and registers each declared handler with the same special-step registry used by core handlers.

Core special-step types:

- register_tool
- invoke_workflow
- run_command
- web_automation
- emit_event
- amend_entity
- git_operation
- manage_tool_candidate

Deprecated and reserved legacy types are documented in the SDD special-step section and validation notes.

Special-step outputs are written into state_variables and are available to downstream jobs and transition conditions.

`web_automation` actions apply selector fallback + retry/backoff policy and persist deterministic failure artifacts. Artifacts are retrievable through:

- `GET /workflows/runs/:runId/web-automation-artifacts`
- `GET /workflows/runs/:runId/web-automation-artifacts/:artifactId`

EPIC-099 extends the same browser execution stack to runtime chat/tool invocations through `workflow-runtime` browser capabilities (`browser_open_page`, `browser_navigate`, `browser_click`, `browser_type`, `browser_wait_for`, `browser_read_page`, `browser_screenshot`, `browser_close_page`). Runtime browser actions also support artifact listing/detail retrieval through `workflow-runtime` routes and share the same deterministic failure artifact model.

Browser sessions are run-scoped and explicitly closeable (`browser_close_page`), and they are cleaned up automatically on terminal run lifecycle events (`COMPLETED`, `FAILED`, `CANCELLED`).

Canonical markdown schema and reconcile ownership boundaries are documented in `docs/architecture/work-item-markdown-canonical-contract.md`.

## Dispatch and Scheduling Integration (EPIC-055 and EPIC-056)

The workflow engine cooperates with dispatch services and orchestration actions:

1. Reconcile/selection signals determine candidate work items.
2. Dispatch mutating actions execute in orchestration mode policy (supervised/autonomous).
3. Capacity controls and polling settings gate actual starts.
4. Scheduling metadata is included in project-state payloads consumed by orchestration decisions.

Polling configuration keys:

- work_item_dispatch_polling_enabled
- work_item_dispatch_poll_interval_seconds
- work_item_dispatch_poll_batch_size

## Delegation Feedback Loops (EPIC-136)

Delegation workflow completion now participates directly in orchestration continuity.

Core guarantees:

1. `orchestration_invoke_agent_default` always executes mandatory post-delegation `kanban.publish_specs` hydration when publication is expected.
2. Dispatch polling can request a stale-heartbeat cycle when orchestration remains idle beyond a configurable threshold.
3. Delegation workflow completion emits an orchestration cycle request for the parent project.

Delegation completion contract:

1. Listener scope is limited to delegation workflow identifiers.
2. `trigger.projectId` is required and UUID-validated before emitting parent-cycle events.
3. Event emission failures are non-fatal and recorded to telemetry.

Stale-heartbeat contract:

1. Stale detection uses `project_orchestrations.updated_at` age.
2. Stale threshold key: `orchestration_stale_threshold_minutes` (default 20).
3. Environment override: `ORCHESTRATION_STALE_THRESHOLD_MINUTES`.
4. Stale cycles preserve cooldown gating and are emitted with reason `stale_heartbeat:<minutes>m`.

Operational telemetry:

1. `orchestration_stale_cycle_triggered`
2. `delegation_completion_cycle_requested`

## Restart Continuity Semantics (EPIC-058)

Orchestration restart context is injected through event payloads and trigger/job inputs.

Current restart fields:

- isRestart
- stateSummary

Discovery and cycle workflows can consume restart context via inputs such as:

- state_summary
- is_restart

Expected behavior:

1. On restart, context summary is provided to avoid repeating completed discovery/spec phases.
2. CEO workflows use restart-aware prompting to continue from current project state.

## Blueprint Workflows (EPIC-066)

EPIC-066 adds reusable blueprint workflows:

1. `standard_feature_flow`
2. `hotfix_flow`
3. `documentation_audit`

Blueprints compose existing primitives instead of re-implementing orchestration internals:

1. `invoke_workflow` for child workflow composition.
2. `invoke_agent_workflow` through orchestration pathways where applicable.
3. `automated_quality_check` as a reusable QA building block.

Blueprint input contract:

1. Required fields:
   - `projectId`
   - `objective`
   - `requested_by`
2. Optional fields with defaults:
   - `risk_level` (default: `standard`)
   - `scope_boundaries` (default: `current_iteration`)
   - `artifact_paths` (default: `[]`)

Validation failures are surfaced with actionable error messages during orchestration invocation.

## Run State and Graph Read Model (EPIC-060)

The engine persists run status and event history, and exposes canonical graph projections through read-model APIs.

Graph endpoints:

- GET /workflows/runs/:runId/graph
- GET /workflows/:id/graph

Node runtime statuses are normalized server-side to avoid per-client reconstruction logic.

## Dry-Run Mode (EPIC-070)

`WorkflowEngineService.startWorkflow` supports dry-run planning mode.

Behavior:

1. Validates workflow schema and dependency graph.
2. Resolves external prompts without enqueuing jobs.
3. Returns execution ordering and state transition targets.
4. Does not persist workflow runs or mutate runtime state.

Dry-run outputs include:

1. `executionPath`
2. `parallelGroups`
3. `stateTransitions`
4. `mockJobsApplied`

Feature toggle:

- `WORKFLOW_DRY_RUN`

## Workflow Test Harness

Test utilities are available under `apps/api/src/workflow/testing/`.

`WorkflowTestHarness` supports:

1. `withTrigger(data)`
2. `withState(variables)`
3. `mockJob(jobId, output)`
4. `run()`

The harness wraps dry-run execution to enable fast workflow-path regression tests.

## Operational Notes

1. Workflow registration is dynamic; active event workflows are registered at startup.
2. Event naming should remain stable because event names are part of workflow trigger contracts.
3. For debugging progression issues, inspect:

- run status
- run events stream/history
- trigger payload
- special-step outputs in state variables

## Conversational Artifact Steering Workflow (EPIC-128)

Workflow ID: `conversational_artifact_steering`

Jobs:

1. `provision_worktree` (type: `git_operation`, action: `create_worktree`)
2. `apply_changes` (type: `execution`, agent: `software-engineer-assistant`)
3. `publish` (type: `mcp_tool_call`, tool: `kanban.publish_specs`)

Triggered by the CEO agent when a user approves an artifact change plan during a steering session. Uses the Kanban-owned `kanban.publish_specs` path to publish spec changes into work items without adding an API-owned publish job type.

Seed file: `seed/workflows/conversational-artifact-steering.workflow.yaml`

## Related Docs

- docs/architecture/ARCH-kanban-workflow.md
- docs/architecture/workflow-graph-read-model.md
- docs/WORKFLOW_EVENT_TRIGGERS.md
- docs/WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md
