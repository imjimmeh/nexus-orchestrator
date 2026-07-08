# EPIC-146: Autonomy Audit and Observability

Status: Implemented
Priority: P2
Beads: kanban-v0k
Depends On: EPIC-141, EPIC-143, EPIC-145
Last Updated: 2026-04-29

---

## 1. Summary

Add operator and user visibility for autonomous learning, critic decisions, and repair attempts.

The autonomy features in EPIC-141 through EPIC-145 should be inspectable through events, APIs, and UI surfaces so users can understand what the platform did and why.

---

## 2. Problem

Autonomous behavior becomes risky when users cannot inspect decisions. Skill proposals, critic rejections, and repair attempts all need clear evidence trails.

Existing `event_ledger`, learning proposal APIs, doctor history, workflow timelines, and UI panels provide foundations, but they are not unified around autonomy decisions.

---

## 3. Goals

1. Show why a skill proposal was generated.
2. Show why a critic accepted or blocked work.
3. Show what repair was attempted and whether it worked.
4. Make autonomy events queryable from existing diagnostics surfaces.
5. Provide clear next steps when autonomous actions fail or require human review.

## 4. Non-Goals

1. Building a new observability stack.
2. Replacing event ledger or doctor history.
3. Allowing users to bypass governance controls from the observability UI.

---

## 5. Architecture

### 5.1 Event Taxonomy

Standardize autonomy event names and payloads for:

1. transcript learning scans,
2. learning candidate creation,
3. skill proposal creation and review,
4. critic decisions,
5. failure classifications,
6. repair attempts and outcomes.

### 5.2 API Surfaces

Extend existing read APIs where possible instead of creating unrelated endpoints:

1. learning status and proposal APIs,
2. workflow run diagnostics,
3. work item detail metadata,
4. doctor history.

### 5.3 UI Surfaces

Add concise autonomy panels in the relevant context:

1. Learning tab for skill proposal evidence,
2. work item detail for critic findings,
3. workflow run detail for classification and repair attempts,
4. operations doctor view for repair history.

---

## 6. Workstreams

1. Define autonomy event taxonomy and payload shape.
2. Add event emission in learning, critic, classification, and repair flows.
3. Extend diagnostics APIs with autonomy summaries.
4. Add UI panels for proposal evidence, critic findings, and repair attempts.
5. Add tests for event payloads and UI projection helpers.

---

## 7. Backlog

- [x] E146-001 Define autonomy event taxonomy.
- [x] E146-002 Add autonomy summary projection helpers.
- [x] E146-003 Surface skill proposal evidence in Learning UI.
- [x] E146-004 Surface critic findings in work item detail UI.
- [x] E146-005 Surface repair attempts in workflow diagnostics or operations UI.
- [x] E146-006 Add projection and rendering tests.

---

## 8. Acceptance Criteria

1. Users can inspect why skill proposals were generated.
2. Users can inspect critic decisions and required fixes from work item views.
3. Users can inspect repair attempts and outcomes from diagnostics or operations views.
4. Autonomy events are queryable and include evidence references.
5. Failed or denied autonomous actions include clear next steps.

---

## 9. Risks and Mitigation

1. Observability may duplicate existing UI surfaces.
   - Mitigate by extending current learning, work item, workflow, and operations views.
2. Event payloads may expose sensitive transcript content.
   - Mitigate by storing references and summaries, not raw transcript bodies.
3. Too much detail may overwhelm users.
   - Mitigate with summary-first UI and expandable diagnostics.

---

## 10. Implementation Notes (2026-04-29)

Implemented in branch `feat/epic-146-autonomy-observability`:

1. **Autonomy taxonomy**: Added `AUTONOMY_EVENT_NAMES`, `AUTONOMY_TRIGGER_NAMES`, autonomy categories, evidence references, next steps, and summary item contracts in `apps/api/src/observability/autonomy-observability.types.ts`. QA decisions use the actual event ledger event `kanban.work_item.status_transition.succeeded` plus trigger `work_item.submit_qa_decision`.

2. **Summary projection helpers**: Added pure projection helpers in `apps/api/src/observability/autonomy-summary.projection.ts` for skill proposals, QA decisions, failure classifications, and repair delegation. Projection sanitizes secret-like values and raw transcript/job-output labels.

3. **Workflow run diagnostics API**: Added `GET /workflows/runs/:runId/autonomy/diagnostics`, backed by `WorkflowRunAutonomyDiagnosticsService`, to project classification and repair events plus `_internal.repair_delegation` state into summary-first diagnostics.

4. **Learning UI evidence**: Expanded the Learning proposal card to show why a proposal was generated, bounded source evidence references, status-specific next steps, and invalid-preview approval guarding.

5. **Work item QA findings**: Added a work item QA findings panel for non-large work item detail views. Large work items continue to show QA feedback through the existing `PlanReviewPanel` to avoid duplicate review sections.

6. **Workflow and operations UI**: Added a workflow autonomy diagnostics panel to workflow run detail pages and added compact autonomy context to Operations Doctor repair history rows when repairs came from workflow repair delegation.

7. **Tests**: Added focused API and web coverage for taxonomy contracts, projections and sanitization, workflow diagnostics service/controller behavior, event-ledger queryability, Learning evidence rendering, QA findings rendering, workflow diagnostics rendering, Doctor repair context rendering, and workflow diagnostics polling.
