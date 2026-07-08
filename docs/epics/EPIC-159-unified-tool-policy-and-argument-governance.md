# EPIC-159: Unified Tool Policy and Argument Governance

**Status:** Completed  
**Priority:** P1  
**Depends On:** EPIC-050, EPIC-115, `docs/architecture/tool-permissions-and-approvals.md`  
**Last Updated:** 2026-05-01  
**Owner:** TBD

---

## 1. Summary

Replace the current split tool permission model with a unified tool policy model that supports concise Claude-style rules, structured frontend/API rule authoring, runtime argument matching, human approval, and consistent enforcement across API-routed tools, runner-native tools, and `nexus_orchestrator` actions.

The end state is one policy interface, one compiler, and one evaluator. Operators should no longer need to put a tool in both `allowed_tools` and `approval_required_tools` to express "visible but approval-gated" behavior.

---

## 2. Technical Review & Alternatives

### 2.1 Principal Review

The proposed move from disparate legacy arrays to a unified `ToolPolicyDocument` is architecturally sound and aligns with mature Attribute-Based Access Control (ABAC) patterns. The "compiler" approach is the correct strategy for maintaining backward compatibility while centralizing logic. By moving argument-aware evaluation into every tool call, we close a significant security gap where statically allowed tools (like `bash`) were previously "blind" to their payloads unless explicitly flagged for approval.

### 2.2 Alternatives Considered

1. **OPA/Rego (Open Policy Agent):**
   - _Pros:_ Industry standard, powerful, and scalable.
   - _Cons:_ Introducing Rego as a dependency adds significant complexity for operators and makes bidirectional UI sync (string-to-builder-to-Rego) extremely difficult.
   - _Decision:_ Rejected in favor of a **Lightweight Domain-Specific Language (DSL)**. A custom grammar allows for the "Claude-style" syntax (e.g., `allow git checkout *`) which is much more intuitive for the target audience and easier to map to a structured UI builder.
2. **Casbin (ABAC/RBAC Library):**
   - _Pros:_ High performance, supports many persistence adapters.
   - _Cons:_ Less flexible for the specific "payload globbing" requirements of tool arguments without significant wrapper logic.
   - _Decision:_ Rejected. The logic for globbing JSON payloads is specific enough that a tailored implementation in `packages/core` is more maintainable.

---

## 3. Current-State Baseline

### 3.1 What already works

1. Agent profiles persist `allowed_tools`, `denied_tools`, and `approval_required_tools`.
2. Workflow/job YAML supports name-only `permissions.allow_tools` and `permissions.deny_tools`.
3. `tool_approval_rules` supports dynamic effects: `allow`, `deny`, and `require_approval`.
4. Dynamic rules can match shallow payload fields with `eq`, `contains`, `glob`, and `regex`.
5. Runner SDK and mounted tools are wrapped with `POST /api/workflow-runtime/check-permission` before execution.
6. `nexus_orchestrator` actions are narrowed by a separate runner-side action allowlist.

### 3.2 Gaps this epic closes

1. **Argument Blindness:** Static permissions are name-only and cannot express argument restrictions.
2. **Inconsistent Enforcement:** Runtime argument-aware rules only apply for tools already classified as approval-required.
3. **UX Confusion:** The `allowed_tools` plus `approval_required_tools` combination is confusing.
4. **Stale UI:** Frontend dynamic rule UI does not expose argument pattern authoring and uses stale scope values.
5. **Fragmentation:** `nexus_orchestrator` action allowlists are separate from the generic governance model.

---

## 4. Goals

1. **Canonical Model:** Introduce `ToolPolicyDocument` with `allow`, `deny`, and `require_approval` rules.
2. **Claude-style Syntax:** Support string rules like `allow bash *` or `require_approval git checkout *`.
3. **Structured Authoring:** Support JSON-based rule authoring for the frontend.
4. **Unified Evaluation:** Evaluate argument-aware rules for _every_ tool call.
5. **Legacy Compatibility:** Treat legacy arrays as compatibility input normalized by the compiler.
6. **Unified UI:** Add a unified policy editor to the frontend with payload preview/testing.
7. **Action Alignment:** Bring `nexus_orchestrator` action policy into this model.
8. **Diagnostics:** Provide clear explanations for _why_ a tool was allowed/denied/gated (e.g., "Matched rule #42 in Profile Scope").

---

## 5. Desired End-State Behavior

### 5.1 YAML authoring

```yaml
permissions:
  tool_policy:
    default: deny
    rules:
      - allow read *
      - allow git status *
      - require_approval git checkout *
      - deny rm -rf *
```

### 5.2 Precedence & Overrides

Rules are evaluated in a specific order of precedence to allow for both safety and flexibility:

1. **Guardrail Deny:** Platform-wide non-overrideable restrictions (e.g., "never allow `curl` to internal IPs").
2. **Normal Rules:** Ordered by scope (most specific to least specific):
   - `Session` -> `Workflow Run` -> `Job` -> `Workflow` -> `Agent Profile` -> `Project` -> `Global`.
3. **Default Behavior:** Fall back to the `default` effect (usually `deny`).

---

## 6. Risks & Mitigations

| Risk                     | Impact                                                                       | Mitigation                                                                                                                                                                      |
| :----------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ReDoS (Regex DoS)**    | High: A malicious or poorly written regex rule could hang the API evaluator. | **Strict Validation:** Limit regex complexity and prefer `glob` patterns. Use a timeout-bound regex engine for evaluation.                                                      |
| **Policy Latency**       | Med: Every tool call now requires a permission check round-trip.             | **Caching:** Implement a TTL-based LRU cache in the API for compiled policies per agent/session.                                                                                |
| **Precedence Confusion** | Med: Operators might not understand why a rule is being shadowed.            | **Traceability:** Return a full diagnostic trace in the `check-permission` response, showing all evaluated rules and the winner.                                                |
| **Command Aliasing**     | Low: `allow git *` might be bypassed by `bash -c "git ..."`                  | **Alias Resolution:** The compiler should map common command strings to their underlying tool execution patterns (e.g., mapping `git` string rules to `bash` payload matchers). |
| **UI/Model Sync**        | Low: Complex rules might not be representable in the UI builder.             | **Bidirectional Sync:** Ensure the parser/decompiler can handle all structured rule types; fall back to a "Raw String" editor for unsupported complex rules.                    |

---

## 7. Workstreams

### Workstream A: Core Policy Contract and Compiler

1. Add `ToolPolicyDocument`, `ToolPolicyRule`, and `ToolPolicyDecision` types in `packages/core`.
2. **Strict Grammar:** Implement a parser for concise string rules using a tool like `chevrotain` or simple regex-based tokenization.
3. **Normalization:** Build the compiler to merge legacy arrays and new policy documents into a single flattened rule list.

### Workstream B: API Evaluator and Persistence

1. **Database:** Add `tool_policy` JSONB to `agent_profiles` and create the `tool_policy_rules` table for scoped overrides.
2. **Evaluator:** Implement the precedence-aware evaluator.
3. **Migration:** Migrate `tool_approval_rules` to `tool_policy_rules`.

### Workstream C: Preflight and Runtime Enforcement

1. **Preflight:** Update snapshots to flag `runtimeCheckRequired` when a tool's permission depends on arguments.
2. **Enforcement:** Ensure `/workflow-runtime/check-permission` is called for _all_ tool calls.

### Workstream D: Frontend & UX

1. **Rule Builder:** Build a React component for authoring rules (Effect + Selector + Matchers).
2. **Preview Tool:** Add a "Policy Simulator" where users can input a tool/payload and see the resulting decision.

---

## 8. Acceptance Criteria

1. String rules like `allow bash *` compile and enforce correctly.
2. Argument-aware `deny` rules override name-based `allow` rules.
3. `guardrail_deny` cannot be bypassed by profile or workflow rules.
4. The frontend provides a clear UI for managing these rules with validation.
5. All tool calls produce audit logs containing the `matchedRuleId` and `explanation`.
6. Performance: Policy evaluation adds <10ms overhead (with caching).

---

## 9. Candidate Files

- `packages/core/src/tool-policy/*` (Types, Parser, Compiler)
- `apps/api/src/capability-governance/tool-policy-evaluator.service.ts`
- `apps/api/src/database/entities/tool-policy-rule.entity.ts`
- `apps/web/src/components/policy/ToolPolicyEditor.tsx`
- `docs/architecture/tool-permissions-and-approvals.md` (Update)

---

**Note to Engineering:** _Verify that the existing `NEXUS_RUNNER_DISABLE_GOVERNANCE_CHECK` flag remains functional for local development but is strictly audited in production._
