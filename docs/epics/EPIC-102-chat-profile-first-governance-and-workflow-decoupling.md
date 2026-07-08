# EPIC-102: Chat Profile-First Governance and Workflow Decoupling

Status: Proposed
Priority: P0
Depends On: EPIC-063, EPIC-064, EPIC-087, EPIC-098, EPIC-099
Related:

1. docs/architecture/chat-sessions.md
2. docs/architecture/agent-capability-orchestration.md
3. docs/architecture/workflow-engine.md
4. apps/chat/src/chat-actions/chat-to-core-action.service.ts
5. apps/api/src/workflow/workflow-runtime-capability-executor.service.ts
6. apps/api/src/workflow/step-support.service.ts
7. seed/workflows/chat-direct-agent-default.workflow.yaml
8. seed/workflows/orchestration-invoke-agent-default.workflow.yaml
   Last Updated: 2026-04-15

---

## 1. Epic Summary

Make agent profile permissions the single source of truth for chat runtime capability authorization, and progressively decouple normal chat turns from mandatory workflow policy layers.

Target outcomes:

1. No duplicate tool allowlist maintenance across agent profile and chat workflow YAML.
2. No "visible but denied" mismatches caused by policy drift between layers.
3. Chat sessions can run with profile-governed capability checks without requiring workflow run/job context for every runtime capability call.
4. Workflow engine remains available as an optional orchestration substrate for multi-step automation, approvals, and structured jobs.

---

## 2. Problem Statement

Current chat authorization behavior intersects multiple policy layers:

1. Agent profile allowed_tools.
2. Workflow permissions allow_tools and deny_tools.
3. Job-level permissions.
4. IAM/tool mounting checks at runtime.

This architecture causes recurring operational issues:

1. Tool policy drift: a tool can be present in capability manifest and profile, but denied by workflow allowlist omissions.
2. High maintenance cost: every new runtime tool requires repeated updates in profile seed plus workflow seed.
3. Poor ergonomics for ad-hoc chat: conversational usage inherits workflow-centric policy semantics.
4. Confusing failure mode for users: agent can "see" tool contracts but receives policy_denied at call time.

---

## 3. Goals

1. Establish profile-first capability governance for chat sessions.
2. Preserve strict least-privilege and approval semantics.
3. Keep workflow-layer governance for workflow-native execution paths.
4. Eliminate duplicate allowlist management for day-to-day chat capability evolution.
5. Provide backward-compatible migration with feature flags and clear rollback paths.
6. Improve operator diagnostics so policy-denied outcomes identify exact authority source.

---

## 4. Non-Goals

1. Removing workflow engine support from the platform.
2. Replacing project orchestration, kanban workflows, or special-step handlers.
3. Granting broader permissions than profile policy currently allows.
4. Delivering fully autonomous cross-domain web execution without governance.

---

## 5. Architecture Direction

### 5.1 Authorization Authorities

Define explicit authorization authorities by execution context:

1. workflow_context:
   - Retain current layered policy model (profile + workflow + job + mode + IAM).
2. chat_context:
   - Use profile policy as the primary capability grant boundary.
   - Apply mode and approval gates as narrowing controls.
   - Do not require workflow permissions.allow_tools for baseline chat capability authorization.

### 5.2 Policy Model

Use a hard upper-bound model:

1. Profile policy is maximum grant.
2. Environment/org/project policy can narrow or require approval.
3. No layer may expand above profile grant.
4. Workflow allow_tools is ignored for chat_context, retained for workflow_context.

### 5.3 Runtime Capability Evaluation

Extend runtime capability governance to resolve effective callable tools from context type:

1. If context is workflow_context, evaluate as today.
2. If context is chat_context, evaluate from profile + mode + org/project guardrails.
3. Preserve current response contract shape:
   - callable_tools
   - denied_tools
   - approval_required_tools

### 5.4 Chat Runtime Ownership

Move toward a dedicated chat runtime turn loop:

1. Immediate term: keep existing chat default workflow substrate with profile-first policy mode.
2. Medium term: add chat session runtime service for turn execution and continuation.
3. Long term: workflow invocation becomes optional tooling for structured subflows, not mandatory for every chat turn.

---

## 6. Comparable System Pattern Analysis

This direction aligns with autonomous-agent platform patterns where interactive chat and orchestrated workflows are separate control planes:

1. Hermes-like split: conversational agent runtime enforces profile/tool contracts directly, while orchestration plans are delegated to separate job runners.
2. OpenClaw-like split: conversation turn governance uses agent-level policy with deterministic tool contract checks, while pipeline workflows enforce stage/job policies independently.

Design implication for Nexus Orchestrator:

1. Keep both planes, but avoid forcing the workflow plane to authorize all chat turns.
2. Preserve compatibility by sharing capability schema contracts, telemetry events, and approval primitives across both planes.

---

## 7. Proposed Phased Implementation

### 7.1 Phase 1: Profile-Only Policy Mode for Chat Workflows

1. Add runtime policy mode option for default chat workflows.
2. Introduce workflow policy strategy values:
   - layered (current behavior)
   - profile_only (new behavior for chat defaults)
3. In profile_only mode:
   - capability authorization ignores workflow allow_tools and deny_tools.
   - job.permissions still optional as explicit local narrowing control.
4. Add explicit diagnostics to denied reasons indicating profile_only policy mode.

### 7.2 Phase 2: First-Class chat_context Governance

1. Extend capability preflight and runtime capability executor to accept chat_context without mandatory workflow_run_id and job_id.
2. Add chat capability snapshot endpoint keyed by chat_session_id and agent_profile_name.
3. Route chat runtime capability checks through chat_context policy resolver.
4. Preserve workflow_context behavior and contracts unchanged.

### 7.3 Phase 3: Chat Runtime Loop Service

1. Implement dedicated chat turn executor in API/chat boundary.
2. Keep session lifecycle, memory context, and telemetry continuity.
3. Allow optional workflow invocation as explicit tool action for structured jobs.
4. Default conversational turns no longer require seeded workflow execution.

### 7.4 Phase 4: Cleanup and Hardening

1. Remove chat-specific tool allowlist duplication from default workflow seed policies.
2. Keep workflow definitions for compatibility scenarios only.
3. Add migration guardrails and operational dashboards for policy source attribution.
4. Update docs and runbooks to profile-first guidance for chat runtime capabilities.

---

## 8. Scope

### In Scope

1. Policy model changes needed to remove chat workflow allowlist duplication.
2. Capability preflight and executor extensions for chat_context.
3. Chat-facing governance endpoints and diagnostics.
4. Feature-flagged rollout and migration tooling.
5. Documentation and operator runbook updates.

### Out of Scope

1. Full redesign of kanban orchestration lifecycle.
2. Replacement of workflow DSL or seed architecture globally.
3. Changes to non-chat workflow security semantics unless required for compatibility.

---

## 9. Actionable Tasks

- [ ] E102-001 Define capability governance context enum (workflow_context, chat_context) in shared contracts.
- [ ] E102-002 Add policy strategy support (layered, profile_only) in workflow/capability evaluation path.
- [ ] E102-003 Implement profile_only evaluation branch in StepSupportService capability policy resolver.
- [ ] E102-004 Update capability preflight service to accept context-aware policy resolution inputs.
- [ ] E102-005 Extend runtime capability executor to authorize chat_context without workflow_run_id/job_id requirement.
- [ ] E102-006 Add chat capability snapshot endpoint with callable/denied/approval-required output.
- [ ] E102-007 Route chat message action path through chat_context capability evaluation.
- [ ] E102-008 Add structured denied reason metadata including policy_authority and context_type.
- [ ] E102-009 Add feature flags for profile_only mode and chat_context runtime path.
- [ ] E102-010 Add migration switch for chat default workflow policies to profile_only.
- [ ] E102-011 Add regression tests for visibility-callability parity in chat profile policies.
- [ ] E102-012 Add regression tests ensuring workflow_context behavior remains unchanged.
- [ ] E102-013 Add docs updates for profile-first chat governance and operational troubleshooting.
- [ ] E102-014 Prepare deprecation plan for chat workflow allowlist duplication.

---

## 10. Acceptance Criteria

1. Adding a runtime capability to a chat agent profile no longer requires workflow allow_tools updates for default chat sessions.
2. Chat capability checks return consistent callable_tools and denied_tools with no false-positive visibility.
3. Denied responses identify exact policy authority source (profile, mode gate, org/project gate, workflow/job where applicable).
4. Workflow-native runs still honor layered workflow/job policy rules exactly as before.
5. Feature flags allow safe incremental rollout and rollback of profile-first behavior.
6. Existing chat sessions and workflow orchestration flows remain backward compatible during migration.

---

## 11. Test and Quality Gates

Recommended verification commands from repository root:

1. npm run lint:api
2. npm run lint --workspace=apps/chat
3. npm run build:api
4. npm run test --workspace=apps/api -- src/tool/capability-preflight.service.spec.ts
5. npm run test --workspace=apps/api -- src/workflow/workflow-runtime-capability-executor.service.spec.ts
6. npm run test --workspace=apps/api -- src/workflow/workflow-runtime-tools.service.spec.ts
7. npm run test --workspace=apps/chat -- src/chat-actions/chat-to-core-action.service.spec.ts
8. npm run test --workspace=apps/chat -- src/chat-messages/chat-messages.service.spec.ts

---

## 12. Risks and Mitigations

1. Risk: Over-permissioning in chat_context due to incorrect profile resolution.
   Mitigation: strict profile lookup, deny on ambiguity, and explicit policy_authority telemetry.
2. Risk: Behavioral regressions in workflow-native governance.
   Mitigation: preserve layered path as default for workflow_context and add compatibility regression suite.
3. Risk: Mixed-mode complexity during migration.
   Mitigation: feature flags, environment-scoped rollout, and deterministic fallback to layered mode.
4. Risk: Operator confusion on where a denial originated.
   Mitigation: reason-code enrichment and run-level diagnostics panel showing authority chain.

---

## 13. Exit Criteria

1. Profile-first governance is the default for chat runtime capability authorization.
2. Duplicate allowlist maintenance between chat workflows and agent profiles is removed from normal operations.
3. Workflow-centric governance remains intact for workflow-native orchestration scenarios.
4. Documentation, tests, and rollout controls are complete for production adoption.
