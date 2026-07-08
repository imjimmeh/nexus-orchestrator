# EPIC-050: Capability Contract and Orchestration Tooling Excellence

> Status: Planned
> Priority: Critical
> Estimate: 6-10 weeks
> Created: 2026-04-05
> Owner: TBD

---

## 1. Epic Summary

Stabilize and upgrade orchestration by eliminating tool/capability contract drift and shipping a complete, testable capability surface for orchestration agents.

This epic turns the current system from "declared capabilities" into "guaranteed callable capabilities" by introducing:

1. Single-source capability contracts.
2. Pre-dispatch capability validation.
3. Runtime capability introspection.
4. Real memory/history retrieval tools.
5. Stronger orchestration action primitives.
6. Observability and diagnostics for stuck/risky runs.

---

## 2. Problem Statement

Current orchestration behavior shows contract mismatch between prompts, workflows, profiles, mounted tools, bridge actions, and gateway handlers.

Examples of impact:

1. Agents are instructed to use tools that may not be callable in their runtime context.
2. Capability semantics are spread across multiple layers (catalog, profile, workflow permissions, bridge enum, gateway subscriptions).
3. Some tools are placeholders rather than production retrieval mechanisms.
4. Operators cannot reliably infer why a run got stuck (policy denial, missing handler, missing mounted tool, or approval queue).

Result:

1. Non-deterministic orchestration behavior.
2. Increased run failures and manual interventions.
3. Lower trust in autonomous/supervised mode boundaries.

---

## 3. Goals

1. Introduce a single source of truth for tool and capability contracts.
2. Guarantee that required tools are callable before workflow dispatch.
3. Align orchestration agent prompts with actual runtime capability availability.
4. Add first-class retrieval for project goals, orchestration state, work-item history, and decision timelines.
5. Improve orchestration primitives for planning, approval, and safe mutation.
6. Add diagnostics that explain why a run is blocked or degraded.
7. Build a regression suite that prevents future contract drift.

---

## 4. Non-Goals

1. Replacing the workflow engine architecture.
2. Replacing container orchestration infrastructure.
3. Designing a full portfolio/multi-project orchestration planner.
4. Introducing a new model provider strategy.
5. Building a full visual orchestration designer.

---

## 5. Design Principles

1. Contract-first: every declared capability must map to a callable runtime implementation.
2. Fail fast: invalid capability combinations are rejected before container execution.
3. Explainability: denials and degradations must produce machine-readable reasons.
4. Determinism: same workflow + profile + mode should produce stable capability sets.
5. Compatibility: staged migration to avoid breaking active seeded workflows.

---

## 6. Current Gaps to Address

### 6.1 Capability Contract Fragmentation

Capability declarations are distributed across:

1. Tool catalog definitions.
2. Profile allowed tool lists.
3. Workflow-level allow/deny policies.
4. Runner bridge action enum.
5. Gateway message handlers.

This enables drift and hidden incompatibilities.

### 6.2 Callable vs Declared Tool Drift

Declared tools can exist without an end-to-end callable path in a given runtime context.

### 6.3 Weak Runtime Introspection

Agents cannot reliably query what they can currently execute and why something is unavailable.

### 6.4 Incomplete Memory/History Retrieval

Memory and context retrieval are not consistently backed by production-grade APIs.

### 6.5 Limited Diagnostics

When runs stall, root-cause visibility is insufficient for operators and agents.

---

## 7. Target Architecture

### 7.1 Capability Manifest (Single Source of Truth)

Introduce a manifest describing each capability:

1. name
2. schema
3. transport (api callback vs websocket bridge)
4. tier restrictions
5. policy tags (mutating, read-only, approval-gated)
6. mode behavior matrix (autonomous, supervised, notifications_only)

### 7.2 Contract Compiler/Validator

Build a compile-time/runtime validator that checks:

1. manifest <-> registry parity
2. manifest <-> bridge action parity
3. manifest <-> gateway handler parity
4. profile/workflow references only use defined capabilities

### 7.3 Dispatch Preflight Gate

Before a job starts, verify:

1. required_tool_calls are callable in the exact resolved context
2. output_tool is callable and transport-compatible
3. policy/mode restrictions are satisfiable

If not, fail run with structured reason code.

### 7.4 Runtime Capability Discovery

Add a `get_capabilities` tool returning:

1. callable tool names
2. denied tools with reasons
3. mode and approval constraints
4. required next user/operator action (if any)

### 7.5 Retrieval and Orchestration Context Tools

Add or harden tools for:

1. get_project_brief (goals, strategy, active blockers, pending approvals)
2. get_project_state (expanded, consistent shape)
3. get_work_item_history
4. get_orchestration_timeline
5. query_memory (real retrieval, not placeholder response)

### 7.6 Orchestration Mutation Primitives

Strengthen action tools with:

1. idempotency keys
2. explicit policy evaluation outputs
3. standardized execution status model
4. actionable remediation hints for denied/queued actions

---

## 8. Workstreams

### Workstream A: Capability Manifest and Contract Validation

1. Add manifest schema and loader.
2. Generate/validate contract artifacts.
3. Add startup guardrails and CI checks.

### Workstream B: Dispatch Preflight and Failure Codes

1. Add preflight capability resolver.
2. Add structured failure taxonomy.
3. Emit preflight telemetry and decision-log entries.

### Workstream C: Tooling Parity and Bridge Alignment

1. Align runner bridge actions with orchestration needs.
2. Ensure gateway handlers exist for all bridged actions.
3. Remove duplicate/manual capability declarations where possible.

### Workstream D: Retrieval Capability Upgrade

1. Implement real memory retrieval tool path.
2. Add orchestration/project/work-item history retrieval tools.
3. Standardize response contracts.

### Workstream E: Policy, Governance, and Mode Semantics

1. Enforce consistent mode-aware mutation policies.
2. Attach explainable denial/recommendation payloads.
3. Add approval-aware action metadata.

### Workstream F: Observability and Diagnostics

1. End-to-end trace correlation for tool and action execution.
2. "Why blocked" diagnostic endpoint for orchestration runs.
3. Metrics and alerts for contract-drift symptoms.

### Workstream G: Regression and Evaluation Suite

1. Contract parity tests.
2. Mode behavior matrix tests.
3. End-to-end orchestration lifecycle tests.
4. Degradation/fault-injection tests.

---

## 9. Delivery Plan

### Phase 1 (Weeks 1-2): Stabilization Foundation

1. Introduce capability manifest scaffold.
2. Add preflight checks for required_tool_calls/output_tool.
3. Fix highest-risk parity gaps in orchestration action wiring.
4. Add test coverage for parity checks.

### Phase 2 (Weeks 3-5): Retrieval and Introspection

1. Ship get_capabilities.
2. Replace placeholder query_memory behavior with real retrieval path.
3. Add get_project_brief and expanded get_project_state shape.
4. Add structured denial/recommendation payloads.

### Phase 3 (Weeks 6-8): Governance and Diagnostics

1. Add idempotency and explicit mutation action statuses.
2. Add run diagnostics endpoint and trace correlation.
3. Extend e2e tests and chaos/fault scenarios.
4. Finalize docs and operational runbooks.

### Phase 4 (Optional Hardening, Weeks 9-10)

1. Manifest-driven code generation for bridge/handler stubs.
2. Automated drift detection in CI with strict enforcement.

---

## 10. Backend Scope

### Expected Files to Modify

1. apps/api/src/tool/tool-catalog.service.ts
2. apps/api/src/workflow/step-support.service.ts
3. apps/api/src/workflow/step-agent-step-executor.service.ts
4. apps/api/src/telemetry/telemetry.gateway.ts
5. apps/api/src/telemetry/telemetry-gateway-orchestration-compat.helpers.ts
6. apps/api/src/project/project-orchestration.service.ts
7. apps/api/src/security/iam-policy.service.ts
8. apps/api/src/database/seeds/project-\*.workflow.yaml
9. apps/api/src/database/seeds/agent-profiles/profiles/\*.profile.ts

### Expected Files to Create

1. apps/api/src/tool/capability-manifest.ts
2. apps/api/src/tool/capability-contract-validator.service.ts
3. apps/api/src/tool/capability-preflight.service.ts
4. apps/api/src/tool/dto/get-capabilities.dto.ts (if needed)
5. apps/api/src/project/project-brief.service.ts (or equivalent)
6. apps/api/src/project/project-orchestration-diagnostics.controller.ts
7. tests for contract parity and preflight failures

---

## 11. Runner Scope

### Expected Files to Modify

1. packages/pi-runner/src/nexus-bridge-tools.ts
2. packages/pi-runner/src/session-factory.ts
3. packages/pi-runner/src/server.ts

### Expected Files to Create

1. packages/pi-runner/src/capability-contract.types.ts
2. packages/pi-runner/src/capability-contract.spec.ts

---

## 12. Frontend Scope

### Expected Files to Modify

1. apps/web/src/lib/api/client.ts
2. apps/web/src/lib/api/types.ts
3. apps/web/src/pages/project-workspace/OrchestrationTab.tsx

### Expected Files to Create

1. apps/web/src/components/orchestration/CapabilityHealthPanel.tsx
2. apps/web/src/components/orchestration/RunBlockReasonCard.tsx

---

## 13. Acceptance Criteria

### 13.1 Contract Integrity

1. Every capability referenced by profiles/workflows exists in manifest.
2. Every manifest capability has a validated runtime transport implementation.
3. CI fails on parity drift.

### 13.2 Preflight Guarantees

1. Runs fail before execution when required tools are not callable.
2. Failure payload includes deterministic reason code and remediation hint.

### 13.3 Runtime Introspection

1. Agents can call get_capabilities and receive callable + denied capability lists with reasons.
2. Responses include mode/policy constraints.

### 13.4 Retrieval Quality

1. query_memory returns real persisted results.
2. Agents can retrieve project goals and orchestration context on demand.
3. Agents can retrieve work item and orchestration timeline/history context.

### 13.5 Governance and Mutations

1. Mutating actions are mode-aware and auditable.
2. Mutating action execution is idempotent and status-tracked.
3. Denied/queued actions are visible in logs and UI.

### 13.6 Diagnostics and Observability

1. Operators can identify blocked run cause in one API call.
2. Tool/action traces are correlated across workflow, step, and telemetry events.

### 13.7 Quality Gate

1. Unit, integration, and e2e suites pass with new capability contracts.
2. New fault-injection tests pass for degraded/missing capability paths.

---

## 14. Risks and Mitigations

1. Risk: Breaking seeded workflows during contract unification.
   Mitigation: Add compatibility adapters and phased migration flags.

2. Risk: Increased complexity from manifest + validators.
   Mitigation: Keep manifest minimal and generate helper code where possible.

3. Risk: Operational noise from strict preflight in early rollout.
   Mitigation: Start in warn mode, then enforce once drift is reduced.

4. Risk: Performance overhead in preflight and diagnostics.
   Mitigation: Cache capability resolution per run context.

---

## 15. Dependencies

1. EPIC-046 Autonomous Project Orchestrator
2. EPIC-048 Subagent Runtime Wiring and Coordination Baseline
3. EPIC-049 Orchestration Modes Behavioral Implementation

---

## 16. Definition of Done

1. Capability contract drift is prevented by automated validation.
2. Required tool callable guarantees exist before execution starts.
3. Orchestration agents can retrieve goals/state/history reliably at runtime.
4. Mutating orchestration actions are consistent, auditable, and mode-safe.
5. Operators can diagnose blocked runs with clear machine-readable causes.
6. Documentation, tests, and seeded workflows align with the new contract model.
