# Durable Agent Await (As Implemented)

Last verified: 2026-06-12

A durable suspend/resume primitive that lets an agent step **wait on the child workflows it spawns** without holding a container open. The awaiting parent run is parked as a persisted state — not a blocked process — so the wait survives container teardown and API/host restarts.

See the design rationale and full decision record in [`docs/specs/SDD-durable-agent-await.md`](../specs/SDD-durable-agent-await.md). Implementation lives under `apps/api/src/workflow/workflow-await/`.

## Problem

The autonomous orchestration loop runs as a self-perpetuating workflow (one run = one cycle). A cycle's CEO agent spawns long-running child workflows (discovery, backlog planning) and then records its decision, ending the cycle run. When those children were spawned fire-and-forget, the cycle went terminal immediately, releasing the "a cycle is active" gate and letting the **next** cycle start while the children were still running. The next cycle then assessed a half-built board (race) and had no knowledge of the in-flight work it had transitively started (blindness).

Durable await closes this structurally: the parent run stays non-terminal (`RUNNING`) until its children finish, so the orchestration gate stays closed and the agent resumes with the children's results in context.

## Mechanism

1. **Suspend.** The agent calls the `await_agent_workflow` runtime capability (`workflow-runtime-await-actions.service.ts`, gated by `ORCHESTRATION_AWAIT_ENABLED`). It starts the requested child workflows **with a parent link** (`parentWorkflowRunId` / `parentStepId`), registers an await record via `AgentAwaitRegistryService` (`agent_await` table, status `WAITING`), and parks the parent run by setting `wait_reason = 'dependency'` (`WorkflowRunRepository.setWaitState`, `WHERE status = RUNNING`). The session is dehydrated to Postgres and the parent container is torn down. `wait_reason IS NOT NULL` grants the run immunity from the stale-run reconciler.

   Each child is launched with the **parent run's scope injected** into its trigger data (`scopeId` / `scope_id`). Child workflows resolve their scope from `triggerData.scopeId` at launch (see `WorkflowLaunchContractService`) and do **not** inherit it from the parent-run link alone, so without this injection an awaited delegation would launch scopeless. An explicit scope in the child inputs always wins.

   **Projected `delegate_*` tools route through this same path.** The CEO does not usually call `await_agent_workflow` by hand — it calls ergonomic projected delegation tools (`delegate_goal_backlog_planning`, `delegate_work_item_generation`, …; see `seed/workflow-delegation-tools/`). `WorkflowDelegationToolProjectionService.invokeProjectedDelegation` routes these to `startAwaitedInvocationWorkflows` whenever await is enabled and the calling run **and step** are known, mapping the delegation's built trigger data to the child `inputs`. It falls back to fire-and-forget `invoke_agent_workflow` only when await is disabled or no calling step can be resolved. (The CEO agent manifest also denies the raw `invoke_agent_workflow` capability, so the awaiting path is the only way it launches child workflows.)

2. **Children run** independently, each as a normal workflow run.

3. **Join.** When a child reaches a terminal status, `AgentAwaitChildTerminalListener` calls the registry's `onChildTerminal`, recording the child into `satisfied_run_ids` (idempotent). Once **all** awaited children are terminal, the await is CAS-promoted `WAITING → RESUMING`.

4. **Resume.** `DependencyParentResumeService` clears the parent's wait state and enqueues a fresh resume job through whichever engine vehicle the parent recorded. **PI parents** resume via the persisted session tree: a `nexus_system` result node per child (id, status, summary) is appended and the prior session is rehydrated from the tree. **Tree-less engines (e.g. Claude Code)** have no session tree; they resume via the stored `parent_session_ref` (SDK `options.resume`) with each child's outcome inlined into the join message instead. Either way a new container is provisioned and the agent continues mid-conversation as if nothing happened — finishing its cycle decision on a settled board. An await with neither a tree nor a session ref is genuinely unrecoverable and is failed.

5. **Safety net.** `AgentAwaitReconcilerService` runs on an interval. It promotes/resumes `WAITING` awaits whose children are all terminal but whose terminal event was lost, and retries `RESUMING` awaits stuck past `AGENT_AWAIT_RESUME_GRACE_MS` (default 120000 ms) — interrupted-resume recovery (e.g. API restart mid-resume), bounded by an attempt cap before the await is cancelled and the parent run failed (repairable).

## Sequence (suspend → run → resume)

```
 Parent agent (container)            API / await registry              Child runs
        │                                   │                              │
        │  await_agent_workflow(...)        │                              │
        │──────────────────────────────────▶│                              │
        │                                   │  start children (parent link)│
        │                                   │─────────────────────────────▶│  (running)
        │                                   │  register agent_await=WAITING │
        │                                   │  setWaitState('dependency')   │
        │   SUSPEND  (session dehydrated)   │                              │
        │◀──────────────────────────────────│                              │
   [container torn down]                    │                              │
                                            │      child terminal          │
                                            │◀─────────────────────────────│
                                            │  onChildTerminal → satisfy   │
                                            │  (all terminal?) CAS RESUMING│
                                            │  inject result nodes,        │
                                            │  clearWaitState, enqueue     │
                                            │  resume job                  │
 Parent agent (NEW container)               │                              │
        │   rehydrate session + results     │                              │
        │◀──────────────────────────────────│                              │
        │   continue → finish cycle decision│                              │
        │──────────────────────────────────▶│  run goes terminal          │
                                            │  (next cycle may now start)  │
```

(The `AgentAwaitReconcilerService` interval runs alongside this path as a safety net for lost terminal events and interrupted resumes.)

## Engine support

The primitive is functional on both the **PI** and **Claude Code** engines. PI resumes by injecting a persisted session JSONL into a fresh container. Claude Code resumes by SDK `sessionId`: the produced id is captured (`ClaudeCodeSession.getProducedSessionId()`), persisted to `agent_await.parent_session_ref` via `persistProducedSessionRef`, and replayed on resume as `resumeSessionRef` → `config.session.resume`. Both paths are unit/integration tested; a live full-stack Claude Code E2E remains a nice-to-have (tracked separately).

### Honoring the suspend directive (halting the turn)

Registering the await is only half of suspend — the agent's **in-flight turn must also stop**, or the model keeps issuing tool calls (re-calling `await_agent_workflow` in a loop) within the same turn and never parks. The signal is end-to-end:

1. `startAwaitedInvocationWorkflows` returns `executionStatus: "suspended"` in its response envelope.
2. In the container, `buildApiCallbackSuccessResult` (`@nexus/harness-runtime`) detects the nested `data.executionStatus === "suspended"` directive and sets `ToolCallResult.terminate = true`.
3. Each engine reads `terminate` and aborts the in-flight turn so no further LLM call runs:
   - **Claude Code** — `toSdkTool`'s handler invokes `onTerminate`, which calls `ClaudeCodeSession.suspend()` and aborts the SDK `query()` via its `AbortController`.
   - **PI** — the governed-tool wrapper in `convertGovernedTools` invokes `onTerminate`, which calls `PiHarnessSession.suspend()` and `AgentSession.abort()`. (`agent_end` is the pi SDK's final event even on abort, so the session converts the aborted end into a clean suspended end.)
4. The session emits `agent_end` with `output.suspended === true` (`stopReason: "suspended"`, `ok: true`). The runtime server's `reconcileAgentEnd` routes a suspended end to the parked/durable-resume path instead of failing or retrying it, and the API skips output-contract enforcement while the run is parked (`wait_reason = 'dependency'`).

## Configuration

| Env var                       | Default  | Effect                                                                                                                                       |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORCHESTRATION_AWAIT_ENABLED` | `true`   | Enables the `await_agent_workflow` capability. When `false`, await actions are rejected and prompts fall back to fire-and-forget delegation. |
| `AGENT_AWAIT_RESUME_GRACE_MS` | `120000` | Grace window before the reconciler retries a stuck `RESUMING` await. Positive integer; invalid values fall back to the default.              |
