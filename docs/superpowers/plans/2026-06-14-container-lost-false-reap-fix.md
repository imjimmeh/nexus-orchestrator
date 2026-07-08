# Fix False `container_lost` Reaping of Healthy Workflow Steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `ExecutionSupervisorService` from reaping healthy `workflow_step` executions with `container_lost` during the brief window where the step container has been cleaned up but the execution row has not yet transitioned to a terminal state.

**Architecture:** Add a debounce/grace window to the `container_lost` reaping path for `workflow_step` executions only. The supervisor tracks how long each execution's container has been _continuously_ observed as lost (in-memory map, keyed by execution id) and only reaps once that duration exceeds a grace threshold. The pure classification helper gains a `containerLostForMs` input and a `containerLostGraceMs` parameter; the stateful tracking lives in the supervisor service. Genuine orphans (API process restart leaving a dead container) still get reaped after the grace window; the normal-completion cleanup race resolves to a terminal state long before the window elapses, so it is no longer reaped.

**Tech Stack:** TypeScript, NestJS, Vitest. No DB schema change.

---

## Background — Root Cause (verified against run `f52e5fa7-a47a-449c-a1b8-87e373bae763`)

A `workflow_step` execution's single container is removed inside the step executor's `finally` cleanup (`step-agent-container-support.service.ts:232` via `step-agent-step-executor.multistep.ts:297`) **before** `execution.completed` is published (`step-execution-orchestrator.service.ts:291`). The row stays in `running` (non-terminal) until the `execution.completed` event is processed by `ExecutionProjector` (`running → completing → completed`). During that window the row has a populated `container_id` pointing at an already-removed container.

`ExecutionSupervisorService.sweepOnce()` runs every 30s, calls `SubagentContainerLivenessProbe.isContainerLost()` (returns `true` on `exited`/`dead`/`removing` or a 404), and `classifyExecutionForReaping()` returns `container_lost` immediately — with **no `workflow_step` carve-out** (the existing carve-out at `execution-supervision.helpers.ts:47` only covers `idle_timeout`). The false reap routes through `StepExecutionCompletionListener.onExecutionFailed` → `handleJobFailed` → a wasteful retry cascade (observed: each step burned a superseded attempt + a `container_lost`-reaped attempt before a third attempt completed).

`container_lost` is redundant for the in-process failure cases (agent error / container OOM mid-call already surface as a thrown error → `execution.failed` with `agent_error` from the executor's own `try/catch`). The **only** case it legitimately catches for `workflow_step` is an orphan: the API process dies mid-step so no completion/failure event ever fires. A grace window preserves orphan recovery while eliminating the cleanup-race false positive.

**Out of scope:** The run being _frozen_ in `RUNNING` was caused by the whole stack being taken down (`nexus-api` and the step container both `Exited (137)`, `OOMKilled=false`, at ~14:32 UTC). That is operational, not a code defect, and is already recoverable on restart (the supervisor reaps the orphaned execution and retries). This plan does not change orphan/startup recovery beyond adding the grace delay.

---

## File Structure

| File                                                                      | Responsibility                              | Change                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.types.ts` | `SupervisionInput` shape                    | Add optional `containerLostForMs` field                                                                        |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`       | Pure reaping classification + env resolvers | Add grace constant + `resolveContainerLostGraceMs`; gate `container_lost` for `workflow_step` behind grace     |
| `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`  | Helper unit tests                           | Update the `workflow_step` + `container_lost` test; add grace-boundary tests                                   |
| `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`        | Stateful sweep loop                         | Track continuous lost duration per execution; pass `containerLostForMs` + grace into the helper; prune the map |
| `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`   | Service unit tests                          | Add tests: no reap on first lost observation; reap after grace; recovery clears tracking                       |

---

## Task 1: Extend `SupervisionInput` with continuous-lost duration

(See repo plan; field `containerLostForMs?: number | null`.)

## Task 2: Gate `workflow_step` `container_lost` behind a grace window (pure helper)

Add `DEFAULT_CONTAINER_LOST_GRACE_MS` + `resolveContainerLostGraceMs`; only reap workflow_step container_lost once continuously lost beyond grace.

## Task 3: Track continuous lost duration in the supervisor sweep

In-memory `containerLostSince` map; `trackContainerLost` + `pruneContainerLostTracking`; pass `containerLostForMs` and grace into helper.

## Task 4: Document the grace knob and verify the full gate

Document `EXECUTION_CONTAINER_LOST_GRACE_MS`; lint + test + build.
