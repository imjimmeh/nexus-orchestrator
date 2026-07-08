# EPIC-049: Orchestration Modes Behavioral Implementation (Supervised, Autonomous, Notifications Only)

> Status: Planned
> Priority: High
> Estimate: 2-3 weeks
> Created: 2026-04-05
> Owner: TBD

---

## 1. Epic Summary

Implement true runtime behavior for all three project orchestration modes already exposed in API and UI:

1. supervised
2. autonomous
3. notifications_only

Today, mode is persisted but does not materially change orchestration behavior. This epic adds explicit policy enforcement, approvals, and action gating so each mode behaves differently and predictably.

---

## 2. Problem Statement

Current state:

1. Mode values are accepted and stored.
2. CEO workflows and tool handlers do not branch by mode in meaningful ways.
3. Users can select a mode in web UI, but runtime semantics remain effectively identical.

Impact:

1. Product behavior does not match user expectation.
2. Risk controls for high-autonomy actions are unclear.
3. Operators cannot rely on mode as a governance boundary.

---

## 3. Goals

1. Define and enforce clear mode semantics at runtime.
2. Ensure all CEO mutation actions are mode-aware and policy-checked.
3. Add supervised approval flow for gated actions.
4. Keep orchestration decisions observable through decision log and activity events.
5. Deliver comprehensive unit and integration coverage for mode-specific behavior.

---

## 4. Non-Goals

1. Multi-project orchestration portfolio management.
2. New agent model/provider strategy.
3. Full rollback and undo framework for CEO actions.
4. Replacing the existing workflow engine event model.

---

## 5. Mode Semantics (Source of Truth)

### 5.1 supervised

Intent:

Human remains in control of mutating orchestration actions.

Behavior:

1. CEO may read state and append decisions normally.
2. CEO cannot directly execute mutating actions.
3. Mutating actions are converted into pending action requests.
4. User explicitly approves or rejects each pending action.
5. On approval, backend executes the requested action and records the outcome.

Mutating actions in scope:

1. kanban.dispatch_selected_work_items
2. invoke_agent_workflow
3. update_project_strategy
4. complete_orchestration

### 5.2 autonomous

Intent:

CEO executes orchestration actions directly without approval gates.

Behavior:

1. CEO executes allowed mutating actions immediately.
2. All decisions and actions are logged with timestamp, reasoning, and result.
3. Failures are surfaced via orchestration event stream and decision metadata.

### 5.3 notifications_only

Intent:

CEO acts as analyzer and notifier only, never mutates project state.

Behavior:

1. CEO evaluates project state and submits decisions.
2. Mutating actions are denied by mode policy.
3. Denied actions are transformed into recommendations and user-visible notifications.
4. No dispatch, strategy mutation, workflow invocation, or orchestration completion is executed automatically.

---

## 6. Technical Design Overview

### 6.1 Mode Policy Service

Add centralized policy evaluator for orchestration actions:

1. input: projectId, mode, action, payload
2. output: allow, deny, or require_approval
3. single source of truth used by telemetry tool handlers and service APIs

### 6.2 Pending Action Requests (supervised)

Add persistence and API for pending action lifecycle:

1. create request when action is gated
2. list pending requests for project
3. approve request and execute action
4. reject request with reason
5. store audit trail (requested by, approved by, rejected by, timestamps)

### 6.3 Tool Handler Enforcement

Enforce mode policy in CEO tool action handlers before side effects:

1. kanban.dispatch_selected_work_items
2. invoke_agent_workflow
3. update_project_strategy
4. complete_orchestration

### 6.4 Decision and Notification Enrichment

Standardize decision log entries to include:

1. requested_action
2. mode_evaluation (allow, deny, require_approval)
3. execution_status (executed, queued_for_approval, denied, failed)
4. correlation id for request and response tracking

---

## 7. Delivery Plan

### Phase 1: Contracts and Policy Foundations

1. Define mode policy matrix and action classification.
2. Implement Mode Policy Service with unit tests.
3. Add typed enums/constants for policy outcomes.
4. Integrate policy checks into telemetry orchestration helper layer.

### Phase 2: notifications_only (Safe Read-Only Mode)

1. Deny mutating actions under notifications_only.
2. Convert denied actions into recommendations and activity events.
3. Add API/web payload support for mode-denied recommendations.
4. Add tests covering all mutating actions under notifications_only.

### Phase 3: supervised (Approval Workflow)

1. Create pending action request entity and repository.
2. Add endpoints to list, approve, and reject pending requests.
3. Queue mutating actions instead of executing directly.
4. Execute approved actions with idempotency guard.
5. Add API and workflow integration tests for approval lifecycle.

### Phase 4: autonomous (Direct Execution)

1. Permit direct execution of mutating actions via policy.
2. Ensure audit metadata is recorded for each action.
3. Add failure-path telemetry and decision annotations.
4. Add integration tests confirming no approval queue usage.

### Phase 5: UX and Observability Completion

1. Expose pending action queue in orchestration tab.
2. Add approve/reject controls with feedback.
3. Display mode-specific behavior hints in UI.
4. Add activity filters: executed, queued, denied.
5. Update docs and e2e verification scripts for three-mode behavior.

---

## 8. Backend Scope

### Expected Files to Modify

1. apps/api/src/project/project-orchestration.service.ts
2. apps/api/src/project/project-orchestration.service.spec.ts
3. apps/api/src/project/project-orchestration.controller.ts
4. apps/api/src/project/project-orchestration.controller.spec.ts
5. apps/api/src/telemetry/telemetry.gateway.ts
6. apps/api/src/telemetry/telemetry-gateway-orchestration-compat.helpers.ts
7. apps/api/src/telemetry/telemetry-gateway-compat.helpers.spec.ts
8. apps/api/src/project/project-orchestration.service.types.ts

### Expected Files to Create

1. apps/api/src/project/project-orchestration-mode-policy.service.ts
2. apps/api/src/project/project-orchestration-mode-policy.service.spec.ts
3. apps/api/src/database/entities/project-orchestration-action-request.entity.ts
4. apps/api/src/database/repositories/project-orchestration-action-request.repository.ts
5. apps/api/src/database/repositories/project-orchestration-action-request.repository.spec.ts
6. apps/api/src/project/dto/approve-orchestration-action.dto.ts
7. apps/api/src/project/dto/reject-orchestration-action.dto.ts
8. apps/api/src/database/migrations/<timestamp>-create-project-orchestration-action-requests.ts

---

## 9. Frontend Scope

### Expected Files to Modify

1. apps/web/src/lib/api/types.ts
2. apps/web/src/lib/api/client.ts
3. apps/web/src/hooks/useProjectOrchestration.ts
4. apps/web/src/pages/project-workspace/OrchestrationTab.tsx
5. apps/web/src/pages/project-workspace/OrchestrationTab.spec.tsx

### Expected Files to Create

1. apps/web/src/components/orchestration/OrchestrationPendingActionsPanel.tsx
2. apps/web/src/components/orchestration/OrchestrationModeHint.tsx

---

## 10. Acceptance Criteria

### 10.1 supervised

1. CEO mutating action attempts create pending action requests.
2. No mutating action executes before approval.
3. Approve executes exactly one action with idempotency safety.
4. Reject marks request rejected and records reason.

### 10.2 autonomous

1. CEO mutating actions execute without human approval.
2. Decision log records action and execution status.
3. Failures are visible in orchestration activity.

### 10.3 notifications_only

1. CEO mutating actions never execute.
2. Denied actions are visible as recommendations.
3. Decision log marks mode_evaluation as denied.

### 10.4 Cross-Mode Guarantees

1. Mode selection immediately affects subsequent tool actions.
2. Updating mode from API/UI changes behavior without restart.
3. Unit tests cover policy matrix for all mutating actions.
4. Integration tests verify supervised queue, autonomous direct execution, and notifications_only denial paths.

---

## 11. Risks and Mitigations

1. Risk: Action execution duplication on approve retries.
   Mitigation: Add request-level idempotency and execution_status guard.

2. Risk: Inconsistent behavior between telemetry handler and service layer.
   Mitigation: Route all evaluations through a single Mode Policy Service.

3. Risk: UX confusion over why actions do not run in notifications_only.
   Mitigation: Add explicit mode hint banners and recommendation messaging.

4. Risk: Approval queue growth under heavy activity in supervised mode.
   Mitigation: Add pagination, stale request cleanup, and status filters.

---

## 12. Dependencies

1. EPIC-046 Autonomous Project Orchestrator
2. EPIC-047 Frontend UX for Orchestrated Execution

---

## 13. Definition of Done

1. All three modes have enforceable, test-backed runtime semantics.
2. Supervised mode includes complete pending action approval workflow.
3. Autonomous mode executes directly with audit visibility.
4. Notifications_only mode is guaranteed non-mutating.
5. API, UI, docs, and tests are aligned with the mode semantics matrix.
