# EPIC-143: Pre-Exposure Critic Gate

Status: Withdrawn
Priority: N/A
Beads: kanban-2vk
Depends On: EPIC-053, EPIC-087
Last Updated: 2026-04-28

---

## 1. Summary

This epic is withdrawn.

The proposed critic gate duplicates the existing `work-item-in-review-default` QA workflow, which already reviews completed work and can reject it back to `in-progress`.

No separate critic gate should be implemented from this epic.

---

## 2. Problem

Implementation workflows currently move work to `in-review` after commit verification. The `work-item-in-review-default` workflow then reviews the completed work and may reject it back to `in-progress`.

EPIC-143 proposed adding an additional critic review before, or at the start of, the review flow. On review, that creates another review stage with largely the same inputs, agent profile, decision shape, and rejection behavior as the existing QA workflow.

That extra stage does not add enough distinct value to justify the workflow complexity.

---

## 3. Goals

No active goals. This epic is retained only as a decision record.

## 4. Non-Goals

1. Do not add a second review job to `work-item-in-review-default.workflow.yaml`.
2. Do not add a pre-transition critic job to `work-item-in-progress-default.workflow.yaml` from this epic.
3. Do not create a new critic agent profile or critic output contract for this epic.

---

## 5. Architecture

### 5.1 Decision

Keep the current lifecycle:

1. `work-item-in-progress-default` implements, commits, and transitions accepted implementation work to `in-review`.
2. `work-item-in-review-default` performs the review gate.
3. QA acceptance moves the item toward merge.
4. QA rejection records feedback and returns the item to `in-progress`.

### 5.2 Rationale

The existing in-review QA workflow already checks completed work against the work item spec, implementation plan, changed files, and project conventions.

Placing a critic inside `work-item-in-review-default` would duplicate that workflow instead of preventing exposure to `in-review`.

Placing a critic before `transition_to_review` would be a distinct control, but it would add another quality gate, new retry semantics, and more lifecycle complexity. The current evidence does not justify that cost.

### 5.3 Future Direction

If review quality needs improvement, strengthen `work-item-in-review-default` directly instead of adding a parallel critic gate.

Potential future work:

1. Improve the QA prompt to better separate blocking defects from advisory findings.
2. Improve QA feedback metadata and failed-deliverable structure.
3. Add tests for existing QA accept/reject/blocked-threshold behavior.
4. Add observability for repeated QA rejection causes.

---

## 6. Workstreams

Cancelled.

---

## 7. Backlog

- [x] E143-001 Withdraw epic as redundant with existing in-review QA workflow.
- [x] E143-002 Remove implementation plan for the proposed critic gate.

---

## 8. Acceptance Criteria

1. Epic status is marked `Withdrawn`.
2. Documentation explains why the proposed critic gate is redundant.
3. Documentation points future quality work at the existing in-review QA workflow.
4. No workflow implementation is planned from this epic.

---

## 9. Risks and Mitigation

1. Existing QA may still miss defects.
   - Mitigate by improving the existing QA workflow directly when concrete gaps are found.
2. A future reader may reopen this idea as a separate critic gate.
   - Mitigate by retaining this withdrawal rationale in the epic.
3. True pre-exposure review may become necessary later.
   - Mitigate with a new epic that justifies the lifecycle cost with concrete failure evidence.
