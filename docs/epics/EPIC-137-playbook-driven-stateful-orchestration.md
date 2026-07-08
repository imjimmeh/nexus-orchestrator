# EPIC-137: Playbook-Driven Stateful Orchestration

**Epic ID:** EPIC-137  
**Status:** Proposed  
**Priority:** P0 - Critical  
**Theme:** Orchestration Runtime, Imported Repository Reliability, Adaptive Planning  
**Created:** 2026-04-20  
**Revised:** 2026-04-20  
**Depends On:** EPIC-046 (Autonomous Project Orchestrator), EPIC-065 (Import-Aware Onboarding), EPIC-057 (Agent Skills), EPIC-118 (Refinement-First Planning), EPIC-120 (Output Contract Evolution)

## 1. Background and Problem Statement

### 1.1 Current Model

The orchestrator currently drives itself through a series of fixed workflow stages (discovery ΓåÆ specs ΓåÆ work-item generation ΓåÆ execution). Each stage has a predetermined entry condition and output contract. The agent executing a stage is expected to produce a specific result in a single run.

This produces a good result when the project is clean, greenfield, and predictable. It fails in the real world.

### 1.2 Observed Failure Patterns (Evidence from Session fb07cb49)

Session `fb07cb49` was the first orchestrator run against an imported repository (this codebase). The following problems were observed:

**Tool argument contract mismatches:**

- `set_job_output` received `data` as a serialised JSON string instead of an object ΓåÆ validation failure.
- `ask_user_questions` received `questions` as a serialised JSON string instead of an array ΓåÆ repeated validation failure.

**Repository access primitive confusion:**

- `read` was called on directory paths ΓåÆ EISDIR errors.
- `read` was called with glob/wildcard patterns ΓåÆ ENOENT errors.
- The agent kept retrying the same broken path strategy instead of adapting.

**Delegation produced false success:**

- `invoke_agent_workflow` returned `execution_status: executed` with `assigned_count: 0` and `idle_agent_count: 0`.
- The orchestrator treated this as successful delegation and kept progressing.

**Stage-first thinking blocked adaptation:**

- The orchestrator was focused on "getting to the next stage" rather than resolving present constraints.
- No playbook existed for "what do I do when I can't see directories? when delegation produces nothing? when the project already has extensive docs?"

### 1.3 Root Cause

The agent had no skill or policy guidance appropriate to the situation it was in. It defaulted to the same patterns it uses for greenfield projects: try to build specs, create work items, delegate. None of those are the right actions when you are still discovering an unfamiliar codebase with unverified tool access.

The fix is not to make the orchestrator loop faster or smarter in isolation. The fix is to:

1. Give it the right playbook for its current situation ΓÇö but **select that playbook deterministically in code**, not by asking the LLM to evaluate boolean conditions.
2. Resolve tool-level errors automatically so they do not consume inference turns.
3. Give it a clean, bounded state object that does not grow indefinitely.

---

## 2. Target Model

### 2.1 Core Principle

The orchestrator runs in discrete sessions. Each session:

1. The API reads persistent project state and evaluates the playbook selection algorithm deterministically.
2. The selected playbook skill is injected into the LLM's system prompt for that session.
3. The LLM executes with the playbook as its primary operational guide.
4. The session ends only when the LLM calls `yield_session` with a status, summary, and recommended next playbook.
5. The API writes updated state before releasing the session.

There is no permanent running process, no continuous loop. Sessions are triggered by: user request, workflow trigger, scheduled heartbeat, or event hook. The persistent project state is what carries memory between sessions.

**Critical design invariant:** The LLM never selects its own playbook. Playbook selection is a code-level concern; playbook _execution_ is an LLM concern.

### 2.2 Persistent Project State

Project state is stored per-project and persists across sessions. It carries:

- **Project context:** repo URL, branch state, artifact inventory (docs, epics, specs, workflows), import metadata.
- **Knowledge state:** a temporary scratchpad of unvalidated facts, open questions, and confidence signals for the current cycle only. Facts that have been validated are compacted into canonical documentation and removed from state (see ┬º4.3).
- **Execution history:** what has been attempted, outcomes (success, no-op, failure, blocked), error class counters with decay.
- **Decision log:** rationale for key actions taken in prior sessions (capped at last 50 entries; older entries archived to a separate log table).
- **Readiness signals:** pre-computed per-playbook readiness (e.g. `specs_ready`, `work_items_pending`, `project_healthy`). These are computed by the API at session start, not by the LLM.

### 2.3 Playbook Selection

**Playbook selection is performed entirely in TypeScript by the API before the LLM is invoked.** The API reads `OrchestrationSessionState`, evaluates the rule set, selects the appropriate playbook, and injects it as the first content block in the system prompt. The LLM receives one playbook only ΓÇö it never sees the selection algorithm or evaluates the rules itself.

The rule set lives in a data-driven configuration (YAML or DB table) so it can be updated without a code deploy. The TypeScript rule engine is a thin evaluator over this config. See ┬º5 for the rule configuration schema.

This guarantees:

- Correct playbook selection every time (no hallucination risk on boolean logic).
- Reduced context window usage (the agent receives one playbook, not the full router).
- Deterministic playbook selection is unit-testable without an LLM.

### 2.4 Session Lifecycle and Locking

Before any session begins, the API acquires a per-project session lock. This prevents concurrent sessions from racing on the same project state.

- Lock uses an advisory lock (database-level) keyed on `project_id`.
- Lock TTL: 30 minutes. Expired locks are released automatically; the next trigger re-acquires.
- A session that finds a lock held by another active session emits a `session.skipped.locked` event and exits cleanly.
- A session that finds a lock held by an expired session logs a `session.lock.recovered` event, releases it, and proceeds.

Sessions terminate only by calling `yield_session`. A session that produces no `yield_session` call within its TTL is forcibly terminated; its state is marked `execution_state.last_session_outcome = 'timeout'`.

---

## 3. Playbook Catalogue

Each playbook is a skill file injected into the orchestrator's system prompt at session start by the API. The skill provides:

- When it applies (trigger conditions ΓÇö for documentation; selection is done by code).
- What to do (ordered guidance, decision branches).
- What tools to use (and which to avoid).
- What constitutes done for this session.
- What state to write before calling `yield_session`.
- Example prompts and expected outputs.

**All playbooks share one non-negotiable termination rule:**

> When you have completed your goals for this session ΓÇö or when you are blocked and cannot proceed ΓÇö you MUST call `yield_session({ status, summary, recommended_next_playbook })`. Do not stop outputting tool calls without calling `yield_session` first.

---

### Playbook 1: First Run

**Trigger condition (API-evaluated):** No `OrchestrationSessionState` record exists for this project.

**Goal:** Orient the orchestrator, establish baseline project state, and determine the correct next playbook.

**Guidance:**

1. Read project brief and any user-provided goals.
2. Check if `importContext` exists or if `artifact_inventory` is empty with a populated workspace root. If yes, route recommendation to Playbook 2 (Imported Repository Bootstrap).
3. Check if docs/specs/epics exist. If yes, route recommendation to Playbook 3 (Investigation).
4. If greenfield with goals only: determine if a PRD and SDD are needed, then route recommendation to Playbook 4 (Spec Generation).
5. Record first-run result and playbook decision in state.
6. Do not attempt work-item creation on first run.
7. Call `yield_session` when done.

**Skills to load:** `project-analysis`, `orchestration-patterns`, `decision-records`

**State written:** `project_context`, `knowledge_state.open_questions`, decision log entry, `recommended_next_playbook`.

**Example session prompt fragment:**

```
This is the first orchestration session for this project.
No prior state exists.

Your task this session:
1. Read the project brief and user goals.
2. Identify whether this is a greenfield project or an import.
3. Build an initial artifact inventory (what docs/specs/epics exist).
4. Determine which playbook applies to the next session.
5. Write your findings to project state.
6. Call yield_session({ status: "completed", summary: "...", recommended_next_playbook: "..." }).

Do NOT attempt to create work items or delegate implementation tasks in this session.
```

---

### Playbook 2: Imported Repository Bootstrap

**Trigger condition (API-evaluated):** `import_status == 'pending'` OR (`artifact_inventory` is empty AND workspace root contains known entry-point files such as `package.json`, `src/`, `README.md`). The second condition ensures the orchestrator bootstraps correctly even when no formal import flow was used.

**Goal:** Build a reliable model of the imported repository before any planning or delegation.

**Guidance:**

1. List directories from the repository root before reading individual files. Use `list_path` ΓÇö never `read` on a directory path. (Note: if you accidentally call `read` on a directory, the tool will auto-list it for you, but prefer explicit `list_path` calls.)
2. Identify and record key artifact categories:
   - Documentation: README, AGENTS.md, docs/, architecture docs.
   - Planning: epics/, specs/, work-items/, PRD/SDD files.
   - Tooling: package.json, build scripts, CI config.
   - Code: primary language, main packages/apps, test structure.
3. For each category, record what was found, what was expected but missing, and confidence level. Confidence is computed from objective signals (see ┬º4.4), not self-assessed.
4. Record open questions for the user only if they are blocking.
5. Determine recommended next playbook:
   - Specs present ΓåÆ Investigation (Playbook 3).
   - Specs missing, codebase understood ΓåÆ Spec Generation (Playbook 4).
   - Codebase large and unfamiliar ΓåÆ Investigation first (Playbook 3).
6. Do not create or modify any project files during this playbook.
7. If any tool call fails with EISDIR or ENOENT, record the path as a known bad path and try the parent directory listing instead.
8. Call `yield_session` when done.

**Skills to load:** `project-analysis`, `orchestration-patterns`

**State written:** Full artifact inventory, objective confidence signals, open questions, next playbook recommendation, `import_status = 'bootstrapped'`.

**Example session prompt fragment:**

```
You are bootstrapping an imported repository for the first time.

Repository path: {repo_path}
Repository URL: {repo_url}

Your task this session:
1. List the root directory contents using list_path.
2. Navigate into docs/, epics/, specs/, and other key directories by listing them.
3. Record what you find for each category in project state.
4. Compute the artifact coverage score from facts found (not a self-assessment).
5. Record any blocking open questions.
6. Call yield_session({ status: "completed", summary: "...", recommended_next_playbook: "..." }).

Do NOT create work items, write files, or delegate to other agents in this session.
```

---

### Playbook 3: Existing Project Investigation

**Trigger condition (API-evaluated):** `confidence_overall < 70` OR `readiness_signals.investigation_needed == true` OR project has existing artifacts but orchestration context is incomplete.

**Goal:** Build or refresh a confident model of the project's current state ΓÇö what is built, what is planned, what is pending, what is blocked.

**Guidance:**

1. Read AGENTS.md as highest-priority policy before any decisions.
2. Read existing epics and specs. Group by: completed, in-progress, planned, stale.
3. Read current work items grouped by: backlog, in-progress, review, done, blocked.
4. Cross-reference epics to work items: identify epics with no work items, and work items with no clear epic.
5. Check recent orchestration history to understand what was tried last.
6. Record findings: what is healthy, what needs attention, what is blocking delivery.
7. Do not modify anything. Record all findings in state.
8. At the end, produce a project health summary and set `recommended_next_playbook`.
9. Call `yield_session` when done.

**Skills to load:** `project-analysis`, `orchestration-patterns`, `decision-records`

**State written:** Project health summary, epic/work-item coverage map, next playbook recommendation.

---

### Playbook 4: Spec Generation

**Trigger condition (API-evaluated):** `readiness_signals.specs_ready == false` AND `confidence_overall >= 70`.

**Goal:** Produce high-quality, hydration-ready spec files.

**Guidance:**

1. Read project goals, existing docs, and any user-provided context.
2. Identify which spec artifacts are missing (PRD, SDD, epic-level work-item specs).
3. For existing specs, identify what is stale or incomplete.
4. Delegate spec authoring to the appropriate specialist agent:
   - PRD ΓåÆ `product-manager` profile via `project_discovery_ceo` workflow.
   - SDD ΓåÆ `architect-agent` via `project_spec_revision_ceo` workflow.
   - Work-item specs ΓåÆ `spec-generator` via `project_work_item_generation_ceo` workflow.
5. Do not write specs directly. Always delegate to the specialist.
6. After delegation, record what was delegated, expected outputs, and completion criteria in state.
7. Verify delegation was actually accepted (`assigned_count > 0`). If `assigned_count = 0`, record as `no_capacity`, do not treat as success, and call `yield_session` with status `blocked`. Do not retry in the same session.
8. Call `yield_session` when done.

**Skills to load:** `orchestration-patterns`, `decision-records`, `project-analysis`

**State written:** Delegation record, expected outputs, completion criteria.

---

### Playbook 4.5: Micro-Planning

**Trigger condition (API-evaluated):** `readiness_signals.project_healthy == true` AND a new user request is present that targets a narrow scope (e.g., single feature, single bug fix, single epic update). Evaluated before Playbook 4 when the project is generally healthy.

**Goal:** Handle a focused user request without triggering a full project-wide spec or work-item generation cycle. Update one spec and hydrate its work items in a single session.

**Guidance:**

1. Read the user request and identify the exact scope (which epic, which spec, which feature area).
2. Read only the relevant spec files ΓÇö do not read unrelated epics or work items.
3. Determine if the scope requires:
   - Updating an existing spec only ΓåÆ update and re-validate it.
   - Creating a new spec only ΓåÆ create and validate it.
   - Updating spec + hydrating work items ΓåÆ do both in sequence.
4. Delegate to the relevant specialist if spec authoring is required.
5. After spec update, call `validate_specs` for the affected spec only.
6. If validation passes, call `kanban.publish_specs` for the affected spec only.
7. Record what changed in state (narrow delta, not full project snapshot).
8. Call `yield_session` when done.

**Skills to load:** `orchestration-patterns`, `project-analysis`

**State written:** Narrow delta of changed spec + hydrated work items. Does not overwrite full project health signals.

**Example session prompt fragment:**

```
A focused user request has been received:
"{user_request}"

Affected scope: {epic_id} / {spec_file}

Your task:
1. Read only the affected spec.
2. Update or create the spec as needed.
3. Validate and hydrate work items for this spec only.
4. Do NOT read or modify other epics or specs.
5. Call yield_session when done.
```

---

### Playbook 5: Work Item Generation

**Trigger condition (API-evaluated):** `readiness_signals.specs_ready == true` AND `readiness_signals.work_items_pending == false`.

**Goal:** Hydrate work items from canonical spec files.

**Guidance:**

1. Verify specs are in canonical form before proceeding (`docs/work-items/` populated and validated).
2. Call `validate_specs` first. Only proceed if validation passes.
3. Call `kanban.publish_specs` to hydrate work items.
4. Review hydration results: check for missing `item_id`, invalid priority, or unresolved dependencies.
5. If any specs fail validation, record the specific issues ΓÇö do not silently skip them.
6. After hydration, record which work items were created and their initial status in project state.
7. Do not manually create individual work items via Kanban API. Always use the spec-hydration path.
8. Call `yield_session` when done.

**Skills to load:** `orchestration-patterns`, `project-analysis`

**State written:** Hydration result, work-item inventory snapshot, any validation failures.

---

### Playbook 6: Project State Review

**Trigger condition (API-evaluated):** `readiness_signals.work_items_active == true`.

**Goal:** Produce a current project status and drive forward motion for the highest-priority next actions.

**Guidance:**

1. Load current work items grouped by status.
2. Review recent workflow run outcomes for active work items.
3. Identify: what is blocked, what is stalled, what is ready to advance.
4. For work items in review status: evaluate whether they are ready for merge or need rework.
5. For work items in backlog: check if they meet dispatch criteria (capacity, dependencies met).
6. Propose dispatch for the highest-priority ready work items.
7. Record review findings and dispatch decisions in state.
8. Ask user if any items require escalation or priority change.
9. Call `yield_session` when done.

**Skills to load:** `orchestration-patterns`, `project-analysis`, `decision-records`

**State written:** Review summary, dispatch decisions, escalations.

---

### Playbook 7: Next Cycle Planning

**Trigger condition (API-evaluated):** `readiness_signals.work_items_active == false` AND `readiness_signals.project_healthy == true`.

**Goal:** Select the next meaningful batch of work and prepare it for execution.

**Guidance:**

1. Review completed work items: verify outcomes match expected deliverables.
2. Review any items that were blocked or rolled back: determine if they can be retried.
3. Identify the next set of work items that are ready (dependencies resolved, specs present).
4. Verify capacity before selecting batch size.
5. Update project strategy summary with completed and upcoming work.
6. Determine if any new spec generation is needed before the next batch.
7. Record planning decisions and batch selection rationale in state.
8. Call `yield_session` when done.

**Skills to load:** `orchestration-patterns`, `project-analysis`, `decision-records`

**State written:** Completed summary, next batch selection, strategy update.

---

### Playbook 8: Triage and Recovery

**Trigger condition (API-evaluated):** `execution_state.recovery_needed == true` OR any `failure_counters` value >= 3 (within the sliding window ΓÇö see ┬º4.1).

**Goal:** Diagnose what went wrong, reset to a safe state, and produce a concrete recovery plan that the API can act on in the next session.

**Guidance:**

1. Read the last N decision log entries and failure records.
2. Identify the dominant failure class (tool contract errors, path errors, delegation no-ops, etc.).
3. For each failure class, apply the appropriate recovery action:
   - Tool contract mismatch ΓåÆ record the corrected argument shape and annotate the known issue.
   - EISDIR/ENOENT ΓåÆ mark bad paths, re-run directory listing, update artifact inventory.
   - Delegation no-op ΓåÆ check agent capacity, check workflow ID validity, defer and schedule retry.
   - Stale state ΓåÆ force re-investigation by setting `recommended_next_playbook = "investigation"`.
4. Do not attempt the failing action again without a documented change to the approach.
5. Ask the user if recovery requires decisions outside the orchestrator's authority.
6. Write a `recovery_plan` entry in state: for each failure class, the specific corrective action and the condition under which the normal playbook should resume. The next session's playbook selection will check this entry.
7. Write clean state (remove stale assumptions, mark known bad paths, reset `recovery_needed` to false) before calling `yield_session`.
8. Call `yield_session({ status: "recovered" | "escalated", summary, recommended_next_playbook })`.

**Skills to load:** `debugging`, `orchestration-patterns`, `decision-records`

**State written:** Failure analysis, `recovery_plan`, corrective actions taken, clean state snapshot.

**Example session prompt fragment:**

```
The last {n} sessions produced repeated failures of class: {error_class}.

Your task:
1. Read the last {n} decision log entries.
2. Identify the root cause.
3. Document a corrective approach in recovery_plan.
4. Do NOT retry the failing action without a documented change.
5. Write clean state and call yield_session({ status: "recovered", ... }).
```

---

## 4. Persistent State Implementation

### 4.1 Schema

```typescript
interface OrchestrationSessionState {
  schema_version: number; // increment on breaking schema changes; used for migration
  project_id: string;
  last_updated: string; // ISO timestamp
  last_session_id: string; // workflow run ID of last session
  session_lock?: {
    locked_by: string; // session ID
    locked_at: string; // ISO timestamp
    expires_at: string; // locked_at + TTL
  };
  playbook_history: Array<{
    playbook: string;
    session_id: string;
    started_at: string;
    finished_at: string;
    outcome: "completed" | "blocked" | "partial" | "failed" | "timeout";
    summary: string;
  }>;
  project_context: {
    repo_url?: string;
    repo_path?: string;
    branch?: string;
    import_status?: "none" | "pending" | "bootstrapped";
    artifact_inventory: Record<string, ArtifactCategoryState>;
  };
  knowledge_state: {
    // Temporary scratchpad only. Validated facts are compacted into docs and removed.
    // See ┬º4.3 for compaction rules.
    cycle_open_questions: Array<{
      question: string;
      blocking: boolean;
      asked_at: string;
    }>;
    cycle_assumptions: Array<{
      fact: string;
      source: string;
    }>;
    compaction_cursor: string; // ISO timestamp of last compaction run
    known_bad_paths: Array<{
      path: string;
      recorded_at: string; // for TTL-based expiry
    }>;
  };
  confidence_signals: {
    // Objective inputs. confidence_overall is derived by the API, not the LLM.
    directories_listed_pct: number; // % of known top-level dirs that have been listed
    key_files_read_pct: number; // % of known entry-point files (README, AGENTS.md, etc.) read
    epics_processed_pct: number; // % of discovered epics that have been read
    bad_path_growth_rate: number; // known_bad_paths added in last 3 sessions
    confidence_overall: number; // computed by API from above signals, 0-100
  };
  execution_state: {
    active_playbook?: string;
    last_playbook?: string;
    last_session_outcome?:
      | "completed"
      | "blocked"
      | "partial"
      | "failed"
      | "timeout";
    recommended_next_playbook?: string; // written by yield_session, read by API at next start
    recovery_plan?: Array<{
      failure_class: string;
      corrective_action: string;
      resume_condition: string;
    }>;
    pending_delegations: Array<{
      run_id: string;
      agent: string;
      task: string;
      dispatched_at: string;
      completed_at?: string;
      outcome?: "success" | "failed" | "cancelled";
    }>;
    failure_counters: Record<
      string,
      {
        count: number;
        window_start: string; // sliding window start (ISO timestamp)
      }
    >; // counters reset when their playbook completes successfully
    recovery_needed: boolean;
  };
  decision_log: Array<{
    session_id: string;
    occurred_at: string;
    decision: string;
    rationale: string;
    outcome?: string;
  }>; // capped at last 50 entries; older entries moved to decision_log_archive table
  readiness_signals: {
    // All computed by API from state, not by LLM.
    specs_ready: boolean;
    work_items_pending: boolean;
    work_items_active: boolean;
    project_healthy: boolean;
    dispatch_ready: boolean;
    investigation_needed: boolean;
  };
}
```

### 4.2 State Access

- State is loaded at session start via `get_orchestration_state` (dedicated tool ΓÇö not `get_project_state`).
- State is written via `update_orchestration_state` with partial-update (patch) semantics so mid-session checkpoints are possible.
- `yield_session` is the terminal tool call. It writes the final state update and releases the session lock atomically.
- State survives process restarts (database-backed, not in-memory).
- State is human-readable in the project timeline API.
- Schema migrations are keyed on `schema_version`. The migration runner checks this field on load and upgrades in-place if needed.

### 4.3 Knowledge Compaction

`knowledge_state` is a **temporary scratchpad**, not a knowledge base. It is bounded by design.

**Compaction rules (enforced by API, not LLM):**

- After each session that sets `outcome = 'completed'`, the API runs a compaction check.
- Any `cycle_assumption` that has been referenced in a successfully written artifact (spec, epic, ARCHITECTURE.md) is removed from `knowledge_state`.
- Any `cycle_open_question` that has been answered (answer found in docs, or user response recorded) is removed.
- `known_bad_paths` entries older than 30 days are expired and removed (paths may change after refactoring).
- The compaction result is logged as a `compaction.ran` event with counts of removed entries.

**Graduating facts to documentation:**

- When the orchestrator discovers a material architectural fact during investigation (e.g., "the API uses event sourcing"), it should write that fact to the relevant permanent doc (ARCHITECTURE.md, AGENTS.md, or equivalent) and remove it from `knowledge_state`.
- The LLM playbook guidance instructs: "Facts that belong in permanent documentation should be written there, not accumulated in knowledge_state."

### 4.4 Confidence Scoring

`confidence_overall` is computed by the API from objective signals ΓÇö it is never self-assessed by the LLM:

```
confidence_overall =
  (directories_listed_pct   ├ù 0.30) +
  (key_files_read_pct       ├ù 0.35) +
  (epics_processed_pct      ├ù 0.25) +
  (100 - bad_path_growth_rate_penalty ├ù 0.10)
```

Where `bad_path_growth_rate_penalty` = `min(100, bad_path_growth_rate ├ù 10)`.

This produces a consistent score across sessions that cannot be inflated by the LLM.

---

## 5. Playbook Selection Algorithm (API Rule Engine)

The API evaluates state and selects one playbook before the LLM is invoked. Rules are stored in a YAML config (or DB table) and evaluated by a lightweight TypeScript rule engine. The LLM never sees this logic.

**Rule config (evaluated in priority order):**

```yaml
rules:
  - id: first_run
    condition: "state == null"
    playbook: first-run

  - id: triage_recovery
    condition: "state.execution_state.recovery_needed == true OR any(state.execution_state.failure_counters, c => c.count >= 3)"
    playbook: triage-and-recovery

  - id: imported_repo_bootstrap
    condition: >
      state.project_context.import_status == 'pending'
      OR (isEmpty(state.project_context.artifact_inventory) AND workspaceRootHasFiles())
      OR (importExists AND state.confidence_signals.confidence_overall < 60)
    playbook: imported-repo-bootstrap

  - id: investigation
    condition: "state.confidence_signals.confidence_overall < 70 OR state.readiness_signals.investigation_needed == true"
    playbook: existing-project-investigation

  - id: micro_planning
    condition: "state.readiness_signals.project_healthy == true AND state.execution_state.pending_user_request != null AND isNarrowScope(state.execution_state.pending_user_request)"
    playbook: micro-planning

  - id: spec_generation
    condition: "state.readiness_signals.specs_ready == false"
    playbook: spec-generation

  - id: work_item_generation
    condition: "state.readiness_signals.specs_ready == true AND state.readiness_signals.work_items_pending == false"
    playbook: work-item-generation

  - id: project_state_review
    condition: "state.readiness_signals.work_items_active == true"
    playbook: project-state-review

  - id: next_cycle_planning
    condition: "state.readiness_signals.work_items_active == false AND state.readiness_signals.project_healthy == true"
    playbook: next-cycle-planning
```

The rule engine evaluates rules top-to-bottom and returns the first match. Adding a new playbook requires only a new rule entry ΓÇö no code change to the engine.

---

## 6. Implementation Tasks

### Task 1: Persistent Orchestration State Store

**Goal:** Database-backed per-project orchestration state with schema versioning.

**Files:**

- New entity + migration: `apps/api/src/project/orchestration-session-state.entity.ts`
- New repository: `apps/api/src/project/orchestration-session-state.repository.ts`
- Extend: `apps/api/src/project/project-orchestration.service.ts` ΓÇö read/write/patch state
- Register in `DatabaseModule`
- Archive table: `orchestration_decision_log_archive` (entries past 50)

**Acceptance Criteria:**

- State survives process restart.
- Loaded in < 200ms per project.
- `schema_version` field present; migration runner upgrades in-place.
- Partial update (patch) supported ΓÇö full replace not required on every write.

---

### Task 2: Playbook Selection Rule Engine

**Goal:** Deterministic TypeScript rule engine that selects the correct playbook from state before any LLM invocation.

**Files:**

- New: `apps/api/src/orchestration/playbook-router.service.ts`
- New: `apps/api/src/orchestration/playbook-rules.config.yaml` (or DB-backed equivalent)
- Integrate into session start in `project-orchestration.service.ts`

**Acceptance Criteria:**

- All 9 playbooks (including Playbook 4.5) selectable from state snapshots.
- Rule evaluation covered by unit tests with fixture snapshots ΓÇö no LLM required.
- Rules loadable from config without code deploy.
- Playbook name injected as first block in system prompt; routing logic never sent to LLM.

---

### Task 3: Tool Contract Repair Adapter

**Goal:** Auto-correct common argument-shape failures before hitting tool validators; feed back transient warnings to the LLM so it learns correct shapes.

**Files:**

- New: `apps/api/src/tool/tool-contract-repair.adapter.ts`
- Integrate in tool execution path

**Failures addressed:**

- `set_job_output.data`: string ΓåÆ parsed object, if string is valid JSON.
- `ask_user_questions.questions`: string ΓåÆ parsed array, if string is valid JSON.
- Any tool argument that is a serialised JSON value where a native value is expected.

**Repair feedback:**
After auto-repair, inject a system turn into the next LLM message:

> `System Note: Your last call to {tool_name} used a stringified JSON value for the '{field}' argument. It was auto-repaired this time. Please use a native object/array ΓÇö not a JSON string ΓÇö in future calls.`

**Acceptance Criteria:**

- One auto-repair attempt per call, tagged in event ledger as `tool.contract_repair.applied`.
- No repair attempted if original is already valid.
- Repair failures recorded as `tool.contract_repair.failed` event.
- Transient warning injected into LLM context on repair.
- Alert threshold: if repair rate for a given tool exceeds 20% over a 24-hour window, emit `tool.contract_repair.threshold_exceeded` alert.

---

### Task 4: Repository Access Safeguards (Auto-Downgrade)

**Goal:** Eliminate EISDIR errors entirely. When `read` is called on a directory, auto-downgrade to `list_path` and return the listing ΓÇö no error, no wasted turn.

**Files:**

- New: `apps/api/src/tool/handlers/list-path.tool.ts`
- Modify: existing `read` handler ΓÇö intercept directory paths, auto-run `list_path`, return listing with a note.
- Add path-type cache to orchestration state (`known_bad_paths` entries)

**Auto-downgrade response format:**

```
Note: '{path}' is a directory. Automatically listing contents:

{directory listing}
```

**Acceptance Criteria:**

- `read` on a directory never returns an EISDIR error ΓÇö always returns a listing.
- `list_path` tool available as a first-class tool for explicit directory listing.
- Auto-downgrade event logged as `tool.read.auto_downgraded`.
- Known-directory entries from prior sessions pre-warm the path-type cache.
- Wildcard paths to `read` return a descriptive error with suggested alternatives (wildcard is never auto-resolved).

---

### Task 5: Delegation Admission Normalisation with Backpressure

**Goal:** Make delegation outcomes unambiguous and provide actionable backpressure data to prevent spin-wait loops.

**Files:**

- Modify: `apps/api/src/project/project-orchestration.service.ts` ΓÇö normalise `invoke_agent_workflow` response
- New response shape in capability manifest

**Normalised outcome shape:**

```typescript
interface DelegationOutcome {
  status: "accepted" | "no_capacity" | "queued" | "rejected";
  assigned_count: number;
  busy_agent_count?: number;
  retry_after_seconds?: number; // included on no_capacity
  guidance?: string; // plain-language instruction for the LLM
}
```

**Backpressure guidance (included in `no_capacity` response):**

> `"No agents are available (3 busy). Do not retry this session. Call yield_session({ status: 'blocked', ... }) and wait for a capacity-freed event."`

**Acceptance Criteria:**

- All callers receive a normalised outcome.
- `no_capacity` includes `retry_after_seconds` and `guidance`.
- `guidance` on `no_capacity` explicitly instructs the LLM to call `yield_session`.
- Playbook skills reference this normalised shape ΓÇö no raw response parsing in prompts.

---

### Task 6: `yield_session` Tool

**Goal:** Provide an explicit, programmatic session termination hook that writes final state and releases the session lock atomically.

**Files:**

- New: `apps/api/src/tool/handlers/yield-session.tool.ts`
- Integrate into session lifecycle in `project-orchestration.service.ts`

**Tool schema:**

```typescript
interface YieldSessionInput {
  status: "completed" | "blocked" | "partial" | "recovered" | "escalated";
  summary: string;
  recommended_next_playbook?: string;
  notes?: string;
}
```

**Acceptance Criteria:**

- `yield_session` atomically writes `last_session_outcome`, `recommended_next_playbook`, and releases the session lock.
- A session that ends without calling `yield_session` within TTL is forcibly terminated; state is marked `outcome: 'timeout'`.
- `yield_session` is the only way to cleanly end a session ΓÇö the system does not treat silence as completion.

---

### Task 7: Knowledge Compaction Service

**Goal:** Keep `knowledge_state` bounded; graduate validated facts to permanent documentation.

**Files:**

- New: `apps/api/src/orchestration/knowledge-compaction.service.ts`
- Called by session lifecycle after `yield_session` with `outcome: 'completed'`

**Compaction logic:**

- Remove `cycle_assumptions` that appear in recently written docs.
- Remove answered `cycle_open_questions`.
- Expire `known_bad_paths` entries older than 30 days.
- Emit `compaction.ran` event with entry counts before/after.

**Acceptance Criteria:**

- Compaction runs after every completed session.
- `knowledge_state` never grows unboundedly in unit tests over 100 simulated sessions.
- Compaction does not run if `outcome != 'completed'` (partial sessions preserve their scratchpad).

---

### Task 8: Playbook Skill Files

**Goal:** Author all playbook skills for delivery by the API at session start.

**Files (one per playbook):**

- `seed/skills/orchestration-playbooks/first-run/SKILL.md`
- `seed/skills/orchestration-playbooks/imported-repo-bootstrap/SKILL.md`
- `seed/skills/orchestration-playbooks/existing-project-investigation/SKILL.md`
- `seed/skills/orchestration-playbooks/spec-generation/SKILL.md`
- `seed/skills/orchestration-playbooks/micro-planning/SKILL.md`
- `seed/skills/orchestration-playbooks/work-item-generation/SKILL.md`
- `seed/skills/orchestration-playbooks/project-state-review/SKILL.md`
- `seed/skills/orchestration-playbooks/next-cycle-planning/SKILL.md`
- `seed/skills/orchestration-playbooks/triage-and-recovery/SKILL.md`

**Acceptance Criteria:**

- Each SKILL.md includes: trigger conditions (for documentation), step-by-step guidance, tools to use/avoid, done criteria, and required `yield_session` call.
- No skill file includes the playbook routing algorithm (that lives in code).
- Skills are seeded and available as assignable skills on the CEO/orchestrator agent profile.

---

### Task 9: CEO Agent Profile Update

**Goal:** Update CEO agent to use the playbook-driven model.

**Files:**

- `seed/agents/ceo.agent.seed.ts` (or YAML equivalent)

**System prompt requirements (explicit, not a one-liner):**

1. At session start, orchestration state has already been read and the correct playbook has been selected by the API. Your system prompt contains exactly one playbook. Follow it.
2. You MUST NOT evaluate which playbook applies ΓÇö that decision has already been made for you.
3. You MUST call `yield_session` before stopping. Never cease tool calls without calling `yield_session`.
4. If state is missing or corrupted, call `yield_session({ status: "escalated", summary: "State unavailable. Manual review required." })` immediately.
5. Hard constraint: do not create work items, write specs, or delegate in sessions where the playbook does not authorise it.

**Profile changes:**

- Remove references to fixed stage names (discovery, specs, implementation).
- Remove playbook router from assigned skill list (routing is now a code concern).
- Add all 9 playbook skills to the assigned skill list for delivery at session start.

**Acceptance Criteria:**

- Profile seeds cleanly.
- Agent always calls `yield_session` ΓÇö no silent session endings.
- Agent follows the injected playbook rather than defaulting to greenfield patterns.

---

### Task 10: Regression Tests

**Goal:** Cover all observed failure classes from session evidence plus all new architectural components.

**Test cases (minimum):**

- Stringified JSON tool argument auto-repair (`set_job_output`, `ask_user_questions`).
- Auto-repair transient warning injected into next LLM turn.
- `read` on a directory ΓåÆ auto-downgraded to listing.
- Wildcard path to `read` ΓåÆ descriptive error.
- `invoke_agent_workflow` with `assigned_count=0` normalised to `no_capacity` with backpressure data.
- `yield_session` atomically writes state and releases lock.
- Concurrent session attempt while lock is held ΓåÆ `session.skipped.locked` event, clean exit.
- Expired lock ΓåÆ `session.lock.recovered` event, session proceeds.
- Playbook selection from state snapshots (one fixture per rule, including Playbook 4.5).
- State persistence through process restart.
- Knowledge compaction: 100 sessions without unbounded `knowledge_state` growth.
- Failure counter sliding window: counter does not trigger triage for failures older than window.
- `confidence_overall` computed correctly from objective signals.

---

## 7. Definition of Done (Epic Level)

- [ ] Persistent orchestration state store implemented, seeded, and migration-tested (`schema_version` present).
- [ ] Deterministic playbook selection rule engine implemented and unit-tested without LLM.
- [ ] Session locking (acquire/release/expiry) implemented and tested for concurrent triggers.
- [ ] All 9 playbook skill files authored and seeded (including Playbook 4.5 Micro-Planning).
- [ ] CEO agent profile updated with explicit `yield_session` requirement and detailed constraints.
- [ ] `yield_session` tool implemented and enforced as the only valid session termination path.
- [ ] Tool contract repair adapter active for known failure classes; transient warning injected on repair.
- [ ] Repository access auto-downgrade prevents EISDIR errors entirely.
- [ ] Delegation admission normalised with backpressure data.
- [ ] Knowledge compaction service prevents unbounded `knowledge_state` growth.
- [ ] Objective confidence scoring replaces LLM self-assessment.
- [ ] All regression test cases from session evidence and new architecture pass.
- [ ] Imported-repository first session produces a complete artifact inventory without manual intervention.
- [ ] Playbook 4.5 handles a narrow user request without triggering full project review.

---

## 8. Skills Required

| Skill                    | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `project-analysis`       | Artifact discovery, coverage mapping, confidence scoring             |
| `orchestration-patterns` | Capacity-aware dispatch, delegation policy, fallback behavior        |
| `decision-records`       | Rationale logging, pivot documentation                               |
| `debugging`              | Failure class identification, recovery playbook selection            |
| `testing-unit-patterns`  | Unit/integration coverage for adapters, rule engine, and state logic |

---

## 9. Risks and Mitigations

| Risk                                                | Mitigation                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Playbook selection produces the wrong playbook      | Deterministic rule engine covered by unit tests with known fixture snapshots; no LLM involved       |
| State grows unbounded                               | knowledge_state is a scratchpad with active compaction; decision_log capped at 50 with archive      |
| Playbook guidance conflicts with base system prompt | Playbook skill takes precedence; CEO prompt explicitly states this                                  |
| Auto-repair hides contract bugs from authors        | Repair events emitted; alert on repair rate > 20% over 24h                                          |
| Imported repo path mount differs from expected      | Playbook 2 builds fresh inventory from actual paths; auto-downgrade eliminates EISDIR loops         |
| Concurrent sessions corrupt state                   | Per-project session lock with TTL; concurrent attempt emits event and exits cleanly                 |
| LLM fails to call yield_session                     | Session TTL enforced by API; timeout recorded in state; next session sees `last_outcome: timeout`   |
| Confidence thresholds behave inconsistently         | Confidence derived from objective signals by API; same inputs always produce same score             |
| Recovery plan is ignored after triage               | `recovery_plan` is a typed state field read by the API; next session selection checks it explicitly |
| Micro-planning scope creep                          | Playbook 4.5 explicitly instructs: read only the affected spec; do not read unrelated epics         |
| known_bad_paths stales after refactor               | 30-day TTL expiry on bad path entries; entries re-acquired if access fails again                    |

---

## 10. Rollout Phases (Parallel Tracks)

**Track A ΓÇö Immediate (no new infrastructure required):**

- Task 3: Tool contract repair adapter + transient warning injection.
- Task 4: Repository access auto-downgrade.

These fix the observed failure patterns independently and ship first.

**Track B ΓÇö Foundation (parallel to Track A):**

- Task 1: Persistent orchestration state store + schema versioning.
- Task 7: Knowledge compaction service.
- Task 6: `yield_session` tool.
- Task 2: Playbook selection rule engine.

**Track C ΓÇö Integration (after A + B land):**

- Task 5: Delegation admission normalisation with backpressure.
- Task 8: Playbook skill files authored and seeded.
- Task 9: CEO agent profile update.
- Task 10: Full regression test suite.

**Validation milestones:**

1. (After Track A) Re-run imported-repository session. EISDIR errors and contract repair failures should drop to zero.
2. (After Track B) New greenfield project completes Playbooks 1ΓåÆ4ΓåÆ5 without manual intervention.
3. (After Track C) Imported-repository full lifecycle (1ΓåÆ2ΓåÆ3ΓåÆ4ΓåÆ5ΓåÆ6) succeeds end-to-end.
4. Final: Enable Playbook 8 (Triage and Recovery); validate failure budget counters and recovery plan flow.

---

## 11. Success Metrics

- 0 EISDIR or ENOENT errors caused by using `read` on directory or wildcard paths.
- 0 false-positive delegation success where `assigned_count = 0`.
- Tool contract repair rate drops to near-zero after transient warnings feed back into model behaviour.
- Imported-repository first session produces a complete artifact inventory without manual intervention.
- Orchestrator correctly selects Playbook 3 (investigation) for a complex existing project before attempting spec generation ΓÇö verified by rule engine unit tests, not LLM output.
- `knowledge_state` does not grow across 100 simulated sessions (compaction test).
- `confidence_overall` produces the same value for the same fixture inputs on every run.
- All sessions end with a `yield_session` call ΓÇö 0 timeout terminations in steady-state operation.

---

## 12. Implementation Summary (2026-04-22)

Implemented in this iteration:

- Added persistent orchestration state storage:
  - New entity: `orchestration_session_states`.
  - New archive table: `orchestration_decision_log_archive`.
  - New repositories and migration registration.
- Added orchestration session state service with:
  - Default-state bootstrap.
  - Partial patch semantics.
  - Session lock acquire/skip/recover behavior with telemetry events.
  - `yield_session` finalize path and lock release.
  - Decision-log archive compaction (cap 50 entries).
  - Known bad path expiry compaction with `compaction.ran` event.
- Added deterministic playbook rule router:
  - YAML rules file (`apps/api/src/orchestration/playbook-rules.config.yaml`).
  - Router service and unit tests for all listed playbook branches.
- Added tool-contract repair adapter:
  - Repairs stringified JSON arguments for `set_job_output.data` and `ask_user_questions.questions`.
  - Generic nested JSON-string repair for object/array payload fields.
  - Emits `tool.contract_repair.applied`, `tool.contract_repair.failed`, and threshold alerts.
  - Integrates with runtime tool execution and returns transient `system_note` guidance.
- Added new runtime orchestration tools:
  - `get_orchestration_state`
  - `update_orchestration_state`
  - `yield_session`
  - `list_path`
  - Added controller endpoints and internal tool registration.
- Added 9 playbook skill files under `seed/skills/orchestration-playbooks/*`.
- Updated CEO seed prompt and profile/tool/skill assignments to enforce playbook-driven behavior and explicit `yield_session` termination.

Challenges and decisions:

- The runtime architecture in this branch uses internal tool handlers and API callbacks rather than a monolithic tool switchboard. The implementation was aligned to that architecture by adding typed internal tools and endpoints.
- Session lock implementation uses persisted lock state with TTL and pessimistic write-safe updates through the service/repository layer, with explicit recovery/skipped events.
- Tool repair warning delivery is implemented as transient `system_note` in tool result payload because runtime message injection hooks are tool-result mediated in this architecture.
