# EPIC-074: Markdown-Canonical Work Item Definitions with Database Reconciliation

Status: Proposed
Priority: P0
Created: 2026-04-11
Last Updated: 2026-04-11
Owner: TBD
Theme: Work item source-of-truth inversion, deterministic sync, and mutation-path simplification

---

## 1. Executive Summary

This epic makes repository markdown files the canonical source of truth for work item definitions and updates the database from those files through deterministic reconciliation.

This epic explicitly adopts a definition-only boundary:

1. Markdown is canonical for definition fields (title, description/spec body, priority, scope, dependency declarations, and source identity).
2. Database remains canonical for runtime lifecycle state (status, active execution linkage, assignment, telemetry counters, and runtime metadata).

This epic also requires hard removal of all DB-first creation paths. They are not deprecated, hidden, or soft-disabled. They are removed.

---

## 2. Context and Current-State Analysis

### 2.1 Current behavior

1. Work item records are persisted in the database table backing the WorkItem entity.
2. Markdown can be referenced and used for hydration, but hydration is currently create-oriented and not a full canonical reconcile loop.
3. Runtime and API paths still allow direct DB-first creation:
   - Project work item REST create and bulk create endpoints.
   - Runtime orchestration create_work_items action path.
   - Telemetry compatibility create_work_items path.

### 2.2 Problem

The platform currently supports markdown-driven hydration but still treats DB-first creation as a first-class write path. This creates split-brain semantics:

1. Definitions can originate in DB without canonical markdown.
2. Reconcile behavior is partial and not authoritative.
3. Operator and agent behavior can diverge depending on which creation path is used.

### 2.3 Design constraints to preserve

1. Preserve workflow-driven kanban status automation and transition validation.
2. Preserve dependency-aware dispatch behavior.
3. Preserve real-time updates and event ledger observability.
4. Preserve deterministic orchestration behavior under replay/restart.

---

## 3. Goals

1. Make markdown files in repository canonical for work item definitions.
2. Introduce deterministic, idempotent reconcile from markdown to DB projection.
3. Remove DB-first creation interfaces entirely.
4. Keep lifecycle runtime state in DB (definition-only canonicalization for this phase).
5. Make create/update/archive decisions explainable via reconcile output and telemetry.

---

## 4. Non-Goals

1. Making markdown canonical for runtime status or execution state in this phase.
2. Bi-directional sync from DB back to markdown as a steady-state behavior.
3. Retaining legacy DB-first creation endpoints behind feature flags.
4. Maintaining backward-compatible create_work_items mutation semantics.

---

## 5. Scope Overview

This epic is delivered in seven workstreams:

1. WS1: Canonical Markdown Definition Contract
2. WS2: Deterministic Reconciliation Engine
3. WS3: Workflow Rewiring to Markdown-First Creation
4. WS4: Hard Removal of DB-First Creation Paths
5. WS5: Migration and Backfill to Canonical Markdown
6. WS6: Guardrails and Observability
7. WS7: Tests, Rollout, and Operational Readiness

---

## 6. Desired End-State Behavior

1. New work item definitions are authored as markdown files in the repository.
2. A reconcile operation computes create/update/archive changes and applies them to DB projection rows.
3. Reconcile is idempotent and safe to run repeatedly.
4. No public API, runtime tool action, or telemetry compatibility path can create work items directly in DB from ad hoc payloads.
5. Existing lifecycle operations continue to mutate runtime state in DB without mutating definition source files.

---

## 7. Workstreams and Detailed Tasks

### WS1: Canonical Markdown Definition Contract

#### Task E074-001: Define canonical frontmatter schema with stable identity

Description:
Define the markdown contract for canonical work item definitions with stable source identity independent of mutable title text.

Acceptance Criteria:

1. Contract includes stable identifier field (for example, item_id) and source version/hash support.
2. Contract includes definition fields required for projection (title, priority, scope, dependency identifiers).
3. Parser and validator reject malformed or ambiguous files with actionable diagnostics.
4. Contract is documented in architecture/docs and linked from workflow authoring guidance.

#### Task E074-002: Normalize and validate dependency declarations by stable identity

Description:
Move dependency mapping away from title matching and slug ambiguity to stable identifiers.

Acceptance Criteria:

1. Dependencies resolve deterministically by canonical identity.
2. Cycles and unresolved dependencies surface explicit reconcile errors.
3. Reconcile can run in dry-run mode and report dependency resolution outcomes.

---

### WS2: Deterministic Reconciliation Engine

#### Task E074-003: Implement reconcile algorithm for create/update/archive

Description:
Replace create-only hydration behavior with full reconciliation semantics.

Acceptance Criteria:

1. Missing DB rows for canonical files are created.
2. Changed canonical definitions update DB projection fields.
3. Missing canonical files for previously canonical rows are archived or removed per defined policy.
4. Reconcile output includes counts and per-item action summaries.

#### Task E074-004: Make reconcile idempotent and hash-driven

Description:
Track source hash/version metadata in DB projection to avoid noisy writes.

Acceptance Criteria:

1. No-op reconcile produces zero DB writes.
2. Reconcile writes only when canonical content changes.
3. Source metadata fields (source path, source id, source hash, last synced) are persisted.

---

### WS3: Workflow Rewiring to Markdown-First Creation

#### Task E074-005: Update project bootstrap generation flow to markdown-first

Description:
Adjust bootstrap generation so agents produce canonical markdown artifacts first, then run reconcile.

Acceptance Criteria:

1. Bootstrap generation workflow no longer relies on create_work_items direct DB mutation.
2. Workflow emits/records reconcile outcome after markdown generation.
3. Failure modes clearly distinguish markdown authoring errors from reconcile errors.

#### Task E074-006: Replace post-merge hydration behavior with reconcile semantics

Description:
Update post-merge workflow from hydrate-create behavior to reconcile behavior.

Acceptance Criteria:

1. Post-merge workflow can process new, changed, and removed canonical files.
2. Workflow output reports create/update/archive actions.
3. Existing merge lifecycle chaining remains intact.

---

### WS4: Hard Removal of DB-First Creation Paths

#### Task E074-007: Remove project REST create and bulk-create endpoints for work items

Description:
Delete DB-first endpoint handlers and request DTO paths used exclusively for direct creation.

Acceptance Criteria:

1. REST routes for direct create and bulk create are removed.
2. Related controller/service wiring and tests are updated accordingly.
3. API documentation no longer advertises DB-first create operations.

#### Task E074-008: Remove runtime orchestration create_work_items mutation path

Description:
Delete create_work_items runtime action handling and related controller/service interfaces.

Acceptance Criteria:

1. Runtime orchestration action create_work_items is removed.
2. Capability manifest/catalog entries are removed.
3. Workflow/tool contracts relying on create_work_items are updated to markdown-first plus reconcile.

#### Task E074-009: Remove telemetry compatibility create_work_items path

Description:
Delete websocket compatibility path that creates work items from payloads.

Acceptance Criteria:

1. Compatibility handlers no longer perform DB-first work item creation.
2. Telemetry events for removed mutation path are retired or replaced with reconcile telemetry.
3. Regression tests cover removed behavior and replacement behavior.

Hard-removal policy note:

No deprecation shims or compatibility aliases are introduced for DB-first creation.

---

### WS5: Migration and Backfill to Canonical Markdown

#### Task E074-010: Backfill canonical markdown for existing work item definitions

Description:
Generate canonical markdown artifacts for existing work items that lack source files.

Acceptance Criteria:

1. Backfill produces deterministic file naming and stable item identity assignment.
2. Backfilled files validate against canonical schema.
3. Reconcile run after backfill yields zero unexpected diffs.

#### Task E074-011: Define orphan and drift handling policy

Description:
Formalize behavior for DB rows without canonical files and canonical files without valid projection rows.

Acceptance Criteria:

1. Policy is explicit (archive/remove/error) and implemented.
2. Policy is observable via reconcile reporting.
3. Operations runbook documents recovery procedures.

---

### WS6: Guardrails and Observability

#### Task E074-012: Add reconcile ledger events and metrics

Description:
Emit structured telemetry for reconcile runs and per-item actions.

Acceptance Criteria:

1. Reconcile emits start/success/failure events with correlation IDs.
2. Metrics include created, updated, archived, skipped, and errored counts.
3. Per-item error diagnostics are persisted for troubleshooting.

#### Task E074-013: Add safety checks for runtime-state-sensitive updates

Description:
Ensure definition updates do not corrupt active runtime lifecycle state.

Acceptance Criteria:

1. Definition reconcile does not overwrite runtime-owned state fields.
2. Active items with definition changes are handled by explicit policy (allow with warnings, gate, or queue).
3. Safety policy is tested and documented.

---

### WS7: Tests, Rollout, and Operational Readiness

#### Task E074-014: Implement unit and integration coverage for reconcile and path removals

Description:
Add focused tests for parser, reconcile decisions, and removed creation paths.

Acceptance Criteria:

1. Unit tests cover parser validation and identity/dependency resolution.
2. Integration tests cover create/update/archive reconcile behavior.
3. Tests assert removed DB-first endpoints/actions are unavailable.

#### Task E074-015: Add end-to-end canonicalization scenarios

Description:
Extend E2E suite to validate markdown-first creation and DB projection updates.

Acceptance Criteria:

1. E2E flow: markdown create -> reconcile -> DB row exists.
2. E2E flow: markdown edit -> reconcile -> DB projection updated.
3. E2E flow: markdown removal -> reconcile -> DB row archived/removed per policy.
4. E2E flow: orchestration/dispatch still works with reconciled items.

#### Task E074-016: Rollout and cutover plan

Description:
Define rollout checkpoints and rollback procedures for canonicalization cutover.

Acceptance Criteria:

1. Dry-run reconcile and apply reconcile are operationally documented.
2. Cutover checklist includes removal verification of DB-first creation paths.
3. Rollback plan is documented for reconcile regressions.

---

## 8. Implementation Impacted Areas (Initial)

1. Work item API/controller and DTO surface in project module.
2. Runtime orchestration action services and tool/controller contracts.
3. Telemetry gateway compatibility helpers.
4. Workflow seed definitions for bootstrap generation and post-merge reconciliation.
5. Work item markdown parser/hydration modules, evolved into reconcile modules.
6. Capability catalog/manifest entries for removed mutation path.
7. E2E coverage for canonical markdown lifecycle.

---

## 9. Acceptance Criteria for the Epic

1. Markdown definitions are canonical for definition fields across all supported creation and update flows.
2. Database projection is updated exclusively via deterministic reconcile from markdown.
3. DB-first creation paths are removed entirely from API/runtime/telemetry compatibility layers.
4. Runtime status and execution fields remain DB-owned and unaffected by definition-only canonicalization.
5. Reconcile behavior is idempotent, observable, and covered by unit, integration, and E2E tests.

---

## 10. Risks and Mitigations

| Risk                                                          | Mitigation                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Identity drift between old rows and new canonical files       | Require stable canonical item identity and perform one-time backfill mapping audit                                   |
| Breaking existing workflows that call create_work_items       | Update seed workflows and runtime contracts in same release unit; fail fast in validation if stale contracts persist |
| Unintended edits to runtime lifecycle fields during reconcile | Strict field ownership boundaries and guarded projection update mapper                                               |
| Large initial diff volume at cutover                          | Dry-run audit and staged reconciliation with reporting before apply mode                                             |

---

## 11. Related

1. [EPIC-037: Spec-Driven Work Item Hydration](EPIC-037-spec-driven-work-item-hydration.md)
2. [EPIC-034: Workflow-Driven Kanban Lifecycle](EPIC-034-workflow-driven-kanban-lifecycle.md)
3. [EPIC-043: Flat Work Items - Remove Hierarchy, Adopt Dependency Graph](EPIC-043-flat-work-items-dependency-graph.md)
4. [EPIC-075: Markdown-Canonical Planning Artifacts with Database Projection Reconciliation](EPIC-075-markdown-canonical-planning-artifacts.md)
