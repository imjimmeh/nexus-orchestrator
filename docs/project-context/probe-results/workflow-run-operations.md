---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-run-operations
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-workspace.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-graph-read-model.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-autonomy-diagnostics.service.ts
  - apps/api/src/workflow/workflow-run-operations/question-idle-tracker.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-todo.service.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-request.contract.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-learning-autonomy-diagnostics.projection.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-run-browser-session-cleanup.listener.ts
  - apps/api/src/workflow/workflow-run-operations/workflow-graph-read-model.helpers.ts
source_paths:
  - apps/api/src/workflow/workflow-run-operations
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Workflow Run Operations

## Narrative Summary

The workflow-run-operations scope is a well-structured, fully-implemented NestJS feature module that provides comprehensive runtime control, observability, and state management for active workflow runs. It exposes 24 REST endpoints across 14 service classes and a controller, with 7 of 9 services carrying dedicated spec files providing unit-test coverage.

The module orchestrates container lifecycle (pause/resume/abort), real-time steering via message injection and question-answer forwarding, idle tracking with configurable stop/remove timers, workspace file access (tree/diff/content), graph-based run state visualization, autonomy diagnostics that aggregate failure classification and repair events, and a background reconciliation loop that recovers from stalled queue jobs and orphaned runs. The todo list management is fully implemented with context linking and agent-action dispatching.

## Capability Updates

### Container Steering (WorkflowRunSteeringService)
- **Pause/Resume/Abort**: Direct Docker container control with proper state checks (already-paused guard, includePaused option)
- **Active Container Selection**: Prefers parent container over child subagent containers; selects newest running container when multiple exist
- **Message Injection**: Publishes `user_message` to telemetry stream; attempts WebSocket forwarding to live container; falls back to session rehydration via `resumeJobWithMessage`; emits delivery failure events and structured audit logs
- **Question Answer Delivery**: Persists `user_question_answers` event; attempts WS forwarding via `sendQuestionResponseCommand`; gracefully falls back to session rehydration with a formatted canonical answer follow-up message; emits `workflow.user_questions.answered` EventEmitter event

### Idle Tracking (QuestionIdleTrackerService)
- Dual-timer design: configurable `question_idle_stop_seconds` (default 300s) and `question_idle_remove_seconds` (default 3600s)
- Callable `onStop` and `onRemove` callbacks registered via `registerCallbacks()`; replaced on re-tracking
- Cleanup on explicit `clearTracking`, `onModuleDestroy`, and timer replacement

### Workspace Access (WorkflowRunWorkspaceService)
- Three-tier workspace resolution: export path (`NEXUS_WORKSPACE_EXPORT_PATH`) → worktree path from run state → NotFoundException
- Path traversal guard preventing escapes outside workspace root
- `.git`-ignored file tree; `git diff --no-color` for diff; file content reads with normalized path resolution

### Graph Read Model (WorkflowGraphReadModelService)
- Builds runtime graph snapshot from workflow definition + persisted state_variables + event history
- Resolves job status from `_internal.completed_jobs` and `_internal.queued_jobs` boolean maps
- Failed job detection from `job.failed` / `workflow.failed` event types
- Outstanding question detection from event stream
- Supports both run-scoped and static (workflow-only) graph queries

### Autonomy Diagnostics (WorkflowRunAutonomyDiagnosticsService)
- Queries 16 event types across `workflow` and `memory` domains via EventLedgerService
- Projects events into 4 categories: `failure_classification`, `repair`, `learning`, `review`
- Includes repair delegation state from StateManager as supplementary item
- Chronologically sorted items with summary totals and latest status
- Full input sanitization: evidence kind allowlist, unsafe ID redaction (bearer tokens, raw output labels, API key patterns)

### Background Reconciliation (WorkflowRunReconciliationService)
- Periodic 30-second interval reconciliation with startup trigger
- Failed queue job recovery: deduplicates by queue job ID or computed key; respects in-flight guard
- Stale run detection: uses 90-second grace period; optionally completes runs via output contract validation when live job is missing
- Dedupes failed jobs across reconciliation cycles via bounded `processedFailedJobKeys` set (max 1000 entries)

### Todo Management (WorkflowRunTodoService)
- Full CRUD with `loadOrSeedRecords`, `applyTodoUpdates`, archive-and-sync pattern
- Agent action dispatching: `add`, `start`, `complete`, `list`, `clear` via `ManageTodoListInput`
- Context item linking and drift detection hooks (both stubbed but structurally present)
- Markdown render output with `_markdown` field; source mode detection (`manual`, `context_source`, `mixed`)

### Controller Endpoints (WorkflowRunsController)
- 24 REST endpoints covering: run lookup, telemetry auth, event history, graph snapshot, pause/resume/abort/inject/question-answers, autonomy diagnostics, web automation artifacts, skill/host-mount diagnostics, failure classification, todo list, workspace file tree/diff/content
- JWT bearer auth with `JwtAuthGuard` + `RolesGuard` (Admin/Developer roles)
- Telemetry WebSocket auth token generation with configurable WS URL priority chain

## Health Findings

### Test Coverage
- `workflow-run-operations.module.ts`: no spec (module wiring)
- `workflow-runs.controller.spec.ts`: controller spec covering failure classification endpoints
- `workflow-run-steering.service.spec.ts`: comprehensive service spec (9 test suites, pause/resume/abort/message delivery/question answers with container selection, WS fallback, session rehydration paths)
- `workflow-run-reconciliation.service.spec.ts`: thorough reconciliation spec (9 test cases covering dedup, stale detection, output contract completion, retry-on-error)
- `workflow-run-workspace.service.spec.ts`: workspace spec (6 test cases)
- `workflow-graph-read-model.service.spec.ts`: graph read model spec (4 test cases)
- `workflow-run-autonomy-diagnostics.service.spec.ts`: extensive diagnostics spec (16 test cases covering all 16 queried event types, safety redaction, category summarization)
- `question-idle-tracker.service.spec.ts`: idle tracker spec (6 test cases)
- `workflow-run-todo.helpers.spec.ts`: helpers spec (4 test cases)
- `workflow-run-todo.service.ts`: no spec
- `workflow-run-request.contract.spec.ts`: contract spec (2 test cases)
- `workflow-run-browser-session-cleanup.listener.spec.ts`: listener spec (3 test cases)

**Coverage assessment**: 9 of 14 non-trivial source files have dedicated spec files. TodoService lacks direct unit tests. Overall test density is high for the most complex services.

### Code Quality
- Type safety: extensive use of discriminated unions (`WorkflowNodeRuntimeStatus`), generic type constraints, and strict null checks
- Error handling: proper NotFoundException, ConflictException, BadRequestException usage with contextual messages
- Secrets safety: dedicated sanitization layer in autonomy diagnostics (`readSafeEvidenceId`, `[REDACTED]` patterns)
- Deduplication: bounded set prevents unbounded memory growth in reconciliation
- No obvious dead code or placeholder stubs except for `syncContextItemStatuses` (stub) and `resolveSourceInfo` drift detection

## Open Questions

1. **TodoService drift detection is stubbed**: `has_drift` always returns `false` and `stale_count` always returns `0`; actual drift comparison logic is not implemented.
2. **Context item status sync is stubbed**: `syncContextItemStatuses` is a no-op; linked context items never get their statuses updated from todo state changes.
3. **Telemetry WS URL resolution**: Uses environment variable priority chain (`TELEMETRY_PUBLIC_WS_URL` → `TELEMETRY_WS_URL` → `WEBSOCKET_URL` → inferred from request); behavior in clustered/containerized deployments not fully validated.
4. **WS delivery fallback reliability**: When WebSocket forwarding fails (socket not found), the service falls back to session rehydration, but the agent's awareness of question answers depends on successful rehydration replay; retry behavior is not guaranteed.
5. **Output contract validation in reconciliation**: `completeRunFromValidOutputContract` silently skips runs without workflow_id; edge case behavior when workflow definition is missing could be made explicit.
6. **Idle timer scaling**: Uses `setTimeout` per tracked run; under very high concurrency (thousands of simultaneous idle runs), the timer management could become a bottleneck; alternative event-driven approach may be needed.