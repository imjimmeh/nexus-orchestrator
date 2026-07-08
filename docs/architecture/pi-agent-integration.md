# Pi Agent Container Integration

The Pi Agent Integration layer connects the Nexus Control Plane with the Docker-based Execution Plane. It defines how AI agents are provisioned, initialized, and monitored during workflow execution.

## Container Tiers

1. **Light Tier (`nexus-light`)**
   - **Base**: `node:24-alpine`
   - **Footprint**: < 500MB
   - **Capabilities**: Basic scripting, file operations, web requests.
   - **Resources**: 1 CPU, 512MB RAM.

2. **Heavy Tier (`nexus-heavy`)**
   - **Base**: `typescript-node:20` (Ubuntu-based DevContainer)
   - **Footprint**: < 2GB
   - **Capabilities**: Full development SDKs (Git, Python, GCC, Make), project builds.
   - **Resources**: 4 CPUs, 4GB RAM.

## Pi Runner Wrapper (`pi-runner.ts`)

Every container runs `pi-runner.ts` as its entry point. This script performs the following:

- **Session Loading**: Reads `session.jsonl` from `/app/.pi/agent/` to restore conversation state.
- **WebSocket Connectivity**: Establishes an authenticated Socket.io connection to the Telemetry Gateway.
- **Tool Discovery**: Scans `/app/extensions/` and automatically registers discovered TypeScript tools with the Pi Agent.
- **Telemetry Bridge**: Proxies agent internal events (thoughts, actions, tool uses) to the Control Plane in real-time.

## Execution Flow

1. **Provisioning**: `StepExecutionConsumer` (BullMQ) calculates the required tier and triggers `ContainerOrchestratorService`.
2. **Mounting**: `ToolMountingService` prepares a temporary directory with the required toolset and bind-mounts it to the container.
3. **Hydration**: If resuming a workflow, `SessionHydrationService` injects the previous `session.jsonl` via Docker's archive API.
4. **Execution**: The agent performs its task, emitting telemetry.
5. **Completion**: Upon receiving a `turn_end` event with output, the Control Plane kills the container and progresses the workflow DAG.

## Security

- **Isolation**: Agents run in restricted Docker containers with resource limits.
- **Secrets**: API keys are injected via environment variables and are never persisted to disk or logged.
- **Persistence**: State is only persisted when the session is explicitly dehydrated back to the database.
