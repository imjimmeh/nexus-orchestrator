# EPIC-075: Markdown-Canonical Planning Artifacts with Database Projection Reconciliation

Status: Proposed
Priority: P0
Created: 2026-04-11
Last Updated: 2026-04-11
Owner: TBD
Theme: Planning source-of-truth inversion, deterministic sync, and lifecycle-safe projection

---

## 1. Executive Summary

This epic makes repository markdown files the canonical source of truth for planning artifacts, while the database remains a runtime projection for fast execution and querying.

This epic also introduces work-item-local subtasks as canonical markdown artifacts.
Subtasks are not standalone kanban board items. They are nested under a parent work item,
visible in frontend work-item views, and injected into agent execution context.

Decision:

1. Planning artifacts should NOT be embedded as canonical payloads in epic files.
2. Planning artifacts should live in dedicated planning markdown files with stable identity and revision lineage.
3. Epic files should remain summary/index documents that link to canonical planning artifacts.

This aligns with EPIC-074's direction (markdown first, DB second) and applies the same ownership split to planning:

1. Markdown canonical: PM preflight output, architect preflight output, implementation plans, delta replan artifacts, plan lineage metadata.
2. DB canonical: runtime lifecycle state (status, execution links, assignment, waiting-for-input, token spend, counters, transient metadata used by running jobs).

Subtask boundary for this epic:

1. Markdown canonical: subtask definition content, ordering/dependency metadata, and lineage.
2. DB canonical: projected subtask read model and runtime completion/progress state used by UI and agents.

---

## 2. Problem Statement

Current planning behavior writes planning data directly into database fields:

1. `metadata.preflight.*`
2. `execution_config.implementationPlan`
3. `execution_config.rejectionFeedback` and related counters for rejection cycles

This creates DB-first planning semantics even when repository markdown is intended as primary source for project truth. As a result:

1. Planning history is hard to diff/review in git.
2. Plan lineage is difficult to track across revisions and replan cycles.
3. Runtime mutation paths and canonical documentation paths diverge.
4. There is no canonical, non-board subtask model that is visible to both frontend and agents.

---

## 3. Strategy Decision (Options)

### Option 1: Put planning payload into epic files

Pros:

1. Fewer files.
2. Familiar docs location.

Cons:

1. High merge-conflict risk.
2. Epics become overloaded and noisy.
3. Poor per-work-item lineage and auditability.
4. Hard to drive deterministic reconcile at scale.

Decision: Rejected as canonical store.

### Option 2: Put planning payload into dedicated planning markdown files

Pros:

1. Clean per-item ownership and git history.
2. Deterministic reconcile inputs.
3. Easy review/diff/rollback.

Cons:

1. Requires schema, parser, and reconcile engine.
2. Requires workflow rewiring and migration.

Decision: Accepted as canonical store.

### Option 3: Hybrid model (recommended)

1. Canonical planning payload lives in dedicated planning markdown files.
2. Epic files hold high-level summary, status, and links to canonical planning files.
3. Database stores projected, runtime-safe views used by workflows/UI.

Decision: Accepted.

---

## 4. Goals

1. Make markdown files canonical for planning artifacts.
2. Add deterministic, idempotent planning reconcile from repo to DB projection.
3. Preserve current workflow runtime behavior while migrating write paths.
4. Remove direct DB-first planning payload writes after cutover.
5. Keep runtime lifecycle ownership boundaries explicit and enforced.
6. Introduce work-item-local subtasks that do not appear as separate board cards.
7. Make subtasks first-class in frontend work-item detail and agent execution context.

---

## 5. Non-Goals

1. Making markdown canonical for runtime status transitions in this epic.
2. Eliminating DB projection reads in one step.
3. Redesigning the entire workflow stage graph.
4. Replacing rejection routing policy logic in this phase.
5. Treating subtasks as standalone dispatchable work items.
6. Creating subtask-level branches, merge flows, or independent kanban lifecycles.

---

## 6. Canonical Planning Contract

### 6.1 Proposed file layout

Canonical planning artifacts are stored per work item under repository paths:

1. `docs/work-items/<work-item-id>/planning/<plan-id>.md`
2. Optional index: `docs/work-items/<work-item-id>/planning/index.md`
3. Subtasks: `docs/work-items/<work-item-id>/subtasks/<subtask-id>.md`

Alternate pathing can be accepted if deterministic and policy-approved, but one canonical convention is required.

### 6.2 Required frontmatter (draft)

1. `plan_id` (stable unique id)
2. `work_item_id` (stable reference)
3. `plan_type` (`preflight_pm`, `preflight_architect`, `implementation_plan`, `delta_replan`)
4. `supersedes_plan_id` (optional lineage)
5. `source_workflow_id`
6. `source_workflow_run_id`
7. `source_job_id`
8. `source_step_id` (optional)
9. `created_at`
10. `content_hash`
11. `status` (`active`, `superseded`, `archived`)

### 6.3 Body contract

Structured markdown sections with deterministic extraction of:

1. Summary
2. Task list (ids, sequencing/dependencies)
3. Delegation strategy (`self` vs `subagent`) when relevant
4. Acceptance targets
5. Risks/constraints

For preflight artifacts, sections map to existing PM and architect fields used by implementation prompts.

### 6.4 Subtask contract (draft)

Canonical subtask markdown must include stable identity and parent binding.

Required frontmatter:

1. `subtask_id` (stable unique id)
2. `work_item_id` (stable parent work item id)
3. `title`
4. `order_index` (deterministic default rendering order)
5. `status` (`todo`, `in_progress`, `done`, `blocked`)
6. `depends_on_subtask_ids` (optional)
7. `content_hash`
8. `updated_at`

Body sections (minimum):

1. Overview
2. Acceptance criteria
3. Notes/constraints

Subtasks remain children of the parent work item only. They are never promoted into top-level kanban cards.

---

## 7. Reconcile and Ownership Model

### 7.1 Reconcile semantics

The planning reconcile loop computes:

1. Create projection: no DB plan projection exists for canonical markdown artifact.
2. Update projection: canonical artifact changed hash/version.
3. Supersede projection: new canonical artifact supersedes an active plan.
4. Archive projection: canonical artifact removed or marked archived.
5. No-op: canonical and DB projection already aligned.

### 7.2 Ownership boundaries

Reconcile can mutate only planning projection fields, not runtime-owned fields.

Allowed mutation scope (phase 1 compatibility mode):

1. `metadata.preflight.*`
2. `execution_config.implementationPlan`
3. planning lineage metadata fields introduced for projection bookkeeping

Protected runtime fields:

1. `status`
2. `assigned_agent_id`
3. `current_execution_id`
4. `waiting_for_input`
5. token/cost counters
6. active lifecycle markers unrelated to planning definition content

### 7.3 Subtask projection semantics

Planning reconcile also reconciles subtask artifacts into a DB read model keyed by:

1. `work_item_id`
2. `subtask_id`

Actions:

1. Create subtask projection for new canonical subtask files.
2. Update projection on content/status/order/dependency change.
3. Archive projection when canonical subtask file is removed/archived.

Invariant:

1. Subtask projection rows must never be treated as top-level work items for dispatch/board grouping.

---

## 8. Workstreams and Tasks

### WS1: Canonical Planning Schema and Validation

#### Task E075-001: Define planning markdown schema with stable identity and lineage

Acceptance Criteria:

1. Stable identity and supersession fields are required.
2. Parser rejects ambiguous or malformed artifacts with actionable diagnostics.
3. Contract docs are published and linked from workflow authoring docs.

#### Task E075-002: Define deterministic path policy and naming convention

Acceptance Criteria:

1. Canonical pathing is deterministic and enforced.
2. Validation rejects out-of-policy or colliding plan paths.

---

### WS2: Planning Reconcile Engine

#### Task E075-003: Implement planning reconcile create/update/supersede/archive

Acceptance Criteria:

1. Reconcile output includes per-artifact action and reason.
2. Supersession updates active-plan pointers deterministically.
3. Reconcile is safe and idempotent.

#### Task E075-004: Add hash-driven no-op behavior and projection metadata

Acceptance Criteria:

1. No-op runs perform zero writes.
2. Projection records persist source path/id/hash/last synced metadata.

---

### WS3: Workflow Rewiring to Markdown-First Planning Writes

#### Task E075-005: Update refinement workflow path to emit canonical planning files then reconcile

Acceptance Criteria:

1. PM and architect planning outputs become canonical markdown artifacts first.
2. Reconcile runs before transition to `in-progress`.
3. Failure diagnostics clearly separate authoring vs reconcile failures.

#### Task E075-006: Update in-progress planning and delta-replan path to canonical files then reconcile

Acceptance Criteria:

1. Large-scope planning and delta-replan produce canonical planning artifacts.
2. Implementation step consumes reconciled projection with no behavior loss.

---

### WS4: Runtime and UI Compatibility Layer

#### Task E075-007: Maintain compatibility projection for existing runtime/UI consumers

Acceptance Criteria:

1. Existing runtime prompts continue reading required planning context.
2. Existing UI plan/preflight views remain functional.
3. Projection mapping from canonical markdown is documented.

#### Task E075-008: Introduce read-path telemetry to prove canonical source adoption

Acceptance Criteria:

1. Telemetry identifies source type (`canonical_markdown` vs `legacy_projection`) during migration.
2. Migration dashboard/reporting supports cutover verification.

---

### WS5: Hard Removal of DB-First Planning Payload Writes

#### Task E075-009: Remove direct DB write behavior for planning payload actions

Acceptance Criteria:

1. Direct writes in planning mutation handlers are removed.
2. Planning persistence path is markdown artifact plus reconcile only.
3. No compatibility aliases for direct DB-first planning writes.

#### Task E075-010: Remove obsolete planning mutation contracts from runtime/tooling

Acceptance Criteria:

1. Tool contracts and workflow action paths are updated to canonical-first semantics.
2. Stale contracts fail validation fast.

---

### WS6: Backfill and Drift Handling

#### Task E075-011: Backfill canonical planning markdown from existing DB planning data

Acceptance Criteria:

1. Existing planning payloads are exported into canonical files with stable ids.
2. Backfill is deterministic and repeatable.
3. Post-backfill reconcile yields expected no-op for unchanged artifacts.

#### Task E075-012: Define orphan and drift policy for planning artifacts

Acceptance Criteria:

1. Policy covers DB-only projection rows and markdown-only artifacts.
2. Reconcile reports policy outcomes explicitly.

---

### WS7: Tests, Rollout, and Operational Readiness

#### Task E075-013: Add unit/integration tests for parser and reconcile behavior

Acceptance Criteria:

1. Tests cover validation, identity, supersession, and no-op logic.
2. Tests cover projection field ownership boundaries.

#### Task E075-014: Add E2E planning lifecycle scenarios

Acceptance Criteria:

1. Preflight authoring -> reconcile -> implementation consumes projected planning context.
2. Delta replan authoring -> reconcile -> targeted implementation behavior persists.
3. Planning markdown edits reconcile deterministically without runtime corruption.

#### Task E075-015: Cutover plan and rollback playbook

Acceptance Criteria:

1. Dry-run and apply-run procedures documented.
2. Removal verification checklist for DB-first planning writes documented.
3. Rollback and recovery procedure documented.

---

### WS8: Work Item Subtask Canonicalization

#### Task E075-016: Define canonical subtask markdown schema and identity rules

Acceptance Criteria:

1. Canonical schema includes stable `subtask_id` and `work_item_id`.
2. Parser validates parent binding, duplicate identity, and deterministic ordering.
3. Schema supports optional subtask dependency declarations.

#### Task E075-017: Implement subtask reconcile create/update/archive behavior

Acceptance Criteria:

1. Reconcile reports per-subtask actions and diagnostics.
2. Reconcile is idempotent for unchanged subtask artifacts.
3. Projection retains source path/hash/last synced metadata.

#### Task E075-018: Enforce non-board invariant for subtasks

Acceptance Criteria:

1. Subtasks are excluded from kanban board column queries and dispatch candidate selection.
2. Regression tests verify subtasks cannot be treated as standalone board items.

---

### WS9: Frontend and Agent Subtask Visibility

#### Task E075-019: Add API and realtime payload support for nested subtasks

Acceptance Criteria:

1. Work-item API responses include subtask summaries and detail payloads.
2. Realtime updates include subtask changes for the parent work item.
3. API contracts/documentation include subtask shapes.

#### Task E075-020: Add frontend subtask visibility in work-item detail surfaces

Acceptance Criteria:

1. Work-item detail panel renders subtasks with status and progress.
2. Board cards remain unchanged as top-level work-item cards only.
3. UX supports scalable rendering for large subtask sets (pagination/collapse as needed).

#### Task E075-021: Inject subtasks into agent execution and review context

Acceptance Criteria:

1. Refinement, implementation, and review prompts can access parent work item subtasks.
2. Agent context includes deterministic subtask ordering and status state.
3. Existing prompt paths continue to work when no subtasks exist.

---

### Workstream Child Work Item Coverage

Each workstream in this epic has explicit child work-item markdown specs in `docs/work-items/`.

1. WS1: `E075-001`, `E075-002`
2. WS2: `E075-003`, `E075-004`
3. WS3: `E075-005`, `E075-006`
4. WS4: `E075-007`, `E075-008`
5. WS5: `E075-009`, `E075-010`
6. WS6: `E075-011`, `E075-012`
7. WS7: `E075-013`, `E075-014`, `E075-015`
8. WS8: `E075-016`, `E075-017`, `E075-018`
9. WS9: `E075-019`, `E075-020`, `E075-021`

Child item files:

1. `docs/work-items/TASK-e075-001-planning-schema-and-lineage.md`
2. `docs/work-items/TASK-e075-002-path-policy-and-naming-convention.md`
3. `docs/work-items/TASK-e075-003-planning-reconcile-create-update-supersede-archive.md`
4. `docs/work-items/TASK-e075-004-hash-noop-and-projection-metadata.md`
5. `docs/work-items/TASK-e075-005-refinement-flow-canonical-authoring-and-reconcile.md`
6. `docs/work-items/TASK-e075-006-in-progress-plan-and-delta-replan-canonicalization.md`
7. `docs/work-items/TASK-e075-007-runtime-ui-compatibility-projection.md`
8. `docs/work-items/TASK-e075-008-read-path-source-telemetry.md`
9. `docs/work-items/TASK-e075-009-remove-direct-db-planning-write-paths.md`
10. `docs/work-items/TASK-e075-010-remove-obsolete-planning-contracts.md`
11. `docs/work-items/TASK-e075-011-backfill-canonical-planning-files.md`
12. `docs/work-items/TASK-e075-012-orphan-and-drift-policy.md`
13. `docs/work-items/TASK-e075-013-parser-and-reconcile-test-coverage.md`
14. `docs/work-items/TASK-e075-014-e2e-planning-lifecycle-scenarios.md`
15. `docs/work-items/TASK-e075-015-cutover-and-rollback-playbook.md`
16. `docs/work-items/TASK-e075-016-subtask-schema-and-identity-rules.md`
17. `docs/work-items/TASK-e075-017-subtask-reconcile-behavior.md`
18. `docs/work-items/TASK-e075-018-subtask-non-board-invariant.md`
19. `docs/work-items/TASK-e075-019-api-and-realtime-nested-subtask-payloads.md`
20. `docs/work-items/TASK-e075-020-frontend-subtask-visibility-in-work-item-detail.md`
21. `docs/work-items/TASK-e075-021-agent-context-injection-for-subtasks.md`

---

## 9. Epic Acceptance Criteria

1. Planning artifacts are canonical in repository markdown files.
2. DB planning data is projection-only and reconciled from markdown artifacts.
3. Direct DB-first planning write paths are removed.
4. Runtime lifecycle behavior remains stable (dispatch/refinement/in-progress/review/merge).
5. Reconcile is idempotent, observable, and operationally documented.
6. Each work item can own canonical subtasks that do not appear as separate board items.
7. Subtasks are visible in frontend work-item views and available to agent runtime context.

---

## 10. Risks and Mitigations

| Risk                                          | Mitigation                                                  |
| --------------------------------------------- | ----------------------------------------------------------- |
| Planning artifact schema churn during rollout | Versioned contract and strict parser diagnostics            |
| Runtime regressions when write path changes   | Compatibility projection layer and staged cutover           |
| Active-run planning drift                     | Ownership guardrails and active-run safety policy           |
| Workflow seeds lagging contract changes       | Validation gate in seed/workflow contract tests             |
| Subtasks leak into board/dispatch flows       | Explicit non-board invariant checks and regression coverage |

---

## 11. Related

1. [EPIC-074: Markdown-Canonical Work Item Definitions with Database Reconciliation](EPIC-074-markdown-canonical-work-item-definitions.md)
2. [EPIC-053: Pre-Flight Planning Pipeline (PM -> Architect -> Developer)](EPIC-053-pre-flight-planning-pipeline-pm-architect.md)
3. [EPIC-045: Adaptive Scope - Parallel Subagents](EPIC-045-adaptive-scope-parallel-subagents.md)
4. [EPIC-034: Workflow-Driven Kanban Lifecycle](EPIC-034-workflow-driven-kanban-lifecycle.md)
5. [EPIC-040: Epic -> Child Work Item Lifecycle Management](EPIC-040-epic-child-lifecycle-management.md)
