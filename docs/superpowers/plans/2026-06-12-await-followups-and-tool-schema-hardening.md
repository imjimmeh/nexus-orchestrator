# Await Follow-ups & Tool-Schema Hardening — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute task-by-task. Steps use checkbox (`- [ ]`) syntax. Build `packages/core` before `apps/api`.

**Created:** 2026-06-12
**Context:** Follow-up to the durable-agent-await work (`docs/architecture/durable-agent-await.md`) and the `manage_todo_list` schema incident (root `z.union` → DeepSeek `type: null` 400). Closes three items raised after the CEO delegate-await fix (kanban-k24x) and schema fix (kanban-x2cb).

## ⚠️ Reconciliation first — two of the three "open" items are already done

Verification on 2026-06-12 (against `main` at commit `2f582fda`) found that two items previously listed as open were resolved by the durable-await work and only survive as **stale documentation**:

1. **Dead container watchdog (`waitForContainerExitWithTimeout` / `STEP_MAX_RUNTIME_MS`)** — `grep` shows `waitForContainerExitWithTimeout` exists **only** in `docs/specs/SDD-durable-agent-await.md` and `docs/superpowers/plans/2026-06-12-durable-agent-await.md`. It is **not present in any `.ts` file**. There is nothing to delete. A live, unrelated `STEP_MAX_RUNTIME_MS` exists in `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` (invoked-child polling timeout) — **do not touch it**.
2. **Claude Code resume produce-side persistence** — already implemented and unit-tested end-to-end at the wiring level:
   - capture: `ClaudeCodeSession.getProducedSessionId()` (`packages/harness-engine-claude-code/src/claude-code-session.ts:69`) → `server.ts:230`
   - persist: `step-agent-step-executor.service.ts:267` (`persistProducedSessionRef`) → `step-agent-step-executor.multistep.ts:141` → `AgentAwaitRepository.updateParentSessionRef` → `agent_await.parent_session_ref` (migration `20260618000000-add-agent-await-session-ref.ts`)
   - resume: `DependencyParentResumeService` (`dependency-parent-resume.service.ts:101-102`) forwards `parent_session_ref` as `resumeSessionRef`; `step-agent-step-executor.helpers.ts:172-175` routes `kind:'claude_code'` → `config.session.resume`; `ClaudeCodeEngine.createSession` consumes it.
   - tests: `dependency-parent-resume.service.spec.ts:188`, `step-agent-step-executor.helpers.spec.ts:507`, `claude-code-engine.resume.spec.ts`.

Phase 0 corrects the docs and verifies the one thing unit tests do not prove: a **real end-to-end Claude Code suspend→resume**. Phases A and B are the genuinely new work.

---

## Phase 0 — Reconcile stale docs + close the Claude Code E2E gap

### Task 0.1: Correct the stale durable-await docs

**Files:** `docs/specs/SDD-durable-agent-await.md`, `docs/superpowers/plans/2026-06-12-durable-agent-await.md`, `docs/architecture/durable-agent-await.md`

- [ ] In the SDD, replace the "Claude Code resume deferred" note with the as-built reality (capture → persist → resume path above), or mark it **Implemented** with the file references.
- [ ] In the SDD/plan, mark the `waitForContainerExitWithTimeout` cleanup (durable-await plan Task 15) as **N/A — symbol not present in code; only `step-support.service.ts:STEP_MAX_RUNTIME_MS` exists and is in active use, not dead.**
- [ ] In `durable-agent-await.md` "Engine support", update to state Claude Code resume persistence is wired (pending the E2E in Task 0.2) rather than deferred.
- [ ] No code change. Commit `docs: reconcile durable-await follow-up status`.

### Task 0.2: End-to-end Claude Code suspend → resume coverage

**Goal:** prove (not just unit-wire) that a Claude-Code-engine parent that calls `await_agent_workflow` is dehydrated, its produced `sessionId` persisted to `agent_await.parent_session_ref`, and on child completion it resumes with `config.session.resume` set — so the agent continues mid-conversation.

**Files:**

- Verify single-step vs multistep capture: confirm `persistProducedSessionRef` fires for the path the CEO actually uses (`step-agent-step-executor.service.ts` wires it into the multistep deps — confirm agent steps route through multistep; if a single-step path exists that bypasses capture, that is the real gap to fix).
- Test: extend `apps/api` await integration (`workflow-await/__tests__/agent-await.integration.spec.ts`) and/or a deterministic E2E (`packages/e2e-tests`).

**Finding (2026-06-12):** the resume chain is already proven at three hops by existing unit tests — capture (`claude-code-engine.resume.spec.ts` `getProducedSessionId`), persist→resume-ref (`dependency-parent-resume.service.spec.ts:188` "forwards parent_session_ref to the queue as the resume session ref"), and resume-ref→config (`step-agent-step-executor.helpers.spec.ts:507`). The only untested hop is the capture→persist glue (`persistProducedSessionRefBestEffort` in `step-agent-step-executor.multistep.ts`, reached only via `executeJobCore`). A focused test was drafted and confirmed the behaviour works (`executeAgent` returning `producedSessionId` → `persistProducedSessionRef('run', {kind:'claude_code', sessionId})`), but the only host spec (`step-agent-step-executor.multistep.spec.ts`) carries **12 pre-existing `@typescript-eslint/unbound-method` errors** (`expect(deps.containerHttpClient.<method>)` patterns) that block lint-staged on commit. Landing the micro-test cleanly therefore requires first clearing that debt (cast each to `as ReturnType<typeof vi.fn>`, which the rule accepts — see the already-clean site at line ~121).

- [ ] **Step 1:** Clean the pre-existing `unbound-method` debt in `step-agent-step-executor.multistep.spec.ts` (cast `deps.containerHttpClient.<method>` references). No behaviour change. (`npm run lint:api` for the file → clean.)
- [ ] **Step 2 (RED→GREEN):** Add the capture→persist test: `executeAgent` returns `producedSessionId` → assert `persistProducedSessionRef` is called with `{kind:'claude_code', sessionId}`; and a negative case (no produced id → not called). Run → green (characterization of shipped behaviour; if it ever regresses it goes RED).
- [ ] **Step 3 (optional, heavier):** A live stack-harness E2E running the real Claude Code engine suspend→resume (`docs/guide/45-stack-harness.md`). Requires the docker stack; treat as a separate spike.
- [ ] **Step 4:** Run → green; `npm run build:api`; commit `test(workflow): cover claude code durable-await capture→persist`.

> **Done (2026-06-12):** cleared the host spec's pre-existing `unbound-method` debt (cast `deps.containerHttpClient` to a `Record<string, Mock>` at the assertion sites) and added the capture→persist tests (`persistProducedSessionRef` called with `{kind:'claude_code', sessionId}` on a produced id; not called otherwise). All four resume hops are now unit/integration tested. Only the live full-stack Claude Code suspend→resume E2E remains (Step 3) — it requires the docker stack and is a separate spike, still tracked in `kanban-jaqe`.

---

## Phase A — Tool-schema root-type guard (fail fast at registration)

**Problem:** A tool/capability whose `inputSchema` serializes to a non-object JSON Schema root (e.g. a root `z.union` → `{ anyOf: [...] }`, no top-level `type`) is accepted at registration but **rejected by strict LLM providers** (DeepSeek: `400 … 'type: null'`), killing the agent's first turn. This already happened with `manage_todo_list` (kanban-x2cb). Catch it at registration/projection time, not at provider-call time.

**Files:**

- `apps/api/src/capability-infra/runtime-capability-schema.adapter.ts` — `zodSchemaToCapabilityJsonSchema` (the conversion)
- `apps/api/src/tool-registry/tool-validation.service.ts` — `validateSchema` (fail-fast hook, called by `ToolRegistryService.upsertTool` at `tool-registry.service.ts:67`)
- Tests: `runtime-capability-schema.adapter.spec.ts`, `tool-validation.service.spec.ts` (create if absent)

**Design decision:** guard in **`ToolValidationService.validateSchema`** (covers canonical capabilities, projected delegations, and plugin/MCP tools that flow through the registry — the single chokepoint before persistence). Keep the adapter pure. The rule: a tool schema intended for provider dispatch must have root `type === 'object'`. Reject `anyOf`/`oneOf`/`allOf` roots and any missing/`null` root type with an actionable error naming the tool. Do not silently coerce — surfacing the authoring bug is the point.

- [ ] **Task A.1 (RED):** In `tool-validation.service.spec.ts`, assert `validateSchema` throws a descriptive error for `{ anyOf: [...] }` (no `type`), for `{ type: null }`, and for a missing root `type`; and that it accepts `{ type: 'object', properties: {...} }` and `{ type: 'object' }` (loose object). Run → FAIL.
- [ ] **Task A.2 (GREEN):** Implement the root-type check in `validateSchema` (after existing presence checks). Error message: `Tool '<name>' schema root must be type:"object" (got <repr>); strict providers reject non-object roots. If accepting multiple shapes, use one z.object with optional fields + superRefine, not a root z.union.` Run → PASS.
- [ ] **Task A.3 (regression):** Add a test that every **canonical `@Capability`** input schema serializes to an object root — iterate `CapabilityRegistryService.discover()` entries and assert `entry.schema.type === 'object'`. This locks the whole capability surface against the regression. Run → PASS (fix any offenders found by collapsing root unions, same pattern as the `manage_todo_list` fix).
- [ ] **Task A.4:** `npm run build:api`; `npm run lint:api` (changed files clean). Commit `fix(tool-registry): reject non-object tool-schema roots at registration`.

---

## Phase B — Circuit breaker on repeated identical tool_contract_mismatch launches

> **Status (2026-06-12): implemented for the await path.** `DelegationCircuitBreakerService` (keyed on resolved workflow definition id + `tool_contract_mismatch`, threshold `DELEGATION_CIRCUIT_BREAKER_THRESHOLD`, default 3) + repository finder `findActiveFailureClassificationGroup` + integration in `WorkflowRuntimeAwaitActionsService.startAwaitedInvocationWorkflows` (refuses to launch / register the await when open) + CEO `decide.md` "circuit-broken delegations (do not retry)" guidance. Observability is via a `logger.warn` and the existing signal-group diagnostics (`occurrence_count`, `last_skipped_reason`) plus the surfaced refusal error.
>
> **Follow-up status (2026-06-12):**
>
> - **invoke fallback guard** — **shipped (2026-06-12, kanban-p0pm).** First extracted the pure invocation utilities from `WorkflowRuntimeOrchestrationActionsService` into the helpers module (543→395 lines, clearing the `max-lines` limit), then added the guard: `invokeAgentWorkflow` resolves the target workflow definition id, calls `circuitBreaker.evaluate`, and returns a `skipped_circuit_open` / `delegation_circuit_open` envelope when open (no `startWorkflow`). Now both the await and fire-and-forget paths are circuit-guarded.
> - **dedicated `circuit_open` event** — not added: the open decision is already observable via the breaker `logger.warn`, the `runtime_feedback_signal_groups` diagnostics, and the refusal error reaching the agent/ledger. A bespoke event was judged low-value for the added publisher dependency.

**Problem:** When a delegated child workflow keeps failing with the same `tool_contract_mismatch` (eligibility `human_required`, no auto-repair), the board stays drained and the next cycle re-launches the **identical doomed delegation** every cycle — a fire-and-poll loop (observed: runs `4885f27b` → `94290e89`). The launcher should detect a repeating, human-required, non-progressing failure for a target workflow and **suppress the re-launch** with a clear signal instead of churning.

**Existing materials to reuse (do not rebuild):**

- Failure classification + fingerprint: `WorkflowFailureClassificationService.buildRuntimeFeedbackDedupeFingerprint` (`workflow-failure-classification.service.ts:188`) → `failure_classification|<class>|workflow:<id>|eligibility:<e>|repair_action:<…>`.
- Signal store: `runtime_feedback_signal_groups` (`RuntimeFeedbackSignalGroup` entity + `RuntimeFeedbackSignalGroupRepository`) with `occurrence_count`, `window_occurrence_count`, `cooldown_until`, `affected_json.failure_class`, `candidateId`.
- Launch path: `WorkflowRuntimeAwaitActionsService.startAwaitedInvocationWorkflows` and `WorkflowRuntimeOrchestrationActionsService.invokeAgentWorkflow` → `WorkflowEngineService.startWorkflow*`; the in-flight guard `list_running_workflows`.

**Design decision:** add a small **`DelegationCircuitBreakerService`** queried at launch time, keyed by **target `workflow_id` + scope**. It opens when an unresolved `tool_contract_mismatch` (or any `human_required`) signal group for that workflow has `window_occurrence_count >= N` (default 3) and no linked learning candidate/resolution. When open, the launch is **skipped** (mirroring the existing concurrency-skip response shape: `executionStatus: 'skipped_circuit_open'`, `ok:false`, actionable `errorMessage`) and a one-time human-facing signal is emitted. Closes when the signal group is resolved/cooled down or a config change is detected. Threshold + window are env-configurable (`DELEGATION_CIRCUIT_BREAKER_THRESHOLD`, default 3; reuse the signal group's window).

- [ ] **Task B.1 (RED):** Unit-test `DelegationCircuitBreakerService.isOpen({ workflowId, scopeId })` against a mocked `RuntimeFeedbackSignalGroupRepository`: returns **open** when a `tool_contract_mismatch` group for that workflow has `window_occurrence_count >= threshold` and `candidateId == null` and `cooldown_until` in the future/unset-but-recent; returns **closed** below threshold, for other failure classes, or when resolved. Run → FAIL.
- [ ] **Task B.2 (GREEN):** Implement the service (read-only query + threshold logic). Add a `findOpenContractMismatchByWorkflow(workflowId, scopeId)` query to the repository if not expressible with existing finders. Run → PASS.
- [ ] **Task B.3 (RED):** Test that `startAwaitedInvocationWorkflows` (and `invokeAgentWorkflow`) **does not start a child** and returns a skip response when the breaker is open for the target workflow; and starts normally when closed. Run → FAIL.
- [ ] **Task B.4 (GREEN):** Inject the breaker into the launch path(s); check before `startWorkflow`. On open: skip, emit a single `delegation.circuit_open` process event (so it surfaces in the ledger/UI once, not every cycle), and return the skip envelope. On closed: proceed unchanged. Run → PASS.
- [ ] **Task B.5 (prompt):** Update `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` so the CEO treats a `skipped_circuit_open` delegation result as a blocker to record (`decision: blocked` / `blockedItems` with the failing workflow + reason), not something to retry. Re-run `npm run validate:seed-data` and the CEO seed-contract spec.
- [ ] **Task B.6:** `npm run build:api`; `npm run lint:api`. Commit `feat(workflow): circuit-break repeated human-required delegation failures`.

---

## Phase C — Quality gate

- [ ] `npm run build --workspace=packages/core && npm run build:api`
- [ ] `npm run test:api` (focus the touched suites; full suite before merge)
- [ ] `npm run validate:seed-data`
- [ ] `npm run lint:api` — zero new findings; **no suppressions** (per repo lint policy)
- [ ] Update `docs/guide/08-workflow-runtime.md` (tool-schema guard note) and `docs/guide/10-workflow-repair.md` / `23-kanban-orchestration.md` (circuit-breaker behaviour).

---

## Risks / notes

- **Phase A breadth:** the canonical-schema regression test (A.3) may surface other root-union tool schemas beyond `manage_todo_list`. Fix each by collapsing to an object root — do **not** weaken the guard to accommodate them.
- **Phase B false-positives:** key the breaker on the **target workflow + scope + failure class**, never globally, so one broken delegation can't suppress unrelated work. Make it observable (single process event) and self-closing (cooldown / candidate resolution) so it never silently wedges the loop.
- **Boundary:** all changes live in `apps/api` / `packages/core`; keep Kanban-neutral naming (no work-item/kanban identifiers in API/core), per the Core/Kanban boundary rules.
