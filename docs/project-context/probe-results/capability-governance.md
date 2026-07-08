---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: capability-governance
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/capability-governance/policy-engine.service.ts
  - apps/api/src/capability-governance/policy-engine.service.spec.ts
  - apps/api/src/capability-governance/tool-approval-rule.service.ts
  - apps/api/src/capability-governance/tool-approval-rule.service.crud.spec.ts
  - apps/api/src/capability-governance/tool-approval-rule.service.spec.ts
  - apps/api/src/capability-governance/tool-call-approval-request.service.ts
  - apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts
  - apps/api/src/capability-governance/tool-policy-decision.service.ts
  - apps/api/src/capability-governance/tool-policy-decision.service.spec.ts
  - apps/api/src/capability-governance/tool-policy-evaluator.service.ts
  - apps/api/src/capability-governance/tool-policy-evaluator.service.spec.ts
  - apps/api/src/capability-governance/tool-approval-rules.controller.ts
  - apps/api/src/capability-governance/tool-approval-rules.controller.spec.ts
  - apps/api/src/capability-governance/tool-call-approval-requests.controller.ts
  - apps/api/src/capability-governance/tool-call-approval-requests.controller.spec.ts
  - apps/api/src/capability-governance/capability-governance.module.ts
  - apps/api/src/capability-governance/capability-governance.module.spec.ts
  - apps/api/src/capability-governance/providers/approvals-capability.provider.ts
  - apps/api/src/capability-infra/capability-registry.service.ts
  - apps/api/src/capability-infra/capability-registry.service.spec.ts
  - apps/api/src/capability-infra/capability-infra.module.ts
  - apps/api/src/capability-infra/capability-infra.module.spec.ts
  - apps/api/src/capability-infra/capability.decorator.ts
  - apps/api/src/capability-infra/runtime-capability.decorator.ts
  - apps/api/src/capability-infra/capability-manifest.types.ts
  - apps/api/src/capability-infra/capability-registry.types.ts
  - apps/api/src/capability-infra/canonical-capability.types.ts
  - apps/api/src/capability-infra/runtime-capability.types.ts
  - apps/api/src/capability-infra/runtime-capability-schema.adapter.ts
  - apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.ts
  - apps/api/src/capability-infra/shared-capability-constants.ts
source_paths:
  - apps/api/src/capability-governance
  - apps/api/src/capability-infra
updated_at: 2026-06-02T01:15:00.000Z
---

# Probe Result: Capability Governance

## Narrative Summary

The capability-governance scope encompasses two NestJS modules providing the full lifecycle of tool capability governance: policy evaluation, approval request management, and the underlying capability infrastructure for registration, discovery, and schema handling. All core services are implemented and have co-located test coverage. No structural gaps were found.

**CapabilityGovernanceModule** exposes a 9-phase policy engine pipeline with services for rule CRUD, approval request lifecycle, profile policy evaluation, and tool policy document evaluation. Two REST controllers (`ToolApprovalRulesController`, `ToolCallApprovalRequestsController`) are guarded by JWT and role-based auth. The module exports all governance services and provides an `ApprovalsCapabilityProvider` that registers `submit_resource_artifact` with `mutating` and `approval_gated` policy tags.

**CapabilityInfraModule** provides the discovery infrastructure using NestJS `DiscoveryService` and `MetadataScanner`. The `@Capability` and `@RuntimeCapability` decorators tag providers and methods. The `CapabilityRegistryService` builds a manifest entry list sorted by name, exposes seeded entries, and bridges to the tool registry via `mapCapabilityEntryToToolRegistryPayload`. Zod schemas are converted to JSON Schema for registry consumption.

## Capability Updates

- **PolicyEngineService**: Orchestrates 9 phases — registration_check → publication_check → profile_deny → profile_allow → workflow_deny → workflow_allow → dynamic_rule → mode_gate → approval_override — producing a `PolicyDecision` with a full phase audit trail and a `decidedBy` label. Supports `allow`, `deny`, and `approval_required` outcomes.
- **ToolApprovalRuleService**: Full CRUD for approval rules with scope-based priority (workflow_run > chat_session > project > agent_profile > global), argument pattern matching (eq, contains, glob, regex) against tool call payloads, preflight and execution resolution paths, and rule creation from an approval decision.
- **ToolCallApprovalRequestService**: Deduplicates requests by SHA-256 correlation ID, emits `tool_call.approval_required` events, polls for resolution with configurable timeout (default 10 min) and poll interval (default 2 s), and resolves wait promises.
- **ToolPolicyDecisionService**: Evaluates profile tool policies with deny/allow/approval_required, preflight decisions, and runtime snapshot decisions with reason codes.
- **ToolPolicyEvaluatorService**: Evaluates `ToolPolicyDocument` rules with glob/regex tool matching, argument pattern matching (including absent-matcher), deep equality for nested objects, and result caching for regex patterns.
- **ToolApprovalRulesController**: CRUD endpoints (GET list, GET :id, POST create, PATCH update, DELETE) with role guard (`Admin`, `Developer`).
- **ToolCallApprovalRequestsController**: GET pending, POST :id/approve (with alwaysAllowExact / alwaysAllowSimilar / allowThisSession), POST :id/reject. Approve path can auto-promote to a persistent rule via `createRuleFromApproval`.
- **ApprovalsCapabilityProvider**: Registers `submit_resource_artifact` capability with api_callback transport, tier 2, and both `mutating` + `approval_gated` policy tags.
- **CapabilityRegistryService**: Implements `OnModuleInit`, scans all providers via `MetadataScanner`, reads `@Capability` metadata on methods and classes, builds manifest entries with JSON schema, and exposes `getSeededCapabilityEntries()` and `getDiscoveredEntryByName()`.
- **@Capability decorator / CAPABILITY_METADATA_KEY**: SetMetadata-based decorator carrying `DiscoveredCapabilityDefinition` (name, tierRestriction, policyTags, transport, runtimeOwner, description, inputSchema, apiCallback, bridgeAction, mutatingAction, modeBehavior, seedInRegistry).
- **@RuntimeCapability decorator**: Separate metadata key for runtime-level capability definitions.
- **CapabilityManifestEntry types**: Defines `CapabilityTransport` (api_callback, mounted_tool, runner_local, websocket_bridge), `CapabilityPolicyTag` (read_only, mutating, approval_gated, diagnostic, context, state), `MutatingActionUnion` (42 action types), `CapabilityModeOutcome` (allow, deny, require_approval).
- **CanonicalCapabilityDefinition**: Extends manifest entry with `CanonicalCapabilitySource` (decorator_provider, internal_tool_handler, external_mcp, external_acp, manual) and `sourceMetadata`.
- **runtime-capability-schema.adapter**: Converts Zod types to JSON Schema via `toJSONSchema`, strips `$schema`, removes empty `definitions`.
- **capability-manifest-to-tool-registry.mapper**: Maps `CapabilityManifestEntry` → partial `IToolRegistry` payload for tool projection.

## Health Findings

- **Test coverage**: Every service and controller has a co-located `.spec.ts` file. Module tests verify controller/provider/export metadata via `Reflect.getMetadata`.
- **`PolicyEngineService`**: 17 test cases covering all 9 phases, edge cases (undefined modeOutcome, null publicationStatus, null ruleEffect), explanation completeness on deny/allow, and approval_required override behavior.
- **`ToolApprovalRuleService`**: Two spec files — one covering CRUD operations, input validation, invalid regex, scope priority, and rule creation from approval; another covering argument pattern resolution with real-world security rules (investigation-subagent bash restrictions) and regex/glob operator matching.
- **`ToolCallApprovalRequestService`**: Tests correlation ID deduplication, event emission, approve/reject resolution, and timeout expiry.
- **`ToolPolicyDecisionService`**: Tests alias denial, approval-required policy evaluation, and runtime snapshot reason code extraction.
- **`ToolPolicyEvaluatorService`**: 9 test cases covering glob tool matching, multi-argument matching, nested object deepEqual, non-string argument matching, absent-matcher semantics, and rule-first-match ordering.
- **`ToolApprovalRulesController`**: Tests list/create/delete with mock service.
- **`ToolCallApprovalRequestsController`**: Tests auth guard, unknown request rejection, alwaysAllowSimilar safety validation, and auto-rule promotion on approval.
- **`CapabilityRegistryService`**: Tests discovery of `set_job_output` and `invoke_agent_workflow` with schema validation.
- **`CapabilityGovernanceModule`**: Validates 2 controllers, 6 providers, exports excluding `ApprovalsCapabilityProvider`.
- **`CapabilityInfraModule`**: Validates `DiscoveryModule` import, `CapabilityRegistryService` provider and export.

## Open Questions

- The `CapabilityGovernanceModule` is not imported anywhere in the scanned paths — its integration point into the application bootstrap (e.g., AppModule) is not visible in the scope but expected to be wired via the parent monorepo composition.
- `ToolCallApprovalRequestsController.listPending` falls back to a raw `find` without scope filtering when neither `scopeId` nor `workflowRunId` is provided — this may return all pending requests globally, which could be a large result set.
- No TTL/expires enforcement test exists for expired tool approval rules — the `expiresAt` field is stored but the query layer (`findActiveByToolName`) behavior on expired rules should be verified.
- The `approvalRequiredTools` set in `ToolPolicyDecisionService.decideRuntimeSnapshot` is only consulted in that one method; there is no shared cache of pending approval states across services.