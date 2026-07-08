# Durable Agent Await Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent durably await the child workflows it spawns — suspending its session and freeing its container — and resume in-context when the children finish, so the orchestration cycle never advances on in-flight work.

**Architecture:** Generalize two proven patterns — subagent parent-resume (`SubagentParentResumeService`) and human-input parking (`awaiting_input`) — into a domain-neutral "Agent Await Dependency" primitive: a persisted `agent_await` join record, a typed run `wait_reason`, an upward child-terminal → parent callback, an event-driven resumer that rehydrates the parent session with child results injected, and a reconciler safety net. Adds Claude Code engine resume to match PI.

**Tech Stack:** NestJS, TypeORM (Postgres), BullMQ, Vitest, harness-runtime engines (PI / Claude Code), `@nexus/core` shared contracts.

**Reference:** `docs/specs/SDD-durable-agent-await.md`. Build `packages/core` first.

---

## File Structure

New module `apps/api/src/workflow/workflow-await/`:

- `agent-await.entity.ts` — `agent_await` TypeORM entity
- `agent-await.repository.ts` — persistence
- `agent-await-registry.service.ts` — register / satisfy / query awaits
- `dependency-parent-resume.service.ts` — resume parent on join complete
- `agent-await-reconciler.service.ts` — restart/lost-event safety net
- `agent-await-child-terminal.listener.ts` — upward child→parent hook
- `workflow-await.module.ts` — wiring
- `__tests__/*.spec.ts` — unit tests

Core (`packages/core/src`):

- `interfaces/agent-await.types.ts` — `AgentAwaitStatus`, `WaitReason`, `HarnessSessionRef`
- extend `interfaces/harness-capabilities.ts` — `supportsResume`

Modified:

- `apps/api/src/workflow/database/entities/workflow-run.entity.ts` — `wait_reason`
- `apps/api/src/workflow/database/repositories/workflow-run.repository.ts` — `setWaitState` / `clearWaitState`
- `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts` — immunity on `wait_reason`
- `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts` — `await_agent_workflow`
- `apps/api/src/workflow/providers/delegation-capability.provider.ts` — register capability
- `apps/api/src/workflow/workflow-run-job-execution.service.ts` (terminal path) — emit child-terminal event
- `packages/harness-engine-claude-code/src/claude-code-engine.ts`, `claude-code-session.ts` — resume
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` — populate `HarnessRuntimeConfig.session`
- `seed/agents/ceo-agent/agent.json`, `prompts/project-orchestration-cycle-ceo/cycle.md`
- New migrations under `apps/api/src/database/migrations/`

---

## Phase 1 — Core contracts

### Task 1: Await + wait-reason + session-ref types in core

**Files:**

- Create: `packages/core/src/interfaces/agent-await.types.ts`
- Modify: `packages/core/src/interfaces/harness-capabilities.ts`
- Modify: `packages/core/src/index.ts` (export new types)
- Test: `packages/core/src/interfaces/__tests__/agent-await.types.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  AGENT_AWAIT_STATUS_VALUES,
  WAIT_REASON_VALUES,
} from "../agent-await.types";

describe("agent-await contracts", () => {
  it("enumerates await statuses", () => {
    expect(AGENT_AWAIT_STATUS_VALUES).toEqual([
      "WAITING",
      "RESUMING",
      "RESUMED",
      "CANCELLED",
    ]);
  });
  it("enumerates wait reasons", () => {
    expect(WAIT_REASON_VALUES).toEqual(["human_input", "dependency"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- agent-await`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/interfaces/agent-await.types.ts
export const AGENT_AWAIT_STATUS_VALUES = [
  "WAITING",
  "RESUMING",
  "RESUMED",
  "CANCELLED",
] as const;
export type AgentAwaitStatus = (typeof AGENT_AWAIT_STATUS_VALUES)[number];

export const WAIT_REASON_VALUES = ["human_input", "dependency"] as const;
export type WaitReason = (typeof WAIT_REASON_VALUES)[number];

export interface SatisfiedChild {
  runId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
}

export type HarnessSessionRef =
  | { kind: "pi"; treeId: string; resumeNodeId?: string }
  | { kind: "claude_code"; sessionId: string };
```

Add to `harness-capabilities.ts` interface: `supportsResume: boolean;`. Export the new file from `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- agent-await` → PASS.
Run: `npm run build --workspace=packages/core` → builds (fix any `supportsResume` missing-property errors in existing capability constants by setting PI=`true`, Claude Code=`false` for now).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add agent-await and harness resume contracts"
```

---

## Phase 2 — Persistence

### Task 2: `agent_await` entity + migration

**Files:**

- Create: `apps/api/src/workflow/workflow-await/agent-await.entity.ts`
- Create: `apps/api/src/database/migrations/<ts>-create-agent-await.ts`
- Modify: `apps/api/src/workflow/database/entities/workflow-run.entity.ts` (add `wait_reason`)
- Create: `apps/api/src/database/migrations/<ts>-add-workflow-run-wait-reason.ts`
- Test: `apps/api/src/workflow/workflow-await/__tests__/agent-await.entity.spec.ts`

Follow the `adding-entity-migration` skill for entity+migration+DatabaseModule registration conventions.

- [ ] **Step 1: Write the failing test** — assert entity metadata (table name `agent_await`, columns `parent_run_id`, `awaited_run_ids`, `status` default `WAITING`).

```ts
import { AgentAwaitEntity } from "../agent-await.entity";
import { getMetadataArgsStorage } from "typeorm";
it("maps agent_await table", () => {
  const table = getMetadataArgsStorage().tables.find(
    (t) => t.target === AgentAwaitEntity,
  );
  expect(table?.name).toBe("agent_await");
});
```

- [ ] **Step 2: Run** `npm run test --workspace=apps/api -- agent-await.entity` → FAIL.

- [ ] **Step 3: Implement** entity per SDD §4.2 (columns: `id` uuid PK, `parent_run_id` indexed, `parent_step_id`, `parent_session_tree_id` nullable, `awaited_run_ids` jsonb, `satisfied_run_ids` jsonb default `[]`, `status` enum default `WAITING`, `resume_node_id` nullable, timestamps). Add `wait_reason` (enum `human_input|dependency`, nullable) to `WorkflowRunEntity`. Write both migrations (additive `CREATE TABLE` / `ALTER TABLE ADD COLUMN`). Register entity in the owning DatabaseModule.

- [ ] **Step 4: Run** entity test → PASS; run migration against a scratch DB (`docker compose up -d postgres` then the api migration command) and confirm it applies.

- [ ] **Step 5: Commit** `feat(workflow): add agent_await entity and wait_reason column`.

### Task 3: `AgentAwaitRepository` + run wait-state methods

**Files:**

- Create: `apps/api/src/workflow/workflow-await/agent-await.repository.ts`
- Modify: `apps/api/src/workflow/database/repositories/workflow-run.repository.ts`
- Test: `apps/api/src/workflow/workflow-await/__tests__/agent-await.repository.spec.ts`

- [ ] **Step 1: Write failing tests** for: `create(await)`, `findById`, `findByParentRun`, `findWaitingByAwaitedChild(childRunId)`, `markSatisfied(id, child)`, `compareAndSetStatus(id, from, to)` (returns false on mismatch), and `WorkflowRunRepository.setWaitState(runId, reason)` only updates `WHERE status=RUNNING`, `clearWaitState(runId)`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** repository methods. `findWaitingByAwaitedChild` queries `awaited_run_ids @> '["<id>"]'::jsonb AND status='WAITING'`. `compareAndSetStatus` uses an UPDATE … WHERE status=:from returning affected rows for idempotent resume guard. Mirror `setAwaitingInput` for `setWaitState` (`WHERE status='RUNNING'`); set `awaiting_input=true` when reason is `human_input` for back-compat.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(workflow): agent_await repository and run wait-state persistence`.

---

## Phase 3 — Registry + reconciler immunity

### Task 4: `AgentAwaitRegistryService`

**Files:**

- Create: `apps/api/src/workflow/workflow-await/agent-await-registry.service.ts`
- Test: `apps/api/src/workflow/workflow-await/__tests__/agent-await-registry.service.spec.ts`

Service API:

```ts
register(input: { parentRunId: string; parentStepId: string;
  parentSessionTreeId?: string; awaitedRunIds: string[]; resumeNodeId?: string;
}): Promise<AgentAwaitEntity>;
onChildTerminal(childRunId: string, status: SatisfiedChild["status"]): Promise<{ ready: AgentAwaitEntity | null }>;
```

- [ ] **Step 1: Write failing tests** (mock repo):
  - `register` rejects an empty `awaitedRunIds`.
  - `register` rejects a self/ancestor await (cycle detection: reject if `parentRunId ∈ awaitedRunIds`).
  - `register` sets run wait-state to `dependency`.
  - `onChildTerminal` marks the child satisfied and returns `ready=null` while siblings outstanding.
  - `onChildTerminal` returns `ready=<await>` (status CAS to `RESUMING`) when the last child is satisfied.
  - `onChildTerminal` for an unknown child is a no-op.
  - `onChildTerminal` is idempotent (re-delivering a satisfied child does not double-resume).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the service against `AgentAwaitRepository` + `WorkflowRunRepository`. Emit process events (`agent_await.registered`, `agent_await.child_satisfied`) via the existing process-event publisher.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(workflow): agent await registry with join + cycle detection`.

### Task 5: Reconciler immunity for `wait_reason`

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts:134-136,207-213`
- Test: `apps/api/src/workflow/workflow-run-operations/__tests__/workflow-run-reconciliation.service.spec.ts`

- [ ] **Step 1: Write failing test** — a `RUNNING` run with `wait_reason='dependency'` (and `awaiting_input=false`) is excluded from `reconcileStaleRunningRuns` and `reconcileFailedQueueJobs`.

- [ ] **Step 2: Run** → FAIL (current filter only checks `awaiting_input`).

- [ ] **Step 3: Implement** — change both filters from `!run.awaiting_input` to `!run.awaiting_input && !run.wait_reason` (i.e. immune when parked for any reason).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `fix(workflow): extend reconciler immunity to dependency waits`.

---

## Phase 4 — Resume path

### Task 6: `DependencyParentResumeService`

**Files:**

- Create: `apps/api/src/workflow/workflow-await/dependency-parent-resume.service.ts`
- Test: `apps/api/src/workflow/workflow-await/__tests__/dependency-parent-resume.service.spec.ts`

Mirror `SubagentParentResumeService` (`apps/api/src/workflow/workflow-subagents/subagent-parent-resume.service.ts:25-75`). API: `resumeParent(await: AgentAwaitEntity): Promise<void>`.

- [ ] **Step 1: Write failing tests** (mock `SessionHydrationService`, `WorkflowJobMessageQueueService`, run repo):
  - For each satisfied child, `appendSystemResultNode` is called with the child's id/status/result summary.
  - `clearWaitState(parentRunId)` is called.
  - `resumeJobWithMessage(parentRunId, parentSessionTreeId, <joinMessage>)` is called once.
  - await status set to `RESUMED`.
  - if `resumeJobWithMessage` throws, status stays `RESUMING` and the error propagates (reconciler retries).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — build a join summary message enumerating child outcomes; reuse `SessionHydrationService.appendSystemResultNode` to inject each child result into the parent session tree; call `resumeJobWithMessage`; emit `agent_await.resume_started` / `agent_await.resumed`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(workflow): resume parent agent on dependency join`.

### Task 7: Child-terminal upward hook

**Files:**

- Create: `apps/api/src/workflow/workflow-await/agent-await-child-terminal.listener.ts`
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts` (terminal paths: `completeWorkflowRun`, `handleJobFailed`, cancellation) to emit internal event `workflow.run.terminal` with `{ runId, status }` if not already emitted.
- Test: `apps/api/src/workflow/workflow-await/__tests__/agent-await-child-terminal.listener.spec.ts`

- [ ] **Step 1: Write failing test** — listener calls `registry.onChildTerminal(runId, status)`; if `ready`, calls `dependencyParentResume.resumeParent(ready)`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** the `@OnEvent('workflow.run.terminal')` listener; add the emit at each terminal transition (guard against double-emit — emit once in the shared terminal closer if one exists, else at each call site).

- [ ] **Step 4: Run** → PASS; run existing `workflow-run-job-execution` tests to confirm no regression.

- [ ] **Step 5: Commit** `feat(workflow): wire child-terminal to dependency await resume`.

### Task 8: `AgentAwaitReconcilerService` (safety net)

**Files:**

- Create: `apps/api/src/workflow/workflow-await/agent-await-reconciler.service.ts`
- Test: `apps/api/src/workflow/workflow-await/__tests__/agent-await-reconciler.service.spec.ts`

Mirror `WorkflowRunReconciliationService` interval style (`setInterval`, `onModuleInit`, `inFlight` guard).

- [ ] **Step 1: Write failing tests**:
  - `WAITING` await whose every awaited child is terminal → drives resume (covers lost event / restart).
  - `RESUMING` await older than a grace window → retries resume.
  - bounded retries → marks parent run FAILED with a clear reason.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — on each tick, load non-terminal awaits, check child statuses via run repo, satisfy + resume as needed; retry stuck `RESUMING`.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(workflow): agent await reconciler safety net`.

### Task 9: `WorkflowAwaitModule` wiring

**Files:**

- Create: `apps/api/src/workflow/workflow-await/workflow-await.module.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts` (import) and DatabaseModule (register entity/repo)
- Test: `apps/api/src/workflow/workflow-await/__tests__/workflow-await.module.spec.ts`

- [ ] **Step 1–4:** Write a Nest testing-module compile test (`Test.createTestingModule`) that resolves `AgentAwaitRegistryService`, `DependencyParentResumeService`, `AgentAwaitReconcilerService`; run → FAIL → wire providers/exports per `nestjs-module-conventions` → PASS.

- [ ] **Step 5: Commit** `feat(workflow): wire WorkflowAwaitModule`.

---

## Phase 5 — Agent-callable capability

### Task 10: `await_agent_workflow` runtime action + suspend directive

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts` (add `startAwaitedInvocationWorkflows`)
- Modify: `apps/api/src/workflow/providers/delegation-capability.provider.ts` (register `await_agent_workflow`)
- Modify: runtime lifecycle controller to route `requested_action: 'await_agent_workflow'`
- Test: `apps/api/src/workflow/workflow-runtime/__tests__/workflow-runtime-orchestration-actions.service.spec.ts`

- [ ] **Step 1: Write failing tests**:
  - capability starts each child via `startWorkflow` with `{ parentWorkflowRunId, parentStepId, ...inputs }`.
  - it calls `registry.register(...)` with the started child run ids.
  - it returns a response whose directive instructs the runner to suspend (`executionStatus: 'suspended'`).
  - if the resolved engine lacks `supportsResume`, it throws a clear validation error (no children started).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `startAwaitedInvocationWorkflows`: resolve children, start with parent link, register the await, resolve the parent session tree id (for resume), set run wait-state via registry, return the suspend directive. Add the capability descriptor (transport mirrors `invoke_agent_workflow`).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `feat(workflow): await_agent_workflow durable suspend capability`.

### Task 11: Runner honours the suspend directive

**Files:**

- Modify: runner/kernel handling of action responses (`packages/harness-runtime` or the runtime client) to dehydrate the session and end the turn on a `suspended` directive.
- Modify: API side — on suspend directive, invoke `SessionHydrationService.dehydrateSession` (extract → kill → remove) for the parent container.
- Test: harness-runtime unit test for the suspend branch; api test asserting `dehydrateSession` is called.

- [ ] **Step 1–4:** TDD the directive handling: runner stops prompting and exits cleanly; API tears down the container after capturing the session. Verify the parent run stays `RUNNING` with `wait_reason='dependency'`.

- [ ] **Step 5: Commit** `feat(runtime): suspend session on await directive`.

---

## Phase 6 — Claude Code engine resume

> **Status (2026-06-12): shipped.** Capability flag, session-ref plumbing, produce-side capture (`getProducedSessionId` → `persistProducedSessionRef` → `agent_await.parent_session_ref`), and resume routing (`resumeSessionRef` → `config.session.resume`) are implemented and unit/integration tested (`claude-code-engine.resume.spec.ts`, `dependency-parent-resume.service.spec.ts`, `step-agent-step-executor.helpers.spec.ts`, `step-agent-step-executor.multistep.spec.ts`). Remaining: a live full-stack E2E (nice-to-have). See `docs/superpowers/plans/2026-06-12-await-followups-and-tool-schema-hardening.md` Phase 0.

### Task 12: Capability flag + session-ref plumbing

**Files:**

- Modify: `packages/harness-engine-claude-code/src/claude-code-engine.ts`, `claude-code-session.ts`
- Modify: `packages/core/src/interfaces/harness-runtime-config.types.ts` (`session.resume?: HarnessSessionRef`)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts:182-193` (populate `session` on resume jobs)
- Test: `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.resume.spec.ts`

- [ ] **Step 1: Write failing test** — given `ctx.session.resume = { kind: 'claude_code', sessionId: 's1' }`, `createSession` passes `options.resume: 's1'` to the SDK and accepts a follow-up prompt.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — read the resume ref; pass `options.resume`; allow `ClaudeCodeSession.prompt()` post-resume; set `CLAUDE_CODE_CAPABILITIES.supportsResume = true`. Populate `HarnessRuntimeConfig.session` in `buildStepRunnerConfigPayloadCore` from the resume job payload.

- [ ] **Step 4: Run** → PASS; `npm run build --workspace=packages/harness-engine-claude-code`.

- [ ] **Step 5: Commit** `feat(harness): Claude Code engine session resume`.

---

## Phase 7 — Orchestration integration

### Task 13: CEO cycle uses durable await

**Files:**

- Modify: `seed/agents/ceo-agent/agent.json` (grant `await_agent_workflow`)
- Modify: `prompts/project-orchestration-cycle-ceo/cycle.md` (await discovery/backlog before deciding; read injected results)
- Modify: seed validation if capability allowlists exist
- Test: `npm run validate:seed-data`

Follow `seed-workflow-patterns`. Guard the prompt/manifest switch behind `ORCHESTRATION_AWAIT_ENABLED` (default on in dev) so the loop can fall back.

- [ ] **Step 1–4:** Update seed + prompt; run `npm run validate:seed-data` → PASS; reseed locally and confirm the CEO manifest exposes the capability.

- [ ] **Step 5: Commit** `feat(orchestration): CEO cycle awaits spawned discovery/backlog`.

### Task 14: E2E — no premature next cycle

**Files:**

- Create/Modify: `packages/e2e-tests/.../orchestration-await.e2e.ts` (extend deterministic kanban E2E)

- [ ] **Step 1: Write failing E2E** asserting: cycle N spawns an awaited child; while the child runs, the cycle run stays `RUNNING` with `wait_reason='dependency'` and **no** cycle N+1 starts (`linked_run_id` unchanged); after the child completes, the parent resumes, records its decision, goes terminal, and only then does N+1 fire; the resumed agent's context contains the child result.

- [ ] **Step 2: Run** `npm run test:e2e:kanban:deterministic` → FAIL.

- [ ] **Step 3: Implement** any glue needed for determinism (stub child workflow with controllable completion).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `test(e2e): orchestration cycle gates on awaited children`.

---

## Phase 8 — Hardening & docs

### Task 15: Remove dead watchdog + docs

> **Status (2026-06-12): superseded.** Re-verification found `waitForContainerExitWithTimeout` does **not** exist anywhere in code — only in this plan and the SDD — so there is nothing to delete. The unrelated `STEP_MAX_RUNTIME_MS` in `step-support.service.ts` is in active use (invoked-child polling) and must be kept. The architecture/SDD docs are now reconciled; the durable-await primitive is documented in `docs/architecture/durable-agent-await.md` and `docs/guide/08-workflow-runtime.md`. No code change required. See `docs/superpowers/plans/2026-06-12-await-followups-and-tool-schema-hardening.md` (Phase 0).

### Task 16: Full quality gate

- [ ] Run `npm run build --workspace=packages/core && npm run build:api`.
- [ ] Run `npm run test:api`, `npm run test:kanban`, `npm run test:unit:web`.
- [ ] Run `npm run lint:summary` — zero new findings; **no suppressions**.
- [ ] Run `npm run test:e2e:kanban:deterministic`.
- [ ] Commit any fixups; ensure 100% green before merge.

---

## Self-Review notes

- **Spec coverage:** §4.1 components → Tasks 2–11; §5 Claude Code resume → Task 12; §4.6 gate → Task 14; §4.5 failure/restart → Tasks 5,7,8; §7 observability → process events in Tasks 4,6,10; §8 testing → per-task TDD + Task 14; §10 module boundary → Task 9 (`WorkflowAwaitModule`), neutral naming enforced.
- **Type consistency:** `AgentAwaitStatus` (WAITING/RESUMING/RESUMED/CANCELLED) and `WaitReason` (human_input/dependency) defined in Task 1 and used verbatim in Tasks 2–10. `register` / `onChildTerminal` / `resumeParent` signatures fixed in Tasks 4 & 6 and consumed unchanged in Tasks 7,8,10.
- **No placeholders:** each code task carries concrete signatures, queries, and commands.
