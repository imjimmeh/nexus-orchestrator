# Epic 006: Session State Management - Dehydration & Rehydration

## Overview

**Epic ID**: 006
**Layer**: Core Services
**Status**: Not Started
**Priority**: High (P1)
**Estimated Timeline**: 1 week

## Context

Implement the advanced state management system that enables Pi Agent sessions to be dehydrated (paused and persisted to database) and rehydrated (resumed from a specific point in the conversation tree). This system supports branching and rewinding, allowing human operators to "undo" agent decisions and explore alternative paths.

Session hydration is critical for resource optimization (containers only run when actively executing) and for enabling human-in-the-loop workflows where agents pause for approval or feedback.

## Dependencies

**Upstream Dependencies**:

- Epic 002 (Core Infrastructure) - for PiSessionTrees table
- Epic 003 (Docker Orchestration) - for Docker archive API (getArchive, putArchive)

**Downstream Dependencies**:

- Epic 010 (Pi Agent Integration) - consumes session state on boot
- Epic 011 (Subagent Orchestration) - dehydrates parent during child execution
- Epic 008 (Memory Management) - token distillation modifies session JSONL

## Scope

### Included in This Epic

- **SessionHydrationService Implementation**
  - Dehydration logic (pause, extract, compress, store, kill)
  - Rehydration logic (retrieve, decompress, inject, resume)
  - Branching support (resume from specific nodeId)
  - Rewinding support (go back to earlier conversation state)

- **Dehydration Pipeline**
  - Send SIGUSR1 signal to agent process (graceful pause)
  - Extract /app/.pi/agent/session.jsonl via Docker getArchive API
  - Compress JSONL data (gzip)
  - Store in PiSessionTrees table (JSONB column)
  - Kill container to free resources
  - Track last leaf node ID for resume

- **Rehydration Pipeline**
  - Retrieve JSONL from PiSessionTrees table
  - Decompress JSONL data
  - Inject into new container via Docker putArchive API
  - Set RESUME_NODE_ID environment variable
  - Start container (Pi Agent auto-resumes from node)

- **JSONL Validation**
  - Validate JSONL format (each line is valid JSON)
  - Validate conversation tree structure
  - Detect corrupted session data
  - Provide detailed error messages

- **Session Cleanup System**
  - Background job to archive old sessions (> 30 days)
  - Compress and move to cold storage (or delete)
  - Clean up orphaned sessions (no associated WorkflowRun)

### Out of Scope

- Token distillation (Epic 008)
- Workflow orchestration (Epic 005)
- WebSocket communication (Epic 007)
- Subagent spawning logic (Epic 011)
- Session analytics/visualization

## Tasks

### SessionHydrationService Core

- [ ] Create SessionHydrationService class
- [ ] Implement dehydrateSession(containerId, workflowRunId) method
  - Send SIGUSR1 to container (pause agent)
  - Wait for agent to acknowledge pause (future: WebSocket confirmation)
  - Extract /app/.pi/agent/session.jsonl via docker.getArchive()
  - Parse tar stream and extract file contents
  - Compress JSONL data (gzip)
  - Find last leaf node ID from JSONL
  - Store in PiSessionTrees table
  - Kill container via ContainerOrchestratorService
  - Return session tree ID
- [ ] Implement rehydrateSession(sessionTreeId, containerId, nodeId?) method
  - Retrieve JSONL from PiSessionTrees table
  - Decompress JSONL data
  - If nodeId provided, validate it exists in tree
  - Create tar stream with session.jsonl
  - Inject via docker.putArchive() to /app/.pi/agent/
  - Set RESUME_NODE_ID environment variable (if nodeId provided)
  - Start container via ContainerOrchestratorService
  - Return container ID
- [ ] Implement getSessionTree(sessionTreeId) method
- [ ] Implement listSessionTrees(workflowRunId) method (with pagination)

### Dehydration Pipeline

- [ ] Install compression library (zlib or gzip-js)
- [ ] Implement sendPauseSignal(containerId) helper
  - Use docker.kill(containerId, 'SIGUSR1')
  - Add timeout (10 seconds)
  - Handle errors if container already stopped
- [ ] Implement extractSessionFile(containerId) helper
  - Call docker.getContainer(containerId).getArchive({ path: '/app/.pi/agent/session.jsonl' })
  - Parse tar stream (use tar-stream library)
  - Extract file contents as Buffer
  - Return JSONL string
- [ ] Implement compressJSONL(jsonlString) helper
  - Compress using gzip
  - Return compressed Buffer
- [ ] Implement findLastLeafNode(jsonl) helper
  - Parse JSONL into conversation tree
  - Traverse tree to find last leaf node
  - Return nodeId
- [ ] Test dehydration with mock container

### Rehydration Pipeline

- [ ] Implement decompressJSONL(buffer) helper
  - Decompress gzip Buffer
  - Return JSONL string
- [ ] Implement validateNodeId(jsonl, nodeId) helper
  - Parse JSONL tree
  - Check if nodeId exists
  - Return boolean
- [ ] Implement createTarStream(filename, content) helper
  - Create tar archive with single file
  - Return tar Buffer or Stream
- [ ] Implement injectSessionFile(containerId, jsonlBuffer) helper
  - Create tar stream with session.jsonl
  - Call docker.getContainer(containerId).putArchive('/app/.pi/agent/', tarStream)
  - Handle errors (directory not found, permission denied)
- [ ] Implement setResumeNodeEnv(containerId, nodeId) helper
  - Update container config or pass via docker run
  - Note: Env vars can't be changed on running containers
  - Must be set during container creation
- [ ] Test rehydration with mock container and sample JSONL

### JSONL Validation

- [ ] Create JSONLValidationService
- [ ] Implement validateJSONL(jsonlString) method
  - Split by newlines
  - Parse each line as JSON
  - Check for required fields (id, type, content, etc.)
  - Return validation errors with line numbers
- [ ] Implement validateTreeStructure(nodes) method
  - Check parent-child relationships are valid
  - Detect orphaned nodes (no path from root)
  - Detect cycles (should not exist in conversation tree)
- [ ] Add validation during dehydration (before storage)
- [ ] Add validation during rehydration (before injection)
- [ ] Return detailed error messages for debugging

### Branching & Rewinding

- [ ] Implement branchSession(sessionTreeId, nodeId, newWorkflowRunId) method
  - Retrieve original session JSONL
  - Truncate tree at nodeId (remove all nodes after)
  - Create new PiSessionTree record with truncated JSONL
  - Associate with newWorkflowRunId
  - Return new session tree ID
- [ ] Implement listBranches(originalSessionTreeId) method
  - Find all session trees branched from original
  - Return metadata (branch point, creation time)
- [ ] Add branch tracking (parent_session_tree_id column)
- [ ] Test branching with complex conversation trees

### Session Cleanup System

- [ ] Create SessionCleanupService
- [ ] Implement BullMQ job for periodic cleanup
- [ ] Add cleanup logic:
  - Find sessions older than 30 days
  - Archive or delete based on configuration
  - Find orphaned sessions (no WorkflowRun association)
  - Delete orphaned sessions
- [ ] Schedule cleanup job (runs daily at 2 AM)
- [ ] Add manual cleanup API for debugging
- [ ] Log all cleanup actions
- [ ] Test cleanup with old test data

### Testing & Documentation

- [ ] Write unit tests for compression/decompression
- [ ] Write unit tests for JSONL validation
- [ ] Write unit tests for branching logic
- [ ] Write integration tests for dehydration
  - Create mock container with session.jsonl
  - Dehydrate session
  - Verify JSONL stored in database
  - Verify container killed
- [ ] Write integration tests for rehydration
  - Create PiSessionTree record
  - Rehydrate into new container
  - Verify session.jsonl injected correctly
- [ ] Write integration tests for Docker archive API
- [ ] Test resume point accuracy (branching validation)
- [ ] Document session hydration API
- [ ] Create troubleshooting guide for session issues

## Key Deliverables

1. **SessionHydrationService**
   - Full dehydration/rehydration API
   - Branching and rewinding support
   - JSONL validation

2. **Dehydration Pipeline**
   - Container pause (SIGUSR1)
   - JSONL extraction via Docker API
   - Compression and storage

3. **Rehydration Pipeline**
   - JSONL retrieval and decompression
   - Injection via Docker API
   - Resume from specific node

4. **Session Cleanup System**
   - Background job for old session archival
   - Orphaned session removal

5. **Documentation**
   - Session hydration API docs
   - Branching and rewinding guide
   - JSONL format reference

## Acceptance Criteria

- [ ] Dehydration extracts session.jsonl from running container
- [ ] JSONL data is compressed before PostgreSQL storage (reduces size by 70%+)
- [ ] Dehydration kills the container after successful extraction
- [ ] Container is removed after kill (no orphans)
- [ ] Rehydration retrieves JSONL from database correctly
- [ ] JSONL is decompressed before injection
- [ ] Rehydration injects JSONL into new container at /app/.pi/agent/session.jsonl
- [ ] RESUME_NODE_ID environment variable is set correctly during container creation
- [ ] Branching works: rewinding to older nodeId creates new session tree
- [ ] Branched session contains only nodes up to branch point
- [ ] JSONL validation detects corrupted session data
- [ ] JSONL validation detects malformed JSON lines
- [ ] Session cleanup job archives sessions older than 30 days
- [ ] Session cleanup job deletes orphaned sessions
- [ ] Unit tests mock Docker archive API (no real containers)
- [ ] Integration tests use real Docker containers with mock JSONL files
- [ ] Full dehydration → rehydration cycle completes in < 2 seconds
- [ ] No data loss during dehydration/rehydration (JSONL checksums match)

## Technical Notes

### Technology Stack

- **Compression**: Node.js zlib (built-in)
- **Tar Handling**: tar-stream package
- **Docker API**: dockerode (from Epic 003)
- **ORM**: TypeORM/Prisma (from Epic 002)

### JSONL Format (Pi Agent)

```jsonl
{"id":"node_1","type":"user","content":"Implement login feature","parent":null}
{"id":"node_2","type":"assistant","content":"I'll implement the login feature","parent":"node_1"}
{"id":"node_3","type":"tool_use","tool":"write","parent":"node_2"}
{"id":"node_4","type":"tool_result","result":"File written","parent":"node_3"}
```

### Dehydration Sequence

```
1. Send SIGUSR1 to container
2. Wait 1 second (agent flushes state)
3. Extract /app/.pi/agent/session.jsonl via getArchive
4. Parse tar stream → JSONL string
5. Compress JSONL (gzip)
6. Find last leaf node ID
7. Store in PiSessionTrees (jsonl_data, last_leaf_node_id)
8. Kill container
Total time: 0.5-2 seconds
```

### Rehydration Sequence

```
1. Retrieve JSONL from PiSessionTrees
2. Decompress JSONL
3. Validate nodeId exists (if branching)
4. Create new container (don't start yet)
5. Create tar stream with session.jsonl
6. Inject via putArchive to /app/.pi/agent/
7. Set RESUME_NODE_ID env var
8. Start container
Total time: 2-5 seconds (depends on container provisioning)
```

### Compression Efficiency

- **Uncompressed**: 10MB JSONL
- **Compressed (gzip)**: ~3MB (70% reduction)
- **Storage**: PostgreSQL JSONB (compressed automatically)

### Branching Example

```
Original tree:
node_1 → node_2 → node_3 → node_4 → node_5

Branch at node_3:
node_1 → node_2 → node_3

New conversation continues from node_3:
node_1 → node_2 → node_3 → node_6 → node_7
```

### Security Considerations

- **Path Traversal**: Validate all file paths (no ../ in paths)
- **JSONL Injection**: Validate JSONL structure (prevent malicious nodes)
- **Resource Limits**: Limit JSONL size (max 100MB uncompressed)
- **Secrets**: Ensure no secrets are stored in JSONL

### Testing Strategy

- **Unit Tests**: Compression, validation, branching logic
- **Integration Tests**: Docker archive API, full dehydration/rehydration
- **Mock Containers**: Create test containers with sample JSONL
- **Cleanup**: Always remove test containers and database records

## Risks & Mitigation

| Risk                                 | Impact | Probability | Mitigation                                  |
| ------------------------------------ | ------ | ----------- | ------------------------------------------- |
| Docker archive API failures          | High   | Medium      | Retry logic, fallback to exec + cat         |
| JSONL corruption during compression  | High   | Low         | Checksum validation, compression tests      |
| Container doesn't respond to SIGUSR1 | Medium | Low         | Timeout, force kill after 10 seconds        |
| JSONL size exceeds PostgreSQL limits | Medium | Low         | Max size validation (100MB), compression    |
| Rehydration node ID doesn't exist    | Medium | Medium      | Validation before injection, error handling |

## Parallel Development

**Can Run in Parallel**: PARTIAL (after Epic 002 + Epic 003 complete)
**Can Run Alongside**: Epic 005 (Workflow Engine), Epic 008 (Memory Management)

## Related ADRs

- Create ADR-015: Session storage strategy (PostgreSQL JSONB vs. S3)
- Create ADR-016: Compression algorithm choice (gzip vs. brotli)
- Create ADR-017: Branching vs. versioning for session trees

## Notes

- Dehydration/rehydration is critical for cost optimization (kill idle containers)
- Branching enables powerful human-in-the-loop workflows
- JSONL validation is essential (corrupted sessions break everything)
- Test with large JSONL files (10MB+) to ensure performance
- Consider adding session compression metrics to observability (Epic 013)
- RESUME_NODE_ID must be set during container creation, not after
