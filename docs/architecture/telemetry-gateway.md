# Telemetry Gateway Architecture

The telemetry gateway provides authenticated realtime communication for workflow runs, active sessions, and agent-to-agent coordination signals.

## Core Responsibilities

1. Authenticate websocket clients and bind them to workflow-run scope.
2. Ingest agent telemetry and persist it for replay.
3. Broadcast realtime updates to subscribed UI clients.
4. Route run-control and answer-injection commands to active containers.
5. Surface mesh communication lifecycle events.

## Main Components

1. TelemetryGateway (Socket.IO server)

- Handles inbound and outbound websocket traffic.
- Validates short-lived JWT tokens scoped to workflowRunId and role.

2. RedisStreamService

- Persists inbound events into stream:telemetry:{runId}.
- Supports history replay for clients that attach after execution has started.

3. RedisPubSubService

- Broadcasts realtime events across nodes for horizontally scaled deployments.

## Auth Flow

1. UI requests GET /workflows/runs/:runId/telemetry-auth.
2. API returns token and wsUrl.
3. Client connects to telemetry gateway with token.
4. Gateway validates token claims and joins run-scoped rooms.

## Event Classes

### Run and Agent Events

Examples:

- turn_start
- turn_end
- agent_telemetry
- tool_execution_start
- tool_execution_end
- user_questions_posed
- user_question_answers
- bash_output
- workflow_control

### Mesh Communication Events (EPIC-054)

Action surface includes:

- mention_agent
- check_agent_mentions
- resolve_agent_thread

Lifecycle event types include:

- agent_mention_requested
- agent_mention_received
- agent_mention_responded
- agent_mention_timeout
- agent_thread_resolved
- agent_mention_denied

These events are emitted into run telemetry streams and can be rendered in orchestration and active-session UI surfaces.

## Control Command Routing

Outbound commands are scoped by run and container/session context.

Common commands:

- pause
- resume
- abort
- inject context/prompt
- submit question answers

The gateway does not make orchestration decisions. It routes commands, records telemetry, and delegates business logic to workflow/project services.

## Durability and Replay

1. Inbound events are appended to Redis Streams before broadcast.
2. UI can request event history from REST run-events endpoint.
3. Realtime stream resumes from live socket after history hydration.

This model supports deterministic reconstruction of run timelines and resilient reconnect behavior.

## Operational Signals and Debugging

When troubleshooting telemetry issues, verify:

1. Auth token claims (workflowRunId, role, expiration).
2. Resolved websocket URL precedence.
3. Redis stream writes and pub/sub delivery.
4. Container session existence for command targets.
5. Event history availability through run-events API.

## Related Docs

- docs/architecture/rest-api.md
- docs/architecture/workflow-engine.md
- docs/architecture/ARCH-kanban-workflow.md
