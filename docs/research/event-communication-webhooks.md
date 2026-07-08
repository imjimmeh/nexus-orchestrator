# Event Communication & Webhooks

Nexus Core is an event-driven platform. It relies on webhooks for external triggers, WebSockets for real-time telemetry, and Redis Streams for durable internal event routing.

## 1. Webhook Ingestion (External -> Control Plane)

The `WorkflowEngineService` exposes a generic webhook endpoint to ingest events from external systems (GitHub, Jira, Linear, custom apps).

### 1.1. Generic Webhook Structure
`POST /webhooks/ingest/:source`

```json
{
  "event": "ticket_updated",
  "payload": {
    "ticket_id": "NX-101",
    "status": "in_progress",
    "repo_url": "https://github.com/org/repo"
  },
  "signature": "sha256=..."
}
```

### 1.2. Workflow Triggering
When a webhook is received:
1.  **Source Identification**: The `:source` determines which security policy to apply (e.g., verifying GitHub HMAC signatures).
2.  **Workflow Lookup**: The engine scans active YAML workflows for matching `trigger` conditions.
3.  **Step Enqueuing**: If a match is found, the engine initializes a `WorkflowRun` in PostgreSQL and pushes the first task to a BullMQ queue (`bull:workflow_steps`).

## 2. Real-time Telemetry (Execution Plane -> UI)

Telemetry from Pi Agents is multiplexed through the `PiTelemetryGateway` (Socket.io) and buffered in Redis Streams for durability and performance.

### 2.1. The Telemetry Sequence
1.  **Pi Runner**: `pi-runner.ts` inside the Docker container emits `agent_telemetry` via a WebSocket client.
2.  **Gateway Gateway**: `PiTelemetryGateway` (NestJS) receives the event and:
    *   Authenticates the container via its `AGENT_JWT`.
    *   Appends the event to a Redis Stream: `stream:telemetry:{session_id}`.
    *   Broadcasts the event to the UI via the `/ui/kanban` or `/ui/assistant` namespace.

### 2.2. Redis Stream Structure
`stream:telemetry:{session_id}` stores events as key-value pairs.

| Event ID | Key: `type` | Key: `payload` | Key: `timestamp` |
| :--- | :--- | :--- | :--- |
| 1711100001-0 | `turn_start` | `{ "agent_id": "..." }` | `2026-03-22T...` |
| 1711100005-0 | `text_delta` | `{ "content": "Initializing..." }` | `2026-03-22T...` |
| 1711100010-0 | `tool_start` | `{ "name": "bash", "args": "ls -la" }` | `2026-03-22T...` |

### 2.3. UI Hydration via `XRANGE`
When a user refreshes the browser, the UI doesn't lose the agent's recent history. The frontend requests all events from the Redis Stream since the last `turn_start` (or from the beginning of the current step) using the `XRANGE` command.

## 3. Internal Event Messaging (Bus/PubSub)

For communication between NestJS services (e.g., `WorkflowEngine` notifying `ContainerManager` to kill a container), Nexus uses Redis Pub/Sub.

### 3.1. Common Internal Events
-   **`workflow.step.completed`**: Emitted by `WorkflowEngine` when a Pi turn ends. Triggers the next step in the DAG.
-   **`container.resource.exceeded`**: Emitted by `ContainerManager` if a container hits its RAM/CPU limit. Triggers an alert or a restart.
-   **`tool.definition.updated`**: Emitted by `ToolRegistryService` when a tool's TypeScript code is updated. Informs the engine to re-scan tools for the next run.

## 4. Telemetry Schema Example

Events emitted by `pi-runner.ts`:

```typescript
interface AgentTelemetryEvent {
  sessionId: string;
  type: 'turn_start' | 'turn_end' | 'text_delta' | 'tool_call' | 'tool_result' | 'error';
  payload: any;
  metadata: {
    containerId: string;
    stepId: string;
    workflowRunId: string;
  };
}
```
