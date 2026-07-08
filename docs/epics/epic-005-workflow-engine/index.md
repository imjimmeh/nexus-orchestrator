# Epic 005: Workflow Engine - DAG & Cyclical Execution

## Overview

**Epic ID**: 005
**Layer**: Core Services
**Status**: Not Started
**Priority**: Critical (P0)
**Estimated Timeline**: 2 weeks

## Context

Build the core orchestration engine that parses YAML workflow definitions, evaluates DAG (Directed Acyclic Graph) dependencies, manages cyclical state machines for iterative loops, and enqueues execution steps via BullMQ. This is the "brain" of Nexus Core Engine - it interprets workflow definitions and coordinates the execution of multi-step, multi-agent workflows.

The Workflow Engine must support both parallel fan-out patterns (DAG dependencies) and iterative review loops (cyclical transitions). This enables complex workflows like "implement code → run tests → review → if failed, return to implementation" which are critical for autonomous software development.

## Dependencies

**Upstream Dependencies**:
- Epic 002 (Core Infrastructure) - for Workflows/WorkflowRuns tables, BullMQ
- Epic 003 (Docker Orchestration) - for container provisioning API

**Downstream Dependencies**:
- Epic 007 (WebSocket Telemetry) - receives workflow events
- Epic 009 (REST API) - exposes workflow endpoints
- Epic 010 (Pi Agent Integration) - executes workflow steps
- Epic 011 (Subagent Orchestration) - workflow-based subagent spawning

## Scope

### Included in This Epic

- **YAML Workflow Parser**
  - Parse YAML workflow files into internal representation
  - Support triggers (webhook, manual, scheduled)
  - Support global environment variables
  - Support step definitions with dependencies

- **DAG Dependency Resolver**
  - Topological sort for step execution order
  - Detect circular dependencies in DAGs
  - Parallel step execution planning (identify independent steps)

- **Cyclical State Machine**
  - Transition condition evaluator (e.g., `output.passed == true`)
  - Support for loops (step A → B → C → A if condition)
  - Loop detection and infinite loop prevention (max iterations)

- **State Variable Management**
  - Store state in WorkflowRuns.state_variables (JSONB)
  - Template variable substitution (e.g., `{{trigger.repo_url}}`)
  - Variable scoping (global, step-level, output)

- **BullMQ Step Execution**
  - Enqueue steps to bull:workflow_steps queue
  - Step execution consumer (BullMQ worker)
  - Handle step completion events
  - Update WorkflowRuns status (Running, Hibernated, Completed, Failed)

- **Workflow CRUD Operations**
  - Create workflow from YAML
  - Retrieve workflow by ID
  - Update workflow definition
  - Delete workflow (soft delete)
  - List all workflows with filtering

- **Workflow Validation**
  - Validate YAML syntax
  - Validate step references (all depends_on steps exist)
  - Validate transition targets (all next steps exist)
  - Validate tool references (all tools exist in ToolRegistry)
  - Detect circular dependencies

### Out of Scope

- Tool mounting (Epic 004)
- Session hydration (Epic 006)
- WebSocket telemetry broadcasting (Epic 007)
- Subagent spawning logic (Epic 011)
- Webhook API endpoints (Epic 009)
- Container image definitions (Epic 010)
- Scheduled workflow triggers (future enhancement)

## Tasks

### YAML Parser Implementation
- [ ] Install YAML parser library (js-yaml or yaml)
- [ ] Create WorkflowParserService
- [ ] Implement parseWorkflow(yamlString) method
  - Parse YAML to JavaScript object
  - Validate required fields (workflow_id, name, steps)
  - Transform into internal WorkflowDefinition type
- [ ] Implement template variable extraction
  - Identify all {{variable}} patterns
  - Build variable dependency graph
- [ ] Add YAML syntax error handling with line numbers
- [ ] Test with sample workflow files

### DAG Dependency Resolver
- [ ] Create DAGResolverService
- [ ] Implement buildDependencyGraph(steps) method
  - Create adjacency list from depends_on relationships
  - Detect cycles using DFS (Depth-First Search)
  - Throw error if circular dependency found
- [ ] Implement topologicalSort(graph) method
  - Kahn's algorithm or DFS-based topological sort
  - Return execution order for steps
- [ ] Implement findParallelSteps(graph) method
  - Identify steps with no mutual dependencies
  - Group into parallel execution batches
- [ ] Add comprehensive error messages for dependency issues
- [ ] Test with complex DAG workflows (10+ steps)

### Cyclical State Machine
- [ ] Create StateMachineService
- [ ] Implement evaluateTransition(condition, context) method
  - Parse condition string (e.g., "output.passed == true")
  - Evaluate against current state variables
  - Return next step ID or null
- [ ] Support condition operators:
  - Equality: ==, !=
  - Comparison: >, <, >=, <=
  - Logical: &&, ||, !
  - Existence: output.field != null
- [ ] Implement loop detection (max iterations: 10)
- [ ] Add transition history tracking (for debugging)
- [ ] Test with iterative review workflows

### State Variable Management
- [ ] Create StateManagerService
- [ ] Implement setVariable(workflowRunId, key, value) method
  - Update WorkflowRuns.state_variables (JSONB)
  - Support nested paths (e.g., "trigger.repo_url")
- [ ] Implement getVariable(workflowRunId, key) method
- [ ] Implement substituteTemplate(template, variables) method
  - Replace {{variable}} with actual values
  - Support nested access: {{trigger.data.field}}
- [ ] Add variable scoping (global vs. step-level)
- [ ] Test variable substitution with complex templates

### WorkflowEngineService Core
- [ ] Create WorkflowEngineService
- [ ] Implement startWorkflow(workflowId, triggerData) method
  - Create WorkflowRun record (status: Running)
  - Initialize state_variables with triggerData
  - Resolve DAG dependencies
  - Enqueue first step(s) to BullMQ
- [ ] Implement handleStepComplete(stepId, output) method
  - Update state variables with step output
  - Evaluate transitions (cyclical state machine)
  - Enqueue next step(s) based on DAG or transition
  - Update WorkflowRun status if complete
- [ ] Implement pauseWorkflow(workflowRunId) method
  - Set status to Hibernated
  - Clear pending BullMQ jobs
- [ ] Implement resumeWorkflow(workflowRunId) method
  - Set status to Running
  - Re-enqueue current step
- [ ] Add comprehensive logging for workflow execution

### BullMQ Step Execution Consumer
- [ ] Create StepExecutionConsumer (BullMQ processor)
- [ ] Implement processStep(job) method
  - Extract step definition and workflow context
  - Call ContainerOrchestratorService.provisionContainer()
  - Pass step inputs and tools to container
  - Wait for step completion (future: handled by Epic 010)
  - Call handleStepComplete() with output
- [ ] Add job retry logic (3 retries with exponential backoff)
- [ ] Add job timeout (max execution time: 1 hour)
- [ ] Handle job failures and update WorkflowRun status
- [ ] Test with mock container provisioning

### Workflow CRUD Operations
- [ ] Implement createWorkflow(yamlDefinition) method
  - Validate YAML
  - Validate all tool references exist
  - Store in Workflows table
- [ ] Implement getWorkflow(id) method
- [ ] Implement getAllWorkflows(filters) method
  - Filter by is_active
  - Pagination support
- [ ] Implement updateWorkflow(id, yamlDefinition) method
  - Validate new definition
  - Version the workflow (keep old versions)
- [ ] Implement deleteWorkflow(id) method (soft delete)
  - Set is_active = false
  - Don't delete WorkflowRun records
- [ ] Test CRUD operations with database

### Workflow Validation
- [ ] Create WorkflowValidationService
- [ ] Implement validateWorkflow(definition) method
  - Check YAML syntax
  - Check all depends_on references exist
  - Check all transition targets exist
  - Check no circular dependencies in DAG
  - Check all tools exist in ToolRegistry
  - Return validation errors with details
- [ ] Add validation on workflow creation
- [ ] Add validation on workflow updates
- [ ] Test with invalid workflow definitions

### Testing & Documentation
- [ ] Write unit tests for YAML parser
- [ ] Write unit tests for DAG resolver (topological sort, cycle detection)
- [ ] Write unit tests for state machine (condition evaluation)
- [ ] Write unit tests for state variable management
- [ ] Write integration tests for workflow execution
  - Simple 3-step DAG workflow
  - Cyclical review loop workflow
  - Complex workflow with parallel steps
- [ ] Write integration tests with BullMQ
- [ ] Document YAML workflow format
- [ ] Create workflow authoring guide
- [ ] Document condition syntax for transitions

## Key Deliverables

1. **WorkflowEngineService**
   - Full workflow execution engine
   - DAG and cyclical support
   - State variable management

2. **YAML Parser & Validator**
   - Parse YAML workflow files
   - Comprehensive validation
   - Error messages with line numbers

3. **DAG Dependency Resolver**
   - Topological sort
   - Circular dependency detection
   - Parallel step identification

4. **Cyclical State Machine**
   - Condition evaluator
   - Loop detection
   - Transition tracking

5. **BullMQ Integration**
   - Step execution consumer
   - Job retry and timeout
   - Workflow status tracking

6. **Documentation**
   - YAML workflow format reference
   - Workflow authoring guide
   - Condition syntax documentation

## Acceptance Criteria

- [ ] YAML workflow files can be parsed into internal representation
- [ ] Invalid YAML returns error with line number
- [ ] DAG dependencies are resolved in correct topological order
- [ ] Circular dependencies in DAG are detected and rejected
- [ ] Parallel steps are identified correctly
- [ ] Cyclical transitions evaluate conditions correctly (`output.passed == true`)
- [ ] Loops terminate after max iterations (10)
- [ ] State variables are stored and retrieved from WorkflowRuns.state_variables
- [ ] Template variables are substituted correctly (`{{trigger.repo_url}}`)
- [ ] BullMQ jobs are enqueued for each workflow step
- [ ] Step execution consumer triggers container provisioning (mocked for now)
- [ ] Workflow validation detects missing step references
- [ ] Workflow validation detects invalid tool references
- [ ] Failed workflows update status to "Failed" in database
- [ ] Completed workflows update status to "Completed"
- [ ] Hibernated workflows can be resumed
- [ ] Unit tests cover YAML parsing (100% coverage)
- [ ] Unit tests cover DAG resolution (including cycle detection)
- [ ] Unit tests cover condition evaluation
- [ ] Integration tests verify end-to-end workflow execution with mock containers
- [ ] 3-step DAG workflow executes steps in correct order
- [ ] Cyclical workflow loops until condition is met
- [ ] Workflow with parallel steps enqueues them simultaneously

## Technical Notes

### Technology Stack
- **YAML Parser**: js-yaml or yaml
- **Condition Evaluator**: Consider using expr-eval or write custom parser
- **Queue**: BullMQ (from Epic 002)
- **ORM**: TypeORM/Prisma (from Epic 002)

### YAML Workflow Format
```yaml
workflow_id: "wf_example"
name: "Example Workflow"
description: "Demonstrates DAG and cyclical patterns"

trigger:
  type: "webhook"
  event: "kanban.ticket.in_progress"

global_env:
  PROJECT_ID: "{{trigger.repo_url}}"

steps:
  - id: "step_1"
    type: "pi_agent_session"
    tier: "heavy"
    inputs:
      system_prompt: "Implement feature"
    tools: ["git_commit", "write_file"]

  - id: "step_2"
    type: "pi_agent_session"
    tier: "heavy"
    depends_on: ["step_1"]
    inputs:
      system_prompt: "Run tests"
    tools: ["bash"]

  - id: "step_3"
    type: "pi_agent_session"
    tier: "light"
    depends_on: ["step_2"]
    inputs:
      system_prompt: "Review code"
    tools: ["read_file"]
    transitions:
      - condition: "output.passed == false"
        next: "step_1"
      - condition: "output.passed == true"
        next: "step_4"

  - id: "step_4"
    type: "pi_agent_session"
    tier: "light"
    inputs:
      system_prompt: "Merge PR"
    tools: ["git_push"]
```

### DAG Dependency Graph
For the workflow above:
```
step_1 → step_2 → step_3 → step_4
         ↑                  ↓
         └──────────────────┘ (if output.passed == false)
```

### Condition Evaluation
Supported operators:
- **Equality**: `output.passed == true`, `status != "failed"`
- **Comparison**: `count > 5`, `score >= 80`
- **Logical**: `passed && !errors`, `status == "success" || status == "warning"`
- **Null checks**: `output.result != null`

### State Variable Structure
```json
{
  "trigger": {
    "repo_url": "https://github.com/org/repo",
    "ticket_id": "JIRA-123"
  },
  "global_env": {
    "PROJECT_ID": "https://github.com/org/repo"
  },
  "step_outputs": {
    "step_1": { "commit_sha": "abc123" },
    "step_2": { "passed": false, "errors": ["Test failed"] },
    "step_3": { "passed": false, "feedback": "Fix error handling" }
  }
}
```

### Loop Prevention
- **Max Iterations**: 10 loops per step
- **Detection**: Track (current_step_id, iteration_count) in WorkflowRun
- **Action**: Fail workflow with "Max iterations exceeded" error

### Testing Strategy
- **Unit Tests**: YAML parsing, DAG resolution, condition evaluation
- **Integration Tests**: Full workflow execution with BullMQ
- **Mock Container**: Use mock ContainerOrchestratorService for now
- **Test Workflows**: Create comprehensive test YAML files

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Infinite loops in cyclical workflows | High | Medium | Max iteration limit (10), loop detection |
| Complex condition evaluation bugs | Medium | High | Comprehensive test cases, use proven library |
| YAML parsing vulnerabilities | Medium | Low | Use trusted library (js-yaml), validate input |
| BullMQ job failures causing workflow stuck | High | Medium | Retry logic, timeout, manual intervention API |
| State variable size exceeds JSONB limits | Low | Low | Monitor size, implement compression if needed |

## Parallel Development

**Can Run in Parallel**: PARTIAL (after Epic 002 completes)
**Can Run Alongside**: Epic 004 (Tool Registry) - but needs Epic 003 API defined

## Related ADRs

- Create ADR-011: YAML vs. JSON for workflow definitions
- Create ADR-012: Condition evaluation library choice
- Create ADR-013: DAG execution strategy (sequential vs. parallel)
- Create ADR-014: Loop prevention mechanism

## Notes

- Workflow engine is the most complex service - allocate 2 full weeks
- Start with simple DAG workflows, add cyclical support incrementally
- Condition evaluation should be secure (no eval(), no arbitrary code)
- Consider adding workflow visualization later (Mermaid diagram generation)
- BullMQ job priority might be needed for critical workflows
- Workflow versioning is important for production (don't break running workflows)
