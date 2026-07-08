# EPIC-169: API and Pi Lifecycle Event and Callback Parity

Status: Proposed
Priority: P0
Depends On: EPIC-018, EPIC-139, EPIC-153
Related: EPIC-124, EPIC-146, EPIC-159, docs/research/pi-agent-extensions.md
Last Updated: 2026-05-11

---

## 1. Summary

Create a canonical lifecycle event and callback surface that gives the API parity with the Pi agent extension lifecycle.

The API must capture every lifecycle event emitted by Pi agent extensions, persist and broadcast those events through the existing observability surfaces, and expose enough callback semantics for the API to act on them. The API must also emit equivalent lifecycle events before Pi is involved, including events for session start, job start, step start, first user message, and API-owned orchestration transitions.

Today the API has several event mechanisms, but they are not a unified Pi-style extension pipeline. The current system is strongest at post-fact telemetry, audit, and workflow lifecycle broadcasting. Pi extensions provide richer middleware semantics: hooks can inspect, cancel, mutate, replace, handle, or continue agent operations before they happen.

This epic closes that gap.

---

## 2. Problem Statement

Pi exposes a detailed extension lifecycle with events such as `session_start`, `input`, `before_agent_start`, `turn_start`, `message_start`, `tool_call`, `tool_result`, `context`, and provider request/response hooks. Several of these hooks are actionable: they can block, cancel, transform input, mutate tool arguments, modify tool results, replace context messages, or replace provider payloads.

The API currently receives a subset of agent runtime events, mostly after the operation has already happened. It has workflow lifecycle events, Redis telemetry streams, and a durable event ledger, but no single canonical lifecycle vocabulary shared with Pi and no general callback dispatcher that can apply Pi-style decisions.

This creates four product and architecture gaps:

1. Agent activity is not captured with the same granularity that Pi extension authors see locally.
2. API workflows cannot reliably react to every agent/session/tool/model lifecycle transition.
3. API policy cannot consistently block or mutate operations at the same points Pi can.
4. API-owned activity before Pi starts, such as sending the first message or starting a workflow job, does not produce the same lifecycle events as Pi-owned activity.

---

## 3. Current State Analysis

The API currently has three separate event layers.

### 3.1 NestJS In-Process Event Bus

The workflow engine uses `@nestjs/event-emitter` for internal lifecycle events. Canonical constants live in `apps/api/src/workflow/workflow-events.constants.ts`.

Supported run-level constants:

1. `WORKFLOW_RUN_STARTED_EVENT = 'workflow.run.started'`
2. `WORKFLOW_RUN_COMPLETED_EVENT = 'workflow.run.completed'`
3. `WORKFLOW_RUN_FAILED_EVENT = 'workflow.run.failed'`
4. `WORKFLOW_RUN_CANCELLED_EVENT = 'workflow.run.cancelled'`
5. `WORKFLOW_RUN_PAUSED_EVENT = 'workflow.run.paused'`
6. `WORKFLOW_RUN_RESUMED_EVENT = 'workflow.run.resumed'`

Supported job-level constants:

1. `WORKFLOW_JOB_QUEUED_EVENT = 'workflow.job.queued'`
2. `WORKFLOW_JOB_STARTED_EVENT = 'workflow.job.started'`
3. `WORKFLOW_JOB_COMPLETED_EVENT = 'workflow.job.completed'`
4. `WORKFLOW_JOB_FAILED_EVENT = 'workflow.job.failed'`
5. `WORKFLOW_RUN_RETRY_SCHEDULED_EVENT = 'workflow.run.retry-scheduled'`
6. `WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT = 'workflow.run.activated-from-queue'`

Internal core lifecycle bus:

1. `WORKFLOW_CORE_LIFECYCLE_EVENT = 'workflow.core.lifecycle'`

Payload types are defined in `apps/api/src/workflow/workflow-events.types.ts`:

1. `WorkflowRunEvent`: `workflowRunId`, `workflowId`, `status`, `stateVariables`, optional `triggerData`, optional `reason`.
2. `WorkflowJobEvent`: `workflowRunId`, optional `workflowId`, `jobId`, optional `output`, optional `reason`, optional `payload`.
3. `WorkflowCoreLifecycleEvent`: `runId`, `workflowId`, and `envelope` where envelope is `CoreWorkflowRunEventEnvelopeV1Shape`.

Known in-process emitters:

1. `apps/api/src/workflow/workflow-engine.service.ts` emits run started, completed, cancelled, paused, and resumed events.
2. `apps/api/src/workflow/workflow-run-job-execution.service.ts` emits job completed and job queued events.
3. `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts` emits retry scheduled events.
4. `apps/api/src/workflow/workflow-run-job-execution.utils.ts` emits run activated from queue events.

Important gap: `WORKFLOW_JOB_STARTED_EVENT` exists, and the core schema supports `core.workflow.step.started.v1`, but no production emitter/listener path was found for the started event. `WORKFLOW_JOB_FAILED_EVENT` exists and has listeners, but the investigation did not find a production emitter in the searched workflow area.

Important listeners discovered:

1. `workflow/listeners/workflow-core-lifecycle-stream.listener.ts` maps workflow events to durable core workflow envelopes.
2. `workflow/listeners/workflow-audit.listener.ts` listens to run/job lifecycle, retry scheduled, activated from queue, and core lifecycle events.
3. `workflow/listeners/workflow-telemetry.listener.ts` listens to run started, completed, failed, and cancelled.
4. `workflow/listeners/workflow-redis-publisher.listener.ts` listens to run started, completed, failed, cancelled, paused, and resumed.
5. `workflow/workflow-run-operations/workflow-run-browser-session-cleanup.listener.ts` listens to run completed, failed, and cancelled.
6. Repair listeners listen to run failed/completed and repair delegation completed.
7. Automation listeners listen to run lifecycle in scheduled job, heartbeat, and automation hook flows.
8. `settings/telegram-tool-approval-notifier.service.ts` listens to literal `tool_call.approval_required`.
9. `session/chat-session-context-refresh.listener.ts` listens to `chat_context.refresh_session` and `chat_context.refresh_project`.
10. Notification producers listen to workflow failures, `tool_call.approval_required`, and `orchestration_action.pending`.

The API also has a generic workflow trigger bridge in `apps/api/src/workflow/workflow-event-trigger.service.ts`. It registers EventEmitter listeners for active workflows with YAML `trigger.type === 'event'`. This is the closest existing API callback mechanism, but it only reacts to in-process NestJS events and does not provide Pi-style interception/mutation semantics.

### 3.2 Redis Telemetry Stream and Pub/Sub

The API persists and broadcasts runtime telemetry using `RedisStreamService.persistEvent` and `RedisPubSubService.publishEvent`.

The primary inbound agent surface is `apps/api/src/telemetry/telemetry.gateway.ts`, which handles WebSocket messages and bridge actions from agent clients.

Supported inbound runtime events:

1. `agent_telemetry`
2. `tool_execution_start`
3. `tool_execution_update`
4. `tool_execution_end`
5. `agent_error`
6. `step_complete`
7. `user_questions_posed`
8. `turn_end`
9. `agent_end`

Supported runtime control actions:

1. `spawn_subagent_async`
2. `wait_for_subagents`
3. `check_subagent_status`

Outbound commands the gateway can send to active agents:

1. `prompt`
2. `abort`
3. `question_response`
4. `dehydrate`

Other Redis `event_type` values found across `apps/api/src` include:

1. Runtime and agent events: `agent_runtime_ready`, `agent_telemetry`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `turn_end`, `agent_end`, `agent_error`, `step_complete`, `step_complete_denied`, `user_questions_posed`.
2. User and steering events: `user_message`, `user_message_delivery_failed`, `user_question_answers`, `workflow_control`.
3. Chat events: `assistant_message`, `user_message`, `user_question_answers`, `chat_participant_invited`, `chat_participant_activated`, `chat_participant_invite_denied`, `telegram_command`.
4. Core durable envelopes: `core.workflow.run.requested.v1`, `core.workflow.run.accepted.v1`, `core.workflow.run.status_changed.v1`, `core.workflow.run.completed.v1`, `core.workflow.step.queued.v1`, `core.workflow.step.completed.v1`, `core.workflow.step.failed.v1`, `core.workflow.step.retry_scheduled.v1`.
5. Subagent and mesh events: `agent_mention_requested`, `agent_mention_received`, `agent_mention_denied`, `agent_thread_resolved`.
6. War room events: `war_room_opened`, `war_room_message_posted`, `war_room_blackboard_updated`, `war_room_signoff_submitted`, `war_room_consensus_reached`, `war_room_deadlocked`, `war_room_tie_break_applied`, `war_room_participant_invited`, `war_room_closed`.
7. Session and context events: `context_injected`, `context_refreshed`.
8. Process output event: `bash_output` via `StepEventPublisherService`.

The string `job_start` appears in tests or references, but no production `event_type: 'job_start'` path was found during the investigation.

### 3.3 Durable Event Ledger

The durable audit layer is implemented by `apps/api/src/observability/event-ledger.service.ts` and exposed by `apps/api/src/observability/event-ledger.controller.ts`.

Capabilities:

1. `emit(params)`
2. `emitBestEffort(params)`
3. `getById(id)`
4. `getByCorrelationId(correlationId, limit, offset)`
5. `query(query)`

The controller exposes:

1. `GET /events`
2. `GET /events/correlation/:correlationId`
3. `POST /events/internal`
4. `GET /events/:id`

`POST /events/internal` is guarded by `InternalServiceScopeGuard`, `JwtAuthGuard`, and `RolesGuard`, and requires the `core.events:write` scope. It accepts arbitrary `domain` and `eventName` values through `emitInternalEventLedgerSchema`.

The event ledger supports these common dimensions:

1. `domain`
2. `eventName`
3. `outcome`: `success`, `failure`, `denied`, or `in_progress`
4. Optional `severity`: `info`, `warn`, `error`, or `critical`
5. `source`
6. `actorType`: `user`, `agent`, or `system`
7. `actorId`
8. `context`: `scopeId`, `contextId`, `contextType`
9. `workflowId`
10. `workflowRunId`
11. `jobId`
12. `stepId`
13. `toolId`
14. `toolName`
15. `subagentExecutionId`
16. `sessionTreeId`
17. `requestId`
18. `correlationId`
19. `parentEventId`
20. `payload`
21. `errorCode`
22. `errorMessage`

Severity is inferred when omitted: `failure` becomes `error`, `denied` becomes `warn`, and other outcomes become `info`. Payload and error fields are redacted and truncated by the service.

Important limitation: generic event ledger ingest does not currently trigger workflow EventEmitter listeners or Redis telemetry broadcasts. It records events, but it is not a callback bus by itself.

### 3.4 Core Event Envelope Schemas

Core event envelope schemas live in `packages/core/src/schemas/events/event-envelope.schema.ts`.

Core workflow event types:

1. `core.workflow.run.requested.v1`
2. `core.workflow.run.accepted.v1`
3. `core.workflow.run.status_changed.v1`
4. `core.workflow.run.completed.v1`
5. `core.workflow.step.queued.v1`
6. `core.workflow.step.started.v1`
7. `core.workflow.step.completed.v1`
8. `core.workflow.step.failed.v1`
9. `core.workflow.step.retry_scheduled.v1`

Chat message event types:

1. `chat.message.received.v1`
2. `chat.message.sent.v1`

Chat session event types:

1. `chat.session.created.v1`
2. `chat.session.status_changed.v1`

Chat memory event types:

1. `chat.memory.promoted.v1`
2. `chat.memory.updated.v1`

Source services:

1. `core`
2. `kanban`
3. `chat`

`workflow-core-lifecycle-stream.listener.ts` maps current workflow events as follows:

1. `workflow.run.started`, `workflow.run.failed`, `workflow.run.cancelled`, `workflow.run.paused`, and `workflow.run.resumed` map to `core.workflow.run.status_changed.v1`.
2. `workflow.run.completed` maps to `core.workflow.run.completed.v1`.
3. `workflow.job.queued` maps to `core.workflow.step.queued.v1`.
4. `workflow.job.completed` maps to `core.workflow.step.completed.v1`.
5. `workflow.job.failed` maps to `core.workflow.step.failed.v1`.
6. `workflow.run.retry-scheduled` maps to `core.workflow.step.retry_scheduled.v1`.

It does not currently listen to `WORKFLOW_JOB_STARTED_EVENT`, even though the schema supports `core.workflow.step.started.v1`.

### 3.5 Workflow Runtime REST Callbacks

The workflow runtime has REST callback-style endpoints in `apps/api/src/workflow/workflow-runtime/workflow-runtime-lifecycle.controller.ts` and `apps/api/src/workflow/workflow-runtime/workflow-runtime-step-complete.controller.ts`.

Important endpoints:

1. `POST /workflow-runtime/jobs/set-output`
2. `POST /workflow-runtime/get-capabilities`
3. `POST /workflow-runtime/query-memory`
4. `POST /workflow-runtime/get-todo-list`
5. `POST /workflow-runtime/manage-todo-list`
6. `POST /workflow-runtime/get-agent-profiles`
7. `POST /workflow-runtime/get-agent-profile`
8. `POST /workflow-runtime/list-agent-profile-names`
9. Governance/capability lifecycle endpoints for tool candidates, skills, files, and profile skill assignments.
10. `POST /workflow-runtime/orchestration/invoke-agent-workflow`
11. `POST /workflow-runtime/yield-session`
12. `POST /workflow-runtime/list-path`
13. `POST /workflow-runtime/update-orchestration-state`
14. `POST /workflow-runtime/check-permission`
15. `POST /workflow-runtime/step-complete`

These are agent-facing runtime capabilities, not a complete Pi lifecycle callback surface.

### 3.6 Workflow Run Steering

`apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts` supports API-to-agent steering.

Important behavior:

1. `injectMessage(workflowRunId, message)` publishes Redis `user_message`, sends a prompt command to an active agent when possible, resumes a saved session when possible, otherwise publishes `user_message_delivery_failed`, appends a workflow event log entry, and throws conflict.
2. `submitQuestionAnswers(workflowRunId, answers)` publishes Redis `user_question_answers`, emits `USER_QUESTIONS_ANSWERED_EVENT`, appends workflow event log `user_questions.answered`, and sends a `question_response` command or resumes saved session.
3. `abort` publishes `workflow_control` with action `abort` after cancellation.

Important gap: injecting the first message before Pi is involved does not currently produce a canonical `session_start` lifecycle event.

---

## 4. Pi Lifecycle Event Inventory

The source lifecycle reference is `docs/research/pi-agent-extensions.md`.

### 4.1 Resource Events

1. `resources_discover`: fired after `session_start`; extensions can contribute skill, prompt, and theme paths.

### 4.2 Session Events

1. `session_start`: fired when a session starts, loads, or reloads. Reasons include `startup`, `reload`, `new`, `resume`, and `fork`.
2. `session_before_switch`: fired before `/new` or `/resume`; can cancel.
3. `session_before_fork`: fired before `/fork` or `/clone`; can cancel.
4. `session_before_compact`: fired before compaction; can cancel or customize compaction.
5. `session_compact`: fired after compaction.
6. `session_before_tree`: fired before tree navigation; can cancel or customize summary.
7. `session_tree`: fired after tree navigation.
8. `session_shutdown`: fired before extension runtime teardown.

### 4.3 Agent Events

1. `before_agent_start`: fired after user prompt submission and before the agent loop; can inject a persistent message and/or modify the system prompt.
2. `agent_start`: fired once per user prompt.
3. `agent_end`: fired once per user prompt with messages from the prompt.
4. `turn_start`: fired for each LLM response/tool-call turn.
5. `turn_end`: fired at the end of each turn with turn index, message, and tool results.
6. `message_start`: fired for user, assistant, and tool-result messages.
7. `message_update`: fired for assistant streaming updates.
8. `message_end`: fired when a message finalizes; handlers can replace the finalized message while preserving role.
9. `tool_execution_start`: fired for tool execution lifecycle start.
10. `tool_execution_update`: fired for partial tool output.
11. `tool_execution_end`: fired when tool execution finalizes.
12. `context`: fired before each LLM call; can modify messages non-destructively.
13. `before_provider_request`: fired after provider payload construction and before request send; can replace provider payload.
14. `after_provider_response`: fired after HTTP response receipt and before stream consumption.

### 4.4 Model Events

1. `model_select`: fired when active model changes through command, cycling, or session restore.
2. `thinking_level_select`: fired when thinking level changes; notification-only.

### 4.5 Tool Events

1. `tool_call`: fired after `tool_execution_start` and before execution; can mutate input and block execution.
2. `tool_result`: fired after tool execution and before `tool_execution_end`; can modify result content, details, or error state.

### 4.6 User Bash Events

1. `user_bash`: fired when the user executes `!` or `!!` shell commands; can intercept or replace operations.

### 4.7 Input Events

1. `input`: fired when user input is received, after extension commands and before skill/template expansion. It can continue, transform, or handle input.

---

## 5. Current Support Matrix

| Pi or Equivalent Event | Current API Support | Notes |
| --- | --- | --- |
| `resources_discover` | Missing | No first-class resource discovery lifecycle event was found. |
| `session_start` | Partial | `chat.session.created.v1`, `chat.session.status_changed.v1`, and `agent_runtime_ready` exist, but there is no unified Pi-style `session_start`. |
| `session_before_switch` | Missing | No cancelable API callback found. |
| `session_before_fork` | Missing | No cancelable API callback found. |
| `session_before_compact` | Missing | No cancel/customize callback found. |
| `session_compact` | Missing | Session hydration may persist trees, but no lifecycle event was found. |
| `session_before_tree` | Missing | No cancel/customize callback found. |
| `session_tree` | Missing | No lifecycle event found. |
| `session_shutdown` | Missing/Partial | Agent disconnect and dehydrate flows exist, but no canonical lifecycle event was found. |
| `input` | Missing/Partial | `user_message` exists, but no pre-expansion continue/transform/handled callback exists. |
| `before_agent_start` | Missing | No API callback that injects persistent message or modifies system prompt before Pi agent loop. |
| `agent_start` | Missing/Partial | `agent_runtime_ready` exists, but no once-per-user-prompt `agent_start` callback was found. |
| `agent_end` | Supported | WebSocket inbound event exists and records `workflow.agent.completed`. |
| `turn_start` | Missing | No inbound or API-generated event found. |
| `turn_end` | Supported | WebSocket inbound event exists and records `workflow.turn.completed`. |
| `message_start` | Missing/Partial | Chat/user/assistant events exist, but no lifecycle start callback found. |
| `message_update` | Missing/Partial | Assistant streaming may be represented elsewhere, but no canonical Pi lifecycle event found. |
| `message_end` | Missing/Partial | Final messages may be persisted, but no replaceable callback found. |
| `tool_execution_start` | Supported | WebSocket inbound event exists and records `tool.execution.started`. |
| `tool_execution_update` | Supported | WebSocket inbound event exists and records `tool.execution.updated`. |
| `tool_execution_end` | Supported | WebSocket inbound event exists and records `tool.execution.completed`. |
| `tool_call` | Partial | `tool_call.approval_required` and `check-permission` exist, but no general mutate/block callback parity. |
| `tool_result` | Missing/Partial | Tool completion telemetry exists, but no result mutation callback parity. |
| `context` | Missing/Partial | `context_injected` and `context_refreshed` exist, but no pre-LLM message mutation callback parity. |
| `before_provider_request` | Missing | No provider payload replacement callback found. |
| `after_provider_response` | Missing | No provider response callback found. |
| `model_select` | Missing/Partial | Provider/model configuration exists, but no lifecycle notification found. |
| `thinking_level_select` | Missing | No lifecycle notification found. |
| `user_bash` | Missing/Partial | `bash_output` exists, but no intercept/replace operation callback parity. |
| API `job_start` / `step_start` | Partial/Missing | Constants/schema exist, but no production emitter/listener path was found. |

---

## 6. Goals

1. Define a shared lifecycle event vocabulary across `packages/core`, `apps/api`, and Pi-facing runner/adapter code.
2. Capture every Pi lifecycle event in the API with correlation metadata, session identity, workflow identity, job identity, step identity, actor identity, and parent event linkage where available.
3. Persist captured lifecycle events to `event_ledger` with redaction and bounded payload handling.
4. Broadcast lifecycle events to Redis telemetry stream/pubsub for live UI/runtime consumers.
5. Bridge selected lifecycle events into the NestJS EventEmitter so event-triggered workflows can react.
6. Add API-generated lifecycle equivalents for activity that starts before Pi is running, especially `session_start`, `input`, `agent_start`, `job_start`, `step_start`, `turn_start`, `message_start`, `message_update`, and `message_end`.
7. Add a callback dispatcher for lifecycle events that need decisions, including continue, transform, handled, cancel, block, mutate, replace, and approve/deny outcomes.
8. Preserve existing telemetry/event-ledger/workflow lifecycle behavior while adding the canonical lifecycle layer.
9. Make lifecycle event delivery observable, testable, replayable where appropriate, and safe under duplicate delivery.

---

## 7. Non-Goals

1. Do not replace the existing event ledger with Redis streams or the NestJS EventEmitter.
2. Do not make every lifecycle event synchronous or blocking.
3. Do not expose provider secrets, prompt secrets, or sensitive tool arguments in raw lifecycle payloads.
4. Do not require external services to subscribe to every lifecycle event.
5. Do not rebuild the full session/message persistence model beyond the minimum needed for lifecycle parity; broader model work belongs to EPIC-139.
6. Do not couple lifecycle event names to a specific UI, external projection, or kanban concept.

---

## 8. Proposed Architecture

### 8.1 Canonical Lifecycle Contract

Add a canonical lifecycle event schema in `packages/core`. The schema should cover Pi-originated and API-originated lifecycle events.

Recommended top-level fields:

1. `eventId`
2. `eventType`
3. `version`
4. `occurredAt`
5. `source`: `api`, `pi`, `pi-runner`, `workflow-runtime`, `chat`, or another registered producer.
6. `correlationId`
7. `parentEventId`
8. `actor`: type and ID.
9. `scope`: project/workspace/session/workflow context.
10. `workflowId`
11. `workflowRunId`
12. `jobId`
13. `stepId`
14. `sessionId`
15. `sessionTreeId`
16. `agentId`
17. `turnId` or `turnIndex`
18. `messageId`
19. `toolCallId`
20. `toolName`
21. `payload`
22. `redactionSummary`

The schema should distinguish notification events from decision events. Notification events are fire-and-forget. Decision events require a bounded synchronous response.

### 8.2 Lifecycle Ingest

Add a lifecycle ingest surface for Pi-originated events.

Recommended transports:

1. WebSocket event through `TelemetryGateway` for active agent runtimes.
2. REST fallback endpoint for runtime clients that cannot use the socket bridge.
3. Internal service endpoint for trusted service-to-service lifecycle emission.

The ingest path should:

1. Validate event shape using shared schemas.
2. Normalize Pi event names into canonical API event types without losing the original Pi event name.
3. Attach authenticated actor/source information.
4. Redact or summarize sensitive fields before durable persistence.
5. Persist to `event_ledger`.
6. Broadcast to Redis telemetry.
7. Optionally emit an in-process NestJS event for configured lifecycle event types.

### 8.3 API-Generated Lifecycle Events

Add lifecycle event emission at API-owned boundaries before Pi is involved.

Required API-generated events:

1. `session_start` equivalent when an API chat/workflow session is created, resumed, forked, or hydrated.
2. `input` equivalent when user input enters the API through web, Telegram, workflow steering, or another ingress path.
3. `message_start`, `message_update`, and `message_end` equivalents for user and assistant message lifecycle where the API owns the stream.
4. `agent_start` equivalent when the API accepts a prompt for execution, even if Pi has not connected yet.
5. `job_start` / `step_start` equivalent when workflow job execution begins.
6. `turn_start` equivalent when a turn starts in API-owned orchestration or when the runner reports it.
7. `session_shutdown` equivalent when the API tears down, dehydrates, or marks a session inactive.

This work must close the known gap around `WORKFLOW_JOB_STARTED_EVENT` and `core.workflow.step.started.v1`.

### 8.4 Callback Dispatcher

Add a callback dispatcher for events that require a decision.

Decision-capable Pi events:

1. `input`: continue, transform, or handled.
2. `before_agent_start`: inject message and/or modify system prompt.
3. `message_end`: replace finalized message while preserving role.
4. `tool_call`: block and/or mutate input.
5. `tool_result`: modify result content, details, or error state.
6. `context`: replace message context before LLM call.
7. `before_provider_request`: replace provider payload.
8. `session_before_switch`: cancel.
9. `session_before_fork`: cancel.
10. `session_before_compact`: cancel or customize.
11. `session_before_tree`: cancel or customize.
12. `user_bash`: intercept or replace operation.

The dispatcher should support:

1. Ordered callback execution.
2. Timeout and fail-closed/fail-open policy per event type.
3. Decision audit in `event_ledger`.
4. Correlation between the original lifecycle event and decision events.
5. Redaction-aware payload passing.
6. Deterministic behavior when multiple callbacks mutate the same payload.
7. Explicit unsupported semantics for events that are notification-only.

### 8.5 Workflow Trigger Bridge

Bridge selected lifecycle events to `WorkflowEventTriggerService` so workflows can use `trigger.type: event` against canonical lifecycle names.

The bridge should not emit every raw lifecycle event by default. It should use an allowlist or typed routing table to avoid accidental high-volume workflow storms.

Initial bridge candidates:

1. `session_start`
2. `agent_start`
3. `agent_end`
4. `turn_start`
5. `turn_end`
6. `tool_call`
7. `tool_result`
8. `tool_execution_start`
9. `tool_execution_end`
10. `workflow.step.started`
11. `workflow.step.failed`

### 8.6 Observability and Replay

Lifecycle events should be visible through the existing event ledger and telemetry paths.

Required observability:

1. Query lifecycle events by correlation ID.
2. Query lifecycle events by workflow run ID.
3. Query lifecycle events by session/session tree ID.
4. Query lifecycle events by tool call ID.
5. Show whether an event was notification-only or decision-capable.
6. Show callback decisions, timeouts, denials, and mutations without leaking sensitive payloads.
7. Provide metrics for ingest count, callback latency, callback timeout count, callback denial count, callback mutation count, and lifecycle bridge fanout failures.

---

## 9. Implementation Slices

### Slice A: Shared Lifecycle Event Vocabulary

1. Add shared lifecycle event schemas to `packages/core`.
2. Include Pi lifecycle names and API-owned equivalents.
3. Add typed payload schemas for high-value events first: session, input, agent, turn, message, tool, workflow step, and provider hooks.
4. Define redaction rules for sensitive fields.
5. Add contract tests for schema compatibility.

### Slice B: Lifecycle Ingest Path

1. Add WebSocket lifecycle ingest to `apps/api/src/telemetry/telemetry.gateway.ts` or a focused lifecycle gateway.
2. Add REST fallback endpoint for internal runtime clients.
3. Normalize Pi-originated events into the shared lifecycle envelope.
4. Persist normalized events to `event_ledger`.
5. Broadcast normalized events to Redis stream/pubsub.
6. Add tests for valid events, invalid events, redaction, authentication failure, and duplicate delivery.

### Slice C: API-Owned Lifecycle Emission

1. Emit `session_start` equivalent from chat/session/workflow session creation and resume paths.
2. Emit `input` equivalent from user ingress paths, including workflow steering message injection.
3. Emit `agent_start` equivalent when the API accepts a prompt for execution.
4. Emit `message_start`, `message_update`, and `message_end` equivalents where the API owns message persistence or streaming.
5. Emit `WORKFLOW_JOB_STARTED_EVENT` when workflow job execution actually starts.
6. Add `WORKFLOW_JOB_STARTED_EVENT` mapping to `core.workflow.step.started.v1` in `workflow-core-lifecycle-stream.listener.ts`.
7. Verify `WORKFLOW_JOB_FAILED_EVENT` has a production emitter and add one if absent.

### Slice D: Pi Runner/Adapter Event Forwarding

1. Forward all Pi lifecycle notifications to the API.
2. Preserve Pi event name, reason/source fields, and lifecycle ordering where available.
3. Attach workflow run, job, step, session, and correlation metadata from the runner context.
4. Add backpressure and bounded retry behavior.
5. Ensure terminal events flush before dehydrate/shutdown completion.

### Slice E: Decision Callback Dispatcher

1. Add callback contracts for decision-capable lifecycle events.
2. Implement callback registration/routing in the API.
3. Define per-event timeout behavior and fail-open/fail-closed defaults.
4. Implement `tool_call` block/mutate semantics.
5. Implement `tool_result` mutation semantics.
6. Implement `input` continue/transform/handled semantics.
7. Implement `before_agent_start` message injection/system prompt mutation semantics.
8. Implement `context` and `before_provider_request` replacement semantics only after redaction and security review.
9. Add event ledger records for decisions and mutations.

### Slice F: Workflow Trigger Integration

1. Add a typed lifecycle-to-EventEmitter bridge.
2. Allow event-triggered workflows to subscribe to selected canonical lifecycle events.
3. Add routing controls to avoid high-volume event storms.
4. Add tests proving lifecycle events can trigger workflows with expected trigger data.

### Slice G: UI and Diagnostics

1. Expose lifecycle timeline query support using existing event ledger APIs or a focused lifecycle query facade.
2. Surface callback decisions and denials in run/session diagnostics.
3. Add operator-facing metrics for lifecycle ingest, fanout, and callback latency.
4. Add troubleshooting documentation.

---

## 10. Deliverables

1. Shared lifecycle event schema package updates in `packages/core`.
2. API lifecycle ingest surface for Pi-originated lifecycle events.
3. API lifecycle event normalizer and router.
4. Event ledger persistence for canonical lifecycle events.
5. Redis telemetry publishing for canonical lifecycle events.
6. API-generated `session_start`, `input`, `agent_start`, `job_start` / `step_start`, `turn_start`, and message lifecycle events.
7. Working `WORKFLOW_JOB_STARTED_EVENT` emitter and `core.workflow.step.started.v1` stream mapping.
8. Verified production `WORKFLOW_JOB_FAILED_EVENT` emission path.
9. Pi runner/adapter forwarding for every Pi lifecycle event listed in `docs/research/pi-agent-extensions.md`.
10. Decision callback dispatcher for at least `input`, `before_agent_start`, `tool_call`, and `tool_result`.
11. Lifecycle-to-workflow trigger bridge for selected event types.
12. Tests covering schema validation, ingest, persistence, telemetry, workflow trigger bridge, callback decisions, timeouts, and redaction.
13. Documentation for lifecycle event names, payloads, callback semantics, and unsupported/deferred semantics.

---

## 11. Acceptance Criteria

1. Every Pi lifecycle event listed in `docs/research/pi-agent-extensions.md` can be sent to the API and accepted through a typed lifecycle ingest contract.
2. Every accepted lifecycle event is persisted to `event_ledger` with correlation metadata and redacted payload fields.
3. Every accepted lifecycle event is broadcast to Redis telemetry with a canonical event type and original Pi event name.
4. API-originated session creation and first-message flows emit a `session_start` equivalent before Pi is involved.
5. Workflow job execution emits a `job_start` / `step_start` equivalent when execution begins.
6. `core.workflow.step.started.v1` is emitted for started workflow jobs.
7. Event-triggered workflows can subscribe to selected canonical lifecycle events.
8. `tool_call` callbacks can block execution and can mutate tool input before execution.
9. `tool_result` callbacks can modify tool results before finalization.
10. `input` callbacks can continue, transform, or handle input before normal agent processing.
11. `before_agent_start` callbacks can inject an additional message and/or modify the system prompt before agent execution.
12. Callback decisions are bounded by timeout and have explicit fail-open/fail-closed behavior.
13. Sensitive provider payloads, tool arguments, and prompt content are redacted or summarized according to documented policy.
14. Duplicate lifecycle event delivery does not corrupt durable state or trigger duplicate non-idempotent callback decisions.
15. Existing telemetry events and workflow lifecycle listeners remain backward compatible unless a migration plan explicitly replaces them.

---

## 12. Suggested Quality Gates

1. `npm run build --workspace=packages/core`
2. `npm run test --workspace=packages/core`
3. `npm run test:api`
4. Focused API tests for lifecycle ingest, event ledger persistence, Redis telemetry publishing, and workflow trigger bridge.
5. Focused runner/adapter tests for forwarding every Pi lifecycle event.
6. Contract tests proving API and runner share the same lifecycle schema.
7. Security tests for redaction of provider payloads, prompts, tool arguments, and tool results.
8. Callback timeout tests for fail-open and fail-closed policies.
9. Idempotency tests for duplicate lifecycle event delivery.
10. Regression test proving `WORKFLOW_JOB_STARTED_EVENT` maps to `core.workflow.step.started.v1`.

---

## 13. Risks and Mitigations

1. Risk: lifecycle event volume overwhelms Redis streams or UI consumers.
   Mitigation: add routing controls, payload bounds, sampling for high-volume updates, and consumer-specific filters.

2. Risk: callback dispatch introduces latency into agent execution.
   Mitigation: make notification events asynchronous, add per-event timeouts, and restrict synchronous callbacks to decision-capable events.

3. Risk: callback mutation semantics become non-deterministic when several callbacks mutate the same payload.
   Mitigation: define explicit callback ordering, chain mutations deterministically, and audit each mutation decision.

4. Risk: provider payload and context hooks leak sensitive prompt or credential data.
   Mitigation: use strict redaction, limit stored payloads, and require security review before enabling provider-level replacement hooks.

5. Risk: bridging all lifecycle events to workflow triggers creates event storms.
   Mitigation: use an allowlist, per-event rate limits, and explicit workflow trigger registration.

6. Risk: existing telemetry consumers rely on old `event_type` names.
   Mitigation: preserve existing events and add canonical lifecycle events alongside them until consumers are migrated.

7. Risk: Pi and API lifecycle vocabularies drift.
   Mitigation: keep schemas in `packages/core`, add contract tests, and document versioned event semantics.

---

## 14. Open Questions

1. Should the canonical public event names preserve Pi names exactly, or should Pi names be mapped into a namespaced API vocabulary such as `agent.session.started.v1` while retaining `originalEventName`?
2. Which callback decisions should be fail-closed by default? `tool_call` and provider payload hooks likely need stricter defaults than message telemetry.
3. Should decision callbacks be implemented as internal workflow actions, registered policy handlers, external webhook callbacks, or all three?
4. How much provider request/response payload can be safely retained for debugging without violating prompt/privacy expectations?
5. Should `message_update` events be sampled or compacted before persistence to avoid high write volume?
6. Should lifecycle event replay re-trigger workflows, or should replay be read-model only by default?
7. How should this epic coordinate with EPIC-139 if session IDs and message IDs are not yet fully unified?

---

## 15. References

1. `docs/research/pi-agent-extensions.md`
2. `apps/api/src/workflow/workflow-events.constants.ts`
3. `apps/api/src/workflow/workflow-events.types.ts`
4. `apps/api/src/workflow/workflow-engine.service.ts`
5. `apps/api/src/workflow/workflow-run-job-execution.service.ts`
6. `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts`
7. `apps/api/src/workflow/workflow-run-job-execution.utils.ts`
8. `apps/api/src/workflow/workflow-event-trigger.service.ts`
9. `apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.ts`
10. `apps/api/src/workflow/listeners/workflow-audit.listener.ts`
11. `apps/api/src/workflow/listeners/workflow-telemetry.listener.ts`
12. `apps/api/src/workflow/listeners/workflow-redis-publisher.listener.ts`
13. `apps/api/src/telemetry/telemetry.gateway.ts`
14. `apps/api/src/observability/event-ledger.service.ts`
15. `apps/api/src/observability/event-ledger.controller.ts`
16. `packages/core/src/schemas/events/event-envelope.schema.ts`
17. `apps/api/src/workflow/workflow-runtime/workflow-runtime-lifecycle.controller.ts`
18. `apps/api/src/workflow/workflow-runtime/workflow-runtime-step-complete.controller.ts`
19. `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts`
20. `apps/api/src/workflow/workflow-step-execution/step-event-publisher.service.ts`
21. `docs/epics/EPIC-018-telemetry-streaming-and-runner-bridge.md`
22. `docs/epics/EPIC-139-unified-agent-session-and-message-model.md`
23. `docs/epics/EPIC-153-core-lifecycle-event-stream-and-external-projections.md`
