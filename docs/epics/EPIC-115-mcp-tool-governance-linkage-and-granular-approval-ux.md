# EPIC-115: MCP Tool Governance Linkage and Granular Approval UX

Status: Proposed  
Priority: P1  
Depends On: EPIC-080, EPIC-050, 2026-04-15-advanced-tool-permissions-and-approvals.md  
Last Updated: 2026-04-17  
Owner: TBD

---

## 1. Summary

Harden end-to-end MCP tool governance by closing gaps between MCP discovery, tool registry persistence, agent profile policy semantics, and human approval UX. This epic makes policy behavior explicit and visible, with first-class UI for argument-level approval rules and clear runtime diagnostics.

---

## 2. Current-State Baseline

### 2.1 What already works

1. MCP server configs are persisted in mcp_servers and can be tested/reloaded from Settings.
2. Discovered MCP tools are synchronized into tool_registry with generated names and api_callback invoke paths.
3. Agent profile create/edit UI can set allowed_tools, denied_tools, and approval_required_tools.
4. Runtime capability preflight and execution evaluate denied and approval_required semantics.
5. Tool call approval requests are available in Notifications and support approve/reject plus sticky allow options.
6. Dynamic tool approval rules exist in backend and support argument-level matching operators.

### 2.2 Gaps this epic closes

1. No explicit relational link between discovered MCP tools and their source mcp_server record.
2. MCP discovery freshness relies on bootstrap/manual reload rather than scheduled reconciliation.
3. Agent profile tool fields accept arbitrary strings without registry-backed validation at admin CRUD boundaries.
4. IAM policy cache is allowlist-only, which creates semantic drift from denied and approval_required fields outside preflight/executor paths.
5. Argument-level rule authoring and visibility are not first-class in frontend admin UX.
6. Existing Notifications approval UI does not expose full pattern authoring/inspection lifecycle.

---

## 3. Problem Statement

Operators can configure MCP servers and see discovered tools, but governance remains partially implicit. Policy intent is split across multiple layers (IAM cache, profile lists, preflight, runtime rules, approval queue) and only part of that model is visible/editable in frontend.

This causes confusion in production:

1. "Why is denied_tools present if IAM only tracks allowed tools?"
2. "Where can I inspect/edit argument-based allow or deny rules?"
3. "Which MCP tool came from which server, and when was it last reconciled?"

Without tighter linkage and UI, users perceive capability behavior as inconsistent even when backend logic exists.

---

## 4. Goals

1. Make MCP-to-tool lineage explicit and queryable.
2. Keep discovered MCP tool inventory fresh without manual intervention.
3. Enforce profile tool-name correctness against active registry capabilities.
4. Eliminate policy semantic drift between IAM-mounted tools and runtime capability governance.
5. Ship a dedicated frontend/admin surface for argument-level rule management.
6. Improve explainability for denied, approval-required, and rule-derived outcomes.
7. Refactor tool-governance evaluation into a single policy decision service to remove duplicated logic and reduce drift.

---

## 5. Non-Goals

1. Replacing existing MCP transport implementations.
2. Replacing workflow orchestration mode semantics.
3. Rebuilding Notifications from scratch.
4. Introducing a brand-new policy engine.

---

## 6. Desired End-State Behavior

1. Every MCP-discovered tool carries a durable source linkage to mcp_server_id.
2. MCP catalogs reconcile on startup and on a scheduled cadence with audit events.
3. Agent profile create/update rejects unknown tool names unless explicitly marked as legacy.
4. Effective policy computation is unified and returned consistently in runtime capability snapshots.
5. Frontend exposes:
   - Pending approval requests
   - Existing tool approval rules
   - Rule creation/editing with argument pattern builders (eq, contains, glob, regex)
   - Scope controls (session, project, profile, global)
6. Runtime diagnostics clearly attribute denial to:
   - profile allowed/denied
   - workflow/job permission policy
   - orchestration mode
   - dynamic rule
   - human rejection

---

## 7. Workstreams

### Workstream A: MCP Lineage and Reconciliation

1. Add source linkage from tool_registry records to MCP origin metadata and/or foreign-key reference.
2. Add scheduled MCP reconciliation job with backoff and observability counters.
3. Add stale/disconnected server diagnostics and last-successful-sync visibility.

### Workstream B: Policy Consistency and Validation

1. Add admin-layer validation of profile tool arrays against registry names.
2. Define canonical merge order for allowed, denied, approval_required, workflow policy, and dynamic rules.
3. Align IAM/mount-time filtering with canonical policy semantics (or explicitly scope IAM to mount-only concerns with documented behavior).

### Workstream C: Granular Approval Rule UX

1. Add API endpoints for listing and managing tool_approval_rules (if missing or partial).
2. Add frontend page/panel for rule CRUD, search, and scope filtering.
3. Add argument pattern editor with validation and preview matching behavior.
4. Link rule provenance from Notifications approval actions.

### Workstream D: Observability and Explainability

1. Add structured reason codes and remediation hints to all denial paths.
2. Extend UI capability health/readouts to show effective policy contributors.
3. Emit events for reconciliation, rule hits, approval queue outcomes, and policy drift warnings.

### Workstream E: Tool Governance Refactor (DRY/SOLID)

1. Introduce a single ToolPolicyDecisionService that computes effective outcome for a tool call:
   - allow
   - deny
   - approval_required
2. Centralize policy precedence in one place:
   - profile allowed_tools
   - profile denied_tools
   - profile approval_required_tools
   - workflow/job allow/deny policies
   - orchestration mode gates
   - dynamic tool_approval_rules
3. Replace duplicated/parallel checks in IAM mount filtering, preflight, and executor with shared policy primitives and adapters.
4. Return consistent reason_code, reason, remediation, and policy_authority from all call sites.
5. Add regression tests proving equivalent behavior across chat and workflow execution paths.

---

## 8. Acceptance Criteria

1. MCP-discovered tools can be traced to source server in API and UI.
2. Scheduled reconciliation updates discovered tools without manual reload.
3. Profile update API rejects unknown tool names with actionable error payloads.
4. Denied and approval_required semantics are verifiably applied in runtime capability tests.
5. Frontend provides rule management UX for argument-based approvals/denials.
6. Notifications approval actions can create scoped rules with inspectable argument patterns.
7. Diagnostics identify the exact layer that blocked a tool call.
8. A single policy engine owns precedence rules; mount-time, preflight, and executor paths consume shared outputs rather than re-implementing decision logic.

---

## 9. Verification Strategy

1. Unit tests for rule matching, precedence, and policy merge logic.
2. Integration tests for MCP discovery sync, stale tool pruning, and lineage integrity.
3. API tests for profile validation failures and rule CRUD.
4. Web unit/integration tests for rule editor and approval flows.
5. Deterministic end-to-end flow covering:
   - approval_required tool call
   - approve once
   - approve with persistent similar-pattern rule
   - subsequent auto-allow via rule match

---

## 10. Candidate Files (Initial)

1. apps/api/src/mcp/mcp-runtime-manager.service.ts
2. apps/api/src/mcp/mcp.service.ts
3. apps/api/src/database/entities/tool-registry.entity.ts
4. apps/api/src/database/repositories/tool-registry.repository.ts
5. apps/api/src/ai-config/ai-config-admin.service.ts
6. apps/api/src/ai-config/dto/profiles/create-profile.dto.ts
7. apps/api/src/ai-config/dto/profiles/update-profile.dto.ts
8. apps/api/src/security/iam-policy.service.ts
9. apps/api/src/tool/tool-approval-rule.service.ts
10. apps/api/src/tool/tool-call-approval-requests.controller.ts
11. apps/web/src/pages/Notifications.tsx
12. apps/web/src/pages/agents/AgentProfileForm.fields.tsx
13. apps/web/src/pages/settings/McpServersCard.tsx
14. apps/web/src/lib/api/client.ts
15. apps/web/src/lib/api/types.ts
16. apps/api/src/workflow/step-support.service.ts
17. apps/api/src/workflow/workflow-runtime-capability-executor.service.ts
18. apps/api/src/tool/capability-preflight.service.ts
19. apps/api/src/tool/capability-preflight.helpers.ts
20. apps/api/src/chat-execution/chat-execution.service.ts

---

## 11. Risks and Mitigations

1. Risk: Policy changes break existing seeded profiles.
   Mitigation: Add compatibility mode and migration diagnostics.
2. Risk: Rule precedence confusion increases operator error.
   Mitigation: Add explicit precedence visualization and dry-run evaluator.
3. Risk: Reconciliation load spikes external MCP endpoints.
   Mitigation: Use jittered schedules, retries, and circuit-breaker behavior.

---

## 12. Open Questions

1. Should MCP lineage use strict FK columns or schema metadata only?
2. Should rule CRUD be Admin-only or Admin+Developer?
3. Should project-scoped rules support expirations by default?
4. Should IAM policy cache include denied/approval lists, or remain allowlist-only with clear boundary docs?

### 12.1 Decisions (Resolved 2026-04-17)

The architecture review for this epic resolved the highest-impact open questions.

1. MCP lineage will use a strict FK column on tool registry (`tool_registry.mcp_server_id -> mcp_servers.id`) plus sync metadata columns for diagnostics.
2. Rule CRUD will be Admin+Developer (same role model as MCP server reload/test), with sensitive global-scope actions audit-logged.
3. Project-scoped rules should support expirations and default to a safe TTL (for example 30 days) unless explicitly set.
4. IAM remains mount-time focused, but it must consume the same canonical policy decision primitives used by preflight/executor to avoid semantic drift.

---

## 13. Captured Findings (2026-04-17)

This section records verified implementation details and behavior caveats discovered during architecture review.

### 13.1 Tool governance behavior by layer

1. IAM policy service currently models allowlist-only behavior based on profile.allowed_tools.
2. denied_tools and approval_required_tools are enforced in capability resolution/execution layers rather than IAM cache.
3. This creates a multi-layer policy model where semantics are valid but distributed, increasing cognitive load and drift risk.

### 13.2 Granular approval functionality status

1. Backend granular rule support exists with operators: eq, contains, glob, regex.
2. Tool call approval request flow exists end-to-end in backend and Notifications.
3. Frontend supports approve/reject and sticky flags (always exact, always similar, session only).
4. Frontend does not yet provide a first-class rule management UI for listing/editing/deleting argument-pattern rules.
5. Frontend does not yet provide rich authoring of similarPatterns during approval decisions.

### 13.3 Important caveat to preserve in implementation plan

1. If "always allow similar" is selected without explicit similarPatterns, backend may create a rule with empty patterns.
2. Empty-pattern rules are treated as unconditional match at that scope for that tool.
3. This can lead to broader allow behavior than operators expect.
4. Epic implementation must address this by requiring explicit pattern synthesis or safe defaults.

### 13.4 Lineage and reconciliation observations

1. MCP-discovered tools are persisted to tool_registry and exposed to agent profile tool pickers.
2. MCP-to-tool linkage is currently inferred by generated naming convention/prefix behavior rather than strict relational lineage.
3. Discovery freshness depends on bootstrap and explicit reload operations; scheduled reconciliation is not yet first-class.

### 13.5 Additional verified findings (2026-04-17)

1. Tool governance is currently evaluated across multiple layers with partially duplicated logic:
   - `apps/api/src/security/iam-policy.service.ts`
   - `apps/api/src/workflow/step-support.service.ts`
   - `apps/api/src/tool/capability-preflight.service.ts`
   - `apps/api/src/workflow/workflow-runtime-capability-executor.service.ts`
2. The admin profile path currently accepts tool arrays without registry-backed validation (`apps/api/src/ai-config/ai-config-admin.service.ts`).
3. Factory-created profiles already validate `allowed_tools` against active registry names (`apps/api/src/ai-config/services/agent-factory.service.ts`), creating inconsistent behavior between admin and factory paths.
4. Approval-rule CRUD is not exposed as first-class API/UI lifecycle management today:
   - Backend service/repository exist, but no dedicated rules controller endpoints.
   - Web supports approve/reject actions in Notifications, but not listing/editing/deleting rules.
5. `alwaysAllowSimilar` can produce unexpectedly broad allow semantics when no explicit `similarPatterns` are provided:
   - Approval endpoint accepts optional `similarPatterns`.
   - Rule matching treats empty patterns as unconditional match at scope/tool level.

---

## 14. Refactor Rationale

Refactoring approval logic provides clear architectural benefits.

1. DRY: removes repeated policy checks spread across IAM mount gating, preflight, and executor paths.
2. SOLID:
   - single responsibility for policy decisioning
   - open/closed via policy plugins/rules rather than ad hoc branching
   - dependency inversion by consuming a shared policy interface in workflow/chat layers
3. Correctness: one precedence implementation prevents mismatched outcomes between "what mounts" and "what executes".
4. Explainability: one decision contract yields consistent reason codes/remediation for UI and telemetry.
5. Testability: one matrix-driven policy suite instead of scattered behavior assertions.

Refactor should be incremental, with adapters preserving behavior while call sites are migrated.

---

## 15. Architecture Decisions and Alternatives

### 15.1 Recommended target architecture (adopted)

1. Introduce a unified `ToolPolicyDecisionService` as the single policy authority for tool-call outcomes.
2. Keep existing call sites (IAM mount filtering, capability preflight, runtime executor) but migrate them to shared decision primitives/adapters.
3. Add explicit MCP lineage in DB schema (`mcp_server_id` on tool registry) and scheduled reconciliation with jitter/backoff.
4. Add backend rule CRUD endpoints and a dedicated frontend rule-management surface.
5. Standardize denial/approval diagnostics with reason codes, policy authority, and remediation guidance.

### 15.2 Canonical precedence (single source of truth)

The unified policy decision path must evaluate in this order:

1. Tool existence/publication eligibility (registry and publication state).
2. Profile allow baseline (`allowed_tools`, wildcard handling).
3. Profile deny overrides (`denied_tools`).
4. Workflow/job policy overlays (allow/deny).
5. Orchestration mode gates (autonomous/supervised/notifications-only behavior).
6. Dynamic approval-rule overrides (`tool_approval_rules`) by scope specificity and priority.
7. Final approval-required resolution (`approval_required_tools` + dynamic `require_approval`) before execution.

### 15.3 Alternatives considered

1. Keep current split services and only improve docs.
   - Rejected: does not reduce semantic drift risk and keeps duplicated logic.
2. Replace with an external policy engine now.
   - Rejected for this epic: high migration risk and scope expansion; not required to achieve deterministic governance.
3. Metadata-only MCP lineage in JSON schema.
   - Rejected: weaker integrity/queryability than FK-backed lineage and harder to maintain under refactors.

### 15.4 Why this is the best quality path

1. Minimizes future refactors by converging policy logic now under one decision contract.
2. Preserves current behavior incrementally while enabling strict regression testing at each migration step.
3. Improves operator trust through visible, inspectable, and explainable policy behavior.

---

## 16. Epic-Level Guardrails for Implementation

1. No behavior-changing migration without targeted regression tests covering chat and workflow paths.
2. No lint suppression or rule downgrades to land governance refactors.
3. Backward compatibility for existing seeded profiles/tools must be measured and reported before cutover.
4. Approval-rule safety requirement:
   - `alwaysAllowSimilar` must require explicit pattern synthesis or explicit confirmation of broad scope.
   - Empty-pattern unconditional rules must be blocked or converted to safe exact-match defaults.
5. Every denial path must return/emit:
   - `reason_code`
   - human-readable `reason`
   - `policy_authority`
   - actionable `remediation`

---

## 17. Implementation Plan Artifact

Detailed phase plan for execution is tracked in:

`docs/plans/PLAN-EPIC-115-tool-governance-unification-and-approval-ux.md`

This plan defines dependency order, migration checkpoints, test gates, rollout strategy, and rollback criteria.
