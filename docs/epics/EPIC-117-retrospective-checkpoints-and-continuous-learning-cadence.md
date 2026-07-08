# EPIC-117: Retrospective Checkpoints and Continuous Learning Cadence

Status: Proposed  
Priority: P1  
Depends On: EPIC-065, EPIC-067, EPIC-084, EPIC-107  
Created: 2026-04-18  
Last Updated: 2026-04-18  
Owner: TBD  
Theme: Project lifecycle learning, retrospective cadence, and practical in-flight improvement

---

## 1. Executive Summary

Move retrospective generation from completion-only behavior to a lifecycle checkpoint model that produces useful learning during active project execution, not only at final completion.

This epic introduces phase-aligned retrospective triggers, deterministic idempotency and cooldown controls, incremental signal-delta gates, and scoped UI/API diagnostics so project learning remains useful across long-running orchestration cycles.

---

## 2. Problem Statement

Current behavior is valid but too sparse for practical use in active projects:

1. Automated retrospective generation is tied to orchestration completion.
2. Completion is intentionally strict and can be delayed by many valid guardrails.
3. Memory learning sweeps depend on retrospective output as a key input stream.
4. When no retrospective history exists yet, learning candidates and proposals remain empty.
5. Project-level learning surfaces are perceived as non-functional during most of the project lifecycle.

The result is a mismatch between user expectations of continuous project learning and an implementation that primarily learns only at the very end.

---

## 3. Goals

1. Generate retrospective lessons at multiple meaningful lifecycle checkpoints.
2. Keep signal quality high with dedupe, cooldown, and minimum-delta gating.
3. Preserve completion retrospective as the final comprehensive synthesis.
4. Improve usefulness of project-scoped learning and diagnostics during active execution.
5. Maintain deterministic behavior and avoid retrospective spam.
6. Keep architecture aligned with existing event-driven orchestration boundaries.

---

## 4. Non-Goals

1. Replacing the existing completion guardrails.
2. Removing completion-triggered retrospective behavior.
3. Building unrestricted autonomous prompt or skill editing.
4. Replacing the existing memory-learning sweep architecture.
5. Redesigning the entire project workspace UI unrelated to retrospective and learning visibility.

---

## 5. Current-State Baseline

1. Retrospective automation is completion-triggered.
2. Manual replay exists and is surfaced in runtime diagnostics.
3. Lifecycle milestone events already exist for specs-ready and bootstrap-completed.
4. Project phase detection already models new, discovery, specs_ready, work_items_created, in_progress, nearing_completion, and complete.
5. Learning sweep and proposal governance pipelines already exist and are operational.

This epic extends cadence and data freshness, not core retrospective existence.

---

## 6. Target End-State Behavior

1. Retrospective checkpoint runs occur on selected lifecycle transitions and phase promotions.
2. Each checkpoint run stores trigger reason, scope, and run metadata.
3. Repeated identical checkpoint triggers are deduped by deterministic keys.
4. Retrospective runs are skipped when no meaningful delta exists since prior run.
5. Completion retrospective still runs as final synthesis and remains authoritative.
6. Learning sweep consumes richer and fresher retrospective history over project lifetime.
7. Learning UI clearly distinguishes checkpoint-derived signals versus final completion synthesis.

---

## 7. Trigger and Cadence Model

### 7.1 Trigger Matrix

Checkpoint triggers to implement:

1. specs_ready
2. bootstrap_completed
3. phase_promoted_to_nearing_completion
4. completion_event (existing, retained)
5. manual_replay (existing, retained)

Optional future triggers (out of initial implementation scope, track as follow-up):

1. high_qa_rejection_burst
2. prolonged_blocked_work_items
3. large_rework_cycle_detected

### 7.2 Trigger Semantics

1. specs_ready: early planning quality checkpoint.
2. bootstrap_completed: post-bootstrap execution readiness checkpoint.
3. nearing_completion: late-cycle quality and release-readiness checkpoint.
4. completion_event: final project synthesis checkpoint.

### 7.3 Cooldown Rules

1. Global minimum interval between automatic checkpoint retrospectives per project.
2. Per-trigger-type cooldown window.
3. Manual replay bypasses cooldown when explicitly requested by operator.

---

## 8. Idempotency and Delta Gates

### 8.1 Idempotency Key

Use deterministic key shape:

1. project_id
2. orchestration_id
3. trigger_type
4. trigger_revision_marker

Suggested revision marker sources:

1. decision log length snapshot
2. work item status checksum
3. latest workflow run id or completion marker

### 8.2 Minimum-Delta Gate

Skip retrospective generation when changes since prior run do not meet threshold.

Delta indicators:

1. New done or merged work item count
2. New failed or denied orchestration events
3. New QA rejection evidence
4. New completed workflow runs
5. Meaningful change in completion readiness blockers

### 8.3 Skip Reasons (First-Class)

Record explicit skip reasons for diagnostics and observability:

1. duplicate_trigger
2. cooldown_active
3. insufficient_delta
4. autorun_disabled

---

## 9. Architecture Changes

### 9.1 API and Orchestration Layer

1. Extend retrospective trigger handling beyond completion-only listener.
2. Add event listeners for milestone events already emitted by orchestration lifecycle.
3. Add phase transition observer to emit retrospective checkpoint request when moving into nearing_completion.
4. Preserve manual replay endpoint and behavior.

### 9.2 Retrospective Service

1. Expand trigger enum and metadata schema.
2. Add checkpoint policy evaluator that applies idempotency, cooldown, and delta gates.
3. Store per-trigger last-run metadata for deterministic decisions.
4. Distinguish checkpoint runs from final synthesis in persisted metadata.

### 9.3 Memory Learning Integration

1. Ensure checkpoint lessons are queryable as history memory without contract break.
2. Add optional trigger metadata fields to lesson payload for ranking diagnostics.
3. Keep learning candidate and proposal pipelines backward compatible.

### 9.4 Web UI and Diagnostics

1. Show retrospective checkpoint history in runtime capability diagnostics.
2. Surface last checkpoint trigger, skip reason, and cooldown state.
3. Improve Learning tab context text to explain why candidate/proposal lists may be empty.
4. Add project-scoped filtering defaults that emphasize current-project learning first.

---

## 10. Configuration and Policy Controls

Add configurable controls with safe defaults:

1. RETROSPECTIVE_CHECKPOINTS_ENABLED (default true)
2. RETROSPECTIVE_CHECKPOINT_TRIGGER_TYPES (default specs_ready,bootstrap_completed,nearing_completion,completion_event)
3. RETROSPECTIVE_CHECKPOINT_GLOBAL_COOLDOWN_SECONDS (default 21600)
4. RETROSPECTIVE_CHECKPOINT_PER_TRIGGER_COOLDOWN_SECONDS (structured map)
5. RETROSPECTIVE_CHECKPOINT_MIN_DELTA_WORK_ITEMS_DONE (default 1)
6. RETROSPECTIVE_CHECKPOINT_MIN_DELTA_FAILURE_EVENTS (default 1)
7. RETROSPECTIVE_CHECKPOINT_ALLOW_MANUAL_BYPASS (default true)

Policy precedence should remain compatible with existing retrospective settings.

---

## 11. Data Contract Changes

### 11.1 Retrospective Metadata Extensions

Persist structured metadata additions in orchestration metadata and/or retrospective run records:

1. last_trigger_type
2. last_triggered_at
3. last_skip_reason
4. checkpoint_history_summary
5. last_delta_snapshot

### 11.2 Optional New Table (Recommended)

Introduce a dedicated retrospective_runs table for auditability and analytics.

Columns:

1. id
2. project_id
3. orchestration_id
4. trigger_type
5. trigger_revision_marker
6. status
7. skip_reason
8. lesson_count
9. delta_snapshot_json
10. started_at
11. completed_at
12. created_at

This avoids overloading orchestration metadata for multi-run history.

---

## 12. API and UX Contract Updates

1. Extend diagnostics payload with checkpoint policy and history summary.
2. Extend retrospective replay response with run mode and trigger classification.
3. Add optional endpoint to list retrospective run history for a project.
4. Update project workspace diagnostics and learning copy to reflect checkpoint behavior.

---

## 13. Workstreams and Task Backlog

### WS1: Trigger Expansion and Event Wiring

1. E117-001 Add checkpoint trigger types to retrospective service contracts.
2. E117-002 Wire specs_ready trigger to retrospective checkpoint request.
3. E117-003 Wire bootstrap_completed trigger to retrospective checkpoint request.
4. E117-004 Add nearing_completion phase promotion trigger.
5. E117-005 Preserve completion and manual trigger behavior with no regressions.

### WS2: Policy Engine for Dedupe, Cooldown, and Delta

1. E117-006 Implement deterministic idempotency key strategy.
2. E117-007 Implement global and per-trigger cooldown policy checks.
3. E117-008 Implement minimum-delta evaluator.
4. E117-009 Emit explicit skip reason telemetry and diagnostics fields.

### WS3: Persistence and Query Model

1. E117-010 Add retrospective run history persistence model.
2. E117-011 Add migration and repository methods for retrospective run history.
3. E117-012 Backfill minimal derived history from existing metadata where practical.

### WS4: Learning Pipeline Integration

1. E117-013 Ensure checkpoint lessons are included in learning sweep collection.
2. E117-014 Add ranking diagnostics for trigger_type influence analysis.
3. E117-015 Validate candidate and proposal quality under increased cadence.

### WS5: API and Frontend Visibility

1. E117-016 Extend diagnostics API contracts for checkpoint visibility.
2. E117-017 Update runtime capability health card with checkpoint details.
3. E117-018 Update Learning tab explanatory copy and project-first filtering defaults.
4. E117-019 Add UI tests for checkpoint history rendering and replay interactions.

### WS6: Operations and Governance

1. E117-020 Add runbook updates for checkpoint cadence controls and troubleshooting.
2. E117-021 Add safe rollout toggles and staged enablement guidance.
3. E117-022 Add quality guard metrics and alert thresholds.

### WS7: Testing and Regression Coverage

1. E117-023 Unit tests for trigger policy decisions and skip reasons.
2. E117-024 Integration tests for lifecycle trigger to retrospective flow.
3. E117-025 Deterministic e2e scenario for in-flight checkpoint learning visibility.
4. E117-026 Regression tests for completion-only final synthesis retention.

---

## 14. Acceptance Criteria

1. At least three automatic checkpoint trigger types run in addition to completion.
2. Duplicate or noisy triggers are skipped with explicit machine-readable reasons.
3. Cooldown and minimum-delta policies are configurable and enforced.
4. Retrospective diagnostics expose trigger type, skip reason, and checkpoint history.
5. Learning pipeline produces non-empty candidate flow during active projects in deterministic test scenarios.
6. Completion-triggered final retrospective still runs and remains stable.
7. API lint, build, and targeted tests pass for touched modules.

---

## 15. Verification Strategy

1. Unit tests for idempotency and cooldown policy matrix.
2. Unit tests for delta gate edge cases.
3. Integration tests for each automatic checkpoint trigger.
4. Integration tests for skip reason observability.
5. UI tests for diagnostics and learning checkpoint visibility.
6. Deterministic scenario proving learning candidates appear before completion.

Suggested command set:

1. npm run lint:api
2. npm run test:api -- project-retrospective
3. npm run test:api -- learning-memory
4. npm run lint:web
5. npm run test:unit:web -- project-workspace
6. npm run test:e2e:kanban:deterministic

---

## 16. Rollout Plan

Phase 1:

1. Ship contracts, policy engine, and diagnostics fields behind feature flags.
2. Enable only specs_ready checkpoints in non-production.

Phase 2:

1. Enable bootstrap_completed and nearing_completion triggers.
2. Monitor candidate quality and proposal precision.

Phase 3:

1. Enable full trigger matrix by default.
2. Keep completion final synthesis mandatory.

Rollback strategy:

1. Disable checkpoint trigger set via config without disabling manual replay.
2. Preserve generated retrospective history for audit and postmortem analysis.

---

## 17. Metrics and Observability

Track:

1. Retrospective runs by trigger_type and outcome.
2. Skip reason distribution.
3. Average delta magnitude per successful checkpoint run.
4. Time from project start to first learning candidate.
5. Candidate-to-proposal and proposal-to-approved conversion rates.
6. Repeat QA rejection rate before and after checkpoint cadence rollout.

---

## 18. Risks and Mitigations

1. Risk: excessive retrospective noise from over-triggering.
   Mitigation: strict cooldown and minimum-delta gates with conservative defaults.
2. Risk: lower lesson quality due to early-stage sparse signals.
   Mitigation: confidence weighting by trigger_type and source richness.
3. Risk: added complexity in orchestration lifecycle.
   Mitigation: isolate policy engine and keep trigger wiring declarative.
4. Risk: operator confusion around skip behavior.
   Mitigation: explicit skip reason diagnostics and runbook guidance.

---

## 19. Open Questions

1. Should nearing_completion trigger fire on first phase entry only, or on every re-entry after regression?
2. Should project-level cooldown values be customizable per orchestration mode?
3. Should checkpoint lessons be tagged as provisional until completion synthesis confirms them?
4. Should learning sweep weight completion-sourced lessons higher than checkpoint-sourced lessons?

---

## 20. References

1. docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md
2. docs/epics/EPIC-067-memory-driven-learning-and-automated-retrospectives.md
3. docs/epics/EPIC-084-autonomous-memory-dreaming-and-skill-self-improvement.md
4. docs/epics/EPIC-107-frontend-memory-visibility-and-exploration.md
5. apps/api/src/project/project-retrospective.service.ts
6. apps/api/src/project/project-orchestration-events.service.ts
7. apps/api/src/project/project-phase-detector.service.ts
8. apps/web/src/components/orchestration/OrchestrationCapabilityHealthCard.tsx
