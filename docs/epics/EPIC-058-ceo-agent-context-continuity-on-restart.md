# EPIC-058: CEO Agent Context Continuity on Restart

> Status: In Progress (restart continuity shipped; session linkage deferred by ADR)  
> Priority: Critical  
> Estimate: 2–3 weeks  
> Created: 2026-04-06  
> Last Updated: 2026-04-06  
> Owner: TBD

---

## 1. Epic Summary

When the CEO orchestration agent is restarted (manually or after a failure), it loses all context about what it has already accomplished — PRDs it delegated, SDDs authored, work items created, decisions made. It begins the discovery cycle from scratch, potentially re-delegating already-completed work or making contradictory decisions.

This epic implements **state-aware context injection** so that the CEO agent always understands the current project phase and artifact state on any restart, combined with **phase-aware prompt routing** to give the agent contextually appropriate instructions.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. `ProjectStateSummaryService` and `ProjectPhaseDetectorService` added and registered in `ProjectModule`.
2. `ProjectOrchestrationStartedEvent` extended with `isRestart` and `stateSummary` payload fields.
3. Orchestration start flow now builds state summary on restart and injects it into discovery trigger data.
4. Discovery CEO workflow prompt now includes restart-aware guidance and `state_summary` / `is_restart` inputs.
5. CEO seeded profile includes restart-continuity operating rules.
6. Orchestration cycle workflow now uses restart-context parity inputs (`state_summary`, `is_restart`) via `ProjectOrchestrationCycleRequestedEvent`.

Remaining scope in this epic:

1. Optional session-tree linkage restoration path for restart continuity is deferred by ADR-0001 pending a safe bounded restoration design.

---

## 2. Problem Statement

### What Happens Today

1. `ProjectOrchestrationService.start()` resets status to `initializing` and clears `currentWorkflowRunId`.
2. The `ProjectOrchestrationStartedEvent` fires, triggering `project-discovery-ceo.workflow.yaml`.
3. The discovery workflow creates a **new container with no session history** — `lastSessionTreeId` is not set on orchestration restart.
4. The step prompt is **static and phase-unaware**:
   ```
   You are running the CEO discovery cycle for project {{trigger.projectId}}.
   Objectives:
   1) Clarify intent and constraints for MVP scope.
   2) Discover available specialist agents...
   3) Delegate PRD/scope authoring to product-manager...
   4) Record one strategic decision...
   ```
5. The CEO agent has no indication that a PRD already exists, work items were already created, or that previous decisions were made. It begins the full discovery cycle again.

### Root Cause

- **No state preamble**: The step prompt contains no information about what artifacts or decisions already exist.
- **No phase detection**: The workflow always runs the same discovery prompt regardless of project maturity.
- **No session linkage**: Restarts don't carry forward the previous CEO session (compressed JSONL in `PiSessionTree`).
- **Tools available but not prompted**: `get_orchestration_timeline`, `get_project_state`, and `get_project_brief` can return the needed context, but the prompt doesn't instruct the CEO to call them first to understand current state before acting.

### Impact

- Wasted LLM tokens and compute re-doing completed work.
- Risk of contradictory decisions (re-delegating PRD with different scope).
- Duplicate work items or specs.
- User confusion when the system appears to "forget" progress.

---

## 3. Existing Infrastructure (What We Can Reuse)

### 3.1 Decision Log (Persistent)

`ProjectOrchestration.decisionLog` stores up to 100 decision entries with timestamp, type, reasoning, actions, and execution status. Survives restarts. Accessible via `get_orchestration_timeline`.

### 3.2 Project State (Live Query)

`getProjectState()` returns work items grouped by status, scheduling data, active/total counts, and orchestration context (goals, strategy, mode). Accessible via `get_project_state`.

### 3.3 Project Brief (Live Query)

`getProjectBrief()` returns goals, strategy summary, orchestration status, active work count, blocked items, and pending approvals. Accessible via `get_project_brief`.

### 3.4 Memory Segments (Persistent)

`MemorySegment` entity supports entity-scoped (project/workflow/agent) storage with content, type, and versioning. Accessible via `query_memory`.

### 3.5 Session Persistence (Existing Machinery)

`PiSessionTree` stores compressed JSONL conversation history. `SessionHydrationService.injectSessionIntoContainer()` can restore sessions when `lastSessionTreeId` is provided. Currently used for work item resume, not for orchestration restart.

### 3.6 Prompt Template Infrastructure

`buildStepRunnerConfigPayloadCore()` already resolves Handlebars template variables (`{{trigger.*}}`, `{{inputs.*}}`), builds upstream context from job dependencies, and assembles the final system prompt. Adding new template variables is straightforward.

---

## 4. Solution Design

The fix is delivered in **three layers**, each independently valuable:

### Layer 1: State-Aware Prompt Injection (Core Fix)

Inject a server-side-rendered **project state preamble** into the CEO step prompt at workflow execution time, so the agent immediately knows what exists before deciding what to do.

### Layer 2: Phase-Aware Prompt Routing

Detect the project's current phase (no artifacts → PRD exists → work items exist → items dispatched) and route to phase-appropriate prompts that skip completed stages.

### Layer 3: Session Linkage on Restart (Optional Enhancement)

Carry forward the last CEO session tree on orchestration restart so the agent has full conversation continuity.

---

## 5. Task Breakdown

### Task 1: Build Project State Summary Helper

**File**: `apps/api/src/project/project-state-summary.service.ts` (new)

Create a service that produces a structured text summary of the current project state suitable for prompt injection. It should:

- Query `getProjectState()`, `getProjectBrief()`, and `getOrchestrationTimeline()`.
- Produce a markdown-formatted summary containing:
  - **Existing artifacts**: Whether PRD exists (`Project.prdMarkdown` is non-empty), whether SDD exists, number of work items by status.
  - **Decision history**: Last 5–10 decisions from the decision log (timestamp, type, reasoning summary, actions taken).
  - **Current orchestration state**: Status, mode, goals, strategy summary.
  - **Active work**: Work items currently in progress, in review, or blocked.
- Enforce a token budget (e.g., truncate decision history to fit within ~2000 tokens).
- Return as a plain string for template injection.

**Acceptance Criteria**:

- [ ] Service is injectable via NestJS DI.
- [ ] Returns empty/minimal summary for brand-new projects with no artifacts.
- [ ] Returns rich summary for projects with PRD, work items, and decision history.
- [ ] Output is deterministic given the same DB state.
- [ ] Unit tests cover: new project, project with PRD only, project with PRD + work items, project with full history.

---

### Task 2: Inject State Summary into Discovery Workflow Trigger

**Files**:

- `apps/api/src/project/project-orchestration.service.ts` (modify `start()`)
- `apps/api/src/project/project-orchestration-events.ts` (modify event payload)

Extend the `ProjectOrchestrationStartedEvent` payload to include the state summary string. In `start()`, call the new `ProjectStateSummaryService` and attach the result to the event.

**Acceptance Criteria**:

- [ ] Event payload includes `stateSummary: string` field.
- [ ] Summary is generated before the event is emitted.
- [ ] Backward compatible — if summary is undefined/empty, downstream consumers still work.
- [ ] Unit test verifies summary is attached to the emitted event.

---

### Task 3: Update Discovery Workflow YAML for State-Aware Prompt

**File**: `apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml`

Update the `discovery` step prompt to:

1. Include a `{{inputs.state_summary}}` section at the top.
2. Make objectives conditional: "Skip any objectives already completed based on the state summary above."
3. Add an explicit instruction: "IMPORTANT: If artifacts already exist (PRD, SDD, work items), do NOT re-delegate their creation. Instead, review the existing artifacts and proceed to the next incomplete step."

Add `state_summary` to the job inputs, sourced from the trigger payload.

**Acceptance Criteria**:

- [ ] Prompt includes state summary block before objectives.
- [ ] Objectives list includes conditional skip language.
- [ ] Template variable `{{inputs.state_summary}}` resolves correctly.
- [ ] When `state_summary` is empty (new project), prompt still reads naturally.
- [ ] Workflow YAML validates (no syntax errors).

---

### Task 4: Update Orchestration Cycle Workflow Prompt

**File**: `apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml`

The orchestration cycle prompt (triggered by `WorkItemDoneEvent`) already instructs the CEO to call `get_project_state`, but doesn't include a state preamble. Update it to:

1. Include a pre-rendered state summary via `{{inputs.state_summary}}` (requires the event trigger handler to also build the summary).
2. Include the last 3 decisions from the decision log inline, so the CEO doesn't waste a tool call retrieving them.

**Acceptance Criteria**:

- [ ] Cycle prompt includes state preamble.
- [ ] Last 3 decisions are included inline.
- [ ] Prompt still functions correctly when state summary is empty.

---

### Task 5: Implement Phase Detection Logic

**File**: `apps/api/src/project/project-phase-detector.service.ts` (new)

Create a service that determines the current project phase:

```typescript
enum ProjectPhase {
  NEW = "new", // No PRD, no work items
  DISCOVERY = "discovery", // PRD in progress or just delegated
  SPECS_READY = "specs_ready", // PRD exists, SDD exists, no work items
  WORK_ITEMS_CREATED = "work_items_created", // Work items exist but none dispatched
  IN_PROGRESS = "in_progress", // Work items dispatched/active
  NEARING_COMPLETION = "nearing_completion", // >80% work items done
  COMPLETE = "complete", // All work items done
}
```

Detection rules:

- Check `Project.prdMarkdown` existence → PRD exists.
- Check work item count by status → determine dispatched/active/done.
- Check `ProjectOrchestration.strategySummary` existence → SDD/strategy exists.
- Check decision log for delegation actions → discovery in progress.

**Acceptance Criteria**:

- [ ] Returns correct phase for each scenario.
- [ ] Unit tests cover all 7 phases.
- [ ] Phase is deterministic given the same DB state.
- [ ] Service is injectable via NestJS DI.

---

### Task 6: Phase-Aware Prompt Templates

**Files**:

- `apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml` (modify)
- Potentially new workflow YAML files per phase, OR conditional prompt blocks

Create phase-specific prompt sections that are injected based on the detected phase. Two implementation options:

**Option A (Preferred — Single Workflow, Conditional Prompt):**
Include the phase in `{{inputs.project_phase}}` and add conditional guidance:

```
{% if inputs.project_phase == 'new' %}
  Begin full discovery: clarify intent, delegate PRD, delegate SDD.
{% elif inputs.project_phase == 'specs_ready' %}
  PRD and SDD already exist. Delegate work-item decomposition to spec-generator.
{% elif inputs.project_phase == 'work_items_created' %}
  Work items exist. Review readiness and dispatch via kanban.dispatch_selected_work_items.
{% endif %}
```

**Option B (Multiple Workflows):**
Create separate workflow YAMLs per phase, with the event handler routing to the correct one.

**Acceptance Criteria**:

- [ ] Phase-appropriate instructions are delivered to the CEO agent.
- [ ] CEO does not re-delegate completed work.
- [ ] All phase transitions produce valid, coherent prompts.
- [ ] Integration test: restart after PRD creation delivers specs_ready prompt, not discovery prompt.

---

### Task 7: Optional — Session Linkage on Orchestration Restart

**Files**:

- `apps/api/src/project/project-orchestration.service.ts` (modify `start()`)
- `apps/api/src/workflow/step-agent-step-executor.service.ts` (modify session injection path)

Before clearing `currentWorkflowRunId` in `start()`:

1. Look up the most recent `PiSessionTree` for the current workflow run.
2. Store its ID in the orchestration record or the event payload.
3. In the workflow's agent step executor, detect the linked session tree and inject it via existing `injectPreviousSessionCore()` machinery.

**Guard rails**:

- Only inject if the previous run completed or was manually stopped (not if it failed with errors).
- Add a `restartSessionPolicy` field: `'restore' | 'fresh'` (default: `'restore'`).
- Limit session size to avoid token overflow (truncate older turns).

**Acceptance Criteria**:

- [ ] On restart after a clean stop, CEO session is restored.
- [ ] On restart after a failure, CEO starts fresh (or with truncated session).
- [ ] `restartSessionPolicy` respected.
- [ ] Unit test: session linkage is set when previous run exists.
- [ ] Unit test: session linkage is skipped when previous run failed.

---

### Task 8: Update CEO Profile System Prompt

**File**: `apps/api/src/database/seeds/agent-profiles/profiles/ceo.profile.ts`

Add rules to the CEO system prompt:

```
16. On startup, review the Project State Summary provided in your prompt before taking any action.
    Do NOT re-delegate work that has already been completed (PRD, SDD, work items).
17. If you are resuming after a restart, call get_orchestration_timeline to review your
    previous decisions and continue from where you left off.
```

**Acceptance Criteria**:

- [ ] System prompt includes restart-awareness rules.
- [ ] Rules are numbered correctly and consistent with existing rule style.
- [ ] Seed migration updates the profile in DB.

---

### Task 9: Add `isRestart` Flag to Orchestration Event

**Files**:

- `apps/api/src/project/project-orchestration.service.ts`
- `apps/api/src/project/project-orchestration-events.ts`
- Workflow YAML files

When `start()` detects an existing orchestration record (i.e., it's a restart, not a first start), include `isRestart: true` in the event payload and make it available as `{{trigger.isRestart}}` in the workflow prompt.

This allows the prompt to include:

```
{% if trigger.isRestart %}
IMPORTANT: This is a RESTART of an existing orchestration. Review the state summary
and decision history carefully. Do not repeat completed work.
{% endif %}
```

**Acceptance Criteria**:

- [ ] `isRestart` is `true` when orchestration record already existed.
- [ ] `isRestart` is `false` (or absent) on first start.
- [ ] Template variable resolves correctly in workflow YAML.
- [ ] Unit test covers both cases.

---

### Task 10: Integration Testing

**Files**: `packages/e2e-tests/` (new test files)

Create integration tests that verify:

1. **Restart after PRD creation**: Start orchestration → CEO delegates PRD → PRD is saved → restart orchestration → CEO receives state summary showing PRD exists → CEO does NOT re-delegate PRD.
2. **Restart after work item creation**: Start orchestration → full discovery completes → work items exist → restart → CEO sees work items and dispatches instead of re-discovering.
3. **Restart with decision history**: Make 3 decisions → restart → CEO's prompt includes decision history.
4. **Fresh start (no regression)**: Brand new project → start → CEO receives empty/minimal state summary and runs full discovery normally.

**Acceptance Criteria**:

- [ ] All 4 scenarios pass in deterministic test mode.
- [ ] Tests use existing deterministic test infrastructure.
- [ ] No regressions in existing E2E kanban lifecycle tests.

---

## 6. Execution Order and Dependencies

```
Task 1  (State Summary Service)         ── no deps ──────────────────┐
Task 5  (Phase Detector Service)         ── no deps ──────────────────┤
Task 8  (CEO Profile Update)             ── no deps ──────────────────┤
Task 9  (isRestart Flag)                 ── no deps ──────────────────┤
                                                                      │
Task 2  (Inject Summary into Event)      ── depends on: Task 1 ──────┤
                                                                      │
Task 3  (Discovery Workflow YAML)        ── depends on: Task 2, 9 ───┤
Task 4  (Cycle Workflow YAML)            ── depends on: Task 2 ──────┤
Task 6  (Phase-Aware Prompts)            ── depends on: Task 3, 5 ───┤
                                                                      │
Task 7  (Session Linkage — Optional)     ── depends on: Task 2 ──────┤
                                                                      │
Task 10 (Integration Tests)              ── depends on: All above ────┘
```

**Recommended implementation waves**:

| Wave       | Tasks      | Description                                         |
| ---------- | ---------- | --------------------------------------------------- |
| **Wave 1** | 1, 5, 8, 9 | Independent foundation services and profile update  |
| **Wave 2** | 2, 3, 4    | Wire state summary into events and workflow prompts |
| **Wave 3** | 6          | Phase-aware prompt routing                          |
| **Wave 4** | 7          | Optional session linkage enhancement                |
| **Wave 5** | 10         | Integration test suite                              |

---

## 7. Acceptance Criteria (Epic-Level)

- [ ] **AC-1**: When the CEO agent is restarted on a project that already has a PRD, it does NOT re-delegate PRD creation.
- [ ] **AC-2**: When the CEO agent is restarted on a project with existing work items, it reviews and dispatches instead of starting discovery.
- [ ] **AC-3**: The CEO agent's prompt on restart includes a structured summary of existing artifacts, work item status, and recent decisions.
- [ ] **AC-4**: The CEO agent's prompt includes an `isRestart` indicator and explicit instructions not to repeat completed work.
- [ ] **AC-5**: Phase detection accurately identifies the project's current phase (7 phases covered).
- [ ] **AC-6**: Fresh starts (no prior orchestration) are unaffected — full discovery runs normally.
- [ ] **AC-7**: All existing E2E tests (kanban lifecycle, review) continue to pass.
- [ ] **AC-8**: State summary is bounded to ~2000 tokens to avoid prompt bloat.
- [ ] **AC-9**: Decision log history (last 5–10 entries) is included in the state preamble.

---

## 8. Risks and Mitigations

| Risk                                                               | Likelihood | Impact | Mitigation                                                                                           |
| ------------------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------- |
| State summary exceeds token budget, degrading agent performance    | Medium     | Medium | Enforce hard truncation in `ProjectStateSummaryService`; measure empirically                         |
| Phase detection misclassifies (e.g., PRD exists but is incomplete) | Medium     | High   | Use conservative heuristics; include phase confidence in summary; CEO can still call tools to verify |
| Handlebars templates can't support conditional blocks (if/elif)    | Low        | Medium | Fall back to server-side prompt selection instead of template conditionals                           |
| Session restore carries stale/incorrect reasoning from failed runs | Medium     | High   | Only restore sessions from clean exits; add `restartSessionPolicy` guard                             |
| Workflow YAML changes require re-seeding the database              | Low        | Low    | Existing seed infrastructure handles this; include in migration notes                                |

---

## 9. Out of Scope

- Agent memory milestones (CEO writing structured memories at milestones) — valuable but dependent on LLM compliance. Tracked as a follow-up.
- Cross-project context sharing — CEO should not carry context between different projects.
- Automatic re-seeding of workflow definitions on deployment — existing seed mechanism is manual.
- UI indicators for orchestration restart state — could be a follow-up UX enhancement.

---

## 10. Key Files Reference

| File                                                                        | Role                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/api/src/database/seeds/agent-profiles/profiles/ceo.profile.ts`        | CEO system prompt and tool list                            |
| `apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml`           | Discovery workflow (restart entry point)                   |
| `apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml` | Orchestration cycle workflow                               |
| `apps/api/src/project/project-orchestration.service.ts`                     | `start()`, `getProjectState()`, decision log               |
| `apps/api/src/workflow/step-agent-step-executor.helpers.ts`                 | `buildStepRunnerConfigPayloadCore()` — prompt assembly     |
| `apps/api/src/workflow/workflow-runtime-tools.service.ts`                   | `getOrchestrationTimeline()`, `getProjectState()` handlers |
| `apps/api/src/workflow/step-agent-step-executor.service.ts`                 | Agent container provisioning + session injection           |
| `apps/api/src/project/project-orchestration-events.ts`                      | Event payload definitions                                  |
| `packages/e2e-tests/`                                                       | Integration test location                                  |
