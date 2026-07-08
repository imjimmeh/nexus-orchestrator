# EPIC-044 Orchestrator-Led Execution — Planning Agent & Subagent Delegation

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](../architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md).

## Status

Planned

## Parent SDD

[SDD: Flat Work Items & Orchestrated Execution — Phase 2](../specs/SDD-flat-work-items-and-orchestrated-execution.md#5-phase-2--orchestrator-led-execution)

## Prerequisites

- EPIC-043 (Flat Work Items) must be complete — `scope` column exists, hierarchy removed.

## Problem Statement

After Phase 1 flattens the hierarchy, work items are self-contained but vary in complexity. A simple one-file bug fix and a multi-module feature both go through the same pipeline: dispatch → agent implements blindly from the spec → review → merge.

This fails for larger work items because:

1. **No planning** — The implementing agent jumps straight into code with no architectural analysis. It doesn't read the codebase structure, identify affected modules, or reason about its approach before writing. This leads to fragmented implementations that miss integration points.
2. **Wasted subagent infrastructure** — The full subagent spawn/dehydrate/rehydrate pipeline is implemented (`SubagentOrchestratorService` facade at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`, delegating to `SubagentProvisioningService` / `SubagentCoordinationService`; plus `SessionHydrationService`, container provisioning) but has never been activated in production workflows. The `spawn_subagent` tool exists in agent profiles but the implementation workflow doesn't encourage or facilitate its use.
3. **Context overload** — For `large` scope items, a single agent session trying to implement everything in order risks running out of context window before completing. Focused subtasks with clear boundaries would produce better results.
4. **No verification** — The agent commits and immediately transitions to external review. There's no self-verification step where the orchestrating agent checks that all deliverables integrate correctly.

## Goals

1. Add a **planning step** to the implementation workflow that runs before coding begins.
2. Activate the **subagent delegation** pipeline so the orchestrator can delegate focused subtasks.
3. Fix the **subagent infrastructure gaps** that prevent production use (shared worktree, session rehydration completion).
4. Add a **new orchestrator agent profile** designed for plan-then-delegate execution.
5. Add new tools: `submit_implementation_plan` (output capture) and `check_subagent_status` (polling).
6. Scope-conditional execution: `standard` items skip planning (fast path); `large` items get the full orchestration.

## Non-Goals

- Parallel subagent execution (Phase 3 — EPIC-045).
- Adaptive scope detection (Phase 3).
- Re-planning on review rejection (Phase 3).
- Changes to the review or merge workflows (Phase 3 enhances review).
- Web UI changes for plan visualization (future follow-up).

## Current-State Analysis

### Subagent System (Implemented, Unused)

The infrastructure exists across several files:

| Component                | File                                                          | Status                                                                      |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Orchestration service    | `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` | Implemented — thin facade that delegates spawn / coordination / completion handling to the inner services |
| Execution entity         | `apps/api/src/database/entities/subagent-execution.entity.ts` | Implemented — tracks parent/child relationship, depth, status, result       |
| Session dehydration      | `apps/api/src/session/session-hydration.service.ts`           | Implemented — extract JSONL, compress, store in `PiSessionTrees`            |
| Session rehydration      | `apps/api/src/session/session-hydration.service.ts`           | **Incomplete** — parent resume after child completion needs work            |
| WebSocket spawn handling | `apps/api/src/telemetry/telemetry.gateway.ts`                 | Implemented — routes `spawn_subagent` message to orchestrator               |
| `spawn_subagent` tool    | `apps/api/src/tool/tool-catalog.service.ts`                   | Implemented — schema defined, tier-2 restriction                            |
| Multistep executor       | `apps/api/src/workflow/step-agent-step-executor.multistep.ts` | Implemented — handles subagent signals in agent turn processing             |

**Key gaps preventing production use:**

1. **No shared workspace** — Subagent gets a fresh container with no worktree mount. It cannot read or write the parent's working directory.
2. **Incomplete rehydration** — After child completes, parent session restoration has incomplete result injection.
3. **No plan structure** — No mechanism for the orchestrator to decide what to delegate vs do itself.
4. **No status polling** — Orchestrator cannot check subagent status; it just dehydrates and waits.

### Implementation Workflow (Current)

From `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`:

```
provision_worktree → implement_and_commit (loop: implement → check_uncommitted → commit) → transition_to_review
```

No planning, no delegation, no self-verification. Agent jumps directly from worktree provisioning to writing code.

### Agent Profiles

From `apps/api/src/database/seeds/agent-profiles/agent-profile-definitions.provider.ts`:

- `architect-agent` — already has `spawn_subagent` in allowed tools, designed for "translating requirements into technical architecture"
- `senior_dev` — primary implementing agent, heavy tier
- `staff_engineer` — all tools allowed, elevated capabilities
- `orchestrator` profile — **does not exist yet**

## Detailed Task List

### Task 1: Create Orchestrator Agent Profile

**Goal:** Define a new agent profile designed for plan-then-delegate execution.

**Files:**

- Create profile in: `apps/api/src/database/seeds/agent-profiles/`
- Update: `apps/api/src/database/seeds/agent-profiles/agent-profile-definitions.provider.ts`

**Profile definition:**

```typescript
{
  name: 'orchestrator',
  system_prompt: `You are an implementation orchestrator. You receive a work item spec
and an implementation plan. Your job is to execute the plan by:

1. Implementing simple tasks directly using read_file, write_file, and bash
2. Delegating complex or parallelizable tasks to subagents via spawn_subagent
3. Integrating all results after subagent completion
4. Running tests and fixing integration issues
5. Committing the final result via step_complete

When delegating to a subagent, provide:
- Clear task description with specific files to modify
- Acceptance criteria for the subtask
- Context about the broader feature being implemented
- The agent_profile best suited for the task (senior_dev, qa_automation, etc.)

After all subagent tasks complete, verify the integrated result by:
- Reading all modified files to check consistency
- Running relevant tests via bash
- Fixing any integration issues before committing`,
  tier_preference: 'heavy',
  allowed_tools: [
    'read_file', 'write_file', 'bash',
    'spawn_subagent', 'check_subagent_status',
    'step_complete', 'nexus_orchestrator',
    'submit_implementation_plan'
  ]
}
```

**Acceptance Criteria:**

- [ ] `orchestrator` profile seeded to database on startup
- [ ] Profile has `spawn_subagent` and `check_subagent_status` in allowed tools
- [ ] Profile uses heavy tier
- [ ] System prompt instructs plan-then-delegate-then-verify workflow

---

### Task 2: Create `submit_implementation_plan` Tool

**Goal:** New output tool that captures the planner's structured implementation plan.

**Files:**

- `apps/api/src/tool/tool-catalog.service.ts` (or tool seed file)

**Tool schema:**

```typescript
{
  name: 'submit_implementation_plan',
  tier_restriction: 2,  // HEAVY only
  api_callback: true,    // captured as output tool
  schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Brief overview of the implementation approach'
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique task identifier, e.g. task-1' },
            title: { type: 'string' },
            description: { type: 'string', description: 'Detailed instructions for this task' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of tasks that must complete before this one'
            },
            agent_profile: {
              type: 'string',
              description: 'Agent profile for execution: senior_dev, qa_automation, etc.'
            },
            delegation_strategy: {
              type: 'string',
              enum: ['self', 'subagent'],
              description: 'Whether the orchestrator should do this itself or delegate'
            },
            files_to_modify: {
              type: 'array',
              items: { type: 'string' },
              description: 'Expected file paths to create or modify'
            },
            acceptance_criteria: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['id', 'title', 'description', 'delegation_strategy']
        }
      },
      execution_strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'mixed'],
        description: 'Overall ordering strategy for tasks'
      }
    },
    required: ['summary', 'tasks', 'execution_strategy']
  }
}
```

**Acceptance Criteria:**

- [ ] Tool registered in tool catalog with correct schema
- [ ] Tool is tier-2 restricted (heavy only)
- [ ] Tool marked as `api_callback` / output tool for capture by workflow engine
- [ ] Plan output persisted in workflow run `state_variables` for downstream steps

---

### Task 3: Create `check_subagent_status` Tool

**Goal:** Allow the orchestrator to poll subagent execution status after spawning.

**Files:**

- `apps/api/src/tool/tool-catalog.service.ts` (or tool seed file)
- Callback handler in relevant API controller

**Tool schema:**

```typescript
{
  name: 'check_subagent_status',
  tier_restriction: 2,
  api_callback: true,
  schema: {
    type: 'object',
    properties: {
      execution_id: {
        type: 'string',
        description: 'The subagent execution ID returned by spawn_subagent'
      }
    },
    required: ['execution_id']
  }
}
```

**Callback response:**

```typescript
{
  execution_id: string,
  status: 'Spawning' | 'Running' | 'Completed' | 'Failed',
  result?: any,          // present only when Completed
  error_message?: string // present only when Failed
}
```

**Acceptance Criteria:**

- [ ] Tool returns current status from `SubagentExecution` entity
- [ ] Returns result payload when status is `Completed`
- [ ] Returns error message when status is `Failed`
- [ ] Returns `Spawning` or `Running` when in progress

---

### Task 4: Fix Subagent Shared Worktree

**Goal:** Mount the parent's git worktree into subagent containers so they can read/write the same files.

**Files:**

- `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` (facade; delegates to `SubagentProvisioningService` / `SubagentCoordinationService`)
- `apps/api/src/docker/container-orchestrator.service.ts`

**Changes:**

In `SubagentProvisioningService` (via `SubagentOrchestratorService` facade, today re-exported by the orchestration operations helpers):

1. Resolve the parent container's workspace mount path from its container config (stored in workflow run state or container labels)
2. Pass the same host path as a bind mount for the child container

```typescript
// Pseudocode
const parentWorkspacePath = await this.resolveParentWorkspacePath(
  parentContainerId,
  workflowRunId,
);
containerConfig.hostConfig.Binds = [`${parentWorkspacePath}:/workspace:rw`];
containerConfig.env.WORKSPACE_PATH = "/workspace";
```

In `ContainerOrchestratorService`:

- Ensure the workspace mount information is accessible (stored in container labels or workflow state)
- Add a `getContainerWorkspacePath(containerId)` method if not already present

**Acceptance Criteria:**

- [ ] Subagent container has the same workspace directory mounted as its parent
- [ ] Subagent can read files that the parent has written
- [ ] Changes made by the subagent are visible to the parent on rehydration
- [ ] Workspace mount path retrieved from container metadata, not hardcoded

---

### Task 5: Fix Session Rehydration on Subagent Completion

**Goal:** Complete the parent session rehydration flow when a subagent finishes.

**Files:**

- `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` (facade; delegates `handleCompletion` to `SubagentCoordinationService`)
- `apps/api/src/session/session-hydration.service.ts`

**Current gap:** After the child completes, the parent needs to:

1. Receive the child's result
2. Have that result injected as a system message into its session
3. Be rehydrated in a new container
4. Continue execution from where it left off

**Changes:**

- In `handleSubagentCompleteByExecutionId()`:
  1. Extract child result from `SubagentExecution.result`
  2. Call `SessionHydrationService.appendResultNode(parentSessionTreeId, childResult)` — this appends a new JSONL node to the parent's session tree with the subagent's output
  3. Provision a new parent container with the same worktree mount
  4. Call `SessionHydrationService.rehydrateSession(newContainerId, parentSessionTreeId)` — inject the session JSONL back into the container
  5. Start the container — pi-runner picks up from the last node
  6. Update `SubagentExecution.status = 'Completed'`

- In `SessionHydrationService`:
  - Verify `appendResultNode()` correctly creates a child node of the parent's `last_leaf_node_id`
  - Verify `rehydrateSession()` correctly decompresses and injects the full JSONL including the appended result node
  - Add integration test for the full dehydrate → append → rehydrate cycle

**Acceptance Criteria:**

- [ ] Parent agent resumes after subagent completion
- [ ] Parent's context includes the subagent's result as a system message
- [ ] Parent can read files modified by the subagent (shared worktree)
- [ ] Full cycle tested: parent → dehydrate → child runs → child completes → parent rehydrates → parent continues

---

### Task 6: Add Planning Step to Implementation Workflow

**Goal:** Modify the implementation workflow to include a planning step before implementation.

**Files:**

- `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`

**New workflow structure:**

```yaml
name: work_item_in_progress_default
trigger:
  type: webhook
  event: kanban.ticket.in_progress

jobs:
  - id: provision_worktree
    type: manage_worktree
    inputs:
      action: provision
      target_branch: "feature/{{ trigger.workItemId }}"
      base_branch: "{{ trigger.executionConfig.baseBranch || trigger.baseBranch || 'main' }}"

  - id: plan_implementation
    depends_on: [provision_worktree]
    type: execution
    tier: heavy
    agent_profile: architect-agent
    condition: "{{ trigger.workItem.scope == 'large' }}"
    inputs:
      system_prompt: |
        You are a planning agent. Analyze the work item spec and the current codebase,
        then produce a structured implementation plan.

        Read the spec carefully. Explore the codebase structure to understand:
        - Which files/modules need to be created or modified
        - How the deliverables relate to each other
        - What order tasks should be executed in
        - Which tasks can be delegated to subagents vs done by the orchestrator

        You MUST call the submit_implementation_plan tool with your plan.
        Do NOT write any code. Only plan.
      work_item_spec: "{{ trigger.workItem.description }}"
      context_files: "{{ trigger.executionConfig.contextFiles }}"
    output_tools: [submit_implementation_plan]
    allow_tools: [read_file, bash, submit_implementation_plan]
    deny_tools: [write_file, spawn_subagent]
    max_loops: 1

  - id: implement_and_commit
    depends_on: [plan_implementation]
    type: execution
    tier: heavy
    agent_profile: "{{ jobs.plan_implementation.output.plan ? 'orchestrator' : 'senior_dev' }}"
    max_loops: 5
    inputs:
      implementation_plan: "{{ jobs.plan_implementation.output }}"
      system_prompt: |
        {{#if implementation_plan}}
        Follow the implementation plan provided. For tasks marked 'subagent',
        use spawn_subagent to delegate. For tasks marked 'self', implement directly.
        After all tasks complete, verify integration and commit.
        {{else}}
        Implement the work item spec directly. Read the spec, understand the
        deliverables, implement them, write tests, and commit.
        {{/if}}
    steps:
      - id: implement
        type: agent
      - id: check_uncommitted
        type: run_command
        command: "git status --porcelain"
      - id: commit
        type: agent
        inputs:
          instruction: "Commit changes with conventional commit messages."

  - id: transition_to_review
    depends_on: [implement_and_commit]
    type: transition_status
    inputs:
      target_status: in-review
```

**Key design decisions:**

- `plan_implementation` has a `condition` — only runs for `scope == 'large'`. Standard items skip directly to `implement_and_commit`.
- The planner uses `architect-agent` with `write_file` denied — it can read and analyze but cannot modify the codebase.
- The implementing agent profile is selected dynamically — `orchestrator` if a plan exists, `senior_dev` for direct implementation.

**Acceptance Criteria:**

- [ ] `standard` scope items skip the planning step (condition evaluates false)
- [ ] `large` scope items run planning → implementation → review
- [ ] Plan output from `submit_implementation_plan` is available to `implement_and_commit` step
- [ ] Agent profile selection is dynamic based on plan presence
- [ ] Existing `standard` workflow performance is unchanged (no regression)

---

### Task 7: Workflow Engine — Conditional Step Support

**Goal:** Ensure the workflow engine correctly evaluates step `condition` expressions and skips steps when false.

**Files:**

- `apps/api/src/workflow/step-execution.service.ts`
- `apps/api/src/workflow/step-execution-orchestrator.service.ts`
- `apps/api/src/workflow/dag-resolver.service.ts`

**Changes:**

- Verify that the DAG resolver handles `condition` on jobs — if condition is false, the job is marked as `SKIPPED` (not `FAILED`)
- Ensure downstream jobs that `depends_on` a skipped job proceed normally (skipped != failed)
- If condition evaluation isn't implemented yet, add it:
  1. Evaluate `condition` string against the workflow state context (trigger, jobs, etc.)
  2. If condition evaluates to false/falsy, mark job as `SKIPPED`
  3. Dependent jobs treat skipped parents as satisfied (not blocking)

**Acceptance Criteria:**

- [ ] Job with `condition` evaluating to false is skipped, not failed
- [ ] Downstream jobs depending on a skipped job proceed normally
- [ ] Condition has access to `trigger.*` variables (e.g., `trigger.workItem.scope`)
- [ ] Unit tests cover: condition true → runs, condition false → skips, downstream proceeds

---

### Task 8: Dynamic Agent Profile Selection in Jobs

**Goal:** Allow job `agent_profile` to reference output from previous jobs.

**Files:**

- `apps/api/src/workflow/step-execution-orchestrator.service.ts`
- `apps/api/src/workflow/step-agent-step-executor.service.ts`

**Changes:**

- Ensure `agent_profile` field supports template variable resolution:
  ```yaml
  agent_profile: "{{ jobs.plan_implementation.output.plan ? 'orchestrator' : 'senior_dev' }}"
  ```
- If the current template engine doesn't support ternary expressions, add a simpler mechanism:
  ```yaml
  agent_profile_map:
    default: senior_dev
    when_plan_exists: orchestrator
  ```
- At minimum, support static fallback: if `plan_implementation` was skipped, use `senior_dev`; if it ran and produced output, use `orchestrator`.

**Acceptance Criteria:**

- [ ] Agent profile for `implement_and_commit` varies based on whether planning ran
- [ ] When `plan_implementation` is skipped (standard scope), agent is `senior_dev`
- [ ] When `plan_implementation` produces output (large scope), agent is `orchestrator`
- [ ] Template resolution or mapping logic has unit tests

---

### Task 9: Subagent Integration Tests

**Goal:** End-to-end verification that the orchestrator → subagent → rehydration pipeline works.

**Files:**

- Create: `apps/api/src/workflow/subagent-orchestrator.service.spec.ts` (or update existing)
- Create: `apps/api/src/session/session-hydration.service.spec.ts` (or update existing)

**Test scenarios:**

1. **Spawn and complete:** Orchestrator spawns subagent → child runs → child completes → parent rehydrates with result
2. **Shared worktree:** Subagent writes a file → parent rehydrates and can read that file
3. **Depth limit:** Attempting to spawn at depth > 3 fails gracefully
4. **Failed subagent:** Child fails → parent rehydrates with error message → parent handles gracefully
5. **Status polling:** `check_subagent_status` returns correct status at each lifecycle stage

**Acceptance Criteria:**

- [ ] All 5 test scenarios pass
- [ ] Tests use mocked Docker/container interactions (unit tests)
- [ ] Tests verify JSONL session tree manipulation (dehydrate → append → rehydrate)
- [ ] Tests verify workspace bind mount configuration

---

### Task 10: End-to-End Validation

**Goal:** Validate the full orchestrated execution pipeline with the deterministic test harness.

**Changes:**

- Update the deterministic kanban integration test (EPIC-042) mock executor to handle:
  - `plan_implementation` job: return a deterministic plan with 2 tasks
  - `implement_and_commit` job with orchestrator profile: simulate subagent spawning
- Alternatively, create a new integration test specifically for the plan → delegate → verify flow
- Verify both paths:
  - `standard` scope: planning skipped, direct implementation as before
  - `large` scope: planning runs, plan captured, orchestrator executes

**Acceptance Criteria:**

- [ ] Standard scope items complete in same time as before (no regression)
- [ ] Large scope items complete with plan visible in workflow run state
- [ ] Full test suite passes

## File Plan

### Files to Create

| File                                         | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| Orchestrator agent profile definition        | New agent profile for plan-then-delegate |
| `submit_implementation_plan` tool definition | Output tool for plan capture             |
| `check_subagent_status` tool definition      | Status polling tool                      |
| Subagent integration test file               | E2E validation of subagent pipeline      |

### Files to Modify

| File                                                                               | Changes                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/api/src/database/seeds/agent-profiles/agent-profile-definitions.provider.ts` | Add orchestrator profile                        |
| `apps/api/src/tool/tool-catalog.service.ts`                                        | Add new tools                                   |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`     | Shared worktree mount, rehydration fixes        |
| `apps/api/src/docker/container-orchestrator.service.ts`                            | `getContainerWorkspacePath()` method            |
| `apps/api/src/session/session-hydration.service.ts`                                | Complete rehydration flow, `appendResultNode()` |
| `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`          | Add planning step, conditional execution        |
| `apps/api/src/workflow/step-execution.service.ts`                                  | Conditional step evaluation                     |
| `apps/api/src/workflow/step-execution-orchestrator.service.ts`                     | Dynamic agent profile resolution                |
| `apps/api/src/workflow/dag-resolver.service.ts`                                    | Skipped job handling                            |
| `apps/api/src/workflow/step-agent-step-executor.multistep.ts`                      | Verify subagent signal handling                 |

## Referenced Documentation

| Document                                                                                                          | Relevance                           |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [SDD — Phase 2](../specs/SDD-flat-work-items-and-orchestrated-execution.md#5-phase-2--orchestrator-led-execution) | Design specification for this phase |
| [Subagent Orchestration Architecture](../architecture/subagent-orchestration.md)                                  | Existing subagent system design     |
| [Session Hydration Architecture](../architecture/session-hydration.md)                                            | Dehydrate/rehydrate pipeline        |
| [Container Orchestration Architecture](../architecture/container-orchestration.md)                                | Container provisioning and mounts   |
| [Workflow Engine Architecture](../architecture/workflow-engine.md)                                                | Step execution, DAG resolution      |
| [EPIC-043 — Flat Work Items](EPIC-043-flat-work-items-dependency-graph.md)                                        | Phase 1 prerequisite                |

## Risks and Mitigations

| Risk                                               | Impact                                        | Mitigation                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning step adds latency to all large items      | 30s–2min added per work item                  | Only `large` scope triggers planning. `standard` items skip entirely. Planning cost recovered by avoiding multiple failed implementation attempts.                      |
| Subagent rehydration fails mid-execution           | Orchestrator loses state, work item stuck     | Implement robust error handling: if rehydration fails, mark workflow run as failed (not stuck). Alert via event ledger with `severity: critical`.                       |
| Subagent writes conflicting changes                | Merge conflicts within single worktree        | Phase 2 uses sequential delegation only — no concurrent subagents writing to the same worktree. Phase 3 (EPIC-045) addresses parallel execution with file partitioning. |
| Plan quality is poor                               | Orchestrator follows bad plan, wastes tokens  | Plan is visible in workflow state for debugging. Self-verification step catches issues before review. Review workflow (Phase 3) can check plan vs implementation.       |
| Condition evaluation in workflow engine is missing | Planning step cannot be conditionally skipped | Task 7 explicitly addresses this. If not feasible quickly, use a simpler approach: always run planning but make it a no-op for standard items (return empty plan).      |

## Dependencies

- **EPIC-043** must be complete (scope column exists on work items)
- **EPIC-042** (deterministic tests) strongly recommended for validation

## Definition of Done

- [ ] Orchestrator agent profile seeded and functional
- [ ] `submit_implementation_plan` and `check_subagent_status` tools registered
- [ ] Subagent containers mount parent's worktree
- [ ] Parent rehydration works after subagent completion (full cycle)
- [ ] Implementation workflow has conditional planning step
- [ ] `standard` scope items execute without planning (same as before)
- [ ] `large` scope items execute with planning → orchestration → verification
- [ ] Subagent integration tests pass
- [ ] Full unit test suite passes
- [ ] TypeScript compilation clean
- [ ] ESLint clean
