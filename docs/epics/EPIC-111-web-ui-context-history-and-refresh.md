# EPIC-111: Web UI Context History and Refresh

Status: Proposed
Priority: P2
Depends On: epic-chat-session-context-service
Last Updated: 2026-04-17

---

## 1. Summary

Add a focused web experience for chat/session context visibility:

1. view context blocks that were injected,
2. inspect historical context snapshots,
3. trigger controlled context refresh from the UI.

This epic makes context behavior transparent to operators and improves debugging/operational confidence.

---

## 2. High-Level Context

Context injection now exists in backend runtime, but users/operators have limited visibility into what was injected and when.

Current gaps:

1. no first-class UI for context snapshots,
2. difficult to compare context before/after refresh,
3. manual refresh capabilities are not surfaced cleanly,
4. limited operator feedback when refresh fails or partially succeeds.

---

## 3. Goals

1. Provide a clear context history timeline in the web app.
2. Show provider blocks and metadata in an operator-friendly format.
3. Add refresh controls with status feedback and audit indicators.
4. Support troubleshooting with minimal backend log digging.
5. Keep UX consistent with existing session/project workspace patterns.

## 4. Non-Goals

1. Real-time collaborative editing of context blocks.
2. Arbitrary user editing of system-generated context.
3. New global design system rollout.
4. Replacing backend context assembly logic.

---

## 5. Scope (High Level)

1. Web routes/components for context history and details.
2. API integration for snapshot retrieval and refresh actions.
3. UI state for loading, partial errors, and refresh outcomes.
4. Basic filtering/sorting for context events.
5. Unit/integration tests for context UX flows.

---

## 6. Expected Outcome

Operators can understand context evolution directly from the UI, refresh context intentionally, and diagnose behavior faster.
