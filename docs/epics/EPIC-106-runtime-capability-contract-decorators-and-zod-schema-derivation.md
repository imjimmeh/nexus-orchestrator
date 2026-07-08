# EPIC-106: Runtime Capability Contracts via Decorators and Zod Schema Derivation

Status: In Progress
Priority: P1
Depends On: EPIC-050
Related:

1. docs/epics/EPIC-050-capability-contract-and-orchestration-tooling-excellence.md
2. docs/epics/EPIC-078-scheduled-jobs-and-cron-lifecycle.md
3. apps/api/src/tool/capability-manifest.runtime.entries.ts
4. apps/api/src/workflow/workflow-runtime-tools.controller.ts
5. apps/api/src/workflow/workflow-runtime-tools.controller.types.ts
   Last Updated: 2026-04-15

---

## 1. Summary

Make runtime capability contracts agent-first and drift-resistant by moving from hand-authored JSON schema blocks to decorator-attached Zod schemas.

Core outcome:

1. Capability manifest remains the contract agents must satisfy.
2. Contract fields are defined once at endpoint ownership points.
3. Manifest schemas are generated from Zod and assembled automatically.

---

## 2. Problem

Current runtime capability definitions require manually maintaining multiple contract surfaces:

1. Controller request interfaces.
2. Capability manifest schema objects.
3. API callback mappings and route ownership.

This causes drift risk and slower iteration. Existing examples already show mismatch potential for enum strictness and naming aliases.

---

## 3. Goals

1. Preserve capability manifest as the exact agent-facing input contract.
2. Use decorators to bind capability metadata to route handlers.
3. Use Zod as source of truth for input contracts.
4. Derive manifest JSON schema from Zod automatically.
5. Keep capability catalog and startup validation compatible with current runtime behavior.
6. Deliver migration path that does not break seeded tools or active workflows.

## 4. Non-Goals

1. Full rewrite of workflow runtime controllers.
2. Full response-schema typing for every runtime tool in initial phase.
3. Replacing existing capability preflight or policy engines.
4. Introducing a new API transport model.

---

## 5. Design Principles

1. Agent-first contract fidelity: if it is in manifest, agent may rely on it.
2. Single source of truth: no duplicate manual schema maintenance.
3. Endpoint ownership: contract metadata lives with the owning controller method.
4. Backward compatibility: preserve current callable names and transport behavior.
5. Incremental migration: ship in slices with parity tests.

---

## 6. Target Architecture

### 6.1 Decorator Contract Metadata

Add a decorator for runtime-capable endpoints, for example RuntimeCapability.

Decorator metadata includes:

1. capability name.
2. policy tags.
3. tier restriction.
4. runtime owner and transport.
5. api callback path and body mapping.
6. mutating action and mode behavior when applicable.
7. Zod input schema.

### 6.2 Zod to JSON Schema Derivation

Add a schema adapter that converts Zod definitions to JSON schema for manifest fields.

Rules:

1. Supported subset must be explicit and tested.
2. Derived schema must remain compatible with tool registry validation pipeline.
3. Conversion failures should fail fast in startup validation.

### 6.3 Manifest Assembly

Build runtime capability entries from discovered decorator metadata instead of large static literal blocks.

Manifest assembly responsibilities:

1. collect decorated endpoints.
2. derive schema from Zod.
3. materialize CapabilityManifestEntry records.
4. merge with existing execution entries.

### 6.4 Contract Validation and Parity

Extend capability contract validator checks:

1. decorated route exists for each runtime api_callback capability.
2. capability names remain unique across runtime and execution entries.
3. derived schema exists and passes registry schema validation.

---

## 7. Workstreams

### Workstream A: Contract Infrastructure

1. Add runtime capability decorator and metadata types.
2. Add manifest builder from decorator metadata.
3. Add Zod-to-JSON-schema adapter and compatibility guards.

### Workstream B: First-Slice Migration

Migrate first high-value runtime endpoints:

1. query_memory.
2. manage_todo_list.
3. list_schedules.

### Workstream C: Runtime Entries Decomposition

Split runtime entries into bounded context modules and reduce aggregator to composition-only.

Target module split:

1. memory and context queries.
2. project and work-item queries.
3. workflow definition lifecycle.
4. schedule lifecycle.

### Workstream D: Validation and Tests

1. unit tests for decorator metadata extraction.
2. unit tests for zod-to-json-schema translation boundaries.
3. parity test between decorated endpoints and runtime manifest.
4. startup validator test for malformed contracts.

### Workstream E: Full Migration and Cleanup

1. migrate remaining runtime capabilities.
2. remove redundant manual schema literals.
3. update internal docs for capability authoring pattern.

### Current Implementation Snapshot

Implemented in the current slice:

1. Runtime capability decorator and shared metadata model.
2. Zod-to-JSON-schema adapter and manifest builder infrastructure.
3. Boundary validation with a reusable Zod validation pipe.
4. Migrated runtime capabilities: `query_memory`, `manage_todo_list`, and `list_schedules`.
5. Runtime manifest decomposition for context and schedule entries.
6. Unit coverage for decorator metadata and manifest parity.

Remaining follow-up:

1. migrate remaining runtime callback contracts.
2. expand startup validator parity coverage.
3. remove remaining manual runtime schema literals.

---

## 8. Backlog

- [x] E106-001 Add RuntimeCapability decorator and metadata model.
- [x] E106-002 Add Zod schema adapter for CapabilityManifestEntry schema field.
- [x] E106-003 Build runtime manifest from shared runtime capability definitions.
- [x] E106-004 Add parity test for decorated runtime callbacks versus manifest entries.
- [x] E106-005 Migrate query_memory contract.
- [x] E106-006 Migrate manage_todo_list contract, including alias handling.
- [x] E106-007 Migrate list_schedules contract with strict status enum.
- [x] E106-008 Split runtime entries into bounded context files and keep thin aggregator.
- [ ] E106-009 Migrate remaining runtime callbacks.
- [ ] E106-010 Remove obsolete schema literals and update docs.

---

## 9. Acceptance Criteria

1. Runtime manifest remains the authoritative agent-facing contract for required inputs.
2. For migrated tools, manifest schema is generated from Zod and no duplicate manual schema blocks remain.
3. Decorated endpoint metadata fully defines runtime callback path and body mapping.
4. Contract validator fails fast when metadata is incomplete, duplicated, or non-convertible.
5. Existing capability catalog, seeding, and runtime invocation behavior remain backward compatible.
6. Lint and targeted API tests pass for touched modules.

---

## 10. Risks and Mitigation

1. Risk: decorator metadata drift from controller route annotations.
   Mitigation: add parity tests that compare decorator callback path against route mapping.
2. Risk: zod-to-json-schema conversion edge cases.
   Mitigation: constrain supported Zod features and enforce explicit adapter tests.
3. Risk: migration churn across a large manifest surface.
   Mitigation: incremental rollout with first-slice migration and compatibility checks.
4. Risk: seeded tool schema changes causing runtime regressions.
   Mitigation: compare generated schema snapshots for migrated tools and validate registry parity in CI.

---

## 11. Delivery Plan

Phase 1: Infrastructure and first-slice migration

1. E106-001 through E106-007.
2. Validate no behavior regressions in runtime tool execution for migrated capabilities.

Phase 2: Broad migration and decomposition

1. E106-008 through E106-010.
2. Remove old schema literals after parity tests pass.

Phase 3: Hardening

1. tighten validator error reporting.
2. add documentation for new capability authoring workflow.

---

## 12. Expected File Scope

Likely touched files:

1. apps/api/src/tool/capability-manifest.runtime.entries.ts
2. apps/api/src/tool/capability-manifest.types.ts
3. apps/api/src/tool/capability-catalog.ts
4. apps/api/src/tool/capability-contract-validator.service.ts
5. apps/api/src/workflow/workflow-runtime-tools.controller.ts
6. apps/api/src/workflow/workflow-runtime-tools.controller.types.ts

Likely new files:

1. apps/api/src/tool/runtime-capability.decorator.ts
2. apps/api/src/tool/runtime-capability-manifest.builder.ts
3. apps/api/src/tool/runtime-capability-schema.adapter.ts
4. tests for decorator discovery and schema parity

---

## 13. Validation Strategy

1. Run lint and targeted unit tests for tool and workflow modules.
2. Run capability contract validator in strict mode.
3. Verify seeded capability payload generation remains valid.
4. Confirm agent-callable capability behavior for migrated endpoints in runtime smoke tests.
