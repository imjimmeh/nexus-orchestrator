# EPIC-165: Autonomous Human Decision Policy and Continuous Orchestration

Status: Completed
Priority: P0
Depends On: EPIC-164
Related: docs/plans/2026-05-10-autonomous-human-decision-policy-design.md
Last Updated: 2026-05-13

---

## 1. Summary

Make imported repository human-decision findings mode-aware. In autonomous mode, the AI should decide and continue. In supervised mode, the system should ask for user feedback and make that feedback need visible. In both modes, feedback/question items must not unnecessarily stop unrelated work generation or continuous orchestration.

This epic fixes the product gap exposed by project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4`, where 26 imported repository findings were classified as `blocked` human-decision work items, the frontend did not explain what to do with them, and the project-level orchestration cycle stopped instead of continuing.

It also fixes the operational bug exposed by the same project: after a user manually moved imported generated items from `blocked` into `todo` or `backlog`, the next imported-repository reconciliation matched those items by `metadata.sourceId` and wrote the generated `blocked` status back. Generated reconciliation must not silently overwrite user/project disposition.

---

## 2. Problem Statement

EPIC-164 made imported repository reconciliation produce real work items from probe artifacts. The current classification is still too conservative:

1. Probe `openQuestions` become `blocked` work items with `workType: human_decision`.
2. If all active imported items are human-decision blocked, continuation records project-level `blocked`.
3. Project-level `blocked` prevents the next orchestration cycle from being requested.
4. The UI does not show a useful blocked reason or decision prompt for these items.
5. Autonomous projects behave like supervised projects whenever imported findings contain uncertainty.
6. Reconciliation treats generated status as authoritative even after manual triage changes item status.

This conflates feedback, work-item blocked state, and whole-project blocked state.

---

## 3. Goals

1. Add a mode-aware human-decision policy for imported repository findings.
2. Default autonomous projects to `decide_without_approval`.
3. Default supervised projects to `ask_when_uncertain`.
4. Preserve future extensibility for project-level policy overrides.
5. Record autonomous decisions and rationale in work item metadata.
6. Record supervised feedback prompts in work item metadata.
7. Prevent imported feedback-needed items from blocking unrelated work generation.
8. Keep orchestration continuous until stopped, paused, hard-blocked, or complete.
9. Make feedback-needed and autonomous-decision items visible in the frontend.
10. Reclassify existing imported human-decision items when orchestration reruns under the new policy.
11. Preserve manual/project status overrides during imported reconciliation and store generated recommendations separately.

---

## 4. Non-Goals

1. Building a full feedback inbox or approval workflow in the first implementation slice.
2. Adding a mandatory database migration for policy metadata.
3. Removing hard blockers for credentials, missing repository access, broken runtime, or explicit pause/stop decisions.
4. Giving implementation agents unrestricted arbitrary backlog mutation powers.
5. Making autonomous decisions untraceable.

---

## 5. Target Behavior

### 5.1 Autonomous Mode

`autonomous` means the AI decides and continues.

When imported reconciliation sees a finding that would previously be `human_decision`, it should resolve it into `todo`, `done`, or ignored/non-actionable instead of blocking by default. The generated or updated work item must preserve the original finding, policy, and rationale.

Project-level `blocked` should only occur when the system cannot safely proceed, such as missing credentials, missing required input, broken infrastructure, or explicit stop policy.

### 5.2 Supervised Mode

`supervised` means ask the user.

Imported uncertainty should become feedback-needed work. The UI should display why feedback is needed and what decision is requested. However, these items should not stop unrelated new work from being generated or dispatched.

### 5.3 Continuous Orchestration

The project orchestration cycle should continue until one of these terminal or stop conditions applies:

1. User explicitly stops or pauses orchestration.
2. The project is complete.
3. A hard system blocker prevents safe progress.
4. The orchestrator records an explicit non-autonomous blocked decision.

Having feedback-needed imported findings is not, by itself, a reason to stop autonomous orchestration.

### 5.4 Reconciliation Ownership

Imported repository reconciliation owns generated content and recommendations. It does not always own current work item disposition.

When reconciliation updates an existing item:

1. If `existing.status === existing.metadata.lastGeneratedStatus`, reconciliation may update `status` to the new generated status and refresh `lastGeneratedStatus`.
2. If `existing.status !== existing.metadata.lastGeneratedStatus`, reconciliation must preserve `existing.status`, mark `metadata.userStatusOverride: true`, and store the new generated status as `metadata.generatedRecommendation`.
3. Reconciliation may still refresh source evidence, generated title/description, rationale, and timestamps.
4. A materially changed source finding should produce visible recommendation/conflict metadata, not a silent status overwrite.

---

## 6. Proposed Components

### 6.1 `HumanDecisionResolutionPolicyService`

Add a focused service under `apps/kanban/src/orchestration/`.

Responsibilities:

1. Select effective policy from project/orchestration mode and optional config.
2. Resolve imported human-decision findings into work item disposition.
3. Return metadata needed for auditability and UI display.

Initial policy values:

```ts
type HumanDecisionPolicy =
  | "decide_without_approval"
  | "ask_when_uncertain"
  | "always_supervise";
```

### 6.2 `ReconciledWorkItemPublisher` Ownership Guard

Update `ReconciledWorkItemPublisher` before or alongside policy integration.

Responsibilities:

1. Persist `metadata.lastGeneratedStatus` and `metadata.lastGeneratedWorkType` when applying generated specs.
2. Detect existing status overrides by comparing current status to `lastGeneratedStatus`.
3. Preserve overridden current status while recording `generatedRecommendation` from the latest spec.
4. Mark override/conflict metadata for UI visibility and future audit.

### 6.3 Imported Repository Reconciler Integration

`ImportedRepositoryBacklogReconciler` should use the policy for `openQuestions` and explicit human-decision markers.

Autonomous result example:

```json
{
  "status": "todo",
  "workType": "gap",
  "metadata": {
    "originalWorkType": "human_decision",
    "humanDecisionPolicy": "decide_without_approval",
    "autonomousDecision": true,
    "feedbackNeeded": false,
    "resolutionRationale": "Autonomous mode converted imported uncertainty into actionable follow-up work."
  }
}
```

Supervised result example:

```json
{
  "status": "blocked",
  "workType": "human_decision",
  "metadata": {
    "humanDecisionPolicy": "ask_when_uncertain",
    "feedbackNeeded": true,
    "decisionPrompt": "...",
    "blockedReason": "Imported repository finding needs user feedback before execution."
  }
}
```

### 6.4 Continuation Policy

Superseded by EPIC-170: `OrchestrationContinuationService` should not decide project-level continuation strategy. It may support wakeup/reconciliation mechanics, but `project_orchestration_cycle_ceo` decides repeat, pause, block, or complete from observed project facts.

Historical required behavior, superseded by EPIC-170's wakeup-only continuation model:

1. Dispatchable `todo` work should wake the CEO cycle; Kanban should not record `repeat` as a strategy decision.
2. Autonomous feedback-only imported state should not automatically record project `blocked`; it should request/allow the CEO cycle to decide or synthesize work.
3. Supervised feedback-only state may surface feedback-needed facts, but project-level blocked strategy belongs to the CEO cycle.
4. Feedback-needed items should not block unrelated work generation.

### 6.5 UI Visibility

Update work item UI to expose imported decision metadata.

Likely files:

1. `apps/web/src/pages/kanban/KanbanWorkItemCard.tsx`
2. `apps/web/src/pages/kanban/KanbanWorkItemCardBody.tsx`
3. `apps/web/src/pages/kanban/WorkItemDetailSheet.tsx`
4. Related specs under `apps/web/src/pages/kanban/*.spec.tsx`

Initial UI acceptance:

1. Show `Feedback needed` for `metadata.feedbackNeeded === true`.
2. Show `Autonomous decision` for `metadata.autonomousDecision === true`.
3. Show `decisionPrompt`, `blockedReason`, or `resolutionRationale` when present.
4. Show when a generated recommendation differs from the current disposition because a user/project override is being preserved.

---

## 7. Acceptance Criteria

1. Autonomous imported open-question findings are no longer project-blocking by default.
2. Autonomous imported open-question findings are resolved into actionable or completed dispositions with rationale metadata.
3. Supervised imported open-question findings remain feedback-needed with visible metadata.
4. Kanban wakeups request another CEO cycle when autonomous mode can continue.
5. The CEO cycle records project-level blocked only for hard blockers or supervised feedback-only states with no other path.
6. Existing imported human-decision items can be reclassified on rerun according to the current policy.
7. Frontend work item cards/details make feedback-needed and autonomous-decision state visible.
8. Manually moved imported items are not silently moved back to generated `blocked` status on rerun.
9. Generated recommendations remain visible when they differ from current item disposition.
10. Unit/integration tests cover autonomous, supervised, override-preservation, and hard-blocker behavior.
11. Seed workflow contracts pass orchestration mode/policy to imported reconciliation.
12. `npm run test:kanban`, relevant web tests, `npm run build:kanban`, and `npm run validate:seed-data` pass.

---

## 8. Testing Requirements

1. Policy service unit tests for policy selection and resolution results.
2. Publisher tests for preserving manual status overrides when generated specs still recommend `blocked`.
3. Publisher tests for updating status normally when current status still equals `lastGeneratedStatus`.
4. Reconciler tests for autonomous open questions becoming `todo`/`done` or ignored with rationale.
5. Reconciler tests for supervised open questions staying feedback-needed.
6. Wakeup/CEO-cycle tests for autonomous feedback-only state continuing rather than blocking.
7. CEO-cycle tests for supervised feedback-only state recording a clear blocked reason when no other path exists.
8. Integration regression for the 26 imported human-decision item shape from project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4`.
9. Frontend component tests for feedback-needed, autonomous-decision, and generated-recommendation badges/details.
10. Seed contract tests for imported repository workflow mode/policy propagation.

---

## 9. Implementation Plan

Use `docs/plans/2026-05-10-autonomous-human-decision-policy-implementation.md`.
