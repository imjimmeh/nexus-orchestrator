# EPIC-138: Imported Repository Reality Mapping and Completed Work Hydration

**Epic ID:** EPIC-138  
**Status:** Proposed  
**Priority:** P0 - Critical  
**Theme:** Imported Repository Reliability, Parallel Discovery, State Accuracy  
**Created:** 2026-04-20  
**Depends On:** EPIC-137 (Playbook-Driven Stateful Orchestration)

## 1. Background

EPIC-137 defines the required foundation:

- Persistent orchestration session state
- Deterministic playbook selection in API code
- Session lock and yield_session termination contract
- Imported repository bootstrap playbook and investigation playbook

This improved first-run behavior, but imported repositories still have a major blind spot:

- Existing epics and work items are discovered, but actual completion state is not reliably inferred from repository reality.
- The orchestrator still tends to rely too heavily on documentation freshness.
- Discovery for imported projects remains mostly single-threaded, which increases latency and lowers coverage on large repositories.

This epic closes that gap by introducing a parallel probe model, deterministic resume behavior, and confidence-based hydration of already-completed work.

---

## 2. Problem Statement

For imported repositories, we need an orchestration path that can answer these questions with evidence:

1. What planning and architecture artifacts exist right now?
2. What does the current codebase actually contain at a high level?
3. If epics/work items exist, which parts are implemented, partially implemented, missing, or stale?
4. How do we represent already-completed work in the project board without corrupting future planning?

Current behavior does not robustly answer 3 and 4.

---

## 3. Goals

1. Parallelize imported-repository discovery into explicit probe workflows.
2. Persist probe outputs as first-class orchestration state.
3. Enable orchestrator sessions to end quickly while probes run, then resume automatically when probe results are ready.
4. Produce evidence-based completion mapping for existing epics/work items.
5. Hydrate completed work into the board with confidence-aware status assignment.
6. Keep the model deterministic and testable without requiring LLM rule evaluation.

---

## 4. Non-Goals

1. Replace the EPIC-137 playbook architecture.
2. Infer low-level implementation correctness of every file in one session.
3. Fully automate unresolved business decisions without user confirmation.

---

## 5. Design Principles

1. Deterministic routing and lifecycle in API code.
2. LLM executes playbooks; it does not route playbooks.
3. Prefer bounded asynchronous sessions over long-lived waiting sessions.
4. Persist objective evidence, not only narrative summaries.
5. Use confidence-gated hydration for completed work to prevent false positives.

---

## 6. Target Model

### 6.1 Import Reality Mapping Cycle

For imported repositories, orchestration uses a two-cycle pattern by default:

Cycle A (Dispatch):

1. Orchestrator selects imported-repo bootstrap/investigation playbook.
2. Orchestrator dispatches probe workflows in parallel:
   - Documentation probe (artifact inventory and quality)
   - Repository structure probe (high-level code and system topology)
   - Domain probes when `len(discovered_epics) > 0` (deterministic condition, not optional)
3. Orchestrator records pending probe delegations in state.
4. Orchestrator calls yield_session with blocked/partial status and explicit resume reason.

Cycle B (Synthesis):

1. Resume trigger fires when all required probes reach terminal state (see Section 6.4).
2. Orchestrator loads all probe outputs from persistent state.
3. Orchestrator synthesizes reality map and completion map.
4. Orchestrator decides next action:
   - Generate/update missing PRD/SDD/AGENTS docs
   - Hydrate missing work items
   - Hydrate completed work with in_review (pending_review) status
   - Ask one batched user clarification question set for ambiguous cases
5. Orchestrator calls yield_session with completed status.

### 6.2 Import Phase State Machine

Add explicit import lifecycle state:

- bootstrapping
- probe_dispatch
- probe_waiting
- probe_synthesis
- completion_hydration
- import_ready

Router decisions for imported repos must incorporate import_phase to avoid repeated re-bootstrap loops. The playbook router (`playbook-rules.config.yaml`) must be updated with import_phase-aware routing rules as part of this epic (see Task 0).

### 6.3 Probe Outputs as Structured Evidence

Each probe writes structured output to orchestration state:

- scope
- discovered_artifacts
- missing_artifacts
- evidence_refs (paths, symbols, tests, docs)
- inferred_status (implemented, partial, missing, unknown)
- confidence_score
- open_questions

Narrative summaries remain optional and secondary.

### 6.4 Async Resume Trigger

Probe-side callback with API-layer atomicity:

1. Each probe writes its result to state via the probe result write endpoint.
2. The API handler for that write atomically: marks the probe terminal, then checks whether all pending probes for the project are terminal.
3. If all probes are terminal, the handler emits `ProjectOrchestrationCycleRequestedEvent` within the same transaction.
4. The probe itself has no responsibility for checking completion or triggering resume. Its only job is to write its output.

Crash recovery: if a probe never writes a terminal result, the timeout sweep (see Task 2) is the sole recovery path.

### 6.5 Probe Staleness

Probe outputs are considered stale if:

- They were written in a prior import_phase_session_id, or
- Their `written_at` timestamp is older than the configured `PROBE_STALENESS_HOURS` (default: 24 hours).

The API layer exposes a `probes_stale: boolean` signal in the orchestration state read. The synthesis playbook reads this signal and does not recompute it.

---

## 7. Completed Work Hydration Model

### 7.1 Status Assignment

When generating board items from imported artifacts, assign initial status using confidence gates:

- in_review (with pending_review metadata flag): high or medium confidence evidence of implementation
- backlog (or equivalent pending status): low confidence or missing evidence

Work items hydrated with the pending_review flag are placed in `in_review` and await explicit user confirmation before transitioning to `done`.

### 7.2 Hydration Metadata

Each hydrated work item carries a `hydration_source` metadata block:

- originating_doc: epic/spec/work-item doc path
- evidence_refs: file paths and optional symbol references
- confidence_score: numeric value used for status assignment
- pending_review: boolean flag indicating the item requires user review before done

This metadata is persisted on the work item and surfaced in the board item detail view.

### 7.3 Workflow Guard Behaviour for Hydrated Items

Hydrated items with `pending_review: true` require three explicit workflow guards:

1. The on-review workflow must not fire when an item is created via hydration in `in_review` state. The hydration path must bypass this trigger.
2. Downstream workflows (e.g. merge trigger) must not fire when a pending_review item transitions to `done`. The transition is a user confirmation, not a merge event.
3. The kanban state validator must allow `in_review ΓåÆ done` for items carrying `pending_review: true`. This transition is otherwise blocked and must be explicitly permitted.

### 7.4 Confidence Inputs (Objective)

Confidence is computed by the API from objective signals:

- referenced modules/files exist and are non-trivial
- implementation paths linked to epic/work-item scope
- tests exist for scoped features
- docs/changelog/commit evidence aligns with scope
- contradictions detected (doc says complete but feature absent)

### 7.5 Confidence Thresholds

Default values (configurable via constants, not hardcoded):

- `HYDRATION_HIGH_CONFIDENCE_THRESHOLD = 0.80` ΓåÆ in_review with pending_review flag
- `HYDRATION_LOW_CONFIDENCE_THRESHOLD = 0.50` ΓåÆ below this, item placed in backlog

Values between thresholds also produce in_review with pending_review flag.

### 7.6 User Clarification Policy

Ambiguous cases must be batched into a single clarification interaction per synthesis session, not one prompt per item.

Example user prompt class:

- "These 7 items are marked complete in docs but have weak code evidence. Confirm as done or reopen?"

Answers are persisted and feed confidence recalculation before final hydration.

---

## 8. Playbook and Workflow Changes

### 8.1 Playbook Changes

Update imported-repo-bootstrap and existing-project-investigation playbooks to:

1. Authorize probe dispatch when import context is incomplete.
2. Explicitly permit yield_session after probe dispatch.
3. Require synthesis from persisted probe outputs on resume.

Add one focused playbook:

- imported-repo-synthesis-and-hydration

Responsibilities:

1. Read `probes_stale` signal from state. If stale, re-dispatch affected probes and yield. Otherwise proceed with persisted probe outputs.
2. Build completion map across epics/work items.
3. Perform confidence-gated hydration using API-computed confidence scores.
4. Batch unresolved user clarifications.
5. Yield with explicit next-playbook recommendation.

### 8.2 Probe Workflow Family

Add reusable probe workflows:

1. documentation-artifact-probe
2. repository-structure-probe
3. domain-completion-probe

All probe workflows must write canonical output payloads to orchestration state via the probe result write endpoint. Probe workflows must not emit resume events or check completion state directly.

### 8.3 Probe Idempotency

Probe contracts are keyed by `(project_id, import_phase_session_id, probe_type, scope_id)`. Dispatching a probe whose key already has a non-failed contract is a no-op. This prevents duplicate probes on recovery or re-entry.

### 8.4 Probe Concurrency Limit

Default: `MAX_CONCURRENT_PROBES = 5` (configurable). Probe dispatch respects this limit; excess probes are queued and dispatched as running probes complete.

### 8.5 Timeout Policy

- Per-probe timeout: 1 hour
- Total cycle timeout (all probes): 4 hours
- Partial synthesis policy: if ΓëÑ 50% of probes are terminal at total cycle timeout, proceed with synthesis using available results and mark remaining probes as timed out. If < 50% terminal, yield with failed status and surface to user.

---

## 9. Implementation Tasks

### Track A ΓÇö Foundation (sequential, must complete before Track B)

#### Task 0: Router Rules Update

Update `playbook-rules.config.yaml` with import_phase-aware routing rules:

- Route to imported-repo-synthesis-and-hydration when import_phase is probe_synthesis or completion_hydration.
- Prevent re-bootstrap when import_phase is probe_waiting or later.

Acceptance criteria:

- Router selects correct playbook for each import_phase value given identical state fixtures.
- No regression in existing routing rules.

#### Task 1: Probe Delegation Contract

Create a typed delegation contract for import probes with fields:

- probe_type
- scope_id
- scope_payload
- expected_output_schema
- timeout_seconds (default: 3600)
- idempotency_key: `(project_id, import_phase_session_id, probe_type, scope_id)`

Acceptance criteria:

- Probe contracts are persisted in execution_state.pending_delegations.
- Each probe has terminal outcome and timestamp.
- Dispatching a probe whose idempotency_key already has a non-failed contract is a no-op.

#### Task 2: Probe Result Write Endpoint and Resume Trigger

Add probe result write endpoint that:

1. Writes probe output to state.
2. Marks the probe contract terminal within the same transaction.
3. Checks atomically whether all pending probes for the project are terminal.
4. If all terminal, emits ProjectOrchestrationCycleRequestedEvent.

Add timeout sweep that marks probes exceeding per-probe timeout as timed out and triggers the all-terminal check.

Acceptance criteria:

- No manual restart required after probe completion.
- No race condition: concurrent probe completions produce exactly one resume event.
- Timeout sweep correctly marks probes terminal and triggers resume when threshold met.
- Partial synthesis policy (ΓëÑ 50%) is applied at total cycle timeout.

#### Task 3: Import Phase State Field

Extend OrchestrationSessionState with import_phase and transition helpers.

Acceptance criteria:

- Phase transitions are deterministic and auditable in timeline.
- Router uses import_phase for imported repo routing.
- probes_stale boolean is computed by the API on state read based on staleness rules (Section 6.5).

#### Task 4: Probe Output Persistence Schema

Add typed state section for probe_results with bounded retention and indexing by probe_type + scope_id.

Default retention: 7 days (configurable via PROBE_RESULT_RETENTION_DAYS constant).

Acceptance criteria:

- Synthesis session can load all relevant probe results in one read.
- Probe payloads older than retention window are compacted/archived.
- probes_stale signal is correctly derived from written_at timestamps and import_phase_session_id.

---

### Track B ΓÇö Probe Capability (starts after Task 4)

#### Task 5: Documentation Artifact Probe Workflow

Implement workflow that inventories PRD, SDD, AGENTS, epics, specs, work-items docs and records completeness signals.

Acceptance criteria:

- Output contains discovered and missing artifact categories.
- Output includes confidence and evidence_refs.
- Output is written via probe result write endpoint (Task 2).

#### Task 6: Repository Structure Probe Workflow

Implement workflow that produces high-level map of apps/packages/modules/tests and architecture indicators.

Acceptance criteria:

- Output includes domain candidates for optional domain probes.
- Output includes key entry points and test topology.
- Output is written via probe result write endpoint.

#### Task 7: Domain Completion Probe Workflow

Implement scoped probe for epic/work-item domains that maps docs intent to code reality.

Dispatch condition: triggered when `len(discovered_epics) > 0` (evaluated deterministically in API code, not by LLM).

Acceptance criteria:

- Returns per-item inferred_status and confidence_score.
- Supports batching by domain for parallel execution up to MAX_CONCURRENT_PROBES.
- Output is written via probe result write endpoint.

---

### Track C ΓÇö Synthesis and Hydration (starts after Task 7)

#### Task 8: Imported Synthesis Playbook

Add imported-repo-synthesis-and-hydration skill file and seed wiring.

Acceptance criteria:

- Playbook reads probes_stale from state and re-dispatches if stale before synthesizing.
- Playbook consumes probe_results from state without re-running discovery.
- Playbook enforces batch clarification and yield_session.

#### Task 9: Completed Work Hydration Path

Extend work-item hydration to support initial status in_review with pending_review metadata flag.

Acceptance criteria:

- Hydration creates items with hydration_source metadata (originating_doc, evidence_refs, confidence_score, pending_review).
- Status assignment uses HYDRATION_HIGH_CONFIDENCE_THRESHOLD and HYDRATION_LOW_CONFIDENCE_THRESHOLD constants.
- On-review workflow is suppressed when item is created via hydration path.
- Downstream workflows (merge trigger, etc.) are suppressed when pending_review item transitions to done.
- Kanban state validator permits in_review ΓåÆ done transition for items with pending_review: true.

#### Task 10: Clarification Batching

Implement one-shot ambiguous-item question batching for imported synthesis sessions.

Acceptance criteria:

- One ask_user_questions call per synthesis cycle for ambiguity resolution.
- Answers are persisted and feed confidence recalculation before final hydration.

#### Task 11: Regression Tests

Add tests covering:

1. Probe dispatch and pending_delegations persistence
2. Probe idempotency: duplicate dispatch is a no-op for non-failed contracts
3. Atomic resume trigger: concurrent probe completions produce exactly one event
4. Import phase transitions and router behaviour (Task 0 routing rules)
5. Probe output schema validation
6. Probe staleness signal derivation
7. Synthesis reads persisted probe outputs without rediscovery
8. Confidence-gated status assignment: done_high, done_medium ΓåÆ in_review (pending_review); low ΓåÆ backlog
9. Workflow guard: on-review suppressed for hydrated items
10. Workflow guard: merge trigger suppressed for pending_review ΓåÆ done transition
11. Kanban validator: in_review ΓåÆ done permitted for pending_review items
12. Clarification batching behaviour
13. Timeout sweep and partial probe completion policies (ΓëÑ 50% and < 50% cases)
14. Probe concurrency limit: excess probes are queued

---

## 10. Definition of Done

- Probe workflows exist and run in parallel for imported repos.
- Orchestrator can yield after dispatch and auto-resume on probe completion (API-layer atomic trigger).
- Import phase state machine is implemented and routed deterministically (playbook-rules.config.yaml updated).
- Probe outputs are persisted as structured evidence with 7-day retention default.
- Probe idempotency is enforced by idempotency key.
- Imported synthesis playbook is authored, seeded, and enforced.
- Completed-work hydration supports in_review (pending_review) with hydration_source provenance.
- Workflow guards prevent on-review and merge triggers for hydrated items.
- Kanban validator permits in_review ΓåÆ done for pending_review items.
- Ambiguous completion decisions are batched for user confirmation.
- Regression tests cover dispatch, resume, synthesis, hydration, confidence gating, and workflow guards.

---

## 11. Risks and Mitigations

1. Risk: Over-hydrating false completed items.
   Mitigation: Confidence gates + pending_review flag + provenance links + user batch confirmation.

2. Risk: Probe fan-out causes long waits.
   Mitigation: MAX_CONCURRENT_PROBES limit (default 5), per-probe 1-hour timeout, 4-hour cycle timeout, partial synthesis at ΓëÑ 50%.

3. Risk: Repeated bootstrap loops.
   Mitigation: Import phase state machine with deterministic transitions and router rules update.

4. Risk: State bloat from probe payloads.
   Mitigation: 7-day retention window with archival compaction (configurable via PROBE_RESULT_RETENTION_DAYS).

5. Risk: Ambiguity prompt fatigue.
   Mitigation: Single batched clarification step per synthesis cycle.

6. Risk: Race condition on concurrent probe completion.
   Mitigation: API-layer atomic check within probe result write transaction; exactly one resume event emitted.

7. Risk: Duplicate probes on recovery or re-entry.
   Mitigation: Idempotency key prevents duplicate dispatch for non-failed contracts.

---

## 12. Rollout Plan

### Track A ΓÇö Foundation

1. Task 0 - Router rules update
2. Task 1 - Probe delegation contract
3. Task 2 - Probe result write endpoint and resume trigger
4. Task 3 - Import phase state field
5. Task 4 - Probe output persistence schema

### Track B ΓÇö Probe Capability (after Track A complete)

1. Task 5 - Documentation artifact probe
2. Task 6 - Repository structure probe
3. Task 7 - Domain completion probe

### Track C ΓÇö Synthesis and Hydration (after Track B complete)

1. Task 8 - Imported synthesis playbook
2. Task 9 - Completed-work hydration path
3. Task 10 - Clarification batching
4. Task 11 - Regression tests

---

## 13. Success Metrics

1. Imported projects reach import_ready with no manual orchestration restart.
2. 90%+ of imported epic/work-item statuses are auto-classified with evidence.
3. False in_review (pending_review) classification rate below 5% after user review.
4. Mean time to import synthesis reduced versus serial discovery baseline.
5. All hydrated completed items include hydration_source provenance.
6. Router decisions for imported projects are deterministic for identical state fixtures.

---

## 14. Resolved Decisions

1. Confidence thresholds: HYDRATION_HIGH_CONFIDENCE_THRESHOLD = 0.80, HYDRATION_LOW_CONFIDENCE_THRESHOLD = 0.50 (configurable constants).
2. Maximum concurrent probes: MAX_CONCURRENT_PROBES = 5 (configurable constant).
3. done_pending_review representation: metadata flag (pending_review: true) on in_review status, not a new board status. Items await user confirmation before transitioning to done.
4. Probe result retention window: 7 days default (configurable via PROBE_RESULT_RETENTION_DAYS).
5. Async resume mechanism: probe-side callback with API-layer atomic check. Probe writes result; API handler atomically marks terminal and emits resume event if all probes complete.
6. Domain probe dispatch condition: deterministic API-side check (`len(discovered_epics) > 0`), not LLM judgment.
7. Probe staleness: prior import_phase_session_id or older than PROBE_STALENESS_HOURS (default 24). Surfaced as probes_stale boolean on state read.

---

## 15. Suggested Follow-Up Epics

1. EPIC-140 (proposed): Evidence Graph and Cross-Artifact Traceability
2. EPIC-141 (proposed): Imported Repository Drift Detection and Continuous Reconciliation

---

## 16. Implementation Summary (2026-04-23)

### 16.1 Delivered In This Iteration

1. Import-phase aware deterministic routing (Task 0 baseline)
    - Added `imported_repo_synthesis` route in `apps/api/src/orchestration/playbook-rules.config.yaml`.
    - Implemented import-phase routing and re-bootstrap loop prevention in `apps/api/src/orchestration/playbook-router.service.ts`.
    - Added dedicated router types module in `apps/api/src/orchestration/playbook-router.types.ts`.
    - Added coverage in `apps/api/src/orchestration/playbook-router.service.spec.ts`.

2. Import lifecycle and probe state model foundation (Task 1/3/4 baseline)
    - Extended orchestration state model in `apps/api/src/project/orchestration-session-state.types.ts`:
       - `import_phase`, `import_phase_session_id`
       - typed import probe delegation contract shape
       - typed `probe_results`
       - `probes_stale` derived signal
    - Added staleness/retention/idempotency utilities in `apps/api/src/project/orchestration-session-state.helpers.ts`:
       - `PROBE_STALENESS_HOURS` defaulted to 24
       - `PROBE_RESULT_RETENTION_DAYS` defaulted to 7
       - probe idempotency key builder
       - probe staleness derivation and result upsert
    - Added helper unit coverage in `apps/api/src/project/orchestration-session-state.helpers.spec.ts`.

3. Probe result write endpoint + resume trigger (Task 2 baseline)
    - Added `write_probe_result` internal tool:
       - `apps/api/src/workflow/tools/project/write-probe-result.tool.ts`
       - registered in `apps/api/src/workflow/workflow.module.ts`
       - controller endpoint in `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
       - request contract in `apps/api/src/workflow/workflow-runtime-tools.controller.types.ts`
    - Implemented write flow in `apps/api/src/workflow/handlers/orchestration-session-tools.handler.ts`:
       - probe contract upsert
       - probe result persistence to orchestration state
       - terminal-probe detection
       - one-shot resume cycle emission using dedupe reason marker
    - Added handler tests in `apps/api/src/workflow/handlers/orchestration-session-tools.handler.spec.ts`.

4. Playbook and skill alignment (Task 8 baseline)
    - Added new playbook skill seed:
       - `seed/skills/orchestration-playbooks/imported-repo-synthesis-and-hydration/SKILL.md`
    - Updated imported bootstrap and investigation playbook instructions:
       - `seed/skills/orchestration-playbooks/imported-repo-bootstrap/SKILL.md`
       - `seed/skills/orchestration-playbooks/existing-project-investigation/SKILL.md`
    - Extended allowed `yield_session` playbook enum in `apps/api/src/workflow/tools/project/yield-session.tool.ts`.

5. Pending-review workflow guards for hydrated transitions (Task 9 partial)
    - Added hydration transition helpers:
       - `apps/api/src/project/work-item-hydration.helpers.ts`
       - `apps/api/src/project/work-item-hydration-transition-policy.helpers.ts`
       - `apps/api/src/project/work-item-hydration-transition-policy.helpers.types.ts`
    - Applied guards in status mutation flow:
       - `apps/api/src/project/work-item-service-mutations.helpers.ts`
    - Behavior delivered:
       - allows `in-review -> done` only for `metadata.pending_review === true`
       - suppresses automation for pending-review transitions into `in-review` and `done`
    - Added helper coverage:
       - `apps/api/src/project/work-item-hydration.helpers.spec.ts`

### 16.2 Verification Results

1. Targeted tests: PASS
    - `playbook-router.service.spec.ts`
    - `orchestration-session-state.helpers.spec.ts`
    - `orchestration-session-tools.handler.spec.ts`
    - `work-item-hydration.helpers.spec.ts`

2. Touched-file ESLint: PASS
    - All modified API TypeScript files in this iteration are lint-clean.

3. Build and runtime health
    - `npm run build:api`: PASS
    - `npm run build:web`: PASS
    - `docker compose up -d --build`: PASS
    - `docker compose ps`: API/Postgres/Redis healthy; Kanban/Web starting but running.

4. Repo-wide lint summary
    - `npm run lint:summary`: FAIL due pre-existing broader repository lint debt unrelated to this iteration.

### 16.3 Decisions And Tradeoffs

1. Implemented a deterministic API-owned probe result write path before full probe workflow family wiring.
2. Preserved existing orchestration architecture by extending state and runtime tools rather than introducing parallel orchestration subsystems.
3. Added resume-event dedupe marker (`last_probe_resume_reason`) to reduce duplicate resume cycles during repeated terminal writes.
4. Implemented pending-review transition guard at work-item mutation boundary to keep transition logic explicit and testable.

### 16.4 Remaining Work To Reach Full Epic DoD

1. Full probe workflow family authoring and dispatch orchestration (Tasks 5-7) in seed workflows.
2. Canonical confidence computation and complete hydration-source metadata pipeline for imported completion mapping (Task 9 complete).
3. Clarification batching integration into synthesis runtime flow (Task 10 complete).
4. Full regression suite coverage listed in Task 11, including concurrency-limit and timeout-policy scenarios.
5. API-layer transactional atomicity hardening for concurrent probe writes (single-transaction mark/check/emit semantics).
