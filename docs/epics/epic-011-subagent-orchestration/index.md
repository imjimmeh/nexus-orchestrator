# Epic 011: Subagent Orchestration - Master-Worker Pattern

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](../../../architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md).

## Overview

**Epic ID**: 011
**Layer**: Integration
**Status**: Not Started
**Priority**: High (P1)
**Estimated Timeline**: 1 week

## Context

Implement the advanced master-worker orchestration pattern that allows Pi Agents to spawn subagents for subtask delegation. This includes proper parent dehydration (pause and persist), child agent provisioning and execution, result aggregation, and parent rehydration (resume). Subagent orchestration enables agents to break down complex tasks and work hierarchically, similar to how human teams delegate work.

This is the final piece of the core execution infrastructure - it unlocks powerful multi-agent workflows.

## Dependencies

**Upstream Dependencies**:
- Epic 010 (Pi Agent Integration) - full agent execution pipeline
- Epic 006 (Session Hydration) - dehydration/rehydration
- Epic 007 (WebSocket Telemetry) - event communication
- Epic 005 (Workflow Engine) - orchestration logic

**Downstream Dependencies**: None (this is a terminal epic)

## Scope

### Included in This Epic

- **NexusBridge Tool (spawn_subagent)**
  - Tool schema definition (profile, prompt, tools)
  - WebSocket event emission (tool_execution_start with type: spawn_subagent)
  - Tool available to Heavy tier agents only

- **Subagent Spawning Logic in WorkflowEngineService**
  - Receive spawn_subagent event from WebSocket
  - Pause parent agent (call SessionHydrationService.dehydrateSession)
  - Provision child agent container
  - Execute child agent with delegated task
  - Wait for child completion (turn_end event)
  - Kill child container
  - Resume parent agent (call SessionHydrationService.rehydrateSession)
  - Inject child result into parent context

- **Parent-Child Coordination**
  - Parent waits in paused (dehydrated) state
  - Child executes independently with own tools and context
  - Result aggregation and serialization
  - Context injection back to parent

- **Nested Subagent Support**
  - Grandchild spawning (subagent spawns its own subagent)
  - Recursive depth limits (prevent infinite spawning)
  - Track parent-child relationships in database

- **Error Handling**
  - Child agent failures don't crash parent
  - Timeout handling (max child execution time: 30 minutes)
  - Parent resumption on child error

### Out of Scope

- Parallel subagent execution (sequential only for MVP)
- Subagent result streaming (child must complete fully before parent resumes)
- Cross-workflow subagent sharing
- Subagent pooling/reuse
- Advanced subagent scheduling (priority, load balancing)

## Tasks

### NexusBridge Tool (spawn_subagent)
- [ ] Create spawn_subagent tool definition
  - Tool name: "spawn_subagent"
  - Parameters:
    - agent_profile: string (e.g., "qa_automation", "senior_backend_dev")
    - task_prompt: string (instruction for subagent)
    - tools: string[] (list of tool names subagent needs)
    - tier: "light" | "heavy"
  - Returns: Subagent execution result
- [ ] Implement tool execution logic
  - Validate parameters (profile exists, tools exist)
  - Emit tool_execution_start event via WebSocket
    - Event type: spawn_subagent
    - Include full parameters
  - Wait for tool_execution_end event (blocking)
  - Return result to parent agent
- [ ] Register tool in ToolRegistry (Epic 004)
  - Tier restriction: Heavy only
  - Make unavailable to Light tier agents
- [ ] Test tool with mock subagent execution

### Subagent Event Handlers in WorkflowEngineService
- [ ] Add event handler for tool_execution_start (spawn_subagent)
  - Extract parent agent container ID
  - Extract subagent parameters (profile, prompt, tools)
  - Call SubagentOrchestratorService.spawnSubagent()
- [ ] Add event handler for subagent turn_end
  - Extract subagent result
  - Call SubagentOrchestratorService.handleSubagentComplete()
  - Emit tool_execution_end to parent agent
- [ ] Test event handlers with mock WebSocket events

### SubagentOrchestratorService
- [ ] Create SubagentOrchestratorService class
- [ ] Implement spawnSubagent(parentContainerId, params) method
  1. Pause parent agent
     - Call SessionHydrationService.dehydrateSession(parentContainerId)
     - Wait for dehydration to complete
  2. Provision child container
     - Call ContainerOrchestratorService.provisionContainer()
     - Use the orchestrator-selected heavy runtime
     - Mount subagent tools
     - Set system prompt to params.task_prompt
  3. Start child container
     - Agent boots and connects to WebSocket
     - Agent executes delegated task
  4. Track parent-child relationship
     - Store in SubagentExecutions table (parent_id, child_id, status)
     - Mark parent as "Waiting for subagent"
- [ ] Implement handleSubagentComplete(childContainerId, result) method
  1. Find parent from SubagentExecutions table
  2. Kill child container
     - Call ContainerOrchestratorService.killContainer(childContainerId)
  3. Resume parent agent
     - Call SessionHydrationService.rehydrateSession(parentSessionId)
     - Inject subagent result as context
  4. Start parent container
     - Agent resumes with subagent result
  5. Update SubagentExecutions status to "Completed"
- [ ] Implement timeout handling
  - If child doesn't complete in 30 minutes, kill it
  - Resume parent with error message
- [ ] Test service with mock agents

### Parent Dehydration
- [ ] Integrate with SessionHydrationService (Epic 006)
  - Call dehydrateSession when subagent spawned
  - Verify parent container is killed
  - Verify session.jsonl is stored in database
- [ ] Add parent state tracking
  - Update WorkflowRun status to "Hibernated"
  - Store waiting_for_subagent flag
- [ ] Test dehydration
  - Verify parent container is killed
  - Verify session persisted
  - Verify parent can be resumed later

### Child Agent Provisioning
- [ ] Implement child container provisioning
  - Use ContainerOrchestratorService.provisionContainer()
  - Pass subagent profile and tools
  - Set system prompt from spawn_subagent params
  - No session.jsonl (fresh agent)
- [ ] Configure child environment
  - Different AGENT_JWT (unique per subagent)
  - Different workflow_run_id (track separately)
  - Parent container ID (for result routing)
- [ ] Test child provisioning
  - Verify container starts
  - Verify agent connects to WebSocket
  - Verify correct tools are mounted

### Parent Rehydration with Result Injection
- [ ] Implement result injection logic
  - Serialize subagent result to JSON
  - Create context message: "Subagent completed task. Result: {result}"
  - Inject into parent session.jsonl before last node
- [ ] Integrate with SessionHydrationService
  - Call rehydrateSession with parent session ID
  - Pass injected context
  - Resume from last node (before subagent spawn)
- [ ] Emit tool_execution_end event to parent
  - Include subagent result in payload
  - Parent agent receives result as tool output
- [ ] Test rehydration
  - Verify parent resumes correctly
  - Verify subagent result is available to parent
  - Verify parent continues execution

### Nested Subagent Support
- [ ] Implement recursive depth tracking
  - Add depth field to SubagentExecutions table
  - Parent depth + 1 = child depth
- [ ] Implement depth limit (max depth: 3)
  - Reject spawn_subagent if depth >= 3
  - Return error to agent
- [ ] Test nested subagents
  - Parent spawns child
  - Child spawns grandchild
  - Grandchild completes → child resumes
  - Child completes → parent resumes
- [ ] Test depth limit
  - Grandchild tries to spawn great-grandchild
  - spawn_subagent returns error

### SubagentExecutions Table
- [ ] Create database migration for SubagentExecutions
  - Columns:
    - id (PK)
    - parent_container_id
    - child_container_id
    - parent_session_tree_id
    - depth (int, default 0)
    - status (Spawning, Running, Completed, Failed)
    - result (JSONB)
    - created_at
    - completed_at
- [ ] Create TypeORM/Prisma entity for SubagentExecutions
- [ ] Implement CRUD operations in service
- [ ] Test database operations

### Error Handling
- [ ] Handle child agent failures
  - If child emits error event, capture it
  - Resume parent with error message
  - Don't crash parent agent
- [ ] Handle child timeout (30 minutes)
  - If child doesn't complete in 30 min, kill it
  - Resume parent with timeout error
  - Log timeout event
- [ ] Handle parent dehydration failures
  - If dehydration fails, don't spawn child
  - Return error to parent agent
- [ ] Handle parent rehydration failures
  - If rehydration fails, log error
  - Mark workflow as failed
  - Don't retry (manual intervention required)
- [ ] Test all error scenarios

### Testing & Documentation
- [ ] Write unit tests for spawn_subagent tool
- [ ] Write unit tests for SubagentOrchestratorService
- [ ] Write integration tests for parent-child lifecycle
  - Parent spawns child
  - Child executes task
  - Child completes
  - Parent resumes with result
- [ ] Write integration tests for nested subagents
- [ ] Write integration tests for error handling
  - Child timeout
  - Child failure
  - Dehydration failure
- [ ] Write end-to-end tests with real Pi Agents
- [ ] Document spawn_subagent tool usage
- [ ] Create subagent orchestration guide
- [ ] Create troubleshooting guide for subagent issues

## Key Deliverables

1. **spawn_subagent Tool**
   - Tool definition and schema
   - WebSocket event emission
   - Heavy tier restriction

2. **SubagentOrchestratorService**
   - Spawn, execute, and complete logic
   - Parent-child coordination
   - Error handling

3. **Parent Dehydration/Rehydration**
   - Pause parent during child execution
   - Resume parent with injected result
   - State tracking

4. **Nested Subagent Support**
   - Recursive spawning (up to depth 3)
   - Depth tracking and limits
   - Parent-child relationship tree

5. **Documentation**
   - spawn_subagent tool reference
   - Subagent orchestration guide
   - Troubleshooting guide

## Acceptance Criteria

- [ ] spawn_subagent tool is available to Heavy tier agents
- [ ] spawn_subagent tool is NOT available to Light tier agents
- [ ] Parent agent dehydrates when subagent is spawned
- [ ] Parent container is killed during dehydration
- [ ] Parent session.jsonl is stored in PiSessionTrees table
- [ ] Child agent provisions with orchestrator-selected runtime and tools
- [ ] Child agent executes delegated task
- [ ] Child agent_end event includes terminal result output
- [ ] Parent rehydrates after child completion
- [ ] Child result is injected into parent conversation context
- [ ] Parent continues execution with subagent result available
- [ ] Parent can access subagent result via tool output
- [ ] Nested subagents work (child spawns grandchild)
- [ ] Grandchild completes → child resumes → parent resumes
- [ ] Recursive depth limit prevents spawning at depth 3
- [ ] Depth limit returns error to agent (doesn't crash)
- [ ] Subagent failure does not crash parent agent
- [ ] Parent resumes with error message on child failure
- [ ] Child timeout (30 min) kills child and resumes parent
- [ ] SubagentExecutions table tracks all parent-child relationships
- [ ] Integration tests verify end-to-end subagent workflow
- [ ] Subagent execution adds < 5s overhead (dehydration + rehydration time)
- [ ] No resource leaks (all child containers cleaned up)

## Technical Notes

### Technology Stack
- **Services**: SubagentOrchestratorService (new)
- **Dependencies**: SessionHydrationService, ContainerOrchestratorService, WebSocket Gateway
- **Database**: SubagentExecutions table (new)

### spawn_subagent Tool Schema
```json
{
  "name": "spawn_subagent",
  "description": "Spawn a subagent to execute a delegated subtask",
  "tier_restriction": "Heavy",
  "parameters": {
    "type": "object",
    "properties": {
      "agent_profile": {
        "type": "string",
        "description": "Agent profile (e.g., 'qa_automation', 'senior_backend_dev')"
      },
      "task_prompt": {
        "type": "string",
        "description": "Instruction for the subagent"
      },
      "tools": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List of tool names the subagent needs"
      }
    },
    "required": ["agent_profile", "task_prompt", "tools"]
  }
}
```

Subagent runtime selection is orchestrator-owned. Current subagent provisioning uses the heavy runtime; capability-based routing is tracked separately.

### Subagent Execution Sequence
```
1. Parent agent calls spawn_subagent tool
2. Pi Agent emits tool_execution_start (spawn_subagent) via WebSocket
3. WorkflowEngineService receives event
4. SubagentOrchestratorService.spawnSubagent() called
5. Parent agent dehydrated (session.jsonl saved, container killed)
6. Child container provisioned with subagent profile and tools
7. Child agent boots and connects to WebSocket
8. Child agent executes task_prompt
9. Child agent may emit turn_end progress events while using tools
10. Child agent emits terminal agent_end with result
11. SubagentOrchestratorService.handleSubagentComplete() called
12. Child container killed
13. Parent session rehydrated (session.jsonl restored)
14. Subagent result injected into parent context
15. Parent container started
16. WorkflowEngineService emits tool_execution_end to parent
17. Parent agent receives subagent result as tool output
18. Parent continues execution

Total overhead: 3-8 seconds (dehydration + rehydration)
```

### SubagentExecutions Table Schema
```sql
CREATE TABLE subagent_executions (
  id UUID PRIMARY KEY,
  parent_container_id VARCHAR(64) NOT NULL,
  child_container_id VARCHAR(64) NOT NULL,
  parent_session_tree_id UUID REFERENCES pi_session_trees(id),
  depth INTEGER DEFAULT 0,
  status VARCHAR(20) CHECK (status IN ('Spawning', 'Running', 'Completed', 'Failed')),
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_parent_container ON subagent_executions(parent_container_id);
CREATE INDEX idx_child_container ON subagent_executions(child_container_id);
```

### Nested Subagent Tree
```
Parent (depth 0)
  └── Child (depth 1)
        └── Grandchild (depth 2)
              └── Great-grandchild (depth 3) ❌ REJECTED (max depth exceeded)
```

### Result Injection Example
Parent session.jsonl before subagent spawn:
```jsonl
{"id":"node_1","type":"user","content":"Implement and test login feature"}
{"id":"node_2","type":"assistant","content":"I'll spawn a subagent to run tests"}
{"id":"node_3","type":"tool_use","tool":"spawn_subagent","params":{...}}
```

Parent session.jsonl after subagent completes:
```jsonl
{"id":"node_1","type":"user","content":"Implement and test login feature"}
{"id":"node_2","type":"assistant","content":"I'll spawn a subagent to run tests"}
{"id":"node_3","type":"tool_use","tool":"spawn_subagent","params":{...}}
{"id":"node_4","type":"tool_result","tool":"spawn_subagent","result":"Tests passed. All 12 test cases successful."}
{"id":"node_5","type":"assistant","content":"Tests passed! Proceeding to deployment..."}
```

### Timeout Handling
- **Child Timeout**: 30 minutes (1800 seconds)
- **Detection**: BullMQ job timeout
- **Action**: Kill child container, resume parent with error
- **Error Message**: "Subagent timed out after 30 minutes"

### Security Considerations
- **Depth Limit**: Prevents infinite recursion and resource exhaustion
- **Tool Restrictions**: Subagents only get specified tools (no tool escalation)
- **Resource Limits**: Each subagent has same resource limits as parent
- **Isolation**: Subagents don't share session state with siblings

### Testing Strategy
- **Unit Tests**: SubagentOrchestratorService methods
- **Integration Tests**: Full parent-child lifecycle
- **E2E Tests**: Real Pi Agents with real subagent spawning
- **Stress Tests**: 10 nested subagents (test depth limit)

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Infinite subagent recursion | High | Medium | Depth limit (max 3), monitoring |
| Parent dehydration failures | High | Low | Comprehensive error handling, rollback |
| Subagent result injection bugs | High | Medium | Thorough testing, JSONL validation |
| Resource exhaustion (too many subagents) | Medium | Low | Container limits, max concurrent subagents |
| Orphaned child containers | Medium | Medium | Cleanup job, parent-child tracking |

## Parallel Development

**Can Run in Parallel**: NO (requires stable Epic 010)
**Blocks**: None (terminal epic)

## Related ADRs

- Create ADR-030: Subagent depth limit strategy
- Create ADR-031: Sequential vs. parallel subagent execution
- Create ADR-032: Subagent result serialization format

## Notes

- Subagent orchestration is the final piece - everything must be stable first
- Allocate full week for integration and testing
- Test thoroughly with real Pi Agents (subagent spawning is complex)
- Depth limit (3) should be configurable in future
- Consider adding subagent analytics (execution time, cost) in Epic 013
- Parallel subagent execution is a future enhancement (not MVP)
- Document common subagent patterns (QA, code review, data analysis)
