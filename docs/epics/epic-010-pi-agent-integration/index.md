# Epic 010: Pi Agent Container Integration

## Overview

**Epic ID**: 010
**Layer**: Integration
**Status**: Not Started
**Priority**: Critical (P0)
**Estimated Timeline**: 2 weeks

## Context

Integrate the Pi Agent runtime into the Nexus Core Engine by building container images (Light and Heavy tiers), creating the pi-runner.ts wrapper, and implementing the complete end-to-end workflow execution pipeline. This epic brings together all previous infrastructure (Docker, Session Hydration, Tool Registry, WebSocket) to create a functioning AI agent execution environment.

This is the culmination of all foundation and core service work - it's where Nexus actually runs AI agents.

## Dependencies

**Upstream Dependencies**:

- Epic 003 (Docker Orchestration) - container provisioning
- Epic 006 (Session Hydration) - session state injection
- Epic 004 (Tool Registry) - tool mounting
- Epic 007 (WebSocket Telemetry) - agent communication
- Epic 005 (Workflow Engine) - workflow orchestration

**Downstream Dependencies**:

- Epic 011 (Subagent Orchestration) - builds on this
- Epic 012 (Security & IAM) - hardens this

## Scope

### Included in This Epic

- **Container Image Definitions**
  - Light Container Dockerfile (Alpine + Node.js + Pi Agent)
  - Heavy Container Dockerfile (Ubuntu DevContainer + SDKs + Pi Agent)
  - Multi-stage builds for optimization
  - Image size optimization (<500MB Light, <2GB Heavy)

- **pi-runner.ts Wrapper Script**
  - Pi Agent initialization
  - Load session.jsonl from /app/.pi/agent/
  - Read RESUME_NODE_ID environment variable
  - Connect to WebSocket gateway (PiTelemetryGateway)
  - Auto-discover tools in /app/extensions
  - Emit telemetry events (turn_start, turn_end, agent_telemetry)

- **Volume Mounting Integration**
  - Tool extensions from ToolRegistry (via ToolMountingService)
  - Git repositories for workspace (bind mount)
  - Session JSONL from SessionHydrationService (via Docker putArchive)

- **Environment Variable Injection**
  - API keys (OpenAI, Anthropic, etc.)
  - Configuration (model, temperature, max_tokens)
  - RESUME_NODE_ID for session resumption
  - Workspace paths

- **End-to-End Workflow Execution**
  - WorkflowEngine triggers container provisioning
  - Container executes Pi Agent
  - Agent emits telemetry to WebSocket
  - Agent completes task and emits turn_end
  - Container is killed
  - WorkflowEngine updates status

- **Tool Execution in Containers**
  - Pi Agent discovers tools in /app/extensions
  - Tools execute within container sandbox
  - Tool results returned to agent
  - Tool execution logged via telemetry

### Out of Scope

- Subagent spawning (Epic 011)
- Production security hardening (Epic 012)
- Advanced monitoring (Epic 013)
- Custom Pi Agent modifications (use stock pi-mono)
- Multi-container orchestration (Kubernetes)

## Tasks

### Light Container Dockerfile

- [ ] Create Dockerfile for Light container
  - Base image: node:24-alpine
  - Install Pi Agent (pi-mono package)
  - Install minimal dependencies
  - Create /app directory structure
  - Set up /app/.pi/agent for session state
  - Set up /app/extensions for tools
  - Copy pi-runner.ts into container
  - Set ENTRYPOINT to node pi-runner.ts
- [ ] Optimize image size (<500MB)
  - Use multi-stage build
  - Remove unnecessary files
  - Use .dockerignore
- [ ] Build and test Light container locally
- [ ] Push to container registry (Docker Hub or private)

### Heavy Container Dockerfile

- [ ] Create Dockerfile for Heavy container
  - Base image: mcr.microsoft.com/devcontainers/typescript-node:20
  - Install Pi Agent (pi-mono package)
  - Install development SDKs:
    - git, make, gcc, g++
    - Python 3.11 + pip
    - npm, yarn
  - Install common dev tools (curl, wget, jq)
  - Create /app directory structure
  - Set up /app/.pi/agent for session state
  - Set up /app/extensions for tools
  - Copy pi-runner.ts into container
  - Set ENTRYPOINT to node pi-runner.ts
- [ ] Optimize image size (<2GB)
  - Use multi-stage build
  - Clean package manager caches
- [ ] Build and test Heavy container locally
- [ ] Push to container registry

### pi-runner.ts Wrapper Script

- [ ] Create pi-runner.ts script
- [ ] Implement Pi Agent initialization
  - Import pi-mono library
  - Configure agent with env vars (MODEL, TEMPERATURE, MAX_TOKENS)
  - Set system prompt from workflow step config
- [ ] Implement session.jsonl loading
  - Read /app/.pi/agent/session.jsonl
  - Parse JSONL into conversation tree
  - Load into Pi Agent memory
- [ ] Implement RESUME_NODE_ID handling
  - Read RESUME_NODE_ID from environment variable
  - Find node in conversation tree
  - Resume agent execution from that node
- [ ] Implement WebSocket connection
  - Connect to PiTelemetryGateway (from env var: WEBSOCKET_URL)
  - Authenticate with JWT (from env var: AGENT_JWT)
  - Handle connection errors (retry with backoff)
- [ ] Implement tool auto-discovery
  - Scan /app/extensions directory
  - Load all .ts files as tools
  - Register tools with Pi Agent
- [ ] Implement telemetry event emission
  - Emit turn_start when agent starts thinking
  - Emit agent_telemetry for each thought/action
  - Emit tool_execution_start when tool called
  - Emit tool_execution_end when tool completes
  - Emit turn_end when agent finishes turn
- [ ] Add graceful shutdown handling (SIGTERM)
- [ ] Test pi-runner.ts with mock Pi Agent

### Volume Mounting Integration

- [ ] Integrate ToolMountingService (Epic 004)
  - Call ToolMountingService.mountToolsForContainer()
  - Get temp directory path
  - Pass to ContainerOrchestratorService as volume mount
- [ ] Implement Git repository mounting
  - Clone repository to host directory
  - Mount as /workspace in container (read-write)
  - Handle authentication for private repos (SSH keys, tokens)
- [ ] Implement session JSONL injection
  - Call SessionHydrationService.rehydrateSession()
  - Inject session.jsonl via Docker putArchive
  - Verify file exists in container before starting
- [ ] Test volume mounting
  - Verify tools are accessible in /app/extensions
  - Verify workspace is writable
  - Verify session.jsonl is loaded correctly

### Environment Variable Injection

- [ ] Define required environment variables
  - WEBSOCKET_URL: WebSocket gateway URL
  - AGENT_JWT: Authentication token
  - MODEL: LLM model to use (gpt-4, claude-3.5-sonnet)
  - TEMPERATURE: Model temperature (0.7)
  - MAX_TOKENS: Max output tokens (4096)
  - RESUME_NODE_ID: Resume point (optional)
  - WORKSPACE_PATH: /workspace
  - OPENAI_API_KEY: OpenAI API key (secret)
  - ANTHROPIC_API_KEY: Anthropic API key (secret)
- [ ] Implement secret injection (Epic 002 config)
  - Read secrets from environment or Vault
  - Inject as container env vars (never write to volumes)
- [ ] Test environment variable injection
  - Verify all vars are set in container
  - Verify secrets are not logged

### End-to-End Workflow Execution

- [ ] Integrate with WorkflowEngineService
  - On step execution, call ContainerOrchestratorService
  - Pass step configuration (tier, inputs, tools)
  - Pass mounted volumes (tools, workspace, session)
  - Pass environment variables
- [ ] Implement step execution flow
  1. WorkflowEngine enqueues step
  2. StepExecutionConsumer picks up job
  3. Mount tools via ToolMountingService
  4. Inject session via SessionHydrationService (if resuming)
  5. Provision container via ContainerOrchestratorService
  6. Start container (Pi Agent boots)
  7. Agent connects to WebSocket
  8. Agent executes task
  9. Agent emits turn_end
  10. WorkflowEngine receives turn_end event
  11. Extract output from turn_end payload
  12. Update WorkflowRun status
  13. Kill container
  14. Cleanup mounted tools
- [ ] Add timeout handling (max execution time: 1 hour)
- [ ] Add failure handling (container crashes, agent errors)
- [ ] Test end-to-end with simple 1-step workflow
- [ ] Test end-to-end with 3-step DAG workflow

### Tool Execution in Containers

- [ ] Verify Pi Agent tool discovery
  - Agent scans /app/extensions
  - Agent loads tool definitions
  - Agent registers tools
- [ ] Implement tool execution logging
  - Log tool name, parameters
  - Log tool execution duration
  - Log tool results
- [ ] Test tool execution
  - Test read_file tool
  - Test write_file tool
  - Test bash tool
  - Test git_commit tool
- [ ] Verify tool results returned to agent
- [ ] Test tool error handling (tool fails, agent continues)

### Container Lifecycle Management

- [ ] Implement container startup sequence
  - Provision container (don't start yet)
  - Mount volumes
  - Inject session (if applicable)
  - Set environment variables
  - Start container
  - Wait for WebSocket connection (timeout: 30s)
  - Mark as ready
- [ ] Implement container shutdown sequence
  - Send SIGTERM to container
  - Wait for graceful shutdown (timeout: 10s)
  - Send SIGKILL if still running
  - Remove container
  - Cleanup mounted volumes
- [ ] Add container health checks
  - Verify WebSocket connection established
  - Verify agent is responsive
- [ ] Test lifecycle with various scenarios
  - Happy path (normal execution)
  - Agent timeout (no turn_end after 1 hour)
  - Agent crash (container exits unexpectedly)
  - Network failure (WebSocket disconnects)

### Testing & Documentation

- [ ] Write unit tests for pi-runner.ts
- [ ] Write integration tests for container provisioning
  - Light container provisions successfully
  - Heavy container provisions successfully
  - Tools are mounted correctly
  - Session is injected correctly
- [ ] Write end-to-end tests for workflow execution
  - Simple 1-step workflow (read_file → output)
  - 3-step DAG workflow (sequential execution)
  - Workflow with tool executions
- [ ] Test with real Pi Agent (not mocks)
- [ ] Test with multiple LLM models (GPT-4, Claude)
- [ ] Document container image build process
- [ ] Document pi-runner.ts configuration
- [ ] Create troubleshooting guide for container issues

## Key Deliverables

1. **Container Images**
   - Light container Dockerfile (Alpine + Pi Agent)
   - Heavy container Dockerfile (DevContainer + Pi Agent)
   - Published images in container registry

2. **pi-runner.ts Wrapper**
   - Pi Agent initialization
   - Session loading and resumption
   - WebSocket connectivity
   - Tool discovery and registration
   - Telemetry emission

3. **Volume Mounting System**
   - Tool mounting integration
   - Git workspace mounting
   - Session JSONL injection

4. **End-to-End Pipeline**
   - Complete workflow execution flow
   - Container lifecycle management
   - Error handling and timeouts

5. **Documentation**
   - Container build guide
   - pi-runner.ts configuration reference
   - Troubleshooting guide

## Acceptance Criteria

- [ ] Light container builds successfully (< 500MB)
- [ ] Heavy container builds successfully (< 2GB)
- [ ] Images are published to container registry
- [ ] pi-runner.ts loads session.jsonl correctly
- [ ] pi-runner.ts connects to WebSocket gateway
- [ ] Pi Agent auto-discovers tools in /app/extensions
- [ ] Tools execute successfully (bash, read_file, write_file, git_commit)
- [ ] Tool execution results are returned to agent
- [ ] RESUME_NODE_ID resumes execution from correct node
- [ ] Telemetry events are emitted to WebSocket gateway
- [ ] turn_end event includes agent output
- [ ] Container is killed after task completion
- [ ] Mounted tools are cleaned up after container shutdown
- [ ] WorkflowRuns status updates to "Completed" on success
- [ ] WorkflowRuns status updates to "Failed" on error
- [ ] End-to-end integration tests verify full workflow execution
- [ ] Workflow with 3 DAG steps executes in correct order
- [ ] Light container executes simple tasks (<30s execution time)
- [ ] Heavy container executes complex tasks (git, build, test)
- [ ] Container timeout kills long-running containers (after 1 hour)
- [ ] Container crash is detected and reported
- [ ] Secrets are never logged or written to volumes

## Technical Notes

### Technology Stack

- **Container Runtime**: Docker Engine
- **Base Images**: node:24-alpine (Light), mcr.microsoft.com/devcontainers/typescript-node:20 (Heavy)
- **Pi Agent**: pi-mono package from npm (See [Pi Agent SDK Research](../../research/pi-agent-sdk.md) for details)
- **WebSocket Client**: socket.io-client

### Light Container Structure

```
/app
  ├── pi-runner.ts        # Entry point
  ├── node_modules/       # Pi Agent + dependencies
  ├── .pi/
  │   └── agent/
  │       └── session.jsonl
  └── extensions/         # Mounted tools
      ├── index.ts
      ├── read_file.ts
      └── write_file.ts
```

### Heavy Container Structure

```
/app
  ├── pi-runner.ts
  ├── node_modules/
  ├── .pi/agent/session.jsonl
  └── extensions/
/workspace                # Git repository
  ├── .git/
  ├── src/
  └── package.json
```

### pi-runner.ts Pseudo-code

```typescript
import { PiAgent } from 'pi-mono';
import { io } from 'socket.io-client';
import fs from 'fs';

async function main() {
  // Load session
  const sessionPath = '/app/.pi/agent/session.jsonl';
  const session = fs.existsSync(sessionPath)
    ? fs.readFileSync(sessionPath, 'utf-8')
    : null;

  // Initialize Pi Agent
  const agent = new PiAgent({
    model: process.env.MODEL,
    temperature: parseFloat(process.env.TEMPERATURE),
    session: session,
    resumeNodeId: process.env.RESUME_NODE_ID,
  });

  // Auto-discover tools
  const tools = discoverTools('/app/extensions');
  agent.registerTools(tools);

  // Connect to WebSocket
  const socket = io(process.env.WEBSOCKET_URL, {
    auth: { token: process.env.AGENT_JWT }
  });

  // Emit telemetry
  agent.on('turn_start', () => socket.emit('turn_start', {...}));
  agent.on('turn_end', (output) => socket.emit('turn_end', { output }));

  // Execute task
  const systemPrompt = process.env.SYSTEM_PROMPT;
  await agent.execute(systemPrompt);

  // Cleanup
  process.exit(0);
}

main();
```

### Container Resource Limits

- **Light Container**: 1 CPU, 512MB RAM
- **Heavy Container**: 4 CPU, 4GB RAM
- **Execution Timeout**: 1 hour (3600 seconds)

### Security Considerations

- **Secret Management**: Inject API keys via env vars, never mount as files
- **Network Isolation**: Heavy containers run without network by default (Epic 012)
- **Tool Sandboxing**: Tools execute in container (already sandboxed)
- **Session Validation**: Validate session.jsonl before loading (prevent injection)

### Testing Strategy

- **Unit Tests**: pi-runner.ts logic, mocked Pi Agent
- **Integration Tests**: Real containers, real Docker daemon
- **E2E Tests**: Full workflows with real Pi Agent
- **Performance Tests**: Large session.jsonl files (10MB+)

## Risks & Mitigation

| Risk                             | Impact | Probability | Mitigation                                     |
| -------------------------------- | ------ | ----------- | ---------------------------------------------- |
| Pi Agent version incompatibility | High   | Medium      | Pin pi-mono version, integration tests         |
| Container image size too large   | Medium | Medium      | Multi-stage builds, .dockerignore, size limits |
| Container startup timeout        | Medium | High        | Increase timeout, health checks, retry logic   |
| Session.jsonl corruption         | High   | Low         | Validation before loading, error handling      |
| Tool discovery failures          | Medium | Medium      | Comprehensive error handling, fallback tools   |
| WebSocket connection failures    | High   | Medium      | Retry logic, connection health checks          |

## Parallel Development

**Can Run in Parallel**: NO (requires all foundation and core services)
**Blocks**: Epic 011 (Subagent Orchestration)

## Related ADRs

- Create ADR-027: Light vs. Heavy container tier strategy
- Create ADR-028: Pi Agent version pinning strategy
- Create ADR-029: Container image registry choice (Docker Hub vs. ECR)

## Notes

- This is the most critical epic - everything comes together here
- Allocate 2 full weeks for integration and testing
- Test with real Pi Agent, not mocks (integration is complex)
- Container size matters - optimize aggressively
- WebSocket connectivity is critical - robust retry logic needed
- Document everything - this will be the most referenced epic
- Consider adding Pi Agent performance metrics (Epic 013)
- Container security hardening is Epic 012 (not here)
