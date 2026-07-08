# EPIC-067: Memory-Driven Learning and Automated Retrospectives

Status: Proposed  
Priority: P1 (High)  
Created: 2026-04-10  
Last Updated: 2026-04-10  
Owner: TBD  
Theme: Continuous learning, orchestration quality, and recurrence prevention

---

## 1. Executive Summary

Enable the orchestrator to learn from completed projects by automatically running a retrospective workflow, distilling actionable lessons, persisting those lessons in long-term memory, and injecting relevant lessons into runtime planning context.

The objective is to reduce repeated failures (especially QA rejection loops and orchestration stalls), improve first-pass quality of dispatch/planning decisions, and create a durable memory layer that compounds over time.

---

## 2. Codebase Alignment and Gap Analysis

This epic was reviewed against the current API/workflow/memory architecture.

## 2.1 Existing Building Blocks We Can Reuse

1. Memory backend abstraction already exists:
   - `MemoryManagerService` delegates to `postgres`, `honcho`, or `dual` backends.
   - `query_memory` runtime contract is already stable and broadly available.
2. Distillation model and infrastructure already exist:
   - `distillation` queue and `DistillationConsumer` process large session trees.
   - AI model selection already supports `useCase: 'distillation'`.
3. Completion guardrails already exist:
   - Completion flows go through `ProjectCompletionValidatorService`.
   - Completion denial telemetry is already emitted.
4. Runtime context surfaces already exist:
   - `get_project_brief` and `get_project_state` are standard orchestration tools.
   - `ProjectStateSummaryService` generates markdown-oriented state context.
5. Event-driven workflow trigger system already exists:
   - Workflows can subscribe to emitted event names via YAML `trigger.type: event`.

## 2.2 Gaps vs EPIC-067 Intent

1. No completion event contract for retrospective automation:
   - There is no `ProjectOrchestrationCompletedEvent` emitted on successful completion.
2. No retrospective workflow seed:
   - No seeded workflow is dedicated to post-completion analysis.
3. No structured retrospective lesson model:
   - Memory entries are generic (`preference/fact/history`) with free-form `content`.
4. No lesson distillation pipeline for project-level outcomes:
   - Existing distillation focuses on token compression of session trees, not organizational learning.
5. No lesson-aware context injection in project brief/state:
   - `get_project_brief` and `get_project_state` do not include lessons learned.
6. No idempotent retry-safe orchestration for retrospective runs:
   - No safeguards prevent duplicate retrospectives for the same completion event.

---

## 3. Goals

1. Automatically trigger a retrospective after a project transitions to `completed`.
2. Distill high-signal lessons from orchestration decisions, workflow outcomes, and QA history.
3. Persist lessons in long-term memory using the existing memory backend abstraction.
4. Inject relevant lessons into runtime context tools used by CEO and execution agents.
5. Improve measurable outcomes across subsequent orchestration cycles.

### 3.1 Success Metrics

1. 90%+ of completed projects produce at least one persisted retrospective lesson set.
2. Reduction in repeated QA rejection patterns over rolling 30-day windows.
3. Reduction in repeated completion-denied reasons for similar project phases.
4. Lesson injection latency remains within existing runtime tool response expectations.

---

## 4. Non-Goals

1. Replacing current `query_memory` contract or capability name.
2. Replacing session dehydration/distillation behavior.
3. Introducing a separate external analytics data warehouse in this epic.
4. Full cross-project recommendation ranking UI in the web app (can be follow-up).

---

## 5. Scope Overview

This epic is split into seven workstreams:

1. WS1: Completion event and retrospective trigger plumbing
2. WS2: Retrospective data assembly and normalization
3. WS3: Distillation and lesson generation
4. WS4: Memory persistence model and retrieval semantics
5. WS5: Context injection into runtime tools
6. WS6: Observability, operations, and guardrails
7. WS7: Testing and validation

---

## 6. Target End-State Behavior

1. On successful orchestration completion, a retrospective workflow is triggered exactly once per completion transition.
2. Retrospective analysis compiles:
   - orchestration timeline signals,
   - workflow run outcomes,
   - QA decisions and rejection themes,
   - repeated blocker/failure signatures.
3. Distilled lessons are persisted as structured memory entries in project namespace (and optionally organization namespace).
4. `get_project_brief` and `get_project_state` include a curated "Lessons Learned" section scoped to current stage/task.
5. System emits telemetry for retrospective lifecycle (`started`, `succeeded`, `failed`, `skipped`, `replayed`).

---

## 7. Technical Strategy

## 7.1 Trigger Model

1. Add a new event contract for project completion (for example `ProjectOrchestrationCompletedEvent`).
2. Emit this event from the canonical completion path after guardrails pass and status is persisted.
3. Add an event-triggered retrospective workflow seed that subscribes to this event.

## 7.2 Data Sources for Retrospective Input

Primary sources:

1. Orchestration decision log from `project_orchestrations.decisionLog`.
2. Workflow runs and statuses via `WorkflowRunRepository.findByProjectId(...)`.
3. Workflow events via paged event history filtered by `projectId`.
4. Work item metadata (`qaFeedback`, rejection counts, execution metadata).

## 7.3 Distillation Approach

1. Reuse existing `distillation` model selection policy (`useCase: 'distillation'`).
2. Build a dedicated project-retrospective distillation service (separate from session compression consumer).
3. Produce normalized lesson objects with relevance tags and confidence scores.

## 7.4 Lesson Storage Format

Use memory backend abstraction and persist structured JSON payload in `content` while preserving `IMemorySegment` compatibility.

Proposed envelope in `content`:

```json
{
  "type": "retrospective_lesson",
  "project_id": "uuid",
  "lesson_id": "uuid",
  "title": "Avoid dispatching without QA policy confirmation",
  "summary": "...",
  "category": "orchestration|qa|implementation|testing|ops",
  "signals": {
    "occurrences": 3,
    "sources": ["decision_log", "workflow_events", "qa_feedback"]
  },
  "recommended_actions": ["..."],
  "relevance_tags": ["ceo", "review", "in-review", "qa_reject_loop"],
  "confidence": 0.82,
  "created_at": "ISO-8601"
}
```

## 7.5 Context Injection Strategy

1. Extend `ProjectBriefService.getProjectBrief(...)` response with `lessons_learned` (curated subset).
2. Extend `WorkflowRuntimeToolsService.getProjectState(...)` response with `lessons_learned` and include a markdown section for agent-readable context.
3. Relevance filter should use:
   - active orchestration stage,
   - tool/job context if available,
   - role tags (`ceo`, `implementation`, `review`, etc).

---

## 8. Workstreams and Detailed Tasks

### WS1: Completion Event and Retrospective Trigger Plumbing

Objective: reliably and idempotently trigger retrospective processing only when completion truly occurs.

### Task E067-001: Add project-completed orchestration event contract

Description:
Add a new event constant/class representing successful orchestration completion.

Acceptance Criteria:

1. Event contract is added under project events with typed payload including `projectId` and `orchestrationId`.
2. Event name follows existing event naming conventions.
3. Unit tests verify event emission payload shape.

References:

1. `apps/api/src/project/events/project-orchestration.events.ts`
2. `apps/api/src/project/project-orchestration.service.ts`

### Task E067-002: Emit completion event from canonical lifecycle path

Description:
Emit completion event only after completion guardrails pass and status update succeeds.

Acceptance Criteria:

1. Event is emitted once per successful transition to `completed`.
2. No event emitted when completion guardrails fail.
3. Existing completion behavior remains unchanged for callers.

References:

1. `apps/api/src/project/project-orchestration-lifecycle.operations.ts`
2. `apps/api/src/project/project-orchestration.service.ts`

### Task E067-003: Add retrospective workflow seed triggered by completion event

Description:
Create an event-driven workflow seed dedicated to retrospective generation.

Acceptance Criteria:

1. New seed parses and registers successfully.
2. Trigger uses completion event contract name exactly.
3. Seed contract tests assert expected event trigger and required jobs.

References:

1. `seed/workflows/` (new retrospective workflow YAML)
2. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
3. `apps/api/src/workflow/workflow-event-trigger.service.ts`

### Task E067-004: Add idempotency guard for retrospective kickoff

Description:
Prevent duplicate retrospectives when completion events are replayed or emitted twice.

Acceptance Criteria:

1. Duplicate completion events for same orchestration completion do not create duplicate retrospective runs.
2. Guard strategy is deterministic (for example: decision-log marker, metadata stamp, or run dedupe key).
3. Skipped duplicates emit diagnostic telemetry.

References:

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/database/repositories/workflow-run.repository.ts`
3. `apps/api/src/project/project-orchestration-decision-log.service.ts`

---

### WS2: Retrospective Data Assembly and Normalization

Objective: compile high-quality structured input for lesson distillation.

### Task E067-005: Implement retrospective data aggregation service

Description:
Create a dedicated service that assembles timeline, run history, and QA artifacts for a project.

Acceptance Criteria:

1. Aggregator returns a normalized object with deterministic keys.
2. Includes orchestration decision history, run outcomes, and work item QA metadata.
3. Supports bounded pagination/limits to avoid unbounded payload growth.

References:

1. `apps/api/src/project/project-brief.service.ts`
2. `apps/api/src/database/repositories/workflow-run.repository.ts`
3. `apps/api/src/database/repositories/workflow-event.repository.ts`
4. `apps/api/src/project/project-work-item.helpers.ts`

### Task E067-006: Define QA-history extraction contract

Description:
Standardize how `qaFeedback`, `rejectionCount`, and review outcomes are extracted and summarized.

Acceptance Criteria:

1. Extraction handles missing/malformed metadata safely.
2. Includes aggregate counters (accept/reject counts, repeated rejection reasons).
3. Output is stable for downstream distillation prompts.

References:

1. `apps/api/src/project/work-item-submit-qa.helpers.ts`
2. `apps/api/src/project/project-work-item.helpers.ts`
3. `apps/api/src/database/entities/work-item.entity.ts`

---

### WS3: Distillation and Lesson Generation

Objective: generate practical, role-aware lessons from retrospective input.

### Task E067-007: Add project retrospective distillation service

Description:
Implement a service that transforms normalized retrospective input into lesson records.

Acceptance Criteria:

1. Distillation service is separate from session-tree compression logic.
2. Uses configured distillation model with existing AI config precedence.
3. Produces structured lessons with categories, confidence, and recommended actions.

References:

1. `apps/api/src/memory/distillation.consumer.ts`
2. `apps/api/src/memory/llm.service.ts`
3. `apps/api/src/ai-config/ai-configuration.service.ts`

### Task E067-008: Add role/stage relevance ranking for lessons

Description:
Rank and filter lessons for CEO vs implementation/review contexts.

Acceptance Criteria:

1. Ranking function is deterministic and test-covered.
2. Supports stage-aware filtering (`discovery`, `implementation`, `review`, `merge`, etc).
3. Falls back gracefully when stage is unknown.

References:

1. `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`
2. `apps/api/src/project/project-phase-detector.service.ts`
3. `apps/api/src/project/project-state-summary.service.ts`

---

### WS4: Memory Persistence Model and Retrieval Semantics

Objective: persist lessons in durable memory without breaking existing contracts.

### Task E067-009: Persist project-level lesson entries through MemoryManagerService

Description:
Store retrospective lessons as memory segments under project namespace.

Acceptance Criteria:

1. Lessons are persisted via `MemoryManagerService` (backend-agnostic).
2. Retrieval works in `postgres`, `honcho`, and `dual` modes.
3. Memory type choice is documented and consistent.

References:

1. `apps/api/src/memory/memory-manager.service.ts`
2. `apps/api/src/memory/postgres-memory-backend.service.ts`
3. `apps/api/src/memory/honcho-memory-backend.service.ts`

### Task E067-010: Add optional organization-level knowledge mirror

Description:
Mirror high-confidence lessons into an organization/global namespace to support cross-project reuse.

Acceptance Criteria:

1. Mirror behavior is feature-flagged.
2. Mirrored entries include project source attribution.
3. No duplicate mirrors for same lesson fingerprint.

References:

1. `apps/api/src/memory/memory-backend.types.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`

---

### WS5: Context Injection into Runtime Tools

Objective: ensure lessons influence planning and execution behavior.

### Task E067-011: Extend get_project_brief output with lessons_learned

Description:
Add a curated lessons section to project brief payload.

Acceptance Criteria:

1. `get_project_brief` includes top-N relevant lessons with concise summaries.
2. Response remains backward compatible (additive fields only).
3. Lesson selection respects role/stage relevance strategy.

References:

1. `apps/api/src/project/project-brief.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `apps/api/src/tool/capability-manifest.runtime.entries.ts`

### Task E067-012: Extend get_project_state markdown with "Lessons Learned"

Description:
Append lesson snippets to project state markdown for agent readability.

Acceptance Criteria:

1. Markdown section is included when lessons exist.
2. Section remains bounded (max items/length) to avoid prompt bloat.
3. Existing UUID/work-item formatting rules remain intact.

References:

1. `apps/api/src/workflow/workflow-runtime-tools-formatting.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`

### Task E067-013: Add diagnostics visibility for retrospective status

Description:
Expose whether retrospective has run, when it ran, and the latest result summary.

Acceptance Criteria:

1. Diagnostics endpoint includes retrospective status fields.
2. Operators can distinguish `not_started`, `running`, `succeeded`, `failed`, `skipped_duplicate`.
3. Failure responses include actionable remediation text.

References:

1. `apps/api/src/project/project-orchestration-diagnostics.controller.ts`
2. `apps/api/src/project/project-brief.service.ts`

---

### WS6: Observability, Operations, and Guardrails

Objective: make retrospective behavior transparent, safe, and operable.

### Task E067-014: Add retrospective telemetry events

Description:
Emit telemetry for lifecycle of retrospective processing.

Acceptance Criteria:

1. Telemetry includes `started`, `succeeded`, `failed`, `skipped_duplicate`.
2. Payload includes projectId, orchestrationId, and lesson counts.
3. Errors are classified with stable error codes.

References:

1. `apps/api/src/observability/event-ledger.service.ts`
2. `apps/api/src/project/project-orchestration.service.ts`

### Task E067-015: Add replay endpoint/operation for manual rerun

Description:
Allow operators to rerun retrospective generation for a project when needed.

Acceptance Criteria:

1. Manual rerun is explicit and auditable.
2. Rerun can optionally replace or append lessons.
3. Authorization follows existing orchestration diagnostics/admin patterns.

References:

1. `apps/api/src/project/project-orchestration.controller.ts`
2. `apps/api/src/project/project.service.ts`

---

### WS7: Testing and Validation

Objective: guarantee correctness, determinism, and regression safety.

### Task E067-016: Unit tests for aggregation, distillation mapping, and ranking

Description:
Add isolated tests for retrospective data assembly and lesson ranking.

Acceptance Criteria:

1. Tests cover malformed metadata, empty datasets, and repeated QA loops.
2. Ranking determinism is asserted for identical input.
3. Distillation output schema validation is test-covered.

References:

1. `apps/api/src/project/**/*.spec.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.spec.ts`

### Task E067-017: Integration tests for completion-triggered retrospective flow

Description:
Validate end-to-end behavior from completion action to memory persistence and context injection.

Acceptance Criteria:

1. Completing orchestration triggers retrospective workflow once.
2. Memory segments are created and queryable for the project.
3. `get_project_brief` and `get_project_state` include lessons after run.

References:

1. `apps/api/src/project/project-orchestration.service.spec.ts`
2. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`

### Task E067-018: E2E regression coverage in packages/e2e-tests

Description:
Add black-box scenario ensuring retrospective generation and reuse in subsequent orchestration cycle.

Acceptance Criteria:

1. E2E creates a project, drives completion, verifies lessons are generated.
2. E2E starts a follow-up cycle and verifies lessons appear in runtime context.
3. Scenario is deterministic and stable under CI constraints.

References:

1. `packages/e2e-tests/src/kanban-lifecycle/`
2. `packages/e2e-tests/src/workflow-execution/`

---

## 9. Definition of Done (DoD)

EPIC-067 is done when all of the following are true:

1. Completion-triggered retrospective runs automatically and idempotently.
2. Distilled lessons are persisted through memory backend abstraction and retrievable.
3. Runtime context tools expose relevant lessons without breaking existing contracts.
4. Observability signals exist for retrospective lifecycle and failure analysis.
5. Unit + integration + targeted e2e coverage pass for the new behavior.
6. Operational runbook/docs are updated with replay, troubleshooting, and rollout guidance.

---

## 10. Risks and Mitigations

1. Risk: prompt/context bloat from injected lessons.  
   Mitigation: bounded top-N lessons, max payload length, relevance scoring.
2. Risk: duplicate retrospectives from repeated completion signals.  
   Mitigation: idempotency keying + skip telemetry.
3. Risk: low-quality or noisy lessons.  
   Mitigation: confidence thresholds, category filters, replay tooling.
4. Risk: backend drift across `postgres` vs `honcho` modes.  
   Mitigation: backend parity tests and dual-read validation checks.

---

## 11. Rollout Plan

1. Phase 1: ship event contract + workflow seed + telemetry (no context injection yet).
2. Phase 2: enable memory persistence behind feature flag.
3. Phase 3: enable project brief/state lesson injection for selected environments.
4. Phase 4: enable organization-level mirroring after quality thresholds are met.

Recommended feature flags:

1. `RETROSPECTIVE_AUTORUN_ENABLED`
2. `RETROSPECTIVE_CONTEXT_INJECTION_ENABLED`
3. `RETROSPECTIVE_ORG_MIRROR_ENABLED`

---

## 12. Dependencies

1. EPIC-061 memory backend abstraction and honcho integration.
2. EPIC-062 workflow events global/project visibility.
3. EPIC-065 completion guardrails and lifecycle hardening.

---

## 13. Open Questions

1. Should retrospective run only at `completed`, or also at major lifecycle milestones (`specs_ready`, `bootstrap_completed`, `large rework cycles`)?
2. Should organization-level lessons be opt-in per project or always on in autonomous mode?
3. Do we want deterministic non-LLM fallback summaries for environments without distillation model access?
4. Should lessons be immutable snapshots or editable by operators after generation?
