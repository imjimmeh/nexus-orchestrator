# 08 - Workflow Runtime

The workflow runtime layer provides agent-facing capabilities — the tools and services that AI agents inside execution containers interact with to complete their work. It acts as a bridge between the agent container and the orchestration engine.

---

## Agent-Facing Runtime Capabilities Overview

When an AI agent runs inside a Docker container, it communicates with the runtime layer via HTTP APIs and WebSocket. The runtime exposes capabilities that the agent discovers (`get_capabilities`) and invokes to read files, execute commands, manage state, and signal completion.

### Controllers

| Controller                                       | Endpoint Base           | Purpose                                |
| ------------------------------------------------ | ----------------------- | -------------------------------------- |
| `WorkflowRuntimeLifecycleController`             | Runtime lifecycle       | Container setup, health, shutdown      |
| `WorkflowRuntimeStepCompleteController`          | Step completion         | Agent signals step is done             |
| `WorkflowRuntimeCapabilityLifecycleController`   | Capability lifecycle    | Enable/disable capabilities at runtime |
| `WorkflowRuntimeInternalToolCallbacksController` | Internal tool callbacks | Callbacks for internal tool execution  |
| `WorkflowRuntimeSubagentsController`             | Subagent management     | Spawn, check status, collect results   |
| `WorkflowRuntimeWarRoomController`               | War-room integration    | Create/join war-room sessions          |
| `WorkflowRuntimeArtifactsController`             | Artifact management     | Create, list, retrieve artifacts       |
| `WorkflowRuntimeAgentMentionsController`         | Agent mentions          | Inter-agent communication              |

### Key Services

| Service                                      | Responsibility                                                |
| -------------------------------------------- | ------------------------------------------------------------- |
| `WorkflowRuntimeToolsService`                | Central tool registration and discovery for the runtime       |
| `WorkflowRuntimeCapabilityExecutorService`   | Executes capability invocations from agents                   |
| `WorkflowRuntimeCapabilityLifecycleService`  | Manages capability enable/disable during runtime              |
| `WorkflowRuntimeSetJobOutputService`         | Processes `set_job_output` calls from agents                  |
| `WorkflowRuntimeOrchestrationActionsService` | Handles orchestration-level actions (pause, resume, delegate) |
| `WorkflowRuntimeOrchestrationSessionService` | Manages orchestration session state                           |
| `WorkflowRuntimeBrowserActionsService`       | Browser automation capability wrapper                         |
| `WorkflowRuntimeSubagentToolsService`        | Subagent management tools for internal agents                 |
| `WorkflowRuntimeTerminalRunGuardService`     | Prevents actions on already-terminal runs                     |
| `WorkflowRuntimeMeshDelegationToolsService`  | Mesh delegation capability tools                              |
| `WorkflowRuntimeSpecEmitterService`          | Emits workflow execution specifications                       |

---

## Capability Providers

Capability providers are registered in `WorkflowModule` and `WorkflowRuntimeModule`. They expose specific functionalities that agents invoke through the runtime.

### DelegationCapabilityProvider

**What it does:** Enables agents to delegate work — spawning subagents, invoking child workflows (fire-and-forget or durably awaited), and offloading tasks to specialized agent profiles.

**Key tools exposed:**

| Tool                     | Behaviour                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `invoke_agent_workflow`  | Launch a child workflow **fire-and-forget** — returns the child run id immediately; the caller does **not** wait.          |
| `await_agent_workflow`   | Launch one or more child workflows and **durably suspend** the calling step until every child is terminal (see below).     |
| `list_running_workflows` | List workflows still running for the current scope (name, status, age, wait reason) so an orchestrator avoids re-spawning. |
| `spawn_subagent_async`   | Spawn an async subagent and return an execution handle.                                                                    |
| `wait_for_subagents`     | Block until subagent executions complete or time out.                                                                      |
| `check_subagent_status`  | Get the latest status for a subagent execution.                                                                            |

**Projected `delegate_*` tools.** CEO-style orchestrators and selected specialist workflows delegate through ergonomic, per-workflow tools (`delegate_goal_backlog_planning`, `delegate_work_item_generation`, `delegate_ui_ux_testing`, `delegate_web_research`, …) defined in `seed/workflow-delegation-tools/` and registered by `WorkflowDelegationToolProjectionService`. Each projected tool binds a fixed `workflow_id` plus trigger-data shaping (fixed routes, allowed fields) so the agent only supplies a `reason` and a few inputs. The projection routes to `await_agent_workflow` when durable await is enabled and the calling run+step are known, and falls back to `invoke_agent_workflow` otherwise. Seeded specialist placements grant only the projected tools a workflow needs; prompts require a concrete question, task, or outcome, consuming the returned child result before `set_job_output`, and never wrapping a delegate call in an additional `await_agent_workflow` call.

### ImplementationPlanCapabilityProvider

**What it does:** Provides agents the ability to create, read, and update implementation plans. Plans are structured breakdowns of work with steps, dependencies, and acceptance criteria.

**Key tools exposed:** Plan creation, plan query, plan mutation tools

### JobOutputCapabilityProvider

**What it does:** Allows agents to set and retrieve job outputs. This is the primary mechanism for agents to communicate results back to the workflow engine.

**Key tools exposed:** `set_job_output`, `get_job_output`

### OrchestrationSessionCapabilityProvider

**What it does:** Manages orchestration session state — the persistent decision log that tracks what the orchestrator has decided across multiple workflow cycles.

**Key tools exposed:** Session state query, decision log append

### WorkflowContextCapabilityProvider

**What it does:** Provides agents access to workflow-level context — trigger data, current run state, parent/child relationships, and state variables.

**Key tools exposed:** Context querying, state variable access

### WorkflowRuntimeBrowserCapabilityProvider

**What it does:** Wraps Playwright browser automation capabilities. Agents can open pages, navigate, click, type, read content, capture screenshots, and close pages.

**Key tools exposed:** `browser_open_page`, `browser_navigate`, `browser_click`, `browser_type`, `browser_wait_for`, `browser_read_page`, `browser_screenshot`, `browser_close_page`, `browser_list_failure_artifacts`, `browser_get_failure_artifact`

### WorkflowManagementCapabilityProvider

**What it does:** Enables agents to manage workflow definitions — create, update, search, and read workflow definitions at runtime.

**Key tools exposed:** Workflow CRUD, workflow search, workflow summary

### InternalToolRegistryService

**What it does:** Central registry for internal tools. Aggregates all `INTERNAL_TOOL_HANDLER` providers and exposes them as a unified tool catalog. Agents discover and invoke internal tools (memory, schedule, todo, workflow meta, skills, playbooks, web search, web fetch) through this registry.

---

## Step-Complete Protocol

The step-complete protocol is how agents signal that a step has finished:

1. **Agent invokes** `step_complete` or `set_job_output` tool
2. **Runtime receives** the invocation via `WorkflowRuntimeStepCompleteController`
3. **Output validation** — `WorkflowOutputContractService` checks output against `output_contract`
4. **Step completion guard** — `WorkflowStepCompletionGuardService` prevents duplicate completions
5. **Result is stored** — Output is persisted to the `WorkflowRun` state variables and event ledger
6. **DAG advances** — `WorkflowRunJobExecutionService.handleJobComplete()` evaluates transitions, enqueues dependent jobs
7. **Terminal check** — `WorkflowTerminalRunCloserService` checks if this was the last job; if so, marks the run complete

```
Agent: set_job_output({ summary: "...", status: "pass" })
    ↓
WorkflowRuntimeStepCompleteController
    ↓
WorkflowRuntimeSetJobOutputService.processJobOutput()
    ↓
WorkflowOutputContractService.validate()
    ↓ (valid)
WorkflowStepCompletionGuardService.guard()
    ↓ (not duplicate)
WorkflowRunJobExecutionService.handleJobComplete()
    ↓
Enqueue dependent jobs || mark run complete
```

---

## Artifact Management

Agents can create, list, and retrieve artifacts — structured files or blobs persisted across workflow runs.

### WorkflowRuntimeArtifactsController

| Endpoint                  | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `create_artifact`         | Creates a new artifact (metadata + initial files) |
| `list_artifacts`          | Lists artifacts accessible to the current scope   |
| `list_artifact_files`     | Lists files within an artifact                    |
| `upsert_artifact_file`    | Creates or updates a file in an artifact          |
| `delete_artifact_file`    | Removes a file from an artifact                   |
| `save_script_as_artifact` | One-shot creation of an artifact from a script    |

Artifacts are distinct from skills. Artifacts are general-purpose file bundles; skills are specialized reusable instruction sets with SKILL.md manifests.

---

## Runtime Formatting

### Tool Result Formatting

`WorkflowRuntimeToolsService` formats tool invocation results for agent consumption. Results include:

- **Status** — success, error, pending (for human approval)
- **Output** — structured JSON payload
- **Metadata** — execution time, token usage, tool version

### AI Config Formatting

`WorkflowRuntimeToolsService` also formats AI configuration (model, provider, system prompt, temperature) into the runner configuration payload that gets injected into the container as environment variables and config files.

---

## Internal Tools Catalog

Internal tools are special tools that execute within the API process itself (not inside the container). They are registered via `INTERNAL_TOOL_HANDLER` token.

| Tool Group        | Tools                                                                                                                                                                                                                                 | Purpose                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Memory**        | `query_memory`, `record_learning`                                                                                                                                                                                                     | Query the agent's memory store; record new learnings |
| **Schedule**      | `list_schedules`, `get_schedule`, `create_scheduled_job`, `update_scheduled_job`, `pause_scheduled_job`, `resume_scheduled_job`, `run_scheduled_job_now`, `delete_scheduled_job`, `list_schedule_runs`                                | Full scheduled job lifecycle management              |
| **Todo**          | `get_todo_list`, `manage_todo_list`                                                                                                                                                                                                   | View and modify the workflow run's todo list         |
| **Workflow Meta** | `list_workflows`, `get_workflow`, `create_workflow_definition`, `update_workflow_definition`, `delete_workflow_definition`, `search_workflows`, `read_workflow_summary`                                                               | Workflow definition CRUD and discovery               |
| **Skill**         | `search_skills`, `read_skill_manifest`, `create_skill`, `update_skill`, `list_skill_files`, `upsert_skill_file`, `delete_skill_file`, `save_script_as_skill`, `replace_profile_skills`, `add_profile_skills`, `remove_profile_skills` | Skill library management                             |
| **Playbook**      | `search_playbooks`, `read_playbook`                                                                                                                                                                                                   | Playbook discovery and reading                       |

### Handler Architecture

Each tool group has a handler class that processes tool calls:

| Handler                    | Tools Managed                       |
| -------------------------- | ----------------------------------- |
| `MemoryToolsHandler`       | `query_memory`, `record_learning`   |
| `ScheduleToolsHandler`     | All 9 schedule tools                |
| `TodoToolsHandler`         | `get_todo_list`, `manage_todo_list` |
| `WorkflowMetaToolsHandler` | All 7 workflow meta tools           |

Handlers are injected into the `INTERNAL_TOOL_HANDLER` multi-provider token as an array. `InternalToolRegistryService` aggregates them into a unified catalog.

---

## Runtime Feedback Ingestion

The runtime feedback system ingests diagnostic signals from running workflows:

- **Skill mount errors** — Skill files that couldn't be mounted or parsed
- **Host mount failures** — Workspace or tool paths that don't exist
- **Tool contract mismatches** — Tools with schemas that don't match expectations
- **Credential gaps** — Missing or invalid provider credentials
- **Runtime diagnostics** — `WorkflowSkillRuntimeDiagnosticsService` collects and organizes these signals

These signals feed into:

- The failure classification system (for repair decisions)
- The observability pipeline (metrics and event ledger)
- The autonomy diagnostics projection (for learning and improvement)

---

## Browser Actions Capability

`WorkflowRuntimeBrowserActionsService` wraps Playwright browser automation and exposes it as runtime capabilities:

| Tool                             | Description                           |
| -------------------------------- | ------------------------------------- |
| `browser_open_page`              | Opens a new browser page              |
| `browser_navigate`               | Navigates to a URL                    |
| `browser_click`                  | Clicks an element by selector         |
| `browser_type`                   | Types text into an input              |
| `browser_wait_for`               | Waits for a selector or timeout       |
| `browser_read_page`              | Reads page content as text            |
| `browser_screenshot`             | Takes a page screenshot               |
| `browser_close_page`             | Closes a browser page                 |
| `browser_list_failure_artifacts` | Lists failure screenshots/artifacts   |
| `browser_get_failure_artifact`   | Retrieves a specific failure artifact |

The browser session is managed per workflow run. When a run is cancelled or completes, browser sessions are cleaned up by `WorkflowRunBrowserSessionCleanupListener`.

---

## Durable user questions (ask_user_questions)

When an agent calls the runner-local `ask_user_questions` tool, it blocks until a human answers. The interaction is made **durable** so that an answer always reaches the agent — even if the original container was stopped, removed, or lost — and the run is never falsely advanced. The orchestrator (not the runner) owns the interaction lifecycle.

### Key services

| Service / Listener                 | Responsibility                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowRunAwaitingInputListener` | On `workflow.user_questions.posed`, sets `awaiting_input=true` and persists the durable record; clears the flag on answer |
| `UserQuestionAwaitService`         | Records the posed question, resolving the owning job id from `state_variables._internal.current_job_id`                   |
| `UserQuestionAwaitRepository`      | CRUD over the `user_question_awaits` table; supplies open-row lookups to the watchdog and idle re-arm                     |
| `WorkflowRunSteeringService`       | Handles answer submission: persist → WS fast path → session-resume fallback → conditional flag clear                      |
| `QuestionIdleTrackerService`       | Per-run stop/remove timers that free the idle container's heavy-tier capacity                                             |
| `QuestionIdleContainerListener`    | Stops then removes the idle container; re-arms timers from open rows on bootstrap                                         |

### The durable record

A `user_question_awaits` row is written the moment the agent poses a question (via the `workflow.user_questions.posed` event). It captures:

- `workflow_run_id`
- `job_id` — the job that asked, resolved from `state_variables._internal.current_job_id` (not `current_step_id`, which only reflects the first/last _advanced_ job and is wrong for parallel-job workflows)
- `step_id`
- the questions (with options)

Lifecycle states:

```
pending ──answered──────────→ answered        (delivered via ws or resume)
        ──delivery failed───→ failed_delivery  (answers saved for retry)
        ──new question posed→ superseded
        ──run aborted───────→ cancelled
```

### Answer delivery order

When a user submits answers via `POST /workflows/runs/:runId/question-answers`, `WorkflowRunSteeringService.submitQuestionAnswers` runs a strict, honest delivery sequence:

```
Submit answers
    ↓
(a) Persist answers on the durable row (answers are never lost)
    ↓
(b) WS fast path — live agent socket for the recorded step_id?
        YES → sendQuestionResponseCommand → mark answered ('ws')
    ↓ NO (or WS send failed)
(c) Fallback — saved session tree for the run?
        YES → kill any lingering container → resume recorded job_id
              from the persisted session tree → mark answered ('resume')
    ↓ NO
(e) Total failure → mark failed_delivery → HTTP 409 (ConflictException)
        Answers stay saved for retry; the run is NOT acknowledged.
    ↓
(d) awaiting_input cleared (USER_QUESTIONS_ANSWERED_EVENT) — only after (b) or (c) succeeds
```

The key invariant: the `awaiting_input` flag (which un-parks the run) is cleared **only after a delivery path confirms success**, never on mere submission. A total failure returns `409` with the answers persisted — it does not falsely acknowledge delivery.

> Runs that predate the durable record fall back to a legacy container-label discovery path (`deliverViaLegacyContainerPath`), which honours the same honesty contract: it throws `ConflictException` rather than acknowledging when neither a live container nor a saved session is available.

### `awaiting_input` semantics

While a run is awaiting a human answer it is intentionally idle — the agent is blocked inside `ask_user_questions`. The `awaiting_input` flag tells reconciliation the run is parked, not stalled. Without it, the stale-run watchdog would treat the idle run as stuck and re-enqueue its job, killing the blocked container and replaying the prompt in an ask/kill/restart loop. The flag is set on `posed` and cleared **only on confirmed delivery**.

### Idle container teardown

A parked run does **not** need a live container: the question and its owning job are durable, and answers resume from the persisted session tree. To free heavy-tier capacity, `QuestionIdleTrackerService` arms two timers per parked run:

| Setting                        | Default | Action                                 |
| ------------------------------ | ------- | -------------------------------------- |
| `question_idle_stop_seconds`   | `300`   | Stop (dehydrate) the waiting container |
| `question_idle_remove_seconds` | `3600`  | Remove the waiting container           |

Timers are in-memory. `QuestionIdleContainerListener.onApplicationBootstrap` re-arms tracking from open `user_question_awaits` rows after an API restart, so teardown still happens for runs parked before the restart. Timers are cleared the instant the answer is delivered (or the run is aborted).

### Recovery (stale-run watchdog)

`WorkflowRunReconciliationService` (30 s sweep) is hardened against durable questions:

- It skips runs with `awaiting_input` or a `wait_reason` — parked runs are never repaired.
- It additionally skips any run that still has an **open** `user_question_awaits` row (`findRunIdsWithOpenQuestions`), guarding against a race where the flag is briefly out of sync.
- When it does recover a genuinely stale run, it derives the actual stalled job id(s) from `state_variables` via `resolveStalledJobIds(run)` — **not** the frozen `current_step_id`, which is unreliable for parallel-job runs.

### Runner behavior

The runner-local `ask_user_questions` handler (`packages/harness-runtime/src/kernel.ts`) waits **indefinitely** for an answer. Each `waitForCommand("question_response", …)` arms a finite window (`QUESTION_WAIT_RETRY_MS` = 30 min); when the window elapses without an answer, the handler simply re-arms and waits again. It **never** fabricates a synthetic "timed out" response — doing so would let the agent continue without the user's input. The orchestrator owns the full lifecycle (persistence, idle teardown, late-answer resume); the runner only blocks.

---

## Durable agent await (await_agent_workflow)

`await_agent_workflow` is the delegation counterpart to durable user questions: it lets an agent step **spawn child workflows and durably suspend** until every child is terminal, then resume mid-conversation with the children's results injected. The parent run stays `RUNNING` (parked with `wait_reason = 'dependency'`) — not terminal — so any "a cycle is active" gate stays closed and the next orchestration cycle cannot advance on a half-built board.

This exists because the autonomous loop is a self-perpetuating workflow (one run = one cycle). When a CEO cycle spawned discovery/backlog children **fire-and-forget**, the cycle went terminal immediately, the next cycle started while the children were still running (race), and it had no knowledge of the in-flight work it had transitively started (blindness).

See [`docs/architecture/durable-agent-await.md`](../../architecture/durable-agent-await.md) for the full mechanism and sequence; the implementation lives under `apps/api/src/workflow/workflow-await/` and `WorkflowRuntimeAwaitActionsService`.

| Concern             | Behaviour                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Suspend             | Starts children with a parent link (`parentWorkflowRunId` / `parentStepId`), registers an `agent_await` row (`WAITING`), parks the parent (`setWaitState('dependency')`), dehydrates and tears down the container. |
| Scope inheritance   | Injects the parent run's `scopeId` / `scope_id` into each child's trigger data — children resolve scope from `triggerData.scopeId` and do not inherit from the parent link alone. Explicit child scope wins.       |
| Resume              | When all children are terminal, a system result node per child is appended to the parent session tree, the wait state is cleared, and a resume job is enqueued; the agent continues where it left off.             |
| Reconciler immunity | `wait_reason IS NOT NULL` makes the parked run immune to the stale-run watchdog (same contract as `awaiting_input`).                                                                                               |
| Engine support      | Fully functional on the **PI** engine; Claude Code resume persistence is a deferred follow-up.                                                                                                                     |
| Feature flag        | `ORCHESTRATION_AWAIT_ENABLED` (default `true`). When `false`, the capability is rejected and delegations fall back to fire-and-forget.                                                                             |

**Seeded workflows use this through `delegate_*` tools, not by hand.** `WorkflowDelegationToolProjectionService.invokeProjectedDelegation` routes a projected delegation to `startAwaitedInvocationWorkflows` when await is enabled **and** the calling run and step id are both known, mapping the delegation's built trigger data into the child `inputs`. It falls back to `invoke_agent_workflow` when await is disabled or no calling step can be resolved (no step to park). The CEO agent manifest denies raw `invoke_agent_workflow`, so awaiting is the only path by which it launches child workflows. Other seeded placements, such as QA review, implementation subagent briefs, backlog planning, and roadmap planning, grant projected specialist tools as bounded manual digressions only; those agents still complete their own output contract after incorporating the child result.

---

## Runtime execution context (workflow_run_id / job_id / step_id)

Agent-facing capabilities almost always need to know **which run, job, and step** is calling — to attribute output, resolve scope, park the right step, or resume the right session. That context is **not** passed in the tool arguments the model emits; it is injected by the runtime out-of-band so the agent cannot spoof or omit it.

### How the context flows

1. **Minting.** When the API launches a step container it mints a short-lived **agent JWT** whose payload carries `workflowRunId`, `jobId`, `stepId`, and `scopeId`, and whose `sub`/`userId` is `agent:<workflowRunId>:<jobId>`.
2. **Forwarding.** The runtime (`packages/harness-runtime`) attaches that JWT to every capability HTTP callback. `decodeRuntimeContextHeaders` (`tools/http-utils.ts`) decodes the payload and forwards it as request **headers**: `x-workflow-run-id`, `x-job-id`, `x-step-id`, `x-correlation-id` (scope).
3. **Authentication.** `JwtAuthGuard` + `jwt.strategy` validate the JWT and populate `req.user` with `{ userId, workflowRunId?, jobId?, stepId?, … }` (`AuthenticatedRequest['user']`, `AgentUserContext`).
4. **Resolution in controllers.** A controller derives the run/step it needs from `req.user`:
   - `parseAgentExecutionContext(req.user.userId)` parses `agent:<runId>:<jobId>` → `{ workflowRunId, jobId }` (run + **job**, not step).
   - `req.user.stepId` supplies the **step** id (the JWT claim) — the `userId` token alone does **not** carry the step.
   - `ExecutionContextResolverService.resolveAgentExecutionContext` is the shared resolver; when a job id can't be derived it falls back to the run's `current_step_id`.

> `job_id` ≠ `step_id`. The JWT `userId` encodes `agent:<runId>:<jobId>`; the **step** id lives in the `stepId` JWT claim (surfaced as `req.user.stepId` and the `x-step-id` header). Durable await needs the **step** to park (`startAwaitedInvocationWorkflows` requires `step_id`), which is why the projected-delegation controller threads `req.user.stepId` — not the job — into the projection.

### Why it matters for delegation

- `invoke_agent_workflow` only needs the **run** id (to record a parent link and resolve scope), so its controller injects `workflow_run_id` from the agent context.
- `await_agent_workflow` additionally needs the **step** id, because it parks that specific step and later resumes its session tree. A delegation that cannot resolve a calling step therefore cannot durably await and falls back to fire-and-forget.
- Child workflows are started with the parent link **and** an injected scope; trigger data (the agent's `goals`, fixed routes, etc.) is mapped to the child `inputs` so the child receives the same payload it would have under fire-and-forget invocation.
