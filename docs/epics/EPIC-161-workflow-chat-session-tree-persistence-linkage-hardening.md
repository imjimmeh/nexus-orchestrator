# EPIC-161: Workflow Chat Session Tree Persistence Linkage Hardening

Status: Completed
Priority: P1
Depends On: EPIC-006, EPIC-063, EPIC-064, EPIC-083
Related:

1. apps/api/src/session/session-hydration.service.ts
2. apps/api/src/workflow/workflow-subagents/subagent-orchestrator.runtime.operations.ts
3. apps/api/src/telemetry/telemetry-gateway-session-checkpoint.helpers.ts
4. apps/api/src/telemetry/telemetry.gateway.ts
5. apps/api/src/database/entities/pi-session-tree.entity.ts
6. apps/api/src/database/entities/chat-session.entity.ts
   Last Updated: 2026-05-05

---

## 1. Epic Summary

Workflow and chat execution paths both persist JSONL session trees, but some workflow-originated chat paths do not consistently link the persisted tree back to the owning chat session. This epic hardens persistence ownership and linkage so workflow chat sessions are always represented as chat sessions in storage and remain queryable from both workflow and chat viewpoints.

The implementation centralizes this in session hydration APIs to keep the call sites DRY and reduce future drift.

---

## 2. Problem Statement

Current behavior has two gaps:

1. Subagent completion persists subagent chat JSONL as a chat-owned session tree, but does not reliably update chat_sessions.session_tree_id.
2. Telemetry checkpoint persistence for ask_user_questions uses workflow-only owner linkage and ignores chat session identity when available.

This causes inconsistent observability and makes chat-session-first retrieval less reliable for workflow-derived chat conversations.

---

## 3. Goals

1. Add a single session hydration API for workflow+chat ownership persistence.
2. Ensure subagent chat completion links chat_sessions.session_tree_id.
3. Ensure telemetry checkpoint persistence includes chat session ownership when available.
4. Preserve existing behavior for non-chat workflow checkpoints.
5. Cover behavior with focused unit tests in touched modules.

## 4. Non-Goals

1. Database schema changes.
2. Backfilling all historical rows in this implementation.
3. Rewriting unrelated chat execution flow behavior.

---

## 5. Scope

### In Scope

1. Session hydration service API extension for workflow+chat persistence.
2. Subagent completion path wiring to workflow+chat persistence.
3. Telemetry checkpoint callback contract extension for optional chatSessionId.
4. Unit test updates in session hydration, subagent runtime operations, and telemetry runtime helper specs.

### Out of Scope

1. New public REST APIs.
2. Event ledger schema modifications.
3. Historical data migration tooling.

---

## 6. Proposed Implementation

### Phase 1: Session Hydration API

1. Add saveSessionForWorkflowChat(containerId, workflowRunId, chatSessionId).
2. Persist pi_session_trees with both workflow_run_id and chat_session_id.
3. Update chat_sessions.session_tree_id in the same flow.

### Phase 2: Subagent Completion Wiring

1. In subagent completion, call workflow+chat persistence when workflowRunId exists.
2. Retain chat-only fallback when workflowRunId is unavailable.

### Phase 3: Telemetry Checkpoint Wiring

1. Extend checkpoint callback contract with optional chatSessionId.
2. Propagate chatSessionId from authenticated socket context when present.
3. Persist workflow+chat checkpoint if chatSessionId is available; otherwise keep workflow-only checkpoint behavior.

### Phase 4: Verification

1. Add unit tests for workflow+chat persistence and chat session linkage.
2. Add unit tests for subagent persistence branch selection.
3. Add unit tests for telemetry chatSessionId propagation.

---

## 7. Actionable Tasks

- [x] E161-001 Add workflow+chat persistence API to session hydration service.
- [x] E161-002 Link chat_sessions.session_tree_id from workflow+chat persistence path.
- [x] E161-003 Wire subagent completion to workflow+chat persistence.
- [x] E161-004 Keep subagent fallback for chat-only persistence when workflow run context is absent.
- [x] E161-005 Extend telemetry checkpoint persistence callback contract with optional chatSessionId.
- [x] E161-006 Pass chatSessionId from runtime helper when present.
- [x] E161-007 Use workflow+chat persistence in telemetry gateway callback when chatSessionId is available.
- [x] E161-008 Add/adjust unit tests across touched modules.

---

## 8. Acceptance Criteria

1. Subagent completion with both workflow run and subagent chat session persists a session tree row containing workflow_run_id and chat_session_id.
2. chat_sessions.session_tree_id is updated by the workflow+chat persistence flow.
3. Telemetry checkpoint persistence for ask_user_questions forwards chatSessionId when present.
4. Workflow-only checkpoint behavior remains unchanged when chatSessionId is absent.
5. All touched unit tests and lint gates pass.

---

## 9. Quality Gates

1. npm run test --workspace=apps/api -- src/session/session-hydration.service.spec.ts
2. npm run test --workspace=apps/api -- src/workflow/workflow-subagents/subagent-orchestrator.runtime.operations.spec.ts
3. npm run test --workspace=apps/api -- src/telemetry/telemetry-gateway-runtime.helpers.spec.ts
4. npm run lint --workspace=apps/api
