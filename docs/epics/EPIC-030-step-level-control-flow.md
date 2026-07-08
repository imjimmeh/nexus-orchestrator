# EPIC-030: Step-Level Control Flow

## Summary

Extend the workflow engine to support **step-level control flow** within a single job. This includes conditional transitions between steps, looping with max iteration limits, and non-agent step types (e.g., `run_command`). This enables workflows where a single container can run implementation → validation → conditional retry without spawning new containers.

## Motivation

### Problem

The current EPIC-028 (Jobs & Steps) model treats steps as simple sequential prompts to the same agent session. This is insufficient for the following use case:

**Example: Implement → Check → Commit Loop**

```yaml
jobs:
  - id: implement_work_item
    tier: heavy
    steps:
      - id: implement
        prompt: |
          Implement this work item...
          # Agent creates files, but may forget to commit
      
      - id: check_uncommitted     # NON-AGENT step - validates git status
        type: run_command
        command: "git status --porcelain"
      
      - id: commit                # Only runs if check_uncommitted found changes
        prompt: |
          Commit the uncommitted changes...
      
      - id: loop_back             # Re-run check if commit was done
        # Need to loop back to check_uncommitted
```

With only sequential steps, this pattern is impossible. The agent could be instructed to "implement and commit", but:
1. We have no independent verification that git is clean
2. Agent might forget or improperly commit
3. We need a non-agent validation step that doesn't depend on agent honesty

### Goals

1. **Step-level transitions**: Conditional flow control between steps within a job
2. **Step-level loops**: Ability to loop back to previous steps with max iteration limit
3. **Non-agent step types**: Steps that execute commands without agent intervention
4. **Step output capture**: Outputs from any step type accessible for condition evaluation

## Design

### Updated IJobStep Interface

```typescript
export interface IJobStep {
  id: string;
  type?: 'agent' | 'run_command' | 'set_variable' | 'wait';
  prompt?: string;              // For 'agent' type
  command?: string;             // For 'run_command' type
  working_dir?: string;         // For 'run_command' type
  variables?: Record<string, unknown>;  // For 'set_variable' type
  timeout_ms?: number;          // For 'run_command' and 'wait' types
  transitions?: IWorkflowTransition[];  // Conditional flow after this step
  on_error?: 'fail' | 'continue' | 'goto:{stepId}';  // Error handling
}
```

### Step-Level Transitions

Transitions at the step level work identically to job-level transitions:

```yaml
steps:
  - id: implement
    type: agent
    prompt: |
      Implement the feature...
    transitions:
      - condition: "steps.implement.output.ok == true"
        next: check_uncommitted
      - condition: "steps.implement.output.ok == false"
        next: fail_job

  - id: check_uncommitted
    type: run_command
    command: "git status --porcelain"
    transitions:
      - condition: "steps.check_uncommitted.output.stdout != ''"
        next: commit
      - condition: "steps.check_uncommitted.output.stdout == ''"
        next: done  # Special: marks job complete successfully

  - id: commit
    type: agent
    prompt: |
      Commit the uncommitted changes...
    transitions:
      - condition: "steps.commit.output.ok == true"
        next: check_uncommitted  # Loop back to verify
      - condition: "steps.commit.output.ok == false"
        next: fail_job
```

### Loop Protection

To prevent infinite loops, each step tracks:
- **loop_count**: Number of times this step has been executed in the current job
- **max_loops**: Optional limit (default: 5, configurable per-step or job-level)

```yaml
jobs:
  - id: implement_work_item
    tier: heavy
    max_step_loops: 10  # Job-level default
    steps:
      - id: check_uncommitted
        type: run_command
        command: "git status --porcelain"
        max_loops: 3    # Override: only check 3 times max
        transitions:
          - condition: "steps.check_uncommitted.output.stdout != '' && steps.check_uncommitted.loop_count < 3"
            next: commit
          - condition: "steps.check_uncommitted.output.stdout != '' && steps.check_uncommitted.loop_count >= 3"
            next: fail_job  # Too many attempts
          - condition: "steps.check_uncommitted.output.stdout == ''"
            next: done
```

### Step Types

#### 1. `agent` (default)
Executes a prompt through the agent session. Waits for agent response.

```yaml
- id: implement
  type: agent  # optional, default
  prompt: |
    Implement the feature...
```

#### 2. `run_command`
Executes a shell command directly, bypassing the agent. Captures stdout, stderr, exit code.

```yaml
- id: check_uncommitted
  type: run_command
  command: "git status --porcelain"
  working_dir: "/workspace"  # optional, defaults to container workdir
  timeout_ms: 30000          # optional, defaults to 60000
```

Output structure:
```typescript
{
  ok: boolean;        // true if exit_code === 0
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}
```

#### 3. `set_variable`
Sets state variables without agent interaction.

```yaml
- id: init_counter
  type: set_variable
  variables:
    attempt_count: 0
    max_attempts: 5
```

#### 4. `wait`
Pauses execution for a specified duration.

```yaml
- id: cooldown
  type: wait
  timeout_ms: 5000
```

### State Variables for Steps

```
jobs.{jobId}.steps.{stepId}.output      # Step output (varies by type)
jobs.{jobId}.steps.{stepId}.loop_count  # Number of times this step executed
jobs.{jobId}.steps.{stepId}.status      # pending | running | completed | failed | skipped
```

### Special Transition Targets

- `done` - Mark job as successfully completed
- `fail_job` - Mark job as failed
- `goto:{stepId}` - Jump to specific step (alternative to explicit transition)

### Default Behavior

For backward compatibility and ergonomics:

1. **No transitions defined**: Sequential execution (step N → step N+1)
2. **No step type defined**: Defaults to `agent`
3. **Agent step without prompt**: Validation error
4. **Last step completes with no transitions**: Job marked complete

### Execution Flow

```
Job Start
    │
    ▼
┌─────────────────┐
│  Step Runner    │◄─────────────────────────┐
│  (Orchestrator) │                          │
└────────┬────────┘                          │
         │                                   │
         ▼                                   │
┌─────────────────┐                          │
│  Execute Step   │                          │
│  (by type)      │                          │
└────────┬────────┘                          │
         │                                   │
         ▼                                   │
┌─────────────────┐                          │
│  Check Loops    │──Exceeded──► FAIL JOB    │
└────────┬────────┘                          │
         │ OK                                │
         ▼                                   │
┌─────────────────┐                          │
│  Evaluate       │                          │
│  Transitions    │                          │
└────────┬────────┘                          │
         │                                   │
    ┌────┴────┐                              │
    │         │                              │
    ▼         ▼                              │
  done    next_step ─────────────────────────┘
    │
    ▼
 JOB COMPLETE
```

## Implementation Plan

### Phase 1: Extend Interfaces

**T1.1** — Update `IJobStep` in `packages/core/src/interfaces/index.ts`
- Add `type`, `command`, `working_dir`, `variables`, `timeout_ms`, `transitions`, `on_error`
- Add `max_loops` to `IJob` for job-level default

**T1.2** — Update `IWorkflowDefinition` to include job-level loop settings
- `IJob.max_step_loops?: number` - global default for step loops in this job

**T1.3** — Define step output interfaces
- `IRunCommandOutput`, `ISetVariableOutput`, `IWaitOutput`

### Phase 2: Step Execution Service

**T2.1** — Create `StepExecutionService` in `apps/api/src/workflow/`
- Orchestrates step execution within a job
- Manages step state (pending, running, completed, failed, skipped)
- Tracks loop counts per step

**T2.2** — Create `StepRunnerRegistry` with handlers for each step type
- `AgentStepRunner` - sends prompt via WebSocket, waits for response
- `RunCommandStepRunner` - exec in container, capture output
- `SetVariableStepRunner` - update state variables
- `WaitStepRunner` - setTimeout, continue

**T2.3** — Implement step transition evaluation
- Use existing condition evaluation from state machine service
- Support special targets: `done`, `fail_job`

**T2.4** — Implement loop tracking
- Track `loop_count` per step in state variables
- Check against `max_loops` before executing step
- Fail job if exceeded

### Phase 3: Multi-Step Job Execution

**T3.1** — Update `StepAgentStepExecutorService.executeMultiStepJob()`
- Replace placeholder with real implementation
- Use `StepExecutionService` to orchestrate
- Support transitions/loops

**T3.2** — Implement WebSocket-based step progression
- Container stays alive in interactive mode
- Step prompts sent as `prompt` commands
- Agent responses captured as step outputs

**T3.3** — Handle `run_command` steps in container context
- Use Docker API to exec command in running container
- Capture stdout/stderr/exit code
- Handle timeouts

### Phase 4: State Management

**T4.1** — Update `StateManagerService` for step-level variables
- New pattern: `jobs.{jobId}.steps.{stepId}.{field}`
- Store `loop_count`, `output`, `status` per step

**T4.2** — Update template substitution
- Support `steps.{stepId}` as shorthand for `jobs.{currentJob}.steps.{stepId}`
- Support `loop_count` in conditions

### Phase 5: Validation

**T5.1** — Update `WorkflowValidationService`
- Validate step transitions reference valid step IDs within same job
- Validate `max_loops` is positive integer
- Validate `command` exists for `run_command` type
- Validate `prompt` exists for `agent` type
- Detect cycles (excluding intentional loops)

**T5.2** — Add warnings for potentially infinite loops
- If a loop has no exit condition other than max_loops, warn

### Phase 6: Update Seed Workflows

**T6.1** — Convert `work-item-in-progress-default.workflow.yaml`

```yaml
jobs:
  - id: implement_and_commit
    tier: heavy
    max_step_loops: 5
    inputs:
      agent_profile: architect-agent
    steps:
      - id: implement
        type: agent
        prompt: |
          Implement this work item:
          Title: {{trigger.workItem.title}}
          Description: {{trigger.workItem.description}}
          
          After implementing, stage any new files but do NOT commit.
          A validation step will check for uncommitted changes.

      - id: check_uncommitted
        type: run_command
        command: "git status --porcelain"
        transitions:
          - condition: "steps.check_uncommitted.output.stdout != ''"
            next: commit
          - condition: "steps.check_uncommitted.output.stdout == ''"
            next: done

      - id: commit
        type: agent
        prompt: |
          There are uncommitted changes. Stage and commit them now.
          
          Run: git add -A && git commit -m "feat: <descriptive message>"
          
          Do NOT leave any uncommitted files.
        transitions:
          - condition: "steps.commit.output.ok == true"
            next: check_uncommitted

  - id: transition_to_review
    type: transition_status
    tier: light
    depends_on: [implement_and_commit]
    inputs:
      target_status: in-review
```

**T6.2** — Review and update other seed workflows if step-level control flow benefits them

### Phase 7: Testing

**T7.1** — Unit tests for `StepExecutionService`
- Sequential steps
- Conditional transitions
- Loop with max limit
- Loop exit conditions
- Special targets (done, fail_job)

**T7.2** — Unit tests for step runners
- `AgentStepRunner` mock WebSocket
- `RunCommandStepRunner` mock Docker exec
- `SetVariableStepRunner`
- `WaitStepRunner`

**T7.3** — Integration tests
- Full workflow with step-level loops
- Verify step outputs in state variables
- Verify loop_count tracking
- Verify container reuse across steps

### Phase 8: Deployment & E2E Verification

**T8.1** — Deploy updated API with new workflow engine

**T8.2** — Delete existing `work-item-in-progress-default` workflow from database to force reseed

**T8.3** — Run E2E kanban lifecycle test:
- Create project with auto-initialized git repo (no repositoryUrl)
- Create work item
- Move to in-progress (triggers workflow)
- Verify single container runs all steps:
  - `implement` step creates files
  - `check_uncommitted` step detects changes
  - `commit` step commits
  - `check_uncommitted` runs again, confirms clean
  - Workflow completes, transitions to in-review

**T8.4** — Verify artifacts:
- PRD file exists in workspace
- Git log shows commit with descriptive message
- No uncommitted changes remain
- Work item status is `in-review`

## Files Changed

| File | Impact | Description |
|------|--------|-------------|
| `packages/core/src/interfaces/index.ts` | Critical | New step type interfaces, IJobStep extensions |
| `apps/api/src/workflow/step-execution.service.ts` | Critical | NEW - Orchestrates step execution |
| `apps/api/src/workflow/step-runners/*.ts` | Critical | NEW - Per-type step execution handlers |
| `apps/api/src/workflow/step-agent-step-executor.service.ts` | Critical | Update multi-step implementation |
| `apps/api/src/workflow/state-manager.service.ts` | High | Step-level state variables |
| `apps/api/src/workflow/workflow-validation.service.ts` | High | Step transition validation |
| `apps/api/src/workflow/workflow-parser.service.ts` | Medium | Parse step type, transitions |
| `apps/api/src/workflow/step-transition-evaluator.service.ts` | High | NEW - Evaluate step transitions |
| `apps/api/src/database/seeds/*.workflow.yaml` | Medium | Update to use step-level control flow |
| `apps/web/src/components/workflow/WorkflowVisualizer.tsx` | Medium | Visualize step transitions |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Infinite loops in step cycles | Mandatory `max_loops` limit; validation warns on loops without exit conditions |
| Container state corruption between steps | Session hydration/dehydration on each step; state stored in DB |
| Complex transition logic hard to debug | Detailed logging of transition evaluation; step-level telemetry events |
| Breaking existing multi-step jobs | Default sequential behavior preserved; transitions are opt-in |

## Success Criteria

1. Single container can run: implement → check_uncommitted → commit → loop back
2. Loop terminates when either: git is clean OR max_loops exceeded
3. No new containers spawned during step transitions
4. Step outputs accurately captured and queryable in conditions
5. All existing workflows continue to work (backward compatibility)

## Future Considerations

- **Parallel steps**: Run multiple steps concurrently within same container
- **Step timeouts**: Fail step if it takes too long
- **Step retries**: Automatic retry on failure (distinct from loop)
- **Step-level caching**: Skip step if conditions already met
