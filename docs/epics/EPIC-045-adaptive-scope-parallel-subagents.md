# EPIC-045 Adaptive Scope, Consolidated Review & Parallel Subagents

## Status

Planned

## Parent SDD

[SDD: Flat Work Items & Orchestrated Execution — Phase 3](../specs/SDD-flat-work-items-and-orchestrated-execution.md#6-phase-3--adaptive-scope--review)

## Prerequisites

- EPIC-043 (Flat Work Items) must be complete — hierarchy removed, dependency graph active.
- EPIC-044 (Orchestrator-Led Execution) must be complete — planning step, subagent delegation, session rehydration working.

## Problem Statement

After Phases 1 and 2, the system can plan and delegate. Three problems remain:

1. **Manual scope tagging** — The PM must explicitly set `scope: large` in the spec frontmatter. If they forget, a complex feature goes through the fast path with no planning, producing a worse implementation. If they over-tag, a simple item wastes time on an unnecessary planning step.
2. **Sequential subagent bottleneck** — Phase 2 dehydrates the parent while each subagent runs, meaning a 4-task plan with delegation takes 4× sequential subagent cycles. Independent tasks that could run concurrently are forced to wait.
3. **Uninformed review** — The QA review agent sees the diff but not the implementation plan. It cannot verify that planned deliverables were actually implemented or that cross-deliverable integration is correct. Review rejections cause a full re-implementation rather than targeted fixes.

## Goals

1. **Adaptive scope detection** — Automatically infer `scope` from spec characteristics during hydration, with PM override capability.
2. **Parallel subagent execution** — Allow the orchestrator to remain active while multiple subagents run concurrently on non-overlapping file sets.
3. **Plan-aware review** — Enhance the review workflow to receive the implementation plan and verify deliverable completeness.
4. **Delta re-planning on rejection** — When QA rejects, re-plan only the failing deliverables instead of re-implementing everything.
5. **New tools** — `spawn_subagent_async` (non-dehydrating) and `wait_for_subagents` (batch completion wait).

## Non-Goals

- Changes to the dispatch algorithm (Phase 1 completed this).
- Changes to the work item entity or spec format (Phase 1 completed this).
- Agent profile changes beyond review prompt enhancement.
- Web UI visualization of plans or subagent execution graphs (future follow-up).

## Detailed Task List

### Task 1: Adaptive Scope Detection in Spec Hydration

**Goal:** Automatically infer `scope` from spec body content when not explicitly set in frontmatter.

**Files:**

- `apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts`
- Test file for parser

**Changes:**

Add a `inferScope()` function that analyzes the parsed spec body:

```typescript
function inferScope(body: string): "standard" | "large" {
  const deliverableCount = countDeliverableSections(body);
  const estimatedFileCount = estimateFilesReferenced(body);
  const hasMultipleModules = detectModuleBoundaries(body);
  const bodyLength = body.length;

  if (
    deliverableCount > 3 ||
    estimatedFileCount > 10 ||
    hasMultipleModules ||
    bodyLength > 5000
  ) {
    return "large";
  }
  return "standard";
}
```

**Heuristics:**

- `countDeliverableSections()` — count `### ` level-3 headings under a `## Deliverables` section
- `estimateFilesReferenced()` — count file path patterns (e.g., `src/`, `.ts`, `.tsx` mentions)
- `detectModuleBoundaries()` — detect mentions of multiple distinct modules/directories
- Body length > 5000 chars suggests significant scope

**Resolution order:**

1. Explicit `scope:` in frontmatter → use as-is (PM override)
2. No explicit `scope:` → run `inferScope()` on body
3. Default fallback → `'standard'`

**Acceptance Criteria:**

- [ ] Explicit frontmatter `scope` is respected and not overridden
- [ ] Specs with >3 deliverable sections auto-detect as `large`
- [ ] Specs with many file references auto-detect as `large`
- [ ] Simple specs with 1-2 deliverables auto-detect as `standard`
- [ ] Unit tests cover each heuristic and the override behavior

---

### Task 2: Plan-Aware Review Workflow

**Goal:** Enhance the review workflow so the QA agent receives the implementation plan alongside the diff.

**Files:**

- `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`
- Review agent profile prompt

**Changes:**

Update the review workflow to pass the implementation plan from the completed implementation run:

```yaml
- id: review_work_item
  type: execution
  tier: heavy
  agent_profile: qa_automation
  inputs:
    implementation_plan: "{{ trigger.executionConfig.implementationPlan }}"
    system_prompt: |
      Review the implementation against both the spec AND the implementation plan.

      Verify:
      1. Each deliverable section in the plan was actually implemented
      2. Cross-deliverable integration is correct (imports, shared types, etc.)
      3. Tests cover all acceptance criteria from the spec
      4. No leftover TODOs, placeholder code, or debug artifacts
      5. Code quality, security, and style standards

      If the implementation plan is not present (standard scope item), 
      review against the spec only.

      You MUST call submit_qa_decision with your verdict.
      When rejecting, provide structured feedback:
      - Which specific deliverables failed and why
      - Whether the failure is in implementation, integration, or testing
      - Specific files and line ranges with issues
  output_tools: [submit_qa_decision]
```

**Additionally:** When the implementation workflow completes, persist the implementation plan in the work item's `executionConfig` so the review workflow can access it:

- In `transition_to_review` step or the automation service, copy `jobs.plan_implementation.output` to `workItem.executionConfig.implementationPlan`

**Acceptance Criteria:**

- [ ] Review agent receives implementation plan when available
- [ ] Review agent validates deliverables were implemented
- [ ] Review agent provides structured rejection feedback (which deliverables failed)
- [ ] Standard scope items (no plan) are reviewed against spec only (no regression)
- [ ] Plan persistence from implementation run to review run works

---

### Task 3: Structured Rejection Feedback in `submit_qa_decision`

**Goal:** Extend the QA decision tool to capture structured rejection details.

**Files:**

- `apps/api/src/tool/tool-catalog.service.ts` (or tool definition)
- QA decision handler

**Extended schema:**

```typescript
{
  name: 'submit_qa_decision',
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      work_item_id: { type: 'string' },
      decision: { type: 'string', enum: ['accept', 'reject'] },
      feedback: { type: 'string' },
      // New fields for structured rejection:
      failed_deliverables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deliverable_id: { type: 'string', description: 'Task ID from plan, or section title' },
            failure_type: { type: 'string', enum: ['not_implemented', 'incorrect', 'incomplete', 'integration_issue', 'test_failure'] },
            details: { type: 'string' },
            affected_files: { type: 'array', items: { type: 'string' } }
          },
          required: ['deliverable_id', 'failure_type', 'details']
        },
        description: 'Structured list of which deliverables failed review. Required when decision is reject.'
      }
    },
    required: ['project_id', 'work_item_id', 'decision', 'feedback']
  }
}
```

**Acceptance Criteria:**

- [ ] `failed_deliverables` field accepted and persisted on rejection
- [ ] Backward compatible — existing callers without `failed_deliverables` still work
- [ ] Rejection feedback available to the re-planning step (Task 5)

---

### Task 4: Parallel Subagent Execution

**Goal:** Allow the orchestrator to spawn multiple subagents concurrently without dehydrating.

**Files:**

- `apps/api/src/workflow/subagent-orchestrator.service.ts`
- `apps/api/src/telemetry/telemetry.gateway.ts`
- `apps/api/src/session/session-hydration.service.ts`
- `apps/api/src/tool/tool-catalog.service.ts`

**New tool: `spawn_subagent_async`**

Unlike `spawn_subagent` (which dehydrates the parent), this variant:

1. Provisions and starts the child container with shared worktree
2. Returns the execution ID immediately
3. Parent container stays active (no dehydration)
4. Orchestrator continues execution — can spawn more subagents or do other work

```typescript
{
  name: 'spawn_subagent_async',
  tier_restriction: 2,
  schema: {
    type: 'object',
    properties: {
      agent_profile: { type: 'string' },
      task_prompt: { type: 'string' },
      tools: { type: 'array', items: { type: 'string' } },
      tier: { type: 'string', enum: ['light', 'heavy'] },
      assigned_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files this subagent is responsible for. Prevents overlap with other subagents.'
      }
    },
    required: ['agent_profile', 'task_prompt', 'tools', 'tier']
  }
}
```

**New tool: `wait_for_subagents`**

Blocks the orchestrator until all specified subagent executions complete:

```typescript
{
  name: 'wait_for_subagents',
  tier_restriction: 2,
  api_callback: true,
  schema: {
    type: 'object',
    properties: {
      execution_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Subagent execution IDs to wait for'
      },
      timeout_seconds: {
        type: 'integer',
        description: 'Max seconds to wait. Default 3600 (1 hour).',
        default: 3600
      }
    },
    required: ['execution_ids']
  }
}
```

**Callback implementation:**

- API polls `SubagentExecution` records for all execution IDs
- Returns when all are `Completed` or `Failed`, or timeout reached
- Response includes results array with each execution's status and result

**Orchestrator changes:**

- Remove mandatory parent dehydration from `spawn_subagent_async` handler
- Parent container resources remain allocated during subagent execution
- Add resource accounting: track total containers per workflow run to prevent unbounded spawning
- Add configurable limit: `max_concurrent_subagents_per_workflow` system setting (default: 3)

**File overlap protection:**

- Each `spawn_subagent_async` call includes `assigned_files`
- Orchestrator service validates no overlap between concurrent subagent file assignments
- If overlap detected, reject the spawn with an error message guiding the orchestrator to sequential execution for those tasks

**Acceptance Criteria:**

- [ ] `spawn_subagent_async` starts child without dehydrating parent
- [ ] Multiple concurrent child containers run simultaneously
- [ ] `wait_for_subagents` blocks until all children complete or timeout
- [ ] File overlap between concurrent subagents is rejected
- [ ] Configurable concurrency limit prevents resource exhaustion
- [ ] Sequential `spawn_subagent` (Phase 2) still works unchanged

---

### Task 5: Delta Re-Planning on Review Rejection

**Goal:** When QA rejects work, re-plan only the failing deliverables instead of re-implementing from scratch.

**Files:**

- `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`
- Planning step logic

**Changes:**

When a work item is rejected and returns to `in-progress`, the trigger context now includes:

- `trigger.rejectionFeedback` — the structured QA feedback from `submit_qa_decision`
- `trigger.previousPlan` — the implementation plan from the prior run

The planning step detects this is a re-entry (rejection cycle) and produces a **delta plan**:

```yaml
- id: plan_implementation
  depends_on: [provision_worktree]
  type: execution
  tier: heavy
  agent_profile: architect-agent
  condition: "{{ trigger.workItem.scope == 'large' }}"
  inputs:
    system_prompt: |
      {{#if rejectionFeedback}}
      You are re-planning after a QA rejection. The previous implementation was 
      partially correct. Analyze the rejection feedback and produce a DELTA plan
      that addresses ONLY the issues identified.

      Previous plan: {{ previousPlan }}
      QA feedback: {{ rejectionFeedback }}

      Do NOT re-implement deliverables that passed review.
      Focus on:
      1. Deliverables marked as 'not_implemented' or 'incomplete'
      2. Integration issues between deliverables
      3. Test failures
      {{else}}
      [standard first-run planning prompt]
      {{/if}}
    work_item_spec: "{{ trigger.workItem.description }}"
    rejection_feedback: "{{ trigger.rejectionFeedback }}"
    previous_plan: "{{ trigger.previousPlan }}"
  output_tools: [submit_implementation_plan]
```

**Automation service changes:**

- When transitioning a work item from `in-review` → `in-progress` (rejection), persist the QA feedback and previous plan in the new trigger context
- The `executionConfig` carries forward: previous plan, rejection feedback, rejection count

**Acceptance Criteria:**

- [ ] Re-entry to `in-progress` after rejection includes structured feedback in trigger
- [ ] Planning step detects rejection context and produces delta plan
- [ ] Delta plan addresses only failing deliverables
- [ ] Deliverables that passed review are marked as "keep" in delta plan
- [ ] Orchestrator only re-implements tasks from the delta plan
- [ ] Unit tests cover: first-run plan vs delta plan branching

---

### Task 6: Resource Management for Parallel Execution

**Goal:** Ensure parallel subagent execution doesn't exhaust host resources.

**Files:**

- `apps/api/src/docker/container-orchestrator.service.ts`
- System settings

**Changes:**

Add resource tracking and limits:

- `max_concurrent_subagents_per_workflow` — system setting, default 3
- `max_total_containers` — system setting, default 10
- Before spawning a new subagent container, check:
  1. Current workflow's active subagent count < per-workflow limit
  2. Total active nexus-managed containers < total limit
- If limit exceeded, return error to orchestrator (it can retry later or switch to sequential)

Add container cleanup for orphaned subagent containers:

- On workflow run completion/failure, kill all subagent containers for that run
- Add to existing `StaleContainerCleanupService` (if it exists) or create one
- Cleanup runs on startup and periodically (every 5 minutes)

**Acceptance Criteria:**

- [ ] Per-workflow subagent limit enforced
- [ ] Total container limit enforced
- [ ] Orphaned subagent containers cleaned up on workflow completion
- [ ] Graceful error when limits exceeded (not a crash)
- [ ] System settings configurable without code changes

---

### Task 7: Integration Tests for Parallel Execution

**Goal:** Validate concurrent subagent execution end-to-end.

**Files:**

- Integration test file (new or extend existing)

**Test scenarios:**

1. **Two parallel subagents:** Orchestrator spawns 2 subagents with non-overlapping files → both complete → orchestrator resumes with both results
2. **File overlap rejection:** Orchestrator tries to spawn 2 subagents with overlapping `assigned_files` → second spawn rejected → orchestrator falls back to sequential
3. **Partial failure:** 2 subagents spawned, 1 succeeds, 1 fails → orchestrator receives both statuses → handles gracefully
4. **Concurrency limit:** Attempt to spawn more subagents than `max_concurrent_subagents_per_workflow` → excess spawns rejected
5. **Timeout:** Subagent hangs → `wait_for_subagents` returns after timeout with partial results
6. **Cleanup:** Workflow fails mid-execution → all subagent containers killed

**Acceptance Criteria:**

- [ ] All 6 scenarios pass
- [ ] Tests use mocked Docker interactions
- [ ] No real containers spawned in unit tests
- [ ] Cleanup behavior verified

---

### Task 8: End-to-End Validation

**Goal:** Validate the complete Phase 3 features against the deterministic test harness.

**Changes:**

- Create a new deterministic integration test scenario for the `large` scope happy path:
  1. Create project with a `large` scope work item
  2. Dispatch → planning step produces plan
  3. Orchestrator spawns 2 async subagents
  4. Both subagents complete
  5. Orchestrator verifies integration
  6. QA review runs with plan-aware prompt → accepts
  7. Merge → done
- Create a rejection cycle scenario:
  1. QA rejects with structured feedback
  2. Work item returns to `in-progress` with rejection context
  3. Delta re-planning produces targeted fix plan
  4. Orchestrator implements delta only
  5. QA accepts on second pass

**Acceptance Criteria:**

- [ ] Happy path scenario completes end-to-end
- [ ] Rejection/delta re-plan scenario completes end-to-end
- [ ] All existing tests still pass (no regressions)

## File Plan

### Files to Create

| File                                     | Purpose                               |
| ---------------------------------------- | ------------------------------------- |
| `spawn_subagent_async` tool definition   | Non-dehydrating subagent spawn        |
| `wait_for_subagents` tool definition     | Batch subagent completion wait        |
| Integration tests for parallel execution | Validate concurrent subagent behavior |
| E2E test scenarios for Phase 3           | Full pipeline validation              |

### Files to Modify

| File                                                                      | Changes                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/workflow/step-hydrate-work-items-spec-parser.ts`            | Add `inferScope()` heuristics                         |
| `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`   | Plan-aware review prompt                              |
| `apps/api/src/tool/tool-catalog.service.ts`                               | New tools, extended `submit_qa_decision`              |
| `apps/api/src/workflow/subagent-orchestrator.service.ts`                  | Async spawn, concurrent execution, file overlap check |
| `apps/api/src/telemetry/telemetry.gateway.ts`                             | Handle `spawn_subagent_async` message                 |
| `apps/api/src/session/session-hydration.service.ts`                       | Optional dehydration (not mandatory on async spawn)   |
| `apps/api/src/docker/container-orchestrator.service.ts`                   | Resource tracking, container limits                   |
| `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml` | Delta re-planning on rejection                        |
| `apps/api/src/project/work-item-automation.service.ts`                    | Persist rejection feedback in trigger context         |
| System settings seed                                                      | New settings for concurrency limits                   |

## Referenced Documentation

| Document                                                                                                      | Relevance                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [SDD — Phase 3](../specs/SDD-flat-work-items-and-orchestrated-execution.md#6-phase-3--adaptive-scope--review) | Design specification           |
| [EPIC-043 — Flat Work Items](EPIC-043-flat-work-items-dependency-graph.md)                                    | Phase 1 foundation             |
| [EPIC-044 — Orchestrator-Led Execution](EPIC-044-orchestrator-led-execution.md)                               | Phase 2 prerequisite           |
| [Subagent Orchestration Architecture](../architecture/subagent-orchestration.md)                              | Existing subagent system       |
| [Session Hydration Architecture](../architecture/session-hydration.md)                                        | Dehydrate/rehydrate pipeline   |
| [Container Orchestration Architecture](../architecture/container-orchestration.md)                            | Container resources and mounts |

## Risks and Mitigations

| Risk                                                       | Impact                                                           | Mitigation                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adaptive scope mis-classifies items                        | Standard items waste time planning, or large items skip planning | PM override always takes precedence. Heuristics are conservative — borderline cases default to `standard`. Logging when scope is inferred vs explicit for debugging.                      |
| Parallel subagents cause git merge conflicts               | Corrupted worktree state                                         | File partitioning enforced via `assigned_files`. Overlap detection rejects conflicting spawns. Git operations (commit/merge) only performed by orchestrator after all subagents complete. |
| Delta re-planning produces worse results than fresh plan   | Quality regression on rejection cycles                           | Limit delta re-plans to 1 attempt. On second rejection, fall back to full re-plan. `max_rejections` setting (existing: 3) still applies.                                                  |
| Resource exhaustion from concurrent containers             | Host OOM or Docker daemon instability                            | Per-workflow and global container limits. Resource reservation tracked. Cleanup service kills orphaned containers.                                                                        |
| Timeout on `wait_for_subagents` leaves orphaned containers | Zombie containers consuming resources                            | Timeout handler explicitly kills all containers for the execution IDs. Workflow failure path also triggers cleanup.                                                                       |

## Dependencies

- **EPIC-043** must be complete (flat work items, scope column)
- **EPIC-044** must be complete (planning step, sequential subagent delegation, rehydration)

## Operational Notes

- Parallel subagent execution significantly increases host resource usage. Monitor Docker memory/CPU during rollout.
- The `max_concurrent_subagents_per_workflow` setting should be tuned based on host capacity. Start with 2, increase to 3 after stability is confirmed.
- Adaptive scope inference heuristics will likely need tuning based on real PM output. Logging at `DEBUG` level for scope decisions.
- Delta re-planning is most effective when the QA agent provides detailed structured feedback. The review prompt update (Task 2) is critical for this to work well.

## Definition of Done

- [x] Adaptive scope detection auto-classifies specs with >3 deliverables as `large`
- [x] PM explicit `scope` override takes precedence over auto-detection
- [x] Review agent receives and validates against implementation plan
- [x] Structured rejection feedback captured in `submit_qa_decision`
- [x] `spawn_subagent_async` starts children without dehydrating parent
- [x] `wait_for_subagents` blocks until all children complete
- [x] File overlap between concurrent subagents is rejected
- [x] Concurrency limits enforced per workflow and globally
- [x] Delta re-planning on rejection addresses only failing deliverables
- [x] Orphaned subagent containers cleaned up on workflow completion
- [x] All integration tests pass
- [x] Full unit test suite passes
- [x] TypeScript compilation clean
- [x] ESLint clean
