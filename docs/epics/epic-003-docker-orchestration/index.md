# Epic 003: Docker Container Orchestration

## Overview

**Epic ID**: 003
**Layer**: Foundation
**Status**: Not Started
**Priority**: Critical (P0)
**Estimated Timeline**: 1 week

## Context

Build the container lifecycle management system that provisions, manages, and terminates Docker containers for Pi Agent execution. This service wraps the Docker API (via dockerode) and provides a clean abstraction for container operations including resource limits, volume mounting, and lifecycle management (start, pause, resume, kill).

The ContainerOrchestratorService is critical infrastructure that enables isolated execution environments for AI agents, enforces resource constraints, and manages the boundary between the Control Plane (NestJS) and the Execution Plane (Docker containers).

## Dependencies

**Upstream Dependencies**:
- Epic 002 (Core Infrastructure) - for configuration, logging, and database

**Downstream Dependencies**:
- Epic 006 (Session Hydration) - needs container archive API
- Epic 010 (Pi Agent Integration) - needs full container orchestration
- Epic 012 (Security & IAM) - needs network isolation controls

## Scope

### Included in This Epic

- **ContainerOrchestratorService Implementation**
  - dockerode client initialization and connection management
  - Container provisioning API (createContainer + start)
  - Volume mounting logic (bind mounts for tools, Git repos, session state)
  - Environment variable injection (secrets, config, RESUME_NODE_ID)
  - cgroup resource limits (CPU cores, RAM limits)
  - Container lifecycle management:
    - Start containers
    - Pause containers (send SIGUSR1 signal)
    - Resume containers
    - Kill/stop containers
    - Remove containers
  - Container log streaming (stdout/stderr)
  - Container stats monitoring (CPU, RAM usage)

- **Container Cleanup System**
  - BullMQ background job for cleanup
  - Remove orphaned containers (no associated WorkflowRun)
  - Prune unused volumes
  - Cleanup stale containers (running > 24 hours)
  - Scheduled cleanup (runs every 1 hour)

- **Docker Health Monitoring**
  - Docker daemon connectivity check
  - Container count monitoring
  - Disk space monitoring (Docker volumes)
  - Alert on Docker daemon failures

- **Error Handling & Resilience**
  - Docker daemon connection retry logic
  - Container provisioning failure handling
  - Graceful degradation when Docker is unavailable
  - Detailed error logging with context

### Out of Scope

- Pi Agent integration (Epic 010)
- Tool registry mounting implementation (interface defined, implementation in Epic 004)
- Session state injection implementation (interface defined, implementation in Epic 006)
- Workflow orchestration (Epic 005)
- Container images (Dockerfiles created in Epic 010)
- WebSocket communication to containers (Epic 007)

## Tasks

### Docker Integration Setup
- [ ] Install dockerode library
- [ ] Create DockerModule with dockerode client configuration
- [ ] Implement Docker daemon connection with retry logic
- [ ] Add Docker health check to system health endpoint
- [ ] Configure Docker socket path (Unix socket or TCP)
- [ ] Test Docker connectivity with simple container (hello-world)

### ContainerOrchestratorService Core
- [ ] Create ContainerOrchestratorService class
- [ ] Implement provisionContainer() method
  - Accept configuration: image, tier, volumes, env vars
  - Call dockerode.createContainer() with full config
  - Apply CPU and RAM limits via HostConfig
  - Start container
  - Return container ID and metadata
- [ ] Implement getContainerStatus() method
- [ ] Implement getContainerLogs() method (streaming)
- [ ] Implement getContainerStats() method (CPU, RAM)
- [ ] Implement killContainer() method
- [ ] Implement removeContainer() method

### Resource Management
- [ ] Define resource profiles (Light tier, Heavy tier)
  - Light: 1 CPU core, 512MB RAM
  - Heavy: 4 CPU cores, 4GB RAM
- [ ] Implement cgroup limit configuration (HostConfig.Memory, HostConfig.NanoCpus)
- [ ] Add resource limit validation
- [ ] Test resource limits with actual containers (verify with docker inspect)

### Volume Mounting
- [ ] Implement volume mounting logic (HostConfig.Binds)
- [ ] Support bind mounts for:
  - Tool extensions (e.g., /host/tools:/app/extensions:ro)
  - Git repositories (e.g., /host/repos:/workspace:rw)
  - Session state (e.g., /host/sessions:/app/.pi/agent:rw)
- [ ] Validate mount paths exist on host before provisioning
- [ ] Add read-only vs. read-write mount support
- [ ] Test volume mounting with real directories

### Lifecycle Management
- [ ] Implement pauseContainer() method
  - Send SIGUSR1 signal to container process
  - Validate container is paused
- [ ] Implement resumeContainer() method
  - Start previously stopped container
  - Inject updated environment variables if needed
- [ ] Add container state tracking (Running, Paused, Stopped, Dead)
- [ ] Implement graceful container shutdown (SIGTERM → SIGKILL timeout)

### Container Cleanup System
- [ ] Create ContainerCleanupService
- [ ] Implement BullMQ job for periodic cleanup
- [ ] Add cleanup logic:
  - Find orphaned containers (no WorkflowRun record)
  - Find stale containers (running > 24 hours)
  - Kill and remove containers
  - Prune unused volumes
- [ ] Schedule cleanup job (every 1 hour)
- [ ] Add manual cleanup API endpoint for debugging
- [ ] Log all cleanup actions

### Error Handling & Monitoring
- [ ] Add Docker daemon connection error handling
- [ ] Implement container provisioning error handling
  - Image not found → pull image or fail gracefully
  - Insufficient resources → queue for retry
  - Port conflicts → retry with different port
- [ ] Add comprehensive logging for all Docker operations
- [ ] Create Prometheus metrics for container operations
  - Total containers provisioned
  - Active containers count
  - Container provisioning duration
  - Container failures count

### Testing & Documentation
- [ ] Write unit tests with dockerode mocks
- [ ] Write integration tests with real Docker daemon
  - Provision Alpine container
  - Start, pause, resume, kill lifecycle
  - Volume mounting validation
  - Resource limit verification
- [ ] Test cleanup job with orphaned containers
- [ ] Document ContainerOrchestratorService API
- [ ] Create troubleshooting guide for Docker issues

## Key Deliverables

1. **ContainerOrchestratorService**
   - Full API for container lifecycle management
   - Resource limit enforcement
   - Volume mounting support
   - Error handling and resilience

2. **Container Cleanup System**
   - BullMQ job for periodic cleanup
   - Orphaned container removal
   - Volume pruning

3. **Docker Health Monitoring**
   - Docker daemon health check
   - Container count monitoring
   - Prometheus metrics

4. **Comprehensive Test Suite**
   - Unit tests with mocked dockerode
   - Integration tests with real Docker daemon
   - Lifecycle tests (start → pause → resume → kill)

5. **Documentation**
   - API documentation for ContainerOrchestratorService
   - Docker troubleshooting guide
   - Resource limit configuration guide

## Acceptance Criteria

- [ ] ContainerOrchestratorService can provision a basic Alpine container
- [ ] Containers can be started and stopped via service API
- [ ] CPU and RAM limits are correctly applied (verified with `docker inspect`)
- [ ] Volume mounting works for arbitrary host directories
- [ ] Mounted volumes are accessible inside container (verified with test)
- [ ] Environment variables are correctly injected into containers
- [ ] Container logs can be streamed in real-time
- [ ] pauseContainer() sends SIGUSR1 signal successfully
- [ ] Orphaned container cleanup job runs every 1 hour
- [ ] Cleanup job removes containers older than 24 hours
- [ ] Service handles Docker daemon failures gracefully (doesn't crash)
- [ ] Unit tests mock dockerode API (no real Docker required)
- [ ] Integration tests use real Docker daemon
- [ ] All containers are stopped and removed after integration tests
- [ ] No container leaks after test runs (verified with `docker ps -a`)
- [ ] Prometheus metrics are exported for container operations

## Technical Notes

### Technology Stack
- **Docker API Client**: dockerode v4+
- **Queue**: BullMQ (from Epic 002)
- **Metrics**: Prometheus client (prom-client)

### Docker Configuration
- **Socket Path**: `/var/run/docker.sock` (Unix) or `tcp://localhost:2375` (Windows)
- **API Version**: Use latest stable Docker Engine API
- **Network Mode**: Bridge network by default (Epic 012 adds --network none)
- **Restart Policy**: No auto-restart (orchestrator manages lifecycle)

### Resource Limits
Light Tier Profile:
```javascript
{
  Memory: 512 * 1024 * 1024, // 512MB
  NanoCpus: 1 * 1000000000,  // 1 CPU core
  MemorySwap: 512 * 1024 * 1024, // No swap
}
```

Heavy Tier Profile:
```javascript
{
  Memory: 4 * 1024 * 1024 * 1024, // 4GB
  NanoCpus: 4 * 1000000000,       // 4 CPU cores
  MemorySwap: 4 * 1024 * 1024 * 1024, // No swap
}
```

### Security Considerations
- **Volume Mounts**: Validate all mount paths to prevent directory traversal
- **Environment Variables**: Never log secret values
- **Container Isolation**: Use user namespaces (add in Epic 012)
- **Network Isolation**: Add --network none support (Epic 012)

### Testing Strategy
- **Unit Tests**: Mock dockerode, test business logic
- **Integration Tests**: Use real Docker daemon, actual containers
- **Test Containers**: Use lightweight images (Alpine, hello-world)
- **Cleanup**: Always remove test containers in afterEach/afterAll hooks
- **CI/CD**: Ensure Docker is available in CI environment

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Docker daemon unavailable | High | Medium | Retry logic, health checks, graceful degradation |
| Container resource exhaustion (host OOM) | High | Medium | Enforce strict resource limits, monitor host metrics |
| Volume mount permission errors | Medium | High | Document required permissions, validate paths |
| Container orphans after crashes | Medium | Medium | Cleanup job, track containers in database |
| dockerode version incompatibility | Low | Low | Pin dockerode version, integration tests |

## Parallel Development

**Can Run in Parallel**: YES (after Epic 002 completes)
**Can Run Alongside**: Epic 004 (Tool Registry)

## Related ADRs

- Create ADR-005: dockerode vs. direct Docker API calls
- Create ADR-006: Container resource limit strategy (Light vs Heavy tiers)
- Create ADR-007: Container cleanup policy (orphaned containers)

## Notes

- Test thoroughly with actual Docker daemon - mocks don't catch all issues
- Resource limits are critical for preventing host DoS
- Container cleanup is essential - failed workflows can leave orphans
- Log all Docker operations for debugging production issues
- Consider adding container execution timeouts (max runtime: 1 hour)
