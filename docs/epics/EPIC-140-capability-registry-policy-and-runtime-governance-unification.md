# EPIC-140: Capability Registry, Policy, and Runtime Governance Unification

Status: In Progress

## Implementation Update (2026-04-24)

### Phase Two: Policy and Governance Engine Consolidation

Completed in this slice:

- Added `PolicyEngineService` as the unified governance decision API:
  - 10-phase pipeline: registration_check, publication_check, profile_deny, profile_allow, workflow_deny, workflow_allow, dynamic_rule, mode_gate, approval_override, default_allow.
  - Each phase produces a `PolicyEnginePhaseResult` with outcome tracking.
  - Full `PolicyDecision` includes status, denied reason, and `explanation` with phases array and `decidedBy` field.
  - Each phase method is independently testable; total cyclomatic complexity per method ≤ 2.
- Migrated `CapabilityPreflightService` to consume `PolicyEngineService`:
  - `classifySingleCandidateCapability` now builds a `PolicyEngineInput` and calls `policyEngine.decide()`.
  - Extracted `resolveIsRegistered`, `resolveProfileDecision`, `checkChatContextDenial` helper methods to reduce complexity.
  - Removed post-classification approval merge loop (PolicyEngine handles Phase 9 natively).
- Migrated `ToolMountingService` to consume `PolicyEngineService`:
  - `canProfileUseTool` computes profileDecision via inlined `resolveProfileDecision` + `matchesAny` helpers, then delegates to `policyEngine.decide()`.
  - Replaced `ToolPolicyDecisionService` dependency with `PolicyEngineService`.
- Migrated `WorkflowRuntimeCapabilityExecutorService` to consume `PolicyEngineService`:
  - `evaluateSnapshotDecision` now builds a `PolicyEngineInput` and calls `policyEngine.decide()`.
  - Added `findDeniedToolEntry` helper for runtime denied tool lookup.
- Registered `PolicyEngineService` in `ToolModule` providers and exports.
- Added 21 unit tests covering:
  - All 10 phases and their short-circuit ordering.
  - Edge cases: null/undefined publicationStatus, modeOutcome, ruleEffect.
  - Explanation completeness and phase recording.
- Updated preflight service tests and workflow runtime capability lifecycle tests to use `PolicyEngineService`.
- Formatted `policy-engine.service.ts` with < 80 lines per method and ≤ 2 complexity per method.
- Removed `ToolPolicyDecisionService` dependency from all three migrated consumers.

Challenges and notes:

- `ToolMountingService.canProfileUseTool` needed a new `resolveProfileDecision` helper (inlined profile policy logic that was previously in `ToolPolicyDecisionService.evaluateProfileToolPolicy`).
- `WorkflowRuntimeCapabilityExecutorService.evaluateSnapshotDecision` required adapting the snapshot-based decision model (callable_tools/denied_tools/approval_required_tools) into the unified `PolicyEngineInput` shape.
- Lint complexity thresholds required extracting several helper methods from `classifySingleCandidateCapability` and `decide`.

Completed in this slice:

- Added canonical registration types and source classification:
  - `CanonicalCapabilityDefinition`
  - `CanonicalCapabilitySource`
  - registration summary and projection request contracts.
- Added `CapabilityRegistrarService` as a centralized ingest path for:
  - canonical first-party capability registration
  - external projection upserts.
- Added conflict detection in registrar for:
  - duplicate in-memory canonical entries with mismatched signatures
  - existing registry projection mismatches against canonical definitions.
- Refactored first-party seed flows to registrar:
  - `ToolSeederService`
  - `InternalToolSeederService`.
- Refactored external dynamic upsert flows to registrar projection API:
  - `McpRuntimeManagerService`
  - `AcpRuntimeManagerService`.
- Removed hardcoded setup fallback for architect tools:
  - `SetupService` now derives prompt + allowed tools from seeded agent profile definitions.
- Added/updated unit tests covering:
  - registrar conflict behavior and projection path
  - seeder integration to registrar
  - MCP/ACP manager registrar usage.
- Added `PolicyEngineService` as a unified phased decision pipeline.
- Migrated all three governance consumers (preflight, runtime executor, mounting) to `PolicyEngineService`.
- Added 21 unit tests for the phased pipeline, edge cases, and explanation completeness.
- Updated preflight and lifecycle test modules for the new dependency.

## Context & Problem Statement

The current tool and capability surface is powerful but fragmented across multiple registries, metadata systems, and enforcement layers. This creates configuration drift, duplicate definitions, and unclear ownership of what is truly authoritative.

### Current Fragmentation

1. Multiple registry systems co-exist:

- Database tool registry service.
- Decorator-discovered capability registry.
- Internal tool handler registry.
- Dynamic MCP and ACP upsert paths.

2. Multiple capability definition styles co-exist:

- Decorator-based provider capabilities.
- Internal tool getDefinition capability metadata.
- Runtime capability contracts and static runtime manifest entries.
- Runtime capability method decorators on selected endpoints.

3. Permission and governance checks are distributed:

- Workflow and job policy layering.
- IAM profile allow and deny checks.
- Capability preflight classification.
- Runtime execution governance checks.
- Mount-time enforcement and SDK allowlist side channels.

4. Setup bootstrap still contains hardcoded architect tool policy fallback, which can diverge from canonical seed definitions.

5. Seed and legacy compatibility paths are partly contradictory:

- File-based agent seeds are treated as canonical.
- Legacy skill assignment fallback still exists.

### Why This Matters

- Higher risk of behavior drift between preflight decisions, runtime execution permissions, and mounted tool availability.
- Increased maintenance cost from duplicate capability definitions.
- Harder onboarding and debugging due to unclear source of truth.
- Greater chance of authorization defects when allowlists differ by code path.

## Goals

1. Establish a single canonical capability model for first-party capabilities.
2. Treat tool registry persistence as a projection, not source-of-truth business logic.
3. Centralize policy and governance decisions so all execution paths evaluate the same rules.
4. Remove hardcoded permission fallback in setup and align bootstrap behavior with seeded definitions.
5. Keep ACP and MCP integrations while isolating them as external capability adapters with explicit namespace and policy boundaries.
6. Preserve backward compatibility during migration with phased cutover and measurable verification.

## Non-Goals

1. Rewriting workflow YAML semantics beyond policy and capability resolution behavior.
2. Removing ACP or MCP dynamic discovery features.
3. Replacing current orchestration mode system.
4. Broad frontend redesign unrelated to capability and policy governance.

## Architecture Decisions (Resolved)

### Decision 1: External Capability Namespace Strategy

Decision:
External ACP and MCP discovered capabilities remain in the same physical tool registry table for operational simplicity, but must be represented as namespaced external capability identities and governed by explicit external policy groups.

Rationale:

- Preserves existing runtime integration and search behavior.
- Avoids immediate data-model split risk.
- Provides clear guardrails for policy isolation and auditability.

Implementation direction:

- Keep registry rows, enforce namespaced identity conventions and source metadata.
- Policy engine classifies first-party vs external capabilities before allow and deny evaluation.

### Decision 2: approval_required Ownership Model

Decision:
approval_required is a layered outcome with three sources:

1. Capability metadata default behavior.
2. Profile-level approval_required_tools overrides.
3. Dynamic rule engine decisions.

Effective precedence:

- Explicit deny remains highest priority.
- approval_required can be asserted by any approval source unless explicitly denied.
- explicit allow can bypass only when no deny and no approval requirement is active.

Rationale:

- Supports safe defaults for sensitive capabilities.
- Preserves per-profile and runtime context governance.
- Keeps policy behavior explainable and auditable.

### Decision 3: policy_strategy Scope

Decision:
policy_strategy remains first-class but must be formally validated and documented for all workflow contexts, not only chat scenarios. profile_only is supported where explicitly configured and tested.

Rationale:

- Removes hidden semantics and one-off behavior assumptions.
- Enables deterministic policy behavior under workflows and chat.
- Improves policy migration confidence.

## Target End State

1. CanonicalCapabilityDefinition is the single source of truth for first-party capability metadata.
2. All capability producers feed one registration pipeline:

- Decorated provider producer.
- Internal tool handler producer.
- External MCP producer.
- External ACP producer.

3. Tool registry rows are generated and reconciled from that pipeline as a projection.
4. PolicyEngine returns one unified decision object used by:

- Capability preflight.
- Runtime capability execution.
- Tool mount filtering.
- SDK allowlist derivation.

5. Setup bootstrap never hardcodes architect allowed_tools; it derives from seeded profile definitions.
6. Legacy skill-assignment compatibility path is deprecated, monitored, and then removed.
7. Startup integrity checks fail fast in strict mode for duplicate or conflicting capability contracts.

## Workstreams & Detailed Tasks

### Workstream A: Canonical Capability Domain Model

- [ ] Introduce CanonicalCapabilityDefinition and CanonicalCapabilitySource types.
- [ ] Define required canonical fields:
  - name, transport, runtimeOwner, tierRestriction, schema, policyTags, bridgeAction, mutatingAction, modeBehavior, seedInRegistry, sourceMetadata.
- [ ] Implement compatibility mappers from existing sources:
  - decorator capability metadata
  - internal handler getDefinition metadata
  - external MCP-discovered tool metadata
  - external ACP-discovered agent metadata
- [ ] Add contract tests guaranteeing semantic parity between old and new representations.
- [ ] Add duplicate-name conflict detector with schema and transport mismatch diagnostics.

### Workstream B: Unified Registration Pipeline

- [ ] Implement CapabilityRegistrar service as the single ingest and reconciliation pipeline.
- [ ] Implement producer adapters:
  - [ ] DecoratedProviderCapabilityProducer
  - [ ] InternalHandlerCapabilityProducer
  - [ ] McpCapabilityProducer
  - [ ] AcpCapabilityProducer
- [ ] Refactor ToolSeeder and InternalToolSeeder to call CapabilityRegistrar only.
- [ ] Refactor ACP and MCP runtime manager upsert paths to call CapabilityRegistrar external ingestion API.
- [ ] Ensure deterministic ordering and idempotent projection updates.
- [ ] Emit structured event ledger telemetry for add, update, delete, and conflict outcomes.

### Workstream C: Policy and Governance Engine Consolidation

- [ ] Implement unified PolicyEngine decision API with explicit phases:
  - [ ] registration and existence check
  - [ ] publication status check
  - [ ] profile allow and deny resolution
  - [ ] workflow and job policy layering
  - [ ] mode behavior evaluation
  - [ ] dynamic rule evaluation
  - [ ] approval-required evaluation and final classification
- [ ] Migrate CapabilityPreflightService to consume PolicyEngine decisions.
- [ ] Migrate WorkflowRuntimeCapabilityExecutorService governance path to consume the same decision object.
- [ ] Migrate ToolMountingService filtering and SDK allowlist derivation to consume the same decision object.
- [ ] Preserve and enforce set_job_output required behavior through explicit contract rule, not implicit ad hoc logic.
- [ ] Add explainability payload for denied and approval_required outcomes with stable reason codes.

### Workstream D: Setup and Seed Source-of-Truth Alignment

- [ ] Remove hardcoded architect allowed_tools fallback from setup service.
- [ ] Ensure setup bootstrap reads architect profile contract from seeded agent definition and fails with actionable errors if missing.
- [ ] Validate seeded agent profiles against canonical capability catalog during startup.
- [ ] Keep agent profile creation via factory restricted to known capabilities from canonical catalog.
- [ ] Add startup guardrails for unknown tool references in allowed_tools, denied_tools, and approval_required_tools.

### Workstream E: Runtime Metadata and Duplicate Contract Cleanup

- [ ] Decide and enforce single active path for runtime capability metadata declaration.
- [ ] Remove or deprecate static runtime capability aggregate paths that are test-only and not runtime-authoritative.
- [ ] Keep RuntimeCapability decorator only if it is integrated into canonical registration; otherwise remove and migrate usages.
- [ ] Eliminate duplicate capability definition literals across internal tools by referencing canonical definitions.
- [ ] Ensure capability contract validator validates canonical source parity, not parallel ad hoc lists.

### Workstream F: External Capability Governance Hardening

- [ ] Add explicit external capability source metadata for ACP and MCP projection entries.
- [ ] Introduce policy groups for external capabilities with first-party separation controls.
- [ ] Add deny-by-default option for external capability classes in high-restriction modes.
- [ ] Add integrity checks for orphaned external registry entries and stale server mappings.
- [ ] Add structured diagnostics endpoints for effective capability inventory and source origin.

### Workstream G: Legacy Path Decommissioning and Migration

- [ ] Keep legacy skill assignment fallback under deprecation warning for one release window.
- [ ] Add migration aid to auto-write missing assigned_skills into agent.json when possible.
- [ ] Remove legacy assignment fallback and associated compatibility code after migration window.
- [ ] Update docs to reflect strict file-based seed ownership and removed fallback behavior.

### Workstream H: Testing, Quality Gates, and Operational Readiness

- [ ] Unit tests for CapabilityRegistrar conflict detection and reconciliation behavior.
- [ ] Unit tests for PolicyEngine precedence, reason codes, and approval semantics.
- [ ] Integration tests covering:
  - [ ] seeded first-party capability resolution
  - [ ] internal handler capability registration
  - [ ] ACP and MCP dynamic registration and pruning
  - [ ] preflight and runtime decision parity
  - [ ] mount-time vs execution-time policy consistency
- [ ] Regression tests for workflow policy_strategy behavior across chat and workflow paths.
- [ ] Lint and typecheck cleanup for touched files.
- [ ] Update architecture docs for unified capability lifecycle and policy engine flow.

## Sequencing Plan

### Phase 1: Foundations

- Canonical capability model.
- CapabilityRegistrar skeleton.
- Read-only parity tests and diagnostics.

### Phase 2: Registration Unification

- Route first-party decorated providers and internal tools through CapabilityRegistrar.
- Keep existing behavior behind compatibility layer.

### Phase 3: Policy Engine Cutover

- Migrate preflight and runtime execution governance to unified PolicyEngine.
- Migrate mount-time filtering and SDK allowlist derivation.

### Phase 4: Setup and Seed Hardening

- Remove hardcoded setup fallback.
- Add strict seeded policy validation and startup checks.

### Phase 5: External Adapter Consolidation

- Route ACP and MCP ingestion through registrar external adapters.
- Enforce external capability policy group behavior.

### Phase 6: Cleanup and Decommission

- Remove duplicate runtime contract paths.
- Remove legacy skill assignment fallback after migration window.
- Enable strict startup validation by default.

## Risks & Mitigations

1. Risk: Behavior regressions from policy centralization.

- Mitigation: parity tests comparing old and new effective decisions before cutover.

2. Risk: Startup failures due to newly enforced strict validation.

- Mitigation: staged rollout with warn-only mode and migration report output.

3. Risk: External ACP and MCP tools breaking due to stricter projection rules.

- Mitigation: adapter compatibility tests and source-specific integration tests.

4. Risk: Hidden dependencies on old runtime manifest constants.

- Mitigation: static usage scan and explicit deprecation shims for one release.

## Definition of Done

- [ ] Canonical capability model is the only authoritative first-party capability source.
- [ ] All registration producers flow through CapabilityRegistrar.
- [ ] Tool registry functions as a projection and no longer as independent capability authority.
- [ ] Preflight, runtime execution, mount filtering, and SDK allowlist generation use the same PolicyEngine decision model.
- [ ] Setup service contains no hardcoded architect allowed_tools fallback.
- [ ] Seeded agent profile tool references are validated against canonical capability inventory at startup.
- [ ] policy_strategy behavior is explicitly tested and documented for chat and workflow contexts.
- [ ] External ACP and MCP capabilities are source-attributed, namespaced, and governed with explicit policy groups.
- [ ] Legacy skill assignment fallback path is removed after migration window and docs are updated.
- [ ] Capability conflict detection prevents duplicate name mismatches on schema or transport in strict mode.
- [ ] Event ledger telemetry exists for registration changes, policy denials, and approval-required transitions with stable reason codes.
- [ ] Relevant API unit and integration suites pass for touched modules.
- [ ] Lint and typecheck pass for touched code.

## Key References

- apps/api/src/tool/tool-registry.service.ts
- apps/api/src/tool/capability-registry.service.ts
- apps/api/src/tool/internal-tool-registry.service.ts
- apps/api/src/tool/tool-seeder.service.ts
- apps/api/src/tool/tool-mounting.service.ts
- apps/api/src/tool/capability-preflight.service.ts
- apps/api/src/tool/tool-policy-decision.service.ts
- apps/api/src/workflow/internal-tool-seeder.service.ts
- apps/api/src/workflow/step-support.service.ts
- apps/api/src/workflow/step-support-tool-policy.helpers.ts
- apps/api/src/workflow/workflow-runtime-capability-executor.service.ts
- apps/api/src/workflow/workflow-runtime-capability.contracts.ts
- apps/api/src/workflow/workflow-runtime-tools.service.ts
- apps/api/src/workflow/step-agent-container-support.service.ts
- apps/api/src/security/iam-policy.service.ts
- apps/api/src/setup/setup.service.ts
- apps/api/src/database/seeds/startup-seed.service.ts
- apps/api/src/database/seeds/agent-profiles/agent-profiles-file-seed.service.ts
- apps/api/src/database/seeds/agent-profiles/agent-profile-seed.service.ts
- apps/api/src/database/seeds/agent-skill-assignments.seed.ts
- apps/api/src/mcp/mcp-runtime-manager.service.ts
- apps/api/src/acp/acp-runtime-manager.service.ts
- seed/README.md
- seed/agents/architect-agent/agent.json
- seed/workflows/chat-direct-agent-default.workflow.yaml
- packages/core/src/interfaces/workflow-legacy.types.ts

## Suggested Initial Slice (Execution-Friendly)

1. Introduce CanonicalCapabilityDefinition plus CapabilityRegistrar.
2. Route internal handler registration through registrar and projection.
3. Remove setup hardcoded architect tool fallback and enforce seeded-source validation.
4. Add parity tests proving preflight and mount filtering decisions remain consistent.
5. Publish migration and deprecation notice for legacy skill assignment fallback.
