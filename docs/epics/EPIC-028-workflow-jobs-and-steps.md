# EPIC-028: Workflow Jobs & Steps Model

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](../architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md).

## Summary

Refactor the workflow engine to adopt a GitHub Actions–inspired **jobs + steps** execution model. A workflow consists of one or more **jobs**; each job runs in its own container. A job consists of one or more **steps**; each step runs sequentially in the same container as the rest of its job. This replaces the current flat `steps` array, where every entry is an independent container execution.

## Motivation

Currently every workflow `step` provisions a new Docker container. This makes it impossible to send a follow-up prompt to the same agent session — for example, to verify uncommitted files and ask the agent to commit after its main implementation work. The only current workaround is to bake everything into the initial system prompt (unreliable) or abuse the retry mechanism (semantically wrong).

The jobs+steps model cleanly separates:

- **Job-level concerns**: container tier, worktree, tools, permissions, dependencies between jobs, transitions/branching
- **Step-level concerns**: what prompt to send, in what order, within a single agent session

## Design

### YAML Schema (New)

```yaml
workflow_id: work_item_in_progress_default
name: Work Item In-Progress Default Implementation
description: >
  ...

trigger:
  type: webhook
  event: kanban.ticket.in_progress

permissions:
  allow_tools: [read_file, write_file, bash, query_memory]
  deny_tools: []

jobs:
  - id: implement_work_item
    tier: heavy
    inputs:
      agent_profile: architect-agent
    steps:
      - id: implement
        prompt: |
          You are the implementation agent for this work item.
          ...
      - id: ensure_committed
        prompt: |
          Run `git status --porcelain`. If there are uncommitted changes,
          stage and commit them with a descriptive conventional commit message.
          Do NOT leave uncommitted files in the working tree.
```

### YAML Schema (Full Reference)

```yaml
workflow_id: string # required
name: string # required
description: string # optional
trigger: # optional
  type: event | webhook | manual
  event: string
permissions: # optional, workflow-level tool policy
  allow_tools: string[]
  deny_tools: string[]

jobs: # required, min 1
  - id: string # required, unique across workflow
    tier: light | heavy # required
    type: execution | register_tool | invoke_workflow # defaults to 'execution'
    depends_on: string[] # job IDs (not step IDs)
    inputs: # job-level inputs (agent_profile, model, provider, etc.)
      agent_profile: string
      model: string
      provider: string
    permissions: # job-level tool policy override
      allow_tools: string[]
      deny_tools: string[]
    tools: string[] # explicit tool filter
    transitions: # conditional branching (between jobs)
      - condition: string
        next: string # must reference a job ID
    required_tool_calls: string[] # still on job level — checked after ALL steps
    max_retries: number
    retry_prompt: string

    # For invoke_workflow jobs:
    workflow_id: string
    wait_for_completion: boolean

    # For register_tool jobs, inputs must contain: name, schema, typescript_code

    steps: # optional for register_tool/invoke_workflow; required for execution
      - id: string # required, unique within this job
        prompt: string # required — the message sent to the agent session
```

### Backward Compatibility

During migration, the parser will accept both formats:

- **New format**: Top-level `jobs` array → each job has a `steps` array
- **Legacy format**: Top-level `steps` array → each entry is auto-wrapped into a single-step job. The existing `inputs.system_prompt` becomes the step's `prompt`.

This means all existing workflows continue to work without modification. The parser handles the normalization transparently.

### Execution Model

```
Workflow
├── Job A (container 1, heavy tier, worktree mounted)
│   ├── Step 1: "Implement the feature..."          → session.prompt()
│   └── Step 2: "Commit uncommitted changes..."     → session.prompt()
│
├── Job B (container 2, light tier)          depends_on: [Job A]
│   └── Step 1: "Review the code..."                → session.prompt()
│
└── Job C (container 3, light tier)          depends_on: [Job B]
    └── Step 1: "Summarize the work..."             → session.prompt()
```

**Key behaviors:**

1. **Jobs** are scheduled by the DAG resolver (same as today's steps). Each job gets its own container.
2. **Steps within a job** run sequentially inside the same container, same agent session. The container starts in **interactive mode**; the orchestrator sends each step's prompt via the WebSocket `prompt` command; the orchestrator waits for the agent to finish before sending the next step.
3. After all steps in a job complete, the orchestrator sends a `dehydrate` or lets the container exit.
4. `required_tool_calls` / `max_retries` / `retry_prompt` are checked after the **last step** completes (same behavior as today, just at the job boundary).

### Pi-Runner Changes

The pi-runner already supports interactive mode and the `prompt` command over WebSocket. The key change: the orchestrator must:

1. Set `interactive: true` in the `RunnerConfigPayload`
2. Send the first step's prompt as the `systemPrompt` (so the session initializes with it)
3. Send subsequent steps as `prompt` commands via WebSocket
4. Send `dehydrate` command after all steps complete

For single-step jobs, this is identical to today's behavior (non-interactive mode — run systemPrompt and exit).

### State Variables

Current:

```
steps.{stepId}.output
_internal.completed_steps.{stepId}
_internal.queued_steps.{stepId}
```

New:

```
jobs.{jobId}.output                    # final output of last step in the job
jobs.{jobId}.steps.{stepId}.output     # per-step output within a job
_internal.completed_jobs.{jobId}
_internal.queued_jobs.{jobId}
```

Template variables update accordingly:

- `{{steps.X.output.Y}}` → `{{jobs.X.output.Y}}` (shorthand for last step)
- `{{jobs.X.steps.Y.output.Z}}` (explicit step reference)
- Legacy `{{steps.X...}}` is rewritten to `{{jobs.X...}}` by the parser for backward compatibility.

## Impact Analysis

### Files Changed

| File                                                           | Impact       | Description                                                                                    |
| -------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/interfaces/index.ts`                        | **Critical** | New `IJob`, `IJobStep` interfaces; update `IWorkflowDefinition`; update `IRunnerConfigPayload` |
| `apps/api/src/workflow/step-execution.types.ts`                | **Critical** | Add `JobQueueData` type with job + steps array                                                 |
| `apps/api/src/workflow/workflow-parser.service.ts`             | **Critical** | Parse `jobs` array; legacy `steps` normalization to jobs                                       |
| `apps/api/src/workflow/workflow-validation.service.ts`         | **Critical** | Validate job structure + nested steps                                                          |
| `apps/api/src/workflow/dag-resolver.service.ts`                | **Critical** | Operate on jobs (not steps); validate job-level depends_on                                     |
| `apps/api/src/workflow/workflow-engine.service.ts`             | **Critical** | Enqueue jobs; track job completion; state variable keys                                        |
| `apps/api/src/workflow/step-execution.consumer.ts`             | **High**     | Receive `JobQueueData`; delegate to orchestrator                                               |
| `apps/api/src/workflow/step-execution-orchestrator.service.ts` | **Critical** | Multi-step execution loop: interactive mode, sequential prompts                                |
| `apps/api/src/workflow/step-agent-step-executor.service.ts`    | **Critical** | Accept job context; run steps sequentially within container                                    |
| `apps/api/src/workflow/step-special-step-executor.service.ts`  | **High**     | Accept job context for register_tool / invoke_workflow                                         |
| `apps/api/src/workflow/step-support.service.ts`                | **High**     | Update `buildUpstreamContext`, `resolveTier` to use job model                                  |
| `apps/api/src/workflow/step-required-tool-retry.service.ts`    | **High**     | State keys reference jobId                                                                     |
| `apps/api/src/workflow/step-event-publisher.service.ts`        | **Medium**   | Include jobId in event payloads                                                                |
| `apps/api/src/workflow/state-manager.service.ts`               | **Medium**   | State key format change                                                                        |
| `apps/api/src/workflow/state-machine.service.ts`               | **Medium**   | Transition conditions reference `jobs.*` instead of `steps.*`                                  |
| `apps/api/src/telemetry/telemetry.gateway.ts`                  | **High**     | Include jobId in JWT; update config store key format                                           |
| `apps/api/src/redis/runner-config-store.service.ts`            | **Medium**   | Key includes jobId                                                                             |
| `apps/api/src/redis/agent-response-store.service.ts`           | **Medium**   | Key includes jobId                                                                             |
| `apps/api/src/redis/tool-call-tracker.service.ts`              | **Medium**   | Key includes jobId                                                                             |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` | **Medium**   | JWT includes jobId                                                                             |
| `apps/api/src/database/seeds/*.workflow.yaml`                  | **High**     | Convert all 4 seed files to jobs format                                                        |
| `apps/web/src/components/workflow/WorkflowVisualizer.tsx`      | **High**     | Render job → steps hierarchy                                                                   |
| `apps/web/src/pages/workflows/WorkflowEditor.tsx`              | **Medium**   | Update default YAML template                                                                   |
| All test files for above services                              | **High**     | Update fixtures and assertions                                                                 |

### Files Unchanged

- `packages/pi-runner/src/main.ts` — Already supports interactive mode + prompt commands
- `packages/pi-runner/src/orchestrator-client.ts` — Already receives `prompt` commands
- `packages/pi-runner/src/session-factory.ts` — No structural changes
- `apps/api/src/workflow/workflow.controller.ts` — Works with IWorkflow entities, not internal structure
- `apps/api/src/common/git/*` — No changes
- `apps/api/src/docker/container-orchestrator.service.ts` — No changes

## Tasks

### Phase 1: Core Types & Interfaces (no behavior change)

**T1.1** — Define `IJob` and `IJobStep` interfaces in `packages/core/src/interfaces/index.ts`

- `IJob`: absorbs current `IWorkflowStep` properties (`id`, `type`, `tier`, `depends_on`, `inputs`, `permissions`, `tools`, `transitions`, `required_tool_calls`, `max_retries`, `retry_prompt`, `workflow_id`, `wait_for_completion`) + new `steps: IJobStep[]`
- `IJobStep`: `id`, `prompt`
- Update `IWorkflowDefinition`: add `jobs?: IJob[]`, keep `steps?: IWorkflowStep[]` for backward compat
- Remove the `post_exec` property added to `IWorkflowStep` and `IRunnerConfigPayload` (superseded by this design)

**T1.2** — Create `JobQueueData` type in `apps/api/src/workflow/step-execution.types.ts`

- Contains: `workflowRunId`, `jobId`, `job: IJob`, `workflowPermissions`, `resumeSessionTreeId`, `userMessage`
- Keep `StepJobData` as deprecated alias during migration

**T1.3** — Write unit tests for the new types (type-level compilation tests)

### Phase 2: Parser & Validation (backward compatible)

**T2.1** — Update `WorkflowParserService.parseWorkflow()` to handle both formats:

- If YAML has `jobs` array → parse as-is into `IWorkflowDefinition.jobs`
- If YAML has `steps` array (legacy) → normalize each step into a single-step job:
  - Job ID = step ID
  - Job tier/type/inputs/permissions/etc = step's properties
  - Job steps = `[{ id: 'default', prompt: step.inputs.system_prompt }]`
- Populate both `jobs` and `steps` (for backward compat with any code reading `steps`)

**T2.2** — Write parser tests:

- Legacy `steps` format → correct normalization to jobs
- New `jobs` format → correct parsing
- Mixed (should reject — must be one or the other)
- Missing required fields (job without id, step without prompt)
- Edge case: single-step job (no `steps` array means `steps` defaults to single step using `inputs.system_prompt`)

**T2.3** — Update `WorkflowValidationService`:

- Validate `jobs` array: each job has `id`, `tier`
- For `execution` type jobs: at least one step with a `prompt`
- Step IDs unique within their job
- Job IDs unique within workflow
- `depends_on` references valid job IDs
- `transitions` reference valid job IDs
- Existing validations (register_tool, invoke_workflow, tool refs, permissions) move to job level
- Legacy format validation still works (via parser normalization)

**T2.4** — Write validation tests for all new rules

### Phase 3: DAG & Engine (job-level orchestration)

**T3.1** — Update `DAGResolverService` to work with `IJob[]` instead of `IWorkflowStep[]`:

- `buildDependencyGraph(jobs: IJob[])` — same algorithm, operates on jobs
- Update `validateTransitionTargets` for job-level transitions
- Maintain backward compat overload accepting legacy `IWorkflowStep[]`

**T3.2** — Write DAG resolver tests with job structures

**T3.3** — Update `WorkflowEngineService`:

- `startWorkflow()`: build graph from `def.jobs`, enqueue jobs
- `handleJobComplete()` (renamed from `handleStepComplete`): marks job done, progresses DAG
- `markJobCompleted()`: sets `jobs.{jobId}.output` and `_internal.completed_jobs.{jobId}`
- `enqueueJob()` (renamed from `enqueueStep`): creates BullMQ job with `JobQueueData`
- `progressDagOrComplete()`: works with job-level groups
- `resolveTransitionTarget()`: reads `job.transitions`, evaluates against `jobs.*` variables
- `enqueueTransitionStep()` → `enqueueTransitionJob()`
- `areAllJobsCompleted()` (renamed from `areAllStepsCompleted`)
- `resumeStepWithMessage()` / `retryStepWithMessage()`: update to use jobId
- Update all state variable keys from `steps.*` to `jobs.*`

**T3.4** — Write workflow engine tests:

- Single-job single-step workflow (equivalent to today)
- Single-job multi-step workflow (new)
- Multi-job with depends_on
- Transitions between jobs
- Loop detection with jobs

### Phase 4: Execution (multi-step within a container)

**T4.1** — Update `StepExecutionConsumer` to accept `JobQueueData` from BullMQ queue:

- Destructure `{ workflowRunId, jobId, job }` from job data
- Pass to orchestrator
- Keep backward compat: if `stepId` present but `jobId` absent, treat as legacy

**T4.2** — Update `StepExecutionOrchestratorService.executeStep()` → `executeJob()`:

- For single-step jobs: behave exactly as today (non-interactive mode)
- For multi-step jobs:
  1. Set `interactive: true` in `RunnerConfigPayload`
  2. Use `job.steps[0].prompt` as the `systemPrompt`
  3. Start container in interactive mode
  4. After the first step's prompt completes (detect via telemetry events), send next step's prompt via WebSocket `prompt` command
  5. After all steps complete, send `dehydrate` command
  6. Collect per-step outputs from the agent response store
- Special types (register_tool, invoke_workflow): no steps — handled at job level as today

**T4.3** — Update `StepAgentStepExecutorService`:

- Accept `IJob` + step index context
- For multi-step: implement the sequential prompt dispatch loop
- **Key challenge**: Detecting when one step's prompt completes so the next can start. Use the existing telemetry bridge — when the agent finishes responding, a `turn_end` event is emitted. The orchestrator subscribes to the run's Redis PubSub channel and waits for each turn to end before sending the next prompt.

**T4.4** — Add `step_prompt_start` and `step_prompt_complete` telemetry events for per-step observability within a job

**T4.5** — Write integration tests:

- Single-step job executes normally (regression)
- Multi-step job sends prompts sequentially
- Container stays alive between steps
- Step 2 can observe Step 1's changes (same filesystem)
- Job failure on any step aborts remaining steps

### Phase 5: State Variables & Template Resolution

**T5.1** — Update `StateManagerService.substituteTemplate()`:

- Support `{{jobs.X.output.Y}}` (shorthand for last step's output)
- Support `{{jobs.X.steps.Y.output.Z}}` (explicit step reference)
- Support legacy `{{steps.X.output.Y}}` → rewrite to `{{jobs.X.output.Y}}`

**T5.2** — Update `StateMachineService.evaluateTransition()`:

- Conditions reference `jobs.*` instead of `steps.*`
- Legacy conditions rewritten transparently

**T5.3** — Write template substitution and condition evaluation tests

### Phase 6: Supporting Services

**T6.1** — Update `StepSupportService`:

- `buildUpstreamContext()`: read `jobs.{dep}.output` instead of `steps.{dep}.output`
- `resolveTier()`: accept `IJob` instead of `IWorkflowStep`
- `resolveStepInputs()`: works the same (job-level inputs)
- `resolveAgentProfileFromStepInputs()`: from job inputs

**T6.2** — Update `StepRequiredToolRetryService`:

- State keys: `_internal.retries.{jobId}`
- Accept job context

**T6.3** — Update `StepEventPublisherService`:

- Include `jobId` in all event payloads alongside `stepId` (step within job)

**T6.4** — Update `StepContainerRuntimeService`:

- No structural changes expected; verify log streaming context labels include jobId

**T6.5** — Update Redis key services:

- `RunnerConfigStoreService`: key format `runner-config:{runId}:{jobId}`
- `AgentResponseStoreService`: key format includes jobId
- `ToolCallTrackerService`: key format includes jobId

**T6.6** — Update `TelemetryGateway`:

- JWT payload includes `jobId`
- Config retrieval uses `jobId`
- Tool call tracking uses `jobId`

**T6.7** — Update `SubagentOrchestratorService` (now the restored facade at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`):

- JWT context includes `jobId`

**T6.8** — Write tests for all updated services

### Phase 7: Workflow Seed Files

**T7.1** — Convert `work-item-in-progress-default.workflow.yaml`:

- Single job `implement_work_item` with two steps:
  1. `implement` — the main implementation prompt
  2. `ensure_committed` — check for and commit uncommitted changes

**T7.2** — Convert `work-item-in-review-default.workflow.yaml`:

- Single job `review_work_item` with one step
- Move `required_tool_calls`, `max_retries`, `retry_prompt` to job level

**T7.3** — Convert `web-search-tool-test.workflow.yaml`:

- 3 jobs, each with one step
- Update template: `{{steps.X.output...}}` → `{{jobs.X.output...}}`

**T7.4** — Convert `todo-web-app.workflow.yaml`:

- 8 jobs, each with one step
- Update all transition conditions: `steps.X.output...` → `jobs.X.output...`
- Update `depends_on` (no change since job IDs = old step IDs)

### Phase 8: Frontend

**T8.1** — Update `WorkflowVisualizer.tsx`:

- Parse `jobs` array from YAML
- Render job cards containing step sub-cards
- Show job-level dependencies and step sequence within each job
- Backward compat: handle legacy `steps` format via same normalization

**T8.2** — Update `WorkflowEditor.tsx`:

- Update default YAML template to use jobs+steps format

**T8.3** — Write frontend component tests

### Phase 9: E2E & Migration

**T9.1** — Update all e2e test files:

- `test/workflow.e2e-spec.ts`
- `test/workflow-logic.e2e-spec.ts`
- `test/workflow-event-trigger.e2e-spec.ts`
- `test/workflow-event-trigger-integration.e2e-spec.ts`
- `e2e-test-review.mjs`

**T9.2** — Ensure backward compatibility: existing workflows with `steps` format must continue to work without modification after parser normalization

**T9.3** — Full regression test pass across all API unit tests and e2e tests

### Phase 10: Cleanup

**T10.1** — Remove `post_exec` from `IWorkflowStep` and `IRunnerConfigPayload` (added prematurely, superseded by this design)

**T10.2** — Remove the commit-related additions from the `system_prompt` in `work-item-in-progress-default.workflow.yaml` (now handled by the `ensure_committed` step)

**T10.3** — Update repo memory file `workflow-design-principles.md` with final design decisions

## Risks & Mitigations

| Risk                                         | Mitigation                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Breaking change for existing workflows       | Legacy `steps` format auto-normalized in parser; dual-format support                         |
| Multi-step prompt completion detection       | Use existing Redis PubSub `turn_end` event; orchestrator subscribes to the run's channel     |
| Container stays alive too long between steps | Configure per-step timeout in addition to job-level timeout                                  |
| Interactive mode race conditions             | Sequential prompt dispatch; queue on orchestrator side; pi-runner already serializes prompts |
| Large refactor surface area                  | Phase implementation; each phase is independently testable and deployable                    |

## Out of Scope

- **Step-level conditions** (conditional steps within a job) — can be added later
- **Parallel steps within a job** — steps within a job are always sequential
- **Step-level tool permissions** — tool permissions are at the job level
- **Frontend job/step configuration UI** — YAML-only for now
