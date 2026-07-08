# EPIC-136: Orchestration Stall Prevention – Delegation Feedback Loops and Spec Hydration Safety

**Epic ID:** EPIC-136  
**Status:** Implemented  
**Created:** 2026-04-22  
**Last Updated:** 2026-04-22 (Implemented)  
**Priority:** P0 - Critical  
**Theme:** Orchestration Resilience, Autonomous Agent Safety, Spec Hydration Reliability

---

## 1. Executive Summary

The autonomous orchestrator for project **556d4517-b7c5-44b8-b36e-cb58ccd2dc90** stalled permanently on 2026-04-22 at 20:42 UTC because:

1. **CEO cycle** delegated spec-writing to the **Architect Agent** via `invoke_agent_workflow`.
2. **Architect** successfully created 9 new spec files in `/workspace/docs/work-items/` but **never called `kanban.publish_specs`** to hydrate them into the database.
3. **Dispatch poller** gating logic (`hasDispatchOpportunity()`) only fires a new CEO cycle when `todoItems.length > 0` in the DB.
4. With zero todo items and no new CEO cycle, the system **deadlocked permanently**.

This epic implements three independent, stacked safety mechanisms to prevent all variants of this stall pattern:

1. **Option A:** Staleness heartbeat in the dispatch poller — fire a CEO cycle when orchestration is idle for >20 min regardless of todo count.
2. **Option B:** Mandatory spec hydration post-step in the delegation workflow — always call `kanban.publish_specs` after agent tasks complete.
3. **Option C:** Emit CEO cycle events on delegation workflow completion — close the feedback loop architecturally when child workflows finish.

**Approach:** Implement **all three** (**A + B + C**) in this epic for defense-in-depth stall prevention. Each mechanism is independent and orthogonal, providing overlapping coverage for different failure modes.

### Implementation Summary (2026-04-22)

Implemented in codebase:

1. Option A: stale-heartbeat dispatch override and stale telemetry emission.
2. Option B: mandatory post-delegation `kanban.publish_specs` workflow job.
3. Option C: delegation-completion listener that emits parent cycle requests.

Key implementation decisions:

1. Preserve existing dispatch cooldown and max-active gating; only bypass todo-count gating for stale orchestrations.
2. Keep delegation-completion emission best-effort, with strict UUID validation and event-ledger telemetry for denied/failure outcomes.
3. Treat post-delegation `kanban.publish_specs` as mandatory but non-fatal when no specs are present.

Challenges and resolutions:

1. Existing orchestration status tracking depended on known trigger-source values.
  - Resolution: added `delegation_completion` to allowed orchestration trigger sources.
2. Stale-cycle visibility required queryable telemetry.
  - Resolution: added `orchestration_stale_cycle_triggered` event-ledger emission from dispatch polling consumer.
3. Delegation completion needed immediate parent feedback without coupling to agent prompt compliance.
  - Resolution: added dedicated workflow-run completion listener keyed to delegation workflow IDs.

---

## 2. Background and Problem Statement

### 2.1 Incident Timeline

- **20:38 UTC** — CEO Cycle run `920f5eab-f99a-4863-aa86-6b9379dd954b` fires.
  - Project state: 45 work items all `done`, 0 todo.
  - Calls `kanban.publish_specs` on `docs/work-items/` — returns `ok: false` (unresolved dependencies: 3 spec files depend on non-existent TASK-00A).
  - Sets decision: `wait_for_architect`.
  - Delegates to architect via `invoke_agent_workflow` targeting `Orchestration Invoke Agent Default`.
  - Workflow **completes successfully** at 20:39:22.

- **20:39–20:42 UTC** — Architect workflow `ff145375-...` runs.
  - Reads existing specs, architecture docs, SDD.
  - Creates **9 new spec files** in `/workspace/docs/work-items/`:  
    `TASK-11A-001`, `TASK-12A-001`, `TASK-12B-001`, `TASK-14A-001`, `TASK-15A-001`, `TASK-15B-001`, etc.
  - **Does NOT call `kanban.publish_specs`** to hydrate files into DB work items.
  - Workflow **completes successfully** at 20:42:29.

- **20:42 UTC onward** — Permanent stall.
  - DB state: 45 work items remain `done`, 0 todo items.
  - `project_orchestrations` record: `status='orchestrating'`, `currentWorkflowRunId=NULL`.
  - Dispatch poll **continues to run every 10–30 seconds**.
  - `hasDispatchOpportunity()` returns **false** because `todoItems.length === 0`.
  - Self-heal path also gated on `pendingCount === 0` — exits immediately.
  - **No new CEO cycle fires** → system stalled permanently.

### 2.2 Root Cause

The dispatch poller uses a **todo-count gate** to decide whether to fire the next CEO cycle:

```typescript
// apps/api/src/project/work-item-dispatch-polling.consumer.ts
private async hasDispatchOpportunity(
  projectId: string,
  maxActive: number,
): Promise<boolean> {
  const [activeItems, todoItems] = await Promise.all([
    this.workItemRepository.findByProjectIdAndStatuses(
      projectId,
      ACTIVE_WORK_ITEM_STATUSES,
    ),
    this.workItemRepository.findByProjectIdAndStatuses(
      projectId,
      TODO_WORK_ITEM_STATUSES,
    ),
  ]);

  return activeItems.length < maxActive && todoItems.length > 0;
}
```

When a delegated agent writes specs to disk **without calling `kanban.publish_specs`**, the files exist in the container filesystem but not in the database. The poller has no way to know specs exist (it only looks at DB state). With zero todo items in the database, it gates the CEO cycle permanently.

### 2.3 Why This Matters

- **Autonomous orchestration is only as resilient as its feedback loops.** If a delegated agent can silently fail to notify the parent orchestrator, the system deadlocks.
- **Spec hydration is a critical handoff.** Many agents (architect, spec-generator, product-manager) write markdown specs. If any of them skip the hydration call, the orchestrator stalls.
- **This is a class of bug**, not an isolated incident. Any future delegation-based spec-writing task that doesn't call `kanban.publish_specs` will cause the same deadlock.

---

## 3. Goals

1. **Prevent spec-hydration deadlocks** — ensure that when agents write spec files, they are hydrated into the database so the CEO cycle can see and dispatch them.
2. **Add staleness detection** — detect when an orchestration is idle (no CEO cycles, no progress) and force a recovery cycle unconditionally.
3. **Enforce spec hydration in the delegation contract** — make `kanban.publish_specs` a mandatory post-step for delegation workflows so agents don't have to remember.
4. **Emit CEO cycle feedback events** — wire delegation workflow completion back to the orchestration event loop so the system self-corrects architecturally.
5. **Preserve existing orchestration behavior** — all changes must be backward-compatible; no existing orchestrations should regress.
6. **Add comprehensive telemetry** — log all stall-detection events, recovery cycles, and spec-hydration outcomes for observability.

---

## 4. Non-Goals

1. Changing the dispatch poller's fundamental philosophy (capacity-aware gating is correct).
2. Making agents responsible for orchestration control flow (delegation is one-way; agents should not orchestrate the parent).
3. Modifying work-item status transitions or kanban state machines.
4. Refactoring the CEO agent prompt or its decision logic (the agent is working correctly; the infrastructure is the problem).
5. Introducing new database tables or migrations beyond what's strictly necessary.

---

## 5. Scope Summary

### 5.1 Option A: Staleness Heartbeat (Dispatch Poller)

**Scope:** Monitor `project_orchestrations.updated_at` and fire a CEO cycle if the timestamp is older than a configurable threshold (default: 20 minutes).

**Affected files:**

- `apps/api/src/project/work-item-dispatch-polling.consumer.ts` — add staleness check to `shouldTriggerCycle()`
- `apps/api/src/project/work-item-dispatch-polling.helpers.ts` — add `isOrchestrationStale()` helper
- Environment/settings: Add `ORCHESTRATION_STALE_THRESHOLD_MINUTES` setting (default: 20)

**Implementation outline:**

1. When `isOrchestrationReadyForCycle()` is true, additionally check if `orchestration.updatedAt < now - threshold`.
2. If stale, fire a CEO cycle **regardless of todo count** (override the `hasDispatchOpportunity()` gate).
3. Emit a telemetry event `orchestration_stale_cycle_triggered` with `projectId`, `staleSinceDuration`, and `reason: stale_heartbeat`.
4. CEO will call `kanban.publish_specs`, discover any new spec files, hydrate them, and dispatch.

**Why this works:**

- Catches **any** stall, not just spec-hydration stalls (e.g., if a delegated workflow silently fails).
- Self-correcting: CEO already has logic to handle zero-todo state gracefully.
- No agent changes required; pure infrastructure safety net.
- Backward-compatible: only fires if orchestration is already idle and ready for a cycle.

---

### 5.2 Option B: Mandatory Spec Hydration Post-Step (Delegation Workflow)

**Scope:** Add a second job or post-step to `orchestration-invoke-agent-default.workflow.yaml` that unconditionally calls `kanban.publish_specs` after the agent's delegated task completes.

**Affected files:**

- `seed/workflows/orchestration-invoke-agent-default.workflow.yaml` — add post-execution job

**Implementation outline:**

1. After the `delegated_task` step completes, add a spec-publication post-step that:
   - Calls `kanban.publish_specs` with `project_id: trigger.projectId`.
   - Waits for the result and logs the outcome (whether specs were found or not).
   - Does NOT fail the workflow if `kanban.publish_specs` returns `ok: false` (specs may not exist; this is safe).
2. Emit telemetry for delegated spec publication with `projectId`, `outcome: ok|no_specs`.
3. CEO will see the newly hydrated items on its next cycle (or this cycle's next state refresh).

**Why this works:**

- Fixes the source: agents no longer have to remember to call `kanban.publish_specs`.
- Idempotent: calling `kanban.publish_specs` twice is harmless.
- Catches the architect-pattern specifically and all similar delegation patterns.
- No agent prompt changes required; workflow machinery handles it.

---

### 5.3 Option C: CEO Cycle Events on Delegation Completion

**Scope:** When `orchestration-invoke-agent-default` workflow completes successfully, emit a `ProjectOrchestrationCycleRequestedEvent` for the parent project, triggering the next CEO cycle to automatically redispatch based on newly hydrated specs.

**Affected files:**

- `apps/api/src/workflow/workflow-completion.event-handler.ts` (or similar completion listener).
- `apps/api/src/project/events/project-orchestration-cycle-requested.event.ts` (already exists).
- `orchestration-invoke-agent-default.workflow.yaml` — requires `projectId` in trigger context and validation.

**Implementation outline:**

1. Identify the workflow completion handler that fires when `orchestration-invoke-agent-default` reaches status `COMPLETED`.
2. Extract `trigger.projectId` from the workflow run context (validate it exists).
3. Emit `ProjectOrchestrationCycleRequestedEvent(projectId, workItemId: '__orchestration_lifecycle__', reason: 'delegation_completed')`.
4. Dispatch poller picks up the event immediately and fires a CEO cycle (subject to concurrency limits and cooldown).
5. Add telemetry event: `delegation_completion_cycle_requested` with `projectId` and `delegationWorkflowRunId`.
6. Log all emit failures (if projectId is missing, if event emission fails, etc.) for observability.

**Why this works:**

- Architecturally elegant: closes the delegation feedback loop at the event-emission level without requiring database state inspection.
- Ensures CEO always gets a chance to redispatch after delegated work, regardless of whether specs exist (A + B handle the spec case; C ensures the CEO sees it).
- Doesn't depend on database state or timing; purely event-driven and asynchronous.
- Complements A + B: if either of those mechanisms fails, C provides a third independent trigger.

**Design notes:**

- The event emission is best-effort; if it fails, the stale heartbeat (Option A) will eventually detect idle orchestration and retry.
- The workflow completion handler should be idempotent and filter only for delegation workflows (not all orchestration workflows).
- Concurrency limits on the CEO workflow still apply; the event is queued if the CEO is already running.
- This is a **pure addition**; no existing behavior changes unless delegation workflows start carrying `projectId` in the trigger.

---

## 6. Workstreams and Phasing

### WS1: Staleness Heartbeat Implementation (Option A)

**Deliverables:**

1. Add `isOrchestrationStale()` helper function to `work-item-dispatch-polling.helpers.ts`.
2. Modify `shouldTriggerCycle()` in `work-item-dispatch-polling.consumer.ts` to check staleness.
3. Add system setting `ORCHESTRATION_STALE_THRESHOLD_MINUTES` with default value 20.
4. Emit telemetry event `orchestration_stale_cycle_triggered` with contextual data.
5. Add unit tests for staleness detection logic.

**Primary files:**

- `apps/api/src/project/work-item-dispatch-polling.consumer.ts`
- `apps/api/src/project/work-item-dispatch-polling.helpers.ts`
- `apps/api/src/project/work-item-dispatch-polling.helpers.types.ts`
- Tests: `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts` (new or updated)

**Acceptance Criteria:**

1. Helper `isOrchestrationStale(orchestration, thresholdMs): boolean` exists and is exported.
2. `shouldTriggerCycle()` calls `isOrchestrationStale()` and skips the `hasDispatchOpportunity()` gate if true.
3. Telemetry event includes: `projectId`, `staleSinceDuration_ms`, `threshold_ms`, `reason`.
4. Setting `ORCHESTRATION_STALE_THRESHOLD_MINUTES` is configurable via environment or system settings table.
5. Unit tests cover: stale detection, non-stale case, missing `updatedAt`, edge cases (NaN dates, etc.).
6. Backward-compatible: all existing orchestrations continue to work; stale heartbeat is additive.

---

### WS2: Mandatory Spec Hydration in Delegation Workflow (Option B)

**Deliverables:**

1. Add a second job or post-step to `orchestration-invoke-agent-default.workflow.yaml`.
2. Post-step calls `kanban.publish_specs` with `project_id: trigger.projectId`.
3. Emit telemetry for delegated spec publication with outcome.
4. Validate that the workflow continues even if `kanban.publish_specs` returns `ok: false`.
5. Update workflow prompt documentation to explain the post-step.

**Primary files:**

- `seed/workflows/orchestration-invoke-agent-default.workflow.yaml`

**Acceptance Criteria:**

1. Workflow YAML includes a post-execution step (or second job) that calls `kanban.publish_specs`.
2. Step does not fail the workflow if `kanban.publish_specs` returns `ok: false` (specs may not exist).
3. Step logs the outcome (number of specs published, any errors, etc.) for observability.
4. Telemetry event includes: `projectId`, `outcome: ok|error|no_specs`, `specs_published_count` (if available).
5. Backward-compatible: any existing delegation workflows continue to work.
6. Documentation updated: YAML comments explain why `kanban.publish_specs` is called and that it's safe to call multiple times.

---

### WS3: CEO Cycle Event Emission on Delegation Completion (Option C)

**Deliverables:**

1. Identify or create workflow completion event handler for `orchestration-invoke-agent-default`.
2. Add logic to extract `trigger.projectId` and emit `ProjectOrchestrationCycleRequestedEvent`.
3. Add validation: only emit if `projectId` exists and is a valid UUID.
4. Add telemetry event `delegation_completion_cycle_requested` with contextual data.
5. Add unit tests for event emission logic.
6. Add integration test: delegation workflow completion triggers CEO cycle.

**Primary files:**

- `apps/api/src/workflow/workflow-completion.event-handler.ts` (or similar; to be identified)
- `apps/api/src/project/events/project-orchestration-cycle-requested.event.ts` (already exists)
- Tests: new test cases in workflow completion handler test file

**Acceptance Criteria:**

1. `orchestration-invoke-agent-default` completion is detected and triggers event emission.
2. `projectId` is safely extracted from workflow trigger context with validation.
3. `ProjectOrchestrationCycleRequestedEvent` is emitted with reason `'delegation_completed'`.
4. Telemetry event includes: `projectId`, `delegationWorkflowRunId`, `timestamp`.
5. Event emission failures are logged but do not crash the system.
6. Unit tests verify event is emitted only for delegation workflows, not all workflows.
7. Integration test verifies CEO cycle fires after delegation completes.
8. Backward-compatible: no changes to existing workflow completion behavior.

---

### WS4: Unit Tests and Integration Validation

**Deliverables:**

1. Unit tests for `isOrchestrationStale()` helper (WS1).
2. Integration test: dispatch poller fires CEO cycle when orchestration is stale, even with zero todo items (WS1).
3. End-to-end test: delegate workflow calls the `kanban.publish_specs` post-step and specs are hydrated (WS2).
4. Unit tests: workflow completion handler emits CEO cycle event correctly (WS3).
5. Integration test: delegation workflow completion triggers CEO cycle (WS3).
6. Regression tests: existing orchestrations continue to dispatch normally (no stale false positives or unexpected event emissions).

**Primary files:**

- `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts`
- `apps/api/src/project/work-item-dispatch-polling.helpers.spec.ts`
- `apps/api/src/workflow/workflow-completion.event-handler.spec.ts`
- E2E tests: `packages/e2e-tests/src/...` (new test cases)

**Acceptance Criteria:**

1. Unit tests pass for all staleness, event emission, and completion handler scenarios.
2. Integration test verifies CEO cycle fires when orchestration is stale.
3. Integration test verifies delegation completion triggers CEO cycle event.
4. E2E test verifies full chain: delegation completes → event fired → CEO cycle starts → specs hydrated and dispatched.
5. Regression test suite passes (existing orchestrations unaffected).
6. All tests pass locally and in CI before PR merge.

---

### WS5: Documentation and Runbook Updates

**Deliverables:**

1. Update [docs/SDD.md](../../docs/SDD.md) to document the three safety mechanisms.
2. Add runbook: [docs/operations/orchestration-stall-recovery.md](../../docs/operations/orchestration-stall-recovery.md).
3. Add troubleshooting guide for orchestration idleness and stale-cycle detection.
4. Update [docs/architecture/workflow-engine.md](../../docs/architecture/workflow-engine.md) with delegation feedback loop design.

**Primary files:**

- `docs/SDD.md`
- `docs/operations/orchestration-stall-recovery.md` (new)
- `docs/architecture/workflow-engine.md`

**Acceptance Criteria:**

1. SDD documents why the stall occurred and how the three options prevent it.
2. Runbook includes: manual recovery procedure, how to set `ORCHESTRATION_STALE_THRESHOLD_MINUTES`, how to inspect stale cycles in telemetry.
3. Troubleshooting guide lists observable signals (dispatch poller logs, telemetry events, DB queries).
4. Architecture doc explains delegation feedback loops and when to use each option.

---

## 7. PR-Ready Task List

Each task is scoped for a single PR with clear acceptance criteria and file change specificity.

### PR-1: Add Staleness Detection Helper (WS1, Part 1)

**Description:** Implement `isOrchestrationStale()` helper in polling helpers module.

**Changes:**

1. File: `apps/api/src/project/work-item-dispatch-polling.helpers.ts`
   - Add function:
     ```typescript
     export function isOrchestrationStale(
       orchestration: OrchestrationCycleContext | null | undefined,
       thresholdMs: number,
     ): boolean;
     ```
   - Logic: return `false` if threshold ≤ 0, if `orchestration` is null/undefined, or if `updatedAt` is missing/invalid.
   - Otherwise: return `Date.now() - updatedAt.getTime() >= thresholdMs`.
   - Handle date parsing edge cases (string vs Date object).

2. File: `apps/api/src/project/work-item-dispatch-polling.helpers.types.ts`
   - No changes (OrchestrationCycleContext already has `updatedAt`).

**Tests:**

- Add test cases in `apps/api/src/project/work-item-dispatch-polling.helpers.spec.ts`:
  - Stale case: updated_at is 30 min old, threshold is 20 min → returns true.
  - Non-stale case: updated_at is 10 min old, threshold is 20 min → returns false.
  - Threshold disabled: threshold is 0 or negative → returns false.
  - Missing updatedAt → returns false.
  - Invalid updatedAt (NaN, unparseable string) → returns false.

**Acceptance Criteria:**

- [ ] Helper function exists and is exported.
- [ ] All edge cases handled (null, undefined, missing date, invalid date, threshold ≤ 0).
- [ ] Unit tests pass (100% coverage of helper logic).
- [ ] No lint errors.

**Estimated Effort:** 1–2 hours

---

### PR-2: Integrate Staleness Gating into Dispatch Poller (WS1, Part 2)

**Description:** Modify `shouldTriggerCycle()` to call `isOrchestrationStale()` and override the `hasDispatchOpportunity()` gate.

**Changes:**

1. File: `apps/api/src/project/work-item-dispatch-polling.consumer.ts`
   - In `shouldTriggerCycle()` method (around line 232–252):
     - After checking `isOrchestrationReadyForCycle()`, add a second gate.
     - Call `this.getOrchestrationStaleThresholdMs()` to get the threshold setting.
     - Call `isOrchestrationStale(params.orchestration, threshold)`.
     - If stale, **skip the `hasDispatchOpportunity()` check** and proceed to cooldown check.
     - Add log: `logger.info('Firing CEO cycle due to stale orchestration', { projectId, staleSinceDuration: ... })`.
   - Add private method `getOrchestrationStaleThresholdMs()`:
     - Read setting `ORCHESTRATION_STALE_THRESHOLD_MINUTES` (default 20 minutes).
     - Return milliseconds: `minutes * 60 * 1000`.
     - Handle invalid values gracefully (return default if NaN or negative).

2. File: `apps/api/src/project/work-item-dispatch-polling.consumer.ts`
   - Add constant at top of file:
     ```typescript
     const ORCHESTRATION_STALE_THRESHOLD_MINUTES_KEY =
       "orchestration_stale_threshold_minutes";
     const DEFAULT_ORCHESTRATION_STALE_THRESHOLD_MINUTES = 20;
     ```

3. File: `apps/api/src/project/work-item-dispatch-polling.consumer.ts`
   - Modify `emitCycleRequested()` to pass a `reason` that includes 'stale_heartbeat' when applicable.
     - The reason is already logged; just ensure it's descriptive (e.g. `'stale_heartbeat:30min'`).

**Tests:**

- Add test cases in `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts`:
  - Orchestration is stale, todo count is 0 → cycle should be triggered.
  - Orchestration is not stale, todo count is 0 → cycle should NOT be triggered.
  - Orchestration is stale, but cooldown not satisfied → cycle should NOT be triggered.
  - Stale threshold is disabled (set to 0) → stale check is skipped, old behavior applies.
  - Setting read failure: default threshold is used.

**Acceptance Criteria:**

- [ ] `shouldTriggerCycle()` calls `isOrchestrationStale()` correctly.
- [ ] Stale orchestrations fire CEO cycles even with `todoItems.length === 0`.
- [ ] Cooldown check is still applied (stale cycles are not fired more than once per cooldown).
- [ ] Logging includes stale duration and reason.
- [ ] Setting `ORCHESTRATION_STALE_THRESHOLD_MINUTES` is read correctly.
- [ ] All unit tests pass.
- [ ] No lint errors.
- [ ] Backward-compatible: setting defaults to 20 min, behavior is additive.

**Estimated Effort:** 2–3 hours

---

### PR-3: Add Staleness Telemetry Event (WS1, Part 3)

**Description:** Emit a telemetry event when a CEO cycle is triggered due to staleness.

**Changes:**

1. File: `apps/api/src/project/work-item-dispatch-polling.consumer.ts`
   - In `emitCycleRequested()` method, detect if this cycle is being triggered for staleness.
     - Pass a flag or reason string that indicates staleness.
   - Emit an additional event or include a marker in the existing event: `ProjectOrchestrationCycleRequestedEvent` already accepts a `reason` string.
     - Update the reason string to be more specific: e.g., `'dispatch_poll:stale_heartbeat:25min'` instead of generic `'dispatch_poll'`.

2. File: If event telemetry handler exists separately, ensure the event is logged to the event ledger with domain='orchestration', event_name='stale_cycle_triggered'.

**Tests:**

- Add test that verifies the event is emitted with the correct reason string when stale.
- Add test that verifies existing event emission is unchanged for non-stale cycles.

**Acceptance Criteria:**

- [ ] Telemetry event includes: projectId, staleness duration, threshold, and reason.
- [ ] Event is queryable from the event ledger by `event_name = 'stale_cycle_triggered'`.
- [ ] Non-stale cycle events are unaffected.
- [ ] All tests pass.

**Estimated Effort:** 1 hour

---

### PR-4: Add Spec Hydration Post-Step to Delegation Workflow (WS2)

**Description:** Modify `orchestration-invoke-agent-default.workflow.yaml` to call `kanban.publish_specs` after the delegated task completes.

**Changes:**

1. File: `seed/workflows/orchestration-invoke-agent-default.workflow.yaml`
   - Current structure: one job `delegate` with one step `delegated_task`.
   - Add a second spec-publication job that runs after `delegate` completes.
   - Job definition:
     ```yaml
     - id: post_spec_publication
       type: execution
       tier: heavy
       inputs:
         projectId: "{{ trigger.projectId }}"
       steps:
         - id: spec_publication_step
           prompt: |
             This is a post-execution step for delegation cleanup.
              Call kanban.publish_specs to hydrate any spec files written by the delegated agent.
             If there are no specs to publish (ok: false), that is normal and not an error.
             Log the outcome.
     ```
   - Or: Add a `post` section to the existing job (if the workflow engine supports it).
   - Ensure `kanban.publish_specs` is in the allowed_tools list.

2. File: Add comments to the workflow explaining the purpose:
   ```yaml
    # IMPORTANT: After delegated task completion, always call kanban.publish_specs
   # to hydrate any markdown spec files written to /workspace/docs/work-items/.
   # This ensures the orchestrator can discover and dispatch new work items
    # in the next CEO cycle. It is safe to call kanban.publish_specs even if no specs exist.
   ```

**Validation:**

- Workflow YAML is valid (can be parsed by the workflow loader).
- `kanban.publish_specs` call succeeds or gracefully fails with `ok: false` (not a hard error).
- Workflow completes even if `kanban.publish_specs` has issues.

**Tests:**

- Add E2E test in `packages/e2e-tests/src/orchestration/delegation-spec-hydration.spec.ts` (new):
  - Setup: Create a mock agent that writes a spec file to `/workspace/docs/work-items/`.
  - Invoke: Call `invoke_agent_workflow` with the mock agent.
  - Verify: Workflow completes, `kanban.publish_specs` is called, and the new spec exists in the database as a work item.

**Acceptance Criteria:**

- [ ] Delegation workflow YAML is updated with post-step.
- [ ] `kanban.publish_specs` is called unconditionally after agent task.
- [ ] Workflow does not fail if `kanban.publish_specs` returns `ok: false`.
- [ ] Comments explain the purpose and idempotency.
- [ ] E2E test passes (delegation -> `kanban.publish_specs` -> spec hydrated).
- [ ] Backward-compatible: existing delegations continue to work.
- [ ] No lint errors in YAML.

**Estimated Effort:** 2–3 hours

---

### PR-5: Add Integration Test – Stale Cycle Triggers CEO with Zero Todos (WS3)

**Description:** Integration test verifying that staleness detection fires a CEO cycle even when todo count is zero.

**Changes:**

1. File: `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts` (new or updated)
   - Test: `should trigger CEO cycle when orchestration is stale and todo count is zero`
   - Setup:
     - Create a mock project orchestration with `status='orchestrating'`, `updated_at` 30 minutes ago.
     - Mock work item repository to return 0 todo items, 0 active items.
     - Mock system settings to return stale threshold = 20 minutes.
   - Action: Call `shouldTriggerCycle()` with the stale orchestration.
   - Assert: Returns `true`.

2. File: `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts`
   - Test: `should not trigger CEO cycle when orchestration is not stale but todo count is zero`
   - Setup: Same as above but `updated_at` is 5 minutes ago.
   - Assert: Returns `false` (old behavior).

3. File: `apps/api/src/project/work-item-dispatch-polling.consumer.spec.ts`
   - Test: `should respect cooldown even when orchestration is stale`
   - Setup: Stale orchestration, but previous cycle was triggered <1 minute ago.
   - Assert: Returns `false` (cooldown takes precedence).

**Acceptance Criteria:**

- [ ] All three test cases pass.
- [ ] Mocks are correctly set up (no real DB calls).
- [ ] Assertions are specific and descriptive.
- [ ] Test coverage for stale-related code path is ≥95%.

**Estimated Effort:** 2 hours

---

### PR-6: Add E2E Test – Delegation Workflow with Spec Hydration (WS3)

**Description:** End-to-end test that verifies delegation workflow publishes specs.

**Changes:**

1. File: `packages/e2e-tests/src/orchestration/delegation-spec-hydration.spec.ts` (new)
   - Test: `should hydrate specs published by delegated agent`
   - Precondition: Create a mock project and orchestration.
   - Action:
     - Invoke `orchestration-invoke-agent-default` workflow with an agent that writes a spec file.
     - Wait for workflow completion.
     - Verify that the spec file exists in `/workspace/docs/work-items/`.
     - Query the database: check that the new work item exists in the `work_items` table.
   - Assert: Spec is published and queryable in the database.

2. File: The E2E test should use the deterministic test setup if available (see user preferences: prefer deterministic tests).

**Acceptance Criteria:**

- [ ] E2E test passes in both local and CI environments.
- [ ] Test verifies full chain: agent writes spec → workflow calls `kanban.publish_specs` → spec hydrated in DB.
- [ ] Test is deterministic (no timing-dependent flakes).
- [ ] Test cleans up after itself (removes test project, clears test specs).

**Estimated Effort:** 3–4 hours

---

### PR-7: Regression Test – Existing Orchestrations Unaffected (WS3)

**Description:** Regression test suite ensuring existing orchestration behavior is unchanged.

**Changes:**

1. File: `packages/e2e-tests/src/orchestration/orchestration-dispatch-regression.spec.ts` (new or updated)
   - Test: `should dispatch work items normally when todo count > 0`
   - Setup: Orchestration with 5 todo items, 1 active item.
   - Action: Trigger dispatch poll.
   - Assert: CEO cycle fires normally (not due to staleness).

2. File: Same file.
   - Test: `should not trigger unnecessary cycles due to staleness setting`
   - Setup: Orchestration updated <5 min ago, 0 todo items.
   - Action: Trigger dispatch poll.
   - Assert: No CEO cycle fires (non-stale).

3. File: Same file.
   - Test: `should maintain concurrency limits`
   - Setup: Orchestration with `max_runs: 1`, cycle already running.
   - Action: Trigger staleness check.
   - Assert: New cycle is queued, not started immediately.

**Acceptance Criteria:**

- [ ] All regression tests pass.
- [ ] Existing dispatch behavior is preserved (no regressions).
- [ ] Stale-heartbeat is purely additive (doesn't break existing flows).

**Estimated Effort:** 2–3 hours

---

### PR-8: Documentation – System Design Update (WS4)

**Description:** Update `docs/SDD.md` to document the stall-prevention architecture.

**Changes:**

1. File: `docs/SDD.md`
   - Add section: "Orchestration Stall Prevention"
   - Document:
     - Why stalls occur (spec hydration gap, zero-todo gate).
     - Three safety mechanisms (Option A, B, C).
     - Precedence and interaction between mechanisms.
     - Configuration: `ORCHESTRATION_STALE_THRESHOLD_MINUTES` setting.
     - Telemetry events for stale cycles and delegated spec publication.

2. File: `docs/architecture/workflow-engine.md` (if it exists)
   - Add subsection: "Delegation Feedback Loops"
   - Document:
     - How delegation workflows (invoke_agent_default) ensure spec hydration.
     - Post-step contract for delegated tasks.
     - Why `kanban.publish_specs` is idempotent and always safe.

**Acceptance Criteria:**

- [ ] SDD documents all three options and which are implemented.
- [ ] Architecture doc explains delegation feedback loop.
- [ ] Configuration and telemetry are documented.
- [ ] No markdown lint errors.

**Estimated Effort:** 1–2 hours

---

### PR-9: Operations Runbook – Stall Recovery and Troubleshooting (WS4)

**Description:** Create runbook for diagnosing and recovering from orchestration stalls.

**Changes:**

1. File: `docs/operations/orchestration-stall-recovery.md` (new)
   - Sections:
     - **Symptoms:** orchestration stalled, no CEO cycles, zero progress for >20 min.
     - **Diagnosis:** DB queries to check stale orchestrations, todo count, recent cycles.
     - **Recovery:** manual trigger via API, setting `ORCHESTRATION_STALE_THRESHOLD_MINUTES`.
     - **Prevention:** ensure delegated agents call `kanban.publish_specs`, monitor stale events.
     - **Telemetry queries:** find stale-triggered cycles, inspect event ledger.

2. File: `docs/operations/orchestration-stall-recovery.md`
   - Example SQL queries:
     ```sql
     -- Find stale orchestrations
     SELECT id, project_id, status, updated_at, CURRENT_TIMESTAMP - updated_at as age
     FROM project_orchestrations
     WHERE status = 'orchestrating'
       AND CURRENT_TIMESTAMP - updated_at > interval '20 minutes'
     ORDER BY age DESC;
     ```

**Acceptance Criteria:**

- [ ] Runbook provides step-by-step recovery procedure.
- [ ] SQL queries are tested and correct.
- [ ] Settings adjustments are documented.
- [ ] Telemetry inspection steps are provided.
- [ ] No markdown lint errors.

**Estimated Effort:** 1–2 hours

---

### PR-10: Identify and Hook Workflow Completion Handler (WS3, Part 1)

**Description:** Locate or create the workflow completion event handler and add hooks for emitting CEO cycle events on delegation workflow completion.

**Changes:**

1. File: Identify the file responsible for handling workflow completion events (likely `apps/api/src/workflow/...` or `apps/api/src/orchestration/...`).
   - Search for existing `WorkflowCompletedEvent` or similar listener.
   - If no dedicated handler exists, create `apps/api/src/workflow/orchestration-delegation-completion.listener.ts`.

2. File: The handler/listener
   - Add or create a method to detect when a completed workflow is `orchestration-invoke-agent-default`.
   - Extract workflow metadata: `workflow_id`, `trigger` context, `status`.
   - Log the completion with relevant context.

3. File: Tests (new or existing)
   - Add basic test to verify the handler is registered and called on workflow completion.
   - Test that non-delegation workflows are filtered out correctly.

**Acceptance Criteria:**

- [ ] Workflow completion handler is identified or created.
- [ ] Handler is registered in the application module (DI container).
- [ ] Logging confirms handler is called on delegation workflow completion.
- [ ] Basic unit test verifies handler is invoked and filters workflows correctly.
- [ ] No lint errors.

**Estimated Effort:** 1–2 hours

---

### PR-11: Emit CEO Cycle Event on Delegation Completion (WS3, Part 2)

**Description:** Implement event emission logic in the delegation completion handler to trigger CEO cycles.

**Changes:**

1. File: The workflow completion handler (from PR-10)
   - Add logic to extract `trigger.projectId` from the completed workflow.
   - Validate that `projectId` is a valid UUID and not empty.
   - If validation fails, log a warning and skip event emission (best-effort).
   - If validation passes, emit `ProjectOrchestrationCycleRequestedEvent`:
     ```typescript
     this.eventEmitter.emit(
       PROJECT_ORCHESTRATION_CYCLE_REQUESTED_EVENT,
       new ProjectOrchestrationCycleRequestedEvent(
         projectId,
         "__orchestration_lifecycle__", // workItemId
         "", // goals (will be fetched by CEO)
         "workflow_completion", // source
         `delegation_completed:${workflowRunId}`, // reason
         false, // isRestart
         "", // stateSummary
         orchestrationId, // orchestrationId (optional)
       ),
     );
     ```
   - Log success: `logger.info('Emitted CEO cycle event on delegation completion', { projectId, workflowRunId })`.
   - Log failures: `logger.warn('Failed to emit CEO cycle event', { projectId, reason: 'missing_project_id' })`.

2. File: Add telemetry helper or integrate with existing telemetry
   - Emit event to event ledger: `delegation_completion_cycle_requested` with `projectId`, `delegationWorkflowRunId`, `timestamp`.

3. File: Tests
   - Test: Event is emitted when `projectId` is valid.
   - Test: Event is NOT emitted when `projectId` is missing or invalid.
   - Test: Emission failure (e.g., event emitter throws) is caught and logged.
   - Test: Event includes correct reason string.

**Acceptance Criteria:**

- [ ] `ProjectOrchestrationCycleRequestedEvent` is emitted on valid delegation completion.
- [ ] Event includes correct `projectId`, `reason`, and `source`.
- [ ] Validation logic safely handles missing/invalid `projectId`.
- [ ] Event emission failures are logged but do not crash handler.
- [ ] Telemetry event is recorded for observability.
- [ ] Unit tests verify all paths (success, missing projectId, emission failure).
- [ ] No lint errors.

**Estimated Effort:** 2–3 hours

---

### PR-12: Add Integration Test – Delegation Completion Triggers CEO (WS3, Part 3)

**Description:** Integration test verifying that delegation workflow completion triggers a CEO cycle event.

**Changes:**

1. File: `apps/api/src/workflow/orchestration-delegation-completion.listener.spec.ts` (or update existing test file)
   - Test: `should emit CEO cycle event when delegation workflow completes successfully`
     - Setup: Create a mock workflow run with `workflow_id='orchestration_invoke_agent_default'` and valid `trigger.projectId`.
     - Action: Call the completion handler / emit a `WorkflowCompletedEvent`.
     - Assert: `ProjectOrchestrationCycleRequestedEvent` is emitted with correct parameters.

   - Test: `should not emit event if projectId is missing`
     - Setup: Workflow run with missing `trigger.projectId`.
     - Assert: No event emitted; warning logged.

   - Test: `should not emit event for non-delegation workflows`
     - Setup: Workflow run with `workflow_id='some_other_workflow'`.
     - Assert: No event emitted.

2. File: E2E integration test (new or updated)
   - File: `packages/e2e-tests/src/orchestration/delegation-completion-event.spec.ts` (new)
   - Test: `should trigger CEO cycle when delegation workflow completes`
     - Setup: Create mock project and orchestration; start a delegation workflow.
     - Action: Let delegation workflow complete successfully.
     - Assert: `ProjectOrchestrationCycleRequestedEvent` is recorded in event ledger.
     - Assert: A new CEO cycle is queued (either executing or in the queue).

**Acceptance Criteria:**

- [ ] Unit tests verify event is emitted only for valid delegation completions.
- [ ] Unit tests verify invalid cases are handled safely (no crashes).
- [ ] E2E test verifies event flow: delegation completion → CEO cycle event → CEO cycle queued/running.
- [ ] All tests pass locally and in CI.
- [ ] Telemetry queries confirm event was recorded.

**Estimated Effort:** 2–3 hours

---

## 8. Acceptance Criteria and Definition of Done

### Functional Requirements

- [ ] Staleness detection fires CEO cycles when orchestration is idle for >20 min (configurable).
- [ ] Delegation workflows call `kanban.publish_specs` post-execution unconditionally.
- [ ] Delegation workflow completion emits CEO cycle events for the parent project.
- [ ] All three mechanisms are backward-compatible; no existing orchestrations regress.
- [ ] CEO cycle triggered by staleness discovers and dispatches newly hydrated work items.
- [ ] CEO cycle triggered by delegation completion discovers newly hydrated work items and redispatches.
- [ ] `kanban.publish_specs` failure in delegation workflow does not block workflow completion.
- [ ] Event emission failures in delegation completion handler are logged but non-fatal.

### Testing Requirements

- [ ] Unit tests: 100% code coverage for staleness helper and gating logic.
- [ ] Integration tests: staleness detection fires cycles correctly.
- [ ] E2E tests: delegation workflow → spec hydration → CEO dispatch chain works end-to-end.
- [ ] Regression tests: existing orchestrations dispatch normally (no false stale cycles).
- [ ] All tests pass locally and in CI before PR merge.

### Code Quality Requirements

- [ ] No ESLint warnings or errors; lint baseline unchanged.
- [ ] No TypeScript diagnostics.
- [ ] Code follows project conventions (SOLID, DRY, SoC).
- [ ] All new functions have clear comments and type annotations.
- [ ] Configuration keys are constants, not magic strings.

### Telemetry and Observability

- [ ] Stale cycle events are emitted to the event ledger with `event_name='orchestration_stale_cycle_triggered'` (queryable).
- [ ] Stale telemetry includes: projectId, stale duration, threshold, reason.
- [ ] Delegation post-step logs outcome (ok, error, specs_published_count).
- [ ] Delegation completion events are emitted with `event_name='delegation_completion_cycle_requested'` (queryable).
- [ ] Delegation event telemetry includes: projectId, delegationWorkflowRunId, timestamp, success/failure status.
- [ ] All logs are structured and queryable for debugging and incident analysis.
- [ ] Telemetry dashboards can display: stale cycles per project, spec hydration success rate, delegation completion event frequency.

### Documentation Requirements

- [ ] `docs/SDD.md` updated with stall-prevention architecture.
- [ ] `docs/architecture/workflow-engine.md` documents delegation feedback loops.
- [ ] `docs/operations/orchestration-stall-recovery.md` created with runbook and SQL queries.
- [ ] Workflow YAML includes comments explaining spec hydration post-step.
- [ ] All documentation passes markdown lint.

### Deployment and Operational Requirements

- [ ] Settings migration script provided (if any DB schema changes).
- [ ] `ORCHESTRATION_STALE_THRESHOLD_MINUTES` defaults to 20 (configurable).
- [ ] Existing deployments can upgrade without manual intervention.
- [ ] Stale cycle behavior can be toggled via system settings if needed.
- [ ] Rollback procedure is safe (stale checks are purely additive).

### Security and Safety

- [ ] No security implications from new code paths.
- [ ] Stale detection does not bypass any authorization or audit checks.
- [ ] Delegation post-step does not introduce new attack surface.
- [ ] Configuration changes are logged and auditable.

---

## 9. Rollout and Phasing

### Phase 1: Core Implementation (PR-1 through PR-4)

- Implement staleness helpers and gating logic (Option A).
- Integrate post-step spec hydration into delegation workflow (Option B).
- All PR checks pass, code review approved.

### Phase 2: Delegation Feedback Events (PR-10 through PR-12)

- Identify and hook workflow completion handler.
- Implement CEO cycle event emission on delegation completion (Option C).
- Add unit and integration tests for event emission.
- All PR checks pass, code review approved.

### Phase 3: Testing and Validation (PR-5 through PR-7)

- Add comprehensive unit, integration, and E2E tests for all three mechanisms.
- Run full regression suite.
- All tests passing in CI.

### Phase 4: Documentation (PR-8 and PR-9)

- Update SDD and architecture docs with all three mechanisms.
- Create operations runbook with telemetry inspection and recovery procedures.
- All markdown lint passes.

### Phase 5: Deployment

- Merge all PRs to main (Phase 1 → Phase 4).
- Deploy to staging; verify all three mechanisms in action.
- Monitor telemetry for stale cycles, spec hydration events, and delegation completion events.
- Deploy to production.
- Long-term monitoring: track prevention success and any new failure modes.

---

## 10. Success Metrics

- **Incident resolution:** Project 556d4517 orchestration transitions from stalled to active within 1 min of any of the three mechanisms triggering (stale heartbeat, spec hydration, or delegation completion event).
- **Prevention:** No new stalls from spec-hydration gaps or delegation feedback failures for 60+ days post-deployment.
- **Observability:** All stale cycles, spec hydration outcomes, and delegation completion events are logged and queryable in the event ledger.
- **Defense-in-depth:** All three mechanisms (A, B, C) demonstrate value in telemetry; no single mechanism is a bottleneck.
- **Regression:** Zero regressions in existing orchestration dispatch behavior; all orchestrations maintain same or improved throughput.
- **Code quality:** All PRs pass lint, tests, and code review without suppressions or caveats.

---

## 11. Related Issues and Context

- **Incident:** Project 556d4517-b7c5-44b8-b36e-cb58ccd2dc90 stalled on 2026-04-22 at 20:42 UTC.
- **Root cause:** Architect agent wrote specs without calling `kanban.publish_specs`; dispatch poller gate prevented CEO cycle with zero todos.
- **Prior analysis:** See conversation summary and repository memory notes on this incident.
- **Related epics:**
  - [EPIC-046: Autonomous Project Orchestrator](./EPIC-046-autonomous-project-orchestrator.md) — establishes CEO agent and orchestration cycle framework.
  - [EPIC-055: Dependency-Aware Parallelization – Critical Path](./EPIC-055-dependency-aware-parallelization-critical-path.md) — work scheduling and dispatch logic.

---

## 12. Appendix: Code Snippets and Examples

### A. Staleness Helper Implementation

```typescript
export function isOrchestrationStale(
  orchestration: OrchestrationCycleContext | null | undefined,
  thresholdMs: number,
): boolean {
  // Threshold disabled
  if (thresholdMs <= 0) {
    return false;
  }

  // Orchestration is null or missing updatedAt
  if (!orchestration?.updatedAt) {
    return false;
  }

  // Parse date safely
  const updatedAtMs =
    orchestration.updatedAt instanceof Date
      ? orchestration.updatedAt.getTime()
      : Date.parse(orchestration.updatedAt as string);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  // Check staleness
  return Date.now() - updatedAtMs >= thresholdMs;
}
```

### B. Dispatch Poller Integration

```typescript
private async shouldTriggerCycle(params: {
  projectId: string;
  orchestration: OrchestrationCycleContext | null | undefined;
}): Promise<boolean> {
  if (!isOrchestrationReadyForCycle(params.orchestration)) {
    return false;
  }

  const gating = await this.readCycleGatingSettings();
  if (gating.maxActive <= 0) {
    return false;
  }

  const staleThresholdMs = await this.getOrchestrationStaleThresholdMs();
  const isStale = isOrchestrationStale(
    params.orchestration,
    staleThresholdMs,
  );

  const hasDispatchOpportunity = isStale
    ? true // Skip todo gate for stale orchestrations
    : await this.hasDispatchOpportunity(
        params.projectId,
        gating.maxActive,
      );

  if (!hasDispatchOpportunity) {
    return false;
  }

  return this.isOutsideCycleCooldown(params.projectId);
}

private async getOrchestrationStaleThresholdMs(): Promise<number> {
  const minutesRaw = await this.settings.get<number>(
    ORCHESTRATION_STALE_THRESHOLD_MINUTES_KEY,
    DEFAULT_ORCHESTRATION_STALE_THRESHOLD_MINUTES,
  );

  const minutes =
    Number.isFinite(minutesRaw) && minutesRaw > 0
      ? Math.floor(minutesRaw)
      : DEFAULT_ORCHESTRATION_STALE_THRESHOLD_MINUTES;

  return minutes * 60 * 1000;
}
```

### C. Delegation Workflow Post-Step

```yaml
jobs:
  - id: delegate
    type: execution
    tier: heavy
    inputs:
      agent_profile: "{{ trigger.agent_profile }}"
    steps:
      - id: delegated_task
        # ... existing step ...

  - id: post_spec_publication
    type: execution
    tier: light
    inputs:
      projectId: "{{ trigger.projectId }}"
    steps:
      - id: spec_publication
        prompt: |
          Call kanban.publish_specs to hydrate any markdown specs written by the delegated agent.
          This is a post-execution cleanup step. It is safe to call even if no specs exist.
          Log the outcome.
```

### D. Delegation Completion Event Emission (Option C)

```typescript
// apps/api/src/workflow/orchestration-delegation-completion.listener.ts

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { WorkflowRun } from "../database/entities/workflow-run.entity";
import {
  PROJECT_ORCHESTRATION_CYCLE_REQUESTED_EVENT,
  ProjectOrchestrationCycleRequestedEvent,
} from "../project/events/project-orchestration-cycle-requested.event";

@Injectable()
export class OrchestrationDelegationCompletionListener {
  private readonly logger = new Logger(
    OrchestrationDelegationCompletionListener.name,
  );

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent("workflow.completed")
  async onWorkflowCompleted(event: {
    workflowRun: WorkflowRun;
  }): Promise<void> {
    const { workflowRun } = event;

    // Only process delegation workflows
    if (
      workflowRun.workflow?.workflow_id !== "orchestration_invoke_agent_default"
    ) {
      return;
    }

    // Only process successful completions
    if (workflowRun.status !== "COMPLETED") {
      return;
    }

    // Extract projectId from trigger
    const projectId = this.extractProjectId(workflowRun);
    if (!projectId) {
      this.logger.warn(
        "Failed to emit CEO cycle event: projectId missing from delegation trigger",
        { workflowRunId: workflowRun.id },
      );
      return;
    }

    try {
      // Emit CEO cycle event for parent orchestration
      this.eventEmitter.emit(
        PROJECT_ORCHESTRATION_CYCLE_REQUESTED_EVENT,
        new ProjectOrchestrationCycleRequestedEvent(
          projectId,
          "__orchestration_lifecycle__",
          "", // goals (will be fetched by CEO)
          "delegation_completion",
          `delegation_completed:${workflowRun.id}`,
          false, // isRestart
          "", // stateSummary
        ),
      );

      this.logger.info("Emitted CEO cycle event on delegation completion", {
        projectId,
        delegationWorkflowRunId: workflowRun.id,
        workflowId: workflowRun.workflow?.workflow_id,
      });
    } catch (error) {
      this.logger.error(
        "Failed to emit CEO cycle event on delegation completion",
        {
          projectId,
          delegationWorkflowRunId: workflowRun.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private extractProjectId(workflowRun: WorkflowRun): string | null {
    try {
      const trigger = workflowRun.trigger;
      if (!trigger || typeof trigger !== "object") {
        return null;
      }

      const projectId = (trigger as Record<string, unknown>).projectId;
      if (typeof projectId === "string" && projectId.trim()) {
        // Basic UUID validation
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            projectId,
          )
        ) {
          return projectId;
        }
      }
      return null;
    } catch (error) {
      this.logger.debug(
        "Error extracting projectId from workflow trigger",
        error,
      );
      return null;
    }
  }
}
```

This listener:

- Detects when `orchestration-invoke-agent-default` workflow completes successfully.
- Safely extracts `projectId` from the workflow trigger context.
- Validates the UUID format before proceeding.
- Emits `ProjectOrchestrationCycleRequestedEvent` to trigger the next CEO cycle.
- Logs failures without crashing the system (best-effort event emission).
