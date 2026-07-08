# Epic 007: Real-Time Telemetry & WebSocket Gateway

## Overview

**Epic ID**: 007
**Layer**: Communication
**Status**: Not Started
**Priority**: High (P1)
**Estimated Timeline**: 1 week

## Context

Build the real-time communication hub that connects Pi Agent containers to the Control Plane and UI clients. This bidirectional WebSocket gateway receives telemetry events from agents, persists them to Redis Streams for durability, and broadcasts them to UI clients via namespace-based routing. It also sends control commands (pause, inject_context, resume) from the Control Plane back to agents.

The PiTelemetryGateway is the nervous system of Nexus Core Engine - it provides real-time visibility into agent execution and enables interactive workflows.

## Dependencies

**Upstream Dependencies**:
- Epic 002 (Core Infrastructure) - for Redis Streams and Pub/Sub
- Epic 005 (Workflow Engine) - for workflow context and routing

**Downstream Dependencies**:
- Epic 010 (Pi Agent Integration) - agents connect to this gateway
- Epic 013 (Observability) - consumes telemetry for metrics

## Scope

### Included in This Epic

- **PiTelemetryGateway (Socket.io Server)**
  - WebSocket server setup and configuration
  - Connection management (authentication, lifecycle)
  - Namespace management (/ui/kanban, /ui/assistant, /agent)
  - Event routing and broadcasting

- **Agent → Gateway Events (Inbound)**
  - `agent_telemetry`: General execution events (think, tool_use, etc.)
  - `turn_start`: Agent begins reasoning turn
  - `turn_end`: Agent completes turn (with output)
  - `tool_execution_start`: Agent starts tool execution
  - `tool_execution_end`: Tool execution completes

- **Gateway → Agent Commands (Outbound)**
  - `pause`: Send SIGUSR1 to pause agent
  - `inject_context`: Add message to conversation
  - `resume`: Signal to continue from RESUME_NODE_ID

- **Redis Stream Integration**
  - Persist all events to Redis Streams (XADD)
  - Support historical event retrieval (XRANGE)
  - Implement event replay for UI refresh

- **Redis Pub/Sub Integration**
  - Broadcast events to topic channels
  - Subscribe UI clients to relevant channels
  - Support multiple subscribers per channel

- **Namespace-Based Routing**
  - `/agent` namespace for Pi Agent connections
  - `/ui/kanban` namespace for Kanban board UI
  - `/ui/assistant` namespace for chatbot UI
  - Route events to appropriate namespaces based on workflow type

- **WebSocket Authentication**
  - JWT validation for all connections
  - Session binding (link WebSocket to WorkflowRun)
  - Rate limiting per connection

### Out of Scope

- Pi Agent WebSocket client (Epic 010)
- UI client implementation (separate frontend project)
- Workflow execution logic (Epic 005)
- Session hydration (Epic 006)
- Advanced analytics on telemetry (Epic 013)

## Tasks

### Socket.io Server Setup
- [ ] Install socket.io package
- [ ] Create PiTelemetryGateway module
- [ ] Configure Socket.io server
  - Port: 3001 (separate from REST API)
  - CORS configuration
  - Transport: WebSocket + polling fallback
- [ ] Set up namespaces (/agent, /ui/kanban, /ui/assistant)
- [ ] Add connection logging
- [ ] Test basic WebSocket connectivity with socket.io client

### Connection Management
- [ ] Implement connection handler
  - Log connection with client ID and IP
  - Track active connections (in-memory Map or Redis)
- [ ] Implement disconnection handler
  - Cleanup connection metadata
  - Log disconnection reason
- [ ] Implement reconnection handling
  - Preserve session on reconnect
  - Resume event stream from last received event
- [ ] Add connection timeout (30 seconds for handshake)
- [ ] Test connection lifecycle (connect, reconnect, disconnect)

### WebSocket Authentication
- [ ] Install jsonwebtoken package
- [ ] Create authentication middleware
  - Extract JWT from handshake auth header
  - Validate JWT signature and expiration
  - Attach user/workflow context to socket
- [ ] Implement session binding
  - Link WebSocket connection to WorkflowRun ID
  - Store binding in Redis (session_id → socket_id)
- [ ] Implement rate limiting (100 events/second per connection)
- [ ] Reject unauthenticated connections
- [ ] Test authentication with valid/invalid JWTs

### Agent Event Handlers (Inbound)
- [ ] Implement `agent_telemetry` event handler
  - Receive event payload
  - Validate payload structure
  - Persist to Redis Stream
  - Broadcast to UI namespaces
- [ ] Implement `turn_start` event handler
  - Extract turn metadata
  - Update workflow status (in-memory cache)
  - Broadcast to UI
- [ ] Implement `turn_end` event handler
  - Extract turn output
  - Call WorkflowEngineService.handleStepComplete()
  - Persist final output to database
  - Broadcast completion to UI
- [ ] Implement `tool_execution_start` event handler
  - Log tool execution start
  - Broadcast to UI for real-time progress
- [ ] Implement `tool_execution_end` event handler
  - Log tool execution result
  - Broadcast to UI
- [ ] Add event validation (JSON Schema)
- [ ] Test event handlers with mock agent client

### Control Command Senders (Outbound)
- [ ] Implement sendPauseCommand(agentSocketId) method
  - Emit `pause` event to agent namespace
  - Include pause reason (human review, subagent spawn)
- [ ] Implement sendInjectContext(agentSocketId, message) method
  - Emit `inject_context` event with message
  - Agent adds message to conversation
- [ ] Implement sendResumeCommand(agentSocketId) method
  - Emit `resume` event
  - Signal agent to continue execution
- [ ] Add command acknowledgment (agent confirms receipt)
- [ ] Test commands with mock agent client

### Redis Stream Integration
- [ ] Create RedisStreamService
- [ ] Implement persistEvent(streamKey, event) method
  - Use XADD to append event to stream
  - Stream key format: stream:telemetry:{workflow_run_id}
  - Include timestamp, event type, payload
- [ ] Implement getEventHistory(streamKey, startId, endId) method
  - Use XRANGE to retrieve events
  - Support pagination
  - Return events in chronological order
- [ ] Implement trimStream(streamKey, maxLength) method
  - Use XTRIM to keep stream size manageable
  - Trim to last 10,000 events per workflow
- [ ] Add stream cleanup on workflow completion
- [ ] Test Redis Stream operations

### Redis Pub/Sub Integration
- [ ] Create RedisPubSubService
- [ ] Implement publishEvent(channel, event) method
  - Publish to channel: telemetry:{workflow_run_id}
  - Include full event payload
- [ ] Implement subscribeToChannel(channel, callback) method
  - Subscribe UI clients to relevant channels
  - Call callback on each event
- [ ] Implement unsubscribeFromChannel(channel) method
- [ ] Handle Pub/Sub connection failures
- [ ] Test Pub/Sub with multiple subscribers

### Namespace-Based Routing
- [ ] Implement event routing logic
  - Extract workflow_type from event
  - Route to appropriate UI namespace
  - kanban workflows → /ui/kanban
  - assistant workflows → /ui/assistant
- [ ] Implement namespace broadcast
  - Emit events only to relevant namespace
  - Support wildcard namespaces (broadcast to all)
- [ ] Add namespace-specific authentication
  - UI clients provide workflow_run_id
  - Only receive events for their workflow
- [ ] Test namespace isolation (kanban events don't leak to assistant)

### Event Replay (UI Refresh)
- [ ] Implement replayEvents(workflowRunId, socketId) method
  - Retrieve all events from Redis Stream
  - Send to client sequentially
  - Mark replay complete
- [ ] Add replay on UI connection
  - When UI client connects, replay all events
  - Hydrate UI state from event history
- [ ] Optimize replay for large event streams (pagination)
- [ ] Test replay with 1000+ events

### Error Handling & Resilience
- [ ] Add comprehensive error handling for all event handlers
- [ ] Handle Redis connection failures gracefully
- [ ] Implement event queue for Redis downtime (in-memory buffer)
- [ ] Add circuit breaker for Redis operations
- [ ] Log all errors with context (event type, workflow_run_id)
- [ ] Test error scenarios (Redis down, malformed events)

### Testing & Documentation
- [ ] Write unit tests for event handlers
- [ ] Write unit tests for Redis Stream operations
- [ ] Write integration tests for WebSocket connectivity
  - Mock agent connects and sends events
  - Verify events persisted to Redis Stream
  - Verify events broadcast to UI namespace
- [ ] Write integration tests for authentication
- [ ] Write integration tests for namespace isolation
- [ ] Document WebSocket event protocol
- [ ] Create WebSocket client integration guide
- [ ] Document namespace routing logic

## Key Deliverables

1. **PiTelemetryGateway (Socket.io Server)**
   - Full WebSocket server with namespaces
   - Event routing and broadcasting
   - Authentication and session management

2. **Agent Event Handlers**
   - Handle 5 core event types
   - Validation and persistence
   - Workflow integration

3. **Control Commands**
   - Send pause/resume/inject_context to agents
   - Command acknowledgment

4. **Redis Integration**
   - Stream persistence (XADD)
   - Historical retrieval (XRANGE)
   - Pub/Sub broadcasting

5. **Event Replay System**
   - Replay events on UI connection
   - Hydrate UI state

6. **Documentation**
   - WebSocket protocol reference
   - Client integration guide
   - Namespace routing guide

## Acceptance Criteria

- [ ] WebSocket server accepts connections on port 3001
- [ ] Agent connections to /agent namespace succeed with valid JWT
- [ ] `agent_telemetry` events are received from mock clients
- [ ] Events are persisted to Redis Streams via XADD
- [ ] Stream key format is correct: stream:telemetry:{workflow_run_id}
- [ ] Historical events can be retrieved via XRANGE
- [ ] Events are broadcast to Redis Pub/Sub channels
- [ ] UI clients in /ui/kanban namespace only receive kanban events
- [ ] UI clients in /ui/assistant namespace only receive chatbot events
- [ ] Namespace isolation is enforced (no cross-namespace leaks)
- [ ] `pause` command is sent to agents correctly via WebSocket
- [ ] `inject_context` command adds messages to agent conversation
- [ ] `resume` command signals agent to continue
- [ ] JWT authentication rejects invalid tokens
- [ ] JWT authentication rejects expired tokens
- [ ] Rate limiting blocks clients sending > 100 events/second
- [ ] WebSocket connections are cleaned up on disconnect
- [ ] Event replay sends all historical events to UI on connect
- [ ] Replay completes for streams with 1000+ events in < 5 seconds
- [ ] Unit tests mock Socket.io connections
- [ ] Integration tests use real Redis Streams
- [ ] No memory leaks from unclosed connections (tested with 1000 connections)

## Technical Notes

### Technology Stack
- **WebSocket Library**: socket.io v4+
- **Authentication**: jsonwebtoken
- **Redis**: ioredis (from Epic 002)
- **Validation**: JSON Schema (ajv)

### Socket.io Namespaces
```javascript
const io = new Server(3001, {
  cors: { origin: '*' }
});

const agentNamespace = io.of('/agent');
const kanbanNamespace = io.of('/ui/kanban');
const assistantNamespace = io.of('/ui/assistant');
```

### Event Payload Format
```json
{
  "event_type": "agent_telemetry",
  "workflow_run_id": "wfrun_123",
  "timestamp": "2026-03-22T10:30:00Z",
  "payload": {
    "type": "think",
    "content": "I need to implement the login feature",
    "metadata": {}
  }
}
```

### Redis Stream Structure
```
XADD stream:telemetry:wfrun_123 * \
  event_type agent_telemetry \
  timestamp 2026-03-22T10:30:00Z \
  payload '{"type":"think","content":"..."}'
```

### WebSocket Event Flow
```
Agent Container → WebSocket → PiTelemetryGateway
  → Redis Stream (XADD - persistence)
  → Redis Pub/Sub (PUBLISH - broadcast)
  → UI Clients (WebSocket emit)
```

### Authentication Flow
```
1. Client connects with JWT in auth header
2. Gateway validates JWT signature
3. Extract workflow_run_id from JWT claims
4. Bind socket to workflow_run_id
5. Allow connection
6. On disconnect, cleanup binding
```

### Namespace Routing Logic
```javascript
function routeEvent(event) {
  const workflowType = event.payload.workflow_type;

  if (workflowType === 'kanban') {
    kanbanNamespace.emit('event', event);
  } else if (workflowType === 'assistant') {
    assistantNamespace.emit('event', event);
  }

  // Always send to /agent namespace
  agentNamespace.to(event.workflow_run_id).emit('event', event);
}
```

### Security Considerations
- **JWT Validation**: Verify signature, expiration, and claims
- **Rate Limiting**: Prevent event flooding (100 events/second)
- **Input Validation**: Validate all event payloads (JSON Schema)
- **Namespace Isolation**: Ensure no cross-namespace event leaks
- **Connection Cleanup**: Prevent memory leaks from stale connections

### Testing Strategy
- **Unit Tests**: Event handlers, routing logic
- **Integration Tests**: Real WebSocket connections, Redis operations
- **Load Tests**: 1000 concurrent connections, high event rate
- **Cleanup Tests**: Verify connection cleanup on disconnect

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Redis Stream memory exhaustion | High | Medium | XTRIM streams to max 10,000 events |
| WebSocket connection storms | Medium | Medium | Rate limiting, connection throttling |
| Event payload size too large | Medium | Low | Validate max payload size (1MB) |
| Namespace routing bugs | High | Low | Comprehensive integration tests |
| Memory leaks from unclosed sockets | High | Medium | Connection cleanup, monitoring |

## Parallel Development

**Can Run in Parallel**: PARTIAL (after Epic 002 + Epic 005 complete)
**Can Run Alongside**: Epic 009 (REST API)

## Related ADRs

- Create ADR-018: Socket.io vs. raw WebSocket
- Create ADR-019: Redis Streams vs. Kafka for event persistence
- Create ADR-020: Namespace strategy for multi-tenancy

## Notes

- WebSocket is critical for real-time UX - prioritize reliability
- Redis Streams provide durability (unlike Pub/Sub which is ephemeral)
- Namespace isolation is essential for security
- Event replay enables instant UI hydration on refresh
- Consider adding event compression for large payloads (Epic 013)
- Monitor WebSocket connection count in production
