# EPIC-034: Workflow-Driven Kanban Lifecycle

## Summary

Migrate all hardcoded kanban process logic from TypeScript services into declarative YAML workflows. Currently, the workflow engine orchestrates agent execution (implementation, review, merge) but significant business logic — QA decision routing, container pause/resume, worktree provisioning, merge outcome handling — is hardcoded in `WorkItemService`, `WorkItemWorktreeLifecycleService`, and tool `api_callback` definitions. This epic makes the workflow engine the single source of truth for all kanban lifecycle behaviour.

## Motivation

### Current State

The platform has a **hybrid architecture**:

| Concern | Currently | Owner |
|---------|-----------|-------|
| Agent implementation run | ✅ Workflow (`work-item-in-progress-default`) | Workflow Engine |
| Transition to `in-review` after implementation | ✅ Workflow (`transition_status` job) | Workflow Engine |
| QA review agent execution | ✅ Workflow (`work-item-in-review-default`) | Workflow Engine |
| QA decision → status routing (`accept`→`ready-to-merge`, `reject`→`in-progress`) | ❌ Hardcoded | `WorkItemService.submitQaDecision()` |
| Return to `in-progress` on review rejection | ❌ Hardcoded | `WorkItemService.applyStatusTransitionEffects()` |
| Resume/restart dev session on rejection | ❌ Hardcoded | `WorkItemService.resumeOrRestartDevRun()` |
| Container pause (in-progress→in-review) | ❌ Hardcoded | `WorkItemService.pauseDevRunIfActive()` |
| Container dehydrate (→blocked) | ❌ Hardcoded | `WorkItemService.dehydrateDevRunIfActive()` |
| Worktree provisioning/cleanup | ❌ Hardcoded | `WorkItemWorktreeLifecycleService` |
| Merge attempt + outcome routing | ⚠️ Partial — workflow owns `attempt_merge`, but REST endpoints duplicate routing | Both |
| `submit_qa_decision` tool | ❌ `api_callback` bypasses workflow | Tool Catalog → REST API |
| `submit_merge_result` tool | ❌ `api_callback` bypasses workflow | Tool Catalog → REST API |
| Automation trigger suppression | ❌ Hardcoded guard | `WorkItemService.triggerTransitionAutomation()` |

### Why Now

1. **Process customisability** — Users cannot customise the review-reject-resume flow without modifying TypeScript. With workflow YAML, they can change the behaviour by editing a definition.
2. **Auditability** — Workflow event sourcing (EPIC-033) only captures workflow-engine events. Hardcoded side-effects in `WorkItemService` are invisible to the event log.
3. **Reliability** — The `submit_qa_decision` tool's `api_callback` path bypasses the workflow engine entirely. If the REST call succeeds but the workflow fails to complete, the system enters an inconsistent state.
4. **Simplification** — `WorkItemService.applyStatusTransitionEffects()` has grown into a complex conditional block that mixes infrastructure concerns (container management) with business logic (status routing). Moving this to YAML makes the TypeScript services thin and testable.

## Goals

1. **Tool output capture** — The workflow engine can capture structured output from specific tool calls made during execution jobs, enabling conditional transitions based on tool results.
2. **QA decision routing via workflow** — The review workflow owns the full accept/reject flow, including status transitions and QA feedback recording.
3. **Container lifecycle via workflow** — Container pause, resume, dehydrate, and removal are orchestrated by workflow steps, not hardcoded in status transition handlers.
4. **Worktree lifecycle via workflow** — Worktree provisioning and cleanup are workflow steps.
5. **Merge cleanup** — The merge workflow owns all merge-related status transitions end-to-end without REST endpoint fallbacks.
6. **Clean `WorkItemService`** — After migration, `applyStatusTransitionEffects()` contains zero hardcoded conditional branches. All side-effects are workflow-driven.

## Non-Goals

1. Data-driven allowed transition state machine (per-project board configuration) — future work.
2. Interactive multi-step execution — tracked separately.
3. Custom board column definitions — future work.
4. Distributed trace propagation to containers — future work.

---

## Technical Approach

### New Engine Enhancement: `output_tool` (Tool Output Capture)

Jobs can declare `output_tool: <tool_name>` to capture a specific tool call's parameters as job output. When the agent calls the named tool during execution, the telemetry gateway captures the tool call's input arguments and stores them in `jobs.{jobId}.output` via `StateManagerService`.

**Example:**
```yaml
- id: review_work_item
  type: execution
  output_tool: submit_qa_decision
  # When agent calls submit_qa_decision, its params become this job's output
  # e.g., jobs.review_work_item.output.decision = 'accept'
```

**Implementation path:**
- Add `output_tool?: string` to `IJob` interface in `@nexus/core`
- `TelemetryGateway.handleToolExecutionEnd()` checks if the tool matches the job's `output_tool`
- If matched, stores the tool parameters in `StateManagerService` under `jobs.{jobId}.output`
- This enables existing conditional transitions (`transitions[].condition`) to branch on tool results

### New Engine Enhancement: `suppress_automation` on `transition_status`

The `transition_status` special step accepts an optional `suppress_automation: true` input that prevents `WorkItemService.updateStatus()` from triggering webhook-based automations. This prevents cascading workflow triggers (e.g., review workflow transitions to `in-progress` but should NOT trigger the `in-progress` workflow).

**Implementation path:**
- Add optional `suppressAutomation?: boolean` to `UpdateWorkItemStatusInput`
- `WorkItemService.applyStatusTransitionEffects()` respects the flag
- `StepTransitionStatusSpecialStepHandler` reads `suppress_automation` from inputs and passes it through

### New Special Step Type: `manage_container`

Controls container infrastructure lifecycle. Wraps existing `WorkflowRunSteeringService` and `ContainerOrchestratorService`.

| Action | Description | Existing Service Method |
|--------|-------------|------------------------|
| `pause` | Docker pause a workflow run's container | `WorkflowRunSteeringService.pause()` |
| `unpause` | Docker unpause a paused container | `WorkflowRunSteeringService.resume()` |
| `dehydrate` | Save session + free container | `SessionHydrationService.dehydrateSession()` |

**YAML usage:**
```yaml
- id: pause_dev_container
  type: manage_container
  tier: light
  inputs:
    action: pause
    execution_id: "{{ trigger.workItem.currentExecutionId }}"
```

### New Special Step Type: `manage_worktree`

Controls git worktree provisioning and cleanup. Wraps `GitWorktreeService`.

| Action | Description |
|--------|-------------|
| `provision` | Create worktree for `trigger.workItem` |
| `remove` | Remove worktree for `trigger.workItem` |

**YAML usage:**
```yaml
- id: provision_worktree
  type: manage_worktree
  tier: light
  inputs:
    action: provision
```

### New Special Step Type: `manage_execution`

Resumes or restarts an existing workflow run. Wraps `WorkflowRunSteeringService` and `WorkItemAutomationService`.

| Action | Description |
|--------|-------------|
| `resume_or_restart` | Try to resume an existing run; if no run exists or resume fails, trigger a fresh automation for the work item's current status |

**YAML usage:**
```yaml
- id: resume_dev_session
  type: manage_execution
  tier: light
  inputs:
    action: resume_or_restart
    execution_id: "{{ trigger.workItem.currentExecutionId }}"
```

### New Special Step Type: `record_metadata`

Appends structured data to a work item's metadata field. Used for QA feedback history and merge lifecycle tracking.

| Action | Description |
|--------|-------------|
| `append_qa_feedback` | Push a QA decision record to `metadata.qaFeedback[]` |
| `set_merge_lifecycle` | Update `metadata.lifecycle.merge` |

**YAML usage:**
```yaml
- id: record_qa_feedback
  type: record_metadata
  tier: light
  inputs:
    action: append_qa_feedback
    decision: "{{ jobs.review_work_item.output.decision }}"
    feedback: "{{ jobs.review_work_item.output.feedback }}"
```

---

## Implementation Phases

### Phase 1: Tool Output Capture & `suppress_automation` (Foundation)

**Scope:** Engine enhancements that later phases depend on.

#### Changes

**`packages/core/src/interfaces/index.ts`** — Add `output_tool?: string` to `IJob` interface.

**`apps/api/src/workflow/tool-output-capture.service.ts`** (new) — Service that:
- Stores set of `(workflowRunId, jobId, toolName)` registrations in-memory
- `registerOutputTool(runId, jobId, toolName)` — called when a job with `output_tool` starts execution
- `captureIfMatch(runId, stepId, toolName, toolArgs)` — called from telemetry; if tool matches, stores in `StateManagerService`
- `deregister(runId, jobId)` — cleanup on job complete

**`apps/api/src/telemetry/telemetry.gateway.ts`** — In `handleToolExecutionEnd()`, after tracking the tool call, call `toolOutputCapture.captureIfMatch()` with the tool name and input arguments from the payload.

**`apps/api/src/workflow/step-execution-orchestrator.service.ts`** — Before executing an execution job, if `job.output_tool` is set, call `toolOutputCapture.registerOutputTool()`.

**`apps/api/src/project/work-item.service.ts`** — Add `suppressAutomation?: boolean` to `UpdateWorkItemStatusInput`. In `applyStatusTransitionEffects()`, skip `triggerTransitionAutomation()` when `suppressAutomation` is `true`.

**`apps/api/src/workflow/step-transition-status-special-step.handler.ts`** — Read `suppress_automation` from `resolvedStepInputs` and pass to `updateStatus()`.

#### Acceptance Criteria

- [ ] `IJob.output_tool` property accepted by parser and validator.
- [ ] When an agent calls the tool matching `output_tool`, its params are stored in `jobs.{jobId}.output`.
- [ ] Conditional transitions can reference captured tool output values.
- [ ] `transition_status` with `suppress_automation: true` does NOT trigger downstream workflows.
- [ ] All new code has unit tests.
- [ ] TypeScript builds cleanly.

---

### Phase 2: QA Decision → Workflow-Driven

**Scope:** Make the review workflow own the entire accept/reject flow.

#### Changes

**`apps/api/src/workflow/step-record-metadata-special-step.handler.ts`** (new) — `record_metadata` special step handler. Actions: `append_qa_feedback`. Reads trigger context for `projectId`/`workItemId`, updates work item metadata via `WorkItemRepository`.

**`apps/api/src/tool/tool-catalog.service.ts`** — Remove `api_callback` from `submit_qa_decision` tool definition. The tool becomes output-only (its `typescript_code` stub already returns structured data).

**`apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`** — Update:
```yaml
jobs:
  - id: review_work_item
    type: execution
    tier: heavy
    output_tool: submit_qa_decision
    required_tool_calls: [submit_qa_decision]
    max_retries: 2
    retry_prompt: >
      You have NOT called the submit_qa_decision tool yet...
    inputs:
      agent_profile: architect-agent
    steps:
      - id: review
        prompt: |
          ... (existing prompt) ...
    transitions:
      - condition: "jobs.review_work_item.output.decision == 'accept'"
        next: record_feedback_accept
      - condition: "jobs.review_work_item.output.decision == 'reject'"
        next: record_feedback_reject

  - id: record_feedback_accept
    type: record_metadata
    tier: light
    depends_on: [review_work_item]
    inputs:
      action: append_qa_feedback
      decision: "{{ jobs.review_work_item.output.decision }}"
      feedback: "{{ jobs.review_work_item.output.feedback }}"

  - id: transition_to_ready_to_merge
    type: transition_status
    tier: light
    depends_on: [record_feedback_accept]
    inputs:
      target_status: ready-to-merge

  - id: record_feedback_reject
    type: record_metadata
    tier: light
    depends_on: [review_work_item]
    inputs:
      action: append_qa_feedback
      decision: "{{ jobs.review_work_item.output.decision }}"
      feedback: "{{ jobs.review_work_item.output.feedback }}"

  - id: transition_to_in_progress
    type: transition_status
    tier: light
    depends_on: [record_feedback_reject]
    inputs:
      target_status: in-progress
      suppress_automation: true
```

**`apps/api/src/project/work-item.service.ts`** — `submitQaDecision()` becomes a thin metadata-only method (no status change). It records the QA feedback to metadata and returns the work item. The status change is now the workflow's responsibility. Update `applyStatusTransitionEffects()` to remove the `in-review → in-progress` resume path (deferred to Phase 3 for `manage_execution`).

#### Acceptance Criteria

- [ ] `submit_qa_decision` tool no longer has `api_callback`.
- [ ] Review workflow branches to `record_feedback_accept` / `record_feedback_reject` based on captured tool output.
- [ ] `record_metadata` handler correctly appends to `metadata.qaFeedback[]`.
- [ ] `transition_status` with `suppress_automation: true` prevents the `in-progress` workflow from re-triggering.
- [ ] QA feedback is still recorded in work item metadata.
- [ ] All new/modified code has unit tests.

---

### Phase 3: Container Lifecycle → Workflow-Driven

**Scope:** Move container pause/dehydrate from hardcoded code to workflow steps.

#### Changes

**`apps/api/src/workflow/step-manage-container-special-step.handler.ts`** (new) — `manage_container` special step handler. Actions: `pause`, `unpause`, `dehydrate`. Resolves execution ID from inputs, calls `WorkflowRunSteeringService` or `SessionHydrationService`.

**`apps/api/src/workflow/step-manage-execution-special-step.handler.ts`** (new) — `manage_execution` special step handler. Action `resume_or_restart`: tries to resume an existing workflow run via `WorkflowRunSteeringService.resume()`; on failure, triggers a fresh automation via `WorkItemAutomationService.triggerStatusTransition()`.

**`apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`** — Add `pause_dev_container` job before `transition_to_review`.

**`apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`** — On reject path, add `resume_dev_session` job after `transition_to_in_progress`.

**`apps/api/src/project/work-item.service.ts`** — Remove `pauseDevRunIfActive()` call from `applyStatusTransitionEffects()`. Remove `dehydrateDevRunIfActive()` call. Remove `resumeOrRestartDevRun()` method and the `in-review → in-progress` special path. Remove `triggerTransitionAutomation()` suppression guard.

#### Acceptance Criteria

- [ ] `manage_container` handler correctly pauses/dehydrates containers.
- [ ] `manage_execution` handler correctly resumes or triggers fresh runs.
- [ ] `applyStatusTransitionEffects()` no longer contains container or resume logic.
- [ ] Review rejection flow (reject → record feedback → transition → resume) works end-to-end.
- [ ] Implementation flow (implement → pause → transition to review) works end-to-end.
- [ ] All new code has unit tests.

---

### Phase 4: Worktree Lifecycle → Workflow-Driven

**Scope:** Move worktree provisioning/cleanup to workflow steps.

#### Changes

**`apps/api/src/workflow/step-manage-worktree-special-step.handler.ts`** (new) — `manage_worktree` special step handler. Actions: `provision`, `remove`. Reads project ID and work item from trigger context. Calls `GitWorktreeService.provisionWorktree()` or `removeWorktree()`.

**`apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`** — Add `provision_worktree` as the first job (before `implement_and_commit`).

**`apps/api/src/database/seeds/work-item-ready-to-merge-default.workflow.yaml`** — Add `cleanup_worktree` as final job in success paths.

**`apps/api/src/project/work-item.service.ts`** — Remove `worktreeLifecycleService.handleTransition()` call from `applyStatusTransitionEffects()`.

**`apps/api/src/project/work-item-worktree-lifecycle.service.ts`** — Remove the service (its logic now lives in the workflow handler). Remove from `ProjectModule` providers.

#### Acceptance Criteria

- [ ] `manage_worktree` handler provisions and removes worktrees correctly.
- [ ] In-progress workflow provisions worktree before agent execution.
- [ ] Merge workflow cleans up worktree after successful merge.
- [ ] `WorkItemWorktreeLifecycleService` deleted.
- [ ] `applyStatusTransitionEffects()` no longer calls worktree service.
- [ ] All new code has unit tests.

---

### Phase 5: Merge Outcome Cleanup

**Scope:** Make the merge workflow fully self-contained for status transitions.

#### Changes

**`apps/api/src/tool/tool-catalog.service.ts`** — Remove `api_callback` from `submit_merge_result` tool definition.

**`apps/api/src/database/seeds/work-item-ready-to-merge-default.workflow.yaml`** — Update `finalize_clean` and `finalize_conflict` to be `transition_status` jobs that set status to `done`. Add `cleanup_worktree` and `record_metadata` (merge lifecycle) jobs.

**`apps/api/src/project/work-item.service.ts`** — Simplify `submitMergeResult()` to only record merge metadata (no status transition). Simplify `mergeWorkItem()` to only perform the merge operation and return the result (no status transition) — leave status transitions to the workflow.

#### Acceptance Criteria

- [ ] `submit_merge_result` tool no longer has `api_callback`.
- [ ] Merge workflow transitions to `done` via `transition_status` steps.
- [ ] `submitMergeResult()` REST endpoint only records metadata.
- [ ] Merge lifecycle metadata still recorded correctly.
- [ ] All new code has unit tests.

---

### Phase 6: Final Cleanup & Documentation

**Scope:** Remove all remaining hardcoded conditional logic from `applyStatusTransitionEffects()` and clean up dead code.

#### Changes

**`apps/api/src/project/work-item.service.ts`** — `applyStatusTransitionEffects()` becomes a thin method that only calls `triggerTransitionAutomation()`. All conditional branches removed. Delete private methods: `pauseDevRunIfActive()`, `dehydrateDevRunIfActive()`, `resumeOrRestartDevRun()`.

**Documentation updates:**
- Update `README.md` with new workflow step types.
- Update `docs/EVENT_DRIVEN_WORKFLOW_TRIGGERS.md` with `suppress_automation` flag.
- Update `docs/SDD.md` with tool output capture and new special step types.
- Update seed workflow `WORKFLOW_SEEDING_GUIDE.md` with new workflow definitions.

#### Acceptance Criteria

- [ ] `applyStatusTransitionEffects()` has zero status-conditional branches.
- [ ] No dead code remains (unused private methods, unused imports).
- [ ] All documentation is current.
- [ ] Full test suite passes.
- [ ] TypeScript builds cleanly.
- [ ] ESLint passes.

---

## Affected Files Summary

### New Files

| File | Phase | Description |
|------|-------|-------------|
| `apps/api/src/workflow/tool-output-capture.service.ts` | 1 | Tool output capture service |
| `apps/api/src/workflow/tool-output-capture.service.spec.ts` | 1 | Tests |
| `apps/api/src/workflow/step-record-metadata-special-step.handler.ts` | 2 | `record_metadata` handler |
| `apps/api/src/workflow/step-record-metadata-special-step.handler.spec.ts` | 2 | Tests |
| `apps/api/src/workflow/step-manage-container-special-step.handler.ts` | 3 | `manage_container` handler |
| `apps/api/src/workflow/step-manage-container-special-step.handler.spec.ts` | 3 | Tests |
| `apps/api/src/workflow/step-manage-execution-special-step.handler.ts` | 3 | `manage_execution` handler |
| `apps/api/src/workflow/step-manage-execution-special-step.handler.spec.ts` | 3 | Tests |
| `apps/api/src/workflow/step-manage-worktree-special-step.handler.ts` | 4 | `manage_worktree` handler |
| `apps/api/src/workflow/step-manage-worktree-special-step.handler.spec.ts` | 4 | Tests |

### Modified Files

| File | Phase(s) | Description |
|------|----------|-------------|
| `packages/core/src/interfaces/index.ts` | 1 | Add `output_tool` to `IJob` |
| `apps/api/src/telemetry/telemetry.gateway.ts` | 1 | Integrate tool output capture |
| `apps/api/src/telemetry/telemetry.gateway.spec.ts` | 1 | Updated tests |
| `apps/api/src/workflow/step-execution-orchestrator.service.ts` | 1 | Register output tool on job start |
| `apps/api/src/workflow/step-transition-status-special-step.handler.ts` | 1 | Add `suppress_automation` support |
| `apps/api/src/workflow/step-transition-status-special-step.handler.spec.ts` | 1 | Updated tests |
| `apps/api/src/workflow/step-special-step.types.ts` | 1-4 | Add new types to union |
| `apps/api/src/workflow/step-special-step-executor.service.ts` | 1-4 | Register new handlers |
| `apps/api/src/workflow/workflow.module.ts` | 1-4 | Register new providers |
| `apps/api/src/project/work-item.service.ts` | 1-6 | Add `suppressAutomation`, simplify |
| `apps/api/src/tool/tool-catalog.service.ts` | 2, 5 | Remove `api_callback` definitions |
| `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml` | 2, 3 | Add transitions, new jobs |
| `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml` | 3, 4 | Add container/worktree jobs |
| `apps/api/src/database/seeds/work-item-ready-to-merge-default.workflow.yaml` | 4, 5 | Add worktree/status jobs |

### Deleted Files

| File | Phase | Reason |
|------|-------|--------|
| `apps/api/src/project/work-item-worktree-lifecycle.service.ts` | 4 | Logic moved to workflow handler |
| `apps/api/src/project/work-item-worktree-lifecycle.service.spec.ts` | 4 | Corresponding tests |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tool output capture timing (telemetry race) | Medium | High | Use synchronous storage in `handleToolExecutionEnd` before broadcasting |
| Breaking existing workflows during migration | Medium | High | Incremental phases; each phase leaves fallback paths until the next phase removes them |
| Container pause/resume reliability in workflow context | Low | Medium | `manage_container` wraps existing proven service methods |
| Infinite cross-workflow loops (review rejects → in-progress → in-review) | Medium | High | `suppress_automation: true` prevents cascading; existing per-edge loop limit (10) applies within workflows |
| `suppress_automation` misuse causing stuck items | Low | Medium | Workflow completion hooks (future) as safety net; audit logging |
| Seed workflow changes require re-seeding | Low | Low | `seed:workflows` CLI command; idempotent by name |

---

## Dependencies

- **EPIC-033** (Observability) — Correlation IDs and workflow event sourcing should be complete first so new workflow steps are automatically captured in the event log.
- **`@nexus/core` package** — Interface changes in Phase 1 require package rebuild.

## Estimated Scope

- **6 phases**, incrementally deployable
- **5 new special step handlers** + **1 new service**
- **3 workflow YAML updates**
- **~15 test files** new or modified
