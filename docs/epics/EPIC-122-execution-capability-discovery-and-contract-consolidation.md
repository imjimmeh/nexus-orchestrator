# EPIC-122: Execution Capability Discovery and Contract Consolidation

Status: Proposed
Priority: High
Depends On:

1. EPIC-050
2. EPIC-106
   Related:

3. docs/epics/EPIC-050-capability-contract-and-orchestration-tooling-excellence.md
4. docs/epics/EPIC-106-runtime-capability-contract-decorators-and-zod-schema-derivation.md
5. apps/api/src/tool/capability-catalog.ts
6. apps/api/src/tool/capability-manifest.execution.entries.ts
7. apps/api/src/tool/capability-manifest.execution.artifact-lifecycle.entries.ts
8. apps/api/src/tool/runtime-capability.decorator.ts
   Last Updated: 2026-04-19

---

## 1. Summary

Replace the remaining hand-maintained execution capability catalog with a discovery-driven, module-owned contract system that uses Zod as the single source of truth for tool inputs and derives agent-facing manifest JSON schema automatically.

This epic is a direct follow-on to EPIC-106. EPIC-106 introduced the infrastructure and first migration slice for runtime capabilities. The remaining execution capability surface still relies on duplicated tool names, duplicated schema literals, repeated default code snippets, and manually synchronized catalog arrays.

Core outcome:

1. Execution capability input contracts are defined once in Zod.
2. Capability definitions are owned by the module or bounded context that implements them.
3. Capability manifest assembly is discovery-based rather than maintained by large static arrays.
4. Bridge-action parity is validated from discovered registrations instead of hand-kept string lists.

---

## 2. Background Context

### 2.1 Current State

The current capability system is split across two architectural styles:

1. Runtime capabilities have already started moving toward decorator-backed metadata and Zod-derived schema generation.
2. Execution capabilities still live in large static manifest files composed from hardcoded arrays and inline JSON schema objects.

The result is an inconsistent system where one half of the surface is moving toward single-source contracts while the other half still requires manual updates in multiple places.

### 2.2 Concrete Pain Points Observed

1. Tool names are repeated across manifest entry files, bridge action arrays, validators, and gateway/runner coordination surfaces.
2. Execution tool schemas are authored manually as JSON schema literals even when the actual API/controller input contracts should be owned as typed runtime contracts.
3. The same `DEFAULT_TS_SNIPPET` is duplicated across multiple files.
4. `capability-catalog.ts` acts as a manual aggregation point and hidden source of drift.
5. `RUNNER_BRIDGE_ACTIONS` and `TELEMETRY_GATEWAY_ACTIONS` are manually maintained string arrays rather than discovered registrations.
6. Adding a new execution capability currently requires touching multiple files with no single ownership boundary.

### 2.3 Why the Existing Static-Array Pattern Is the Wrong Long-Term Shape

Large manifest arrays are simple to start with but poor as a growing architecture because they:

1. centralize unrelated bounded contexts in one place,
2. violate single responsibility,
3. make omission bugs easy,
4. force manual synchronization of type names, manifest entries, schemas, and bridge actions,
5. make future extension work more expensive than necessary.

The better architecture in this NestJS codebase is module-owned provider registration plus metadata discovery. Nest dependency injection can provide the registration boundary, while discovery and metadata reflection can assemble the global manifest view.

---

## 3. Problem Statement

Execution capability contracts are fragmented across hardcoded arrays, inline JSON schema literals, repeated default code snippets, and manually synchronized bridge action lists.

This fragmentation creates three classes of failure:

1. Contract drift: Zod/controller inputs and manifest schemas can diverge.
2. Registration drift: a tool can be added in one place and forgotten in another.
3. Ownership drift: no single module clearly owns the declaration of a capability.

The platform needs the same contract discipline for execution capabilities that EPIC-106 began introducing for runtime capabilities, but extended into a discovery-driven architecture that removes central manual registration arrays wherever feasible.

---

## 4. Goals

1. Make Zod the single source of truth for execution capability input contracts.
2. Remove hand-authored JSON schema from execution capability definitions.
3. Move capability ownership to the module or bounded context that implements the capability.
4. Replace static manifest aggregation with discovery-driven manifest assembly.
5. Replace manually curated bridge-action arrays with discovered bridge-action registrations and parity validation.
6. Preserve existing public capability names, transports, and agent-facing behavior during migration.
7. Keep startup validation strict so contract drift fails fast.

## 5. Non-Goals

1. Replacing the manifest model as the agent-facing contract.
2. Changing tool names, transport semantics, or workflow YAML references as part of this epic.
3. Rewriting all controller routing in a single pass.
4. Replacing Nest dependency injection with a custom registry framework.
5. Broad workflow-engine redesign unrelated to capability registration and contract ownership.

---

## 6. Design Principles

1. Single source of truth: each tool input contract must have one authoritative schema definition.
2. Module ownership: capability declaration lives with the owning bounded context, not a global catch-all file.
3. Discovery over manual aggregation: use Nest metadata discovery to materialize the global manifest view.
4. Incremental migration: preserve current behavior and migrate capability groups in slices.
5. Fail fast: duplicate names, missing callback config, invalid schema derivation, and bridge parity mismatches must fail validation.
6. Backward compatibility: seeded tools and workflow references must keep working throughout the migration.

---

## 7. Target Architecture

### 7.1 Shared Contract Model

Introduce a shared capability definition model that both runtime and execution surfaces can use.

Expected shape:

1. capability name
2. policy tags
3. tier restriction
4. runtime owner
5. transport
6. api callback or bridge metadata
7. mutating action or mode behavior where applicable
8. Zod input schema
9. optional seed-in-registry metadata

This model should be rich enough to derive `CapabilityManifestEntry` without separate handwritten schema blocks.

### 7.2 Discovery-Driven Capability Registration

Capability definitions should be attached to Nest providers or methods using metadata decorators and discovered through Nest discovery infrastructure.

Architecture expectation:

1. feature module owns the provider defining a capability,
2. provider is registered in its normal module,
3. a `CapabilityRegistryService` or equivalent discovery service scans providers,
4. discovered definitions are normalized into `CapabilityManifestEntry[]`.

This preserves proper DI boundaries while avoiding a giant manual manifest array.

### 7.3 Zod-to-JSON-Schema Derivation for All Capability Types

EPIC-106 already established the adapter pattern for runtime capability schema derivation. This epic extends that to execution capabilities so the manifest JSON schema is always derived from Zod and never maintained separately.

### 7.4 Bridge Action Discovery

Bridge actions should no longer be maintained in freestanding arrays. Instead:

1. runner bridge handlers declare the action they support,
2. telemetry gateway handlers declare the action they support,
3. startup validation compares discovered action sets against capability definitions that depend on those actions.

This creates parity from discovered registrations rather than manual string duplication.

### 7.5 Thin Catalog Compatibility Layer

`capability-catalog.ts` may remain temporarily, but only as a compatibility facade over the discovery service. It should stop being the primary authoring surface.

Its eventual role should be limited to:

1. exposing assembled manifest results,
2. exposing helper methods for existing callers,
3. avoiding broad immediate call-site churn.

---

## 8. Scope

### 8.1 In Scope

1. Execution capability contract migration from handwritten JSON schema to Zod.
2. Shared capability-definition metadata model.
3. Capability discovery service and manifest assembly pipeline.
4. Artifact lifecycle capability slice as the first end-to-end migration.
5. Default TypeScript snippet deduplication.
6. Bridge action discovery/parity infrastructure.
7. Validator updates to use discovered definitions.
8. Documentation updates for the new authoring pattern.

### 8.2 Out of Scope

1. Full removal of all compatibility helpers in one pass if that creates broad churn.
2. Major API route redesign.
3. Changing tool runtime behavior or policy semantics unrelated to registration/contract architecture.
4. E2E suite expansion beyond targeted regression coverage for touched areas.

---

## 9. Epic Goals by Outcome

### 9.1 Developer Experience

1. Adding a new execution capability should require one schema definition and one module-owned capability declaration.
2. Developers should not need to update a central array of names and a separate schema block manually.

### 9.2 Architectural Quality

1. Capability ownership should align with bounded contexts.
2. Registration should happen through DI/module composition rather than a monolithic catalog file.

### 9.3 Operational Safety

1. Startup validation should catch duplicate names, broken schema derivation, and missing bridge handlers.
2. Seeded registry payload generation should remain deterministic and backward compatible.

---

## 10. Detailed Task Breakdown

### Phase 0: Baseline and Design Lock

#### Task 0.1: Document the current capability fragmentation map

Expected outputs:

1. An implementation checklist mapping current execution capability files to owning domains.
2. A mapping of current bridge actions, gateway handlers, and manifest dependencies.

Files to change:

1. docs/epics/EPIC-122-execution-capability-discovery-and-contract-consolidation.md

#### Task 0.2: Freeze the shared capability definition shape

Expected outputs:

1. Final TypeScript interface for discovered capability definitions.
2. Agreement on provider-level versus method-level decorator support.

Files to change:

1. apps/api/src/tool/capability-manifest.types.ts
2. apps/api/src/tool/runtime-capability.types.ts or new shared capability definition file
3. apps/api/src/tool/runtime-capability.decorator.ts or replacement shared decorator file

### Phase 1: Shared Infrastructure

#### Task 1.1: Extract and share the default TypeScript tool snippet

Expected outputs:

1. One exported default snippet constant.
2. Removal of duplicated local constants from execution capability files.

Files to change:

1. apps/api/src/tool/runtime-capability-manifest.builder.ts
2. apps/api/src/tool/capability-manifest.execution.entries.ts
3. apps/api/src/tool/capability-manifest.execution.approvals.entries.ts
4. apps/api/src/tool/capability-manifest.execution.artifact-lifecycle.entries.ts
5. apps/api/src/tool/capability-manifest.execution.skill-lifecycle.entries.ts
6. apps/api/src/tool/capability-manifest.execution.tool-lifecycle.entries.ts
7. apps/api/src/tool/capability-manifest.execution.nexus-orchestrator.entry.ts
8. apps/api/src/tool/capability-manifest.set-job-output.entry.ts
9. apps/api/src/tool/capability-manifest.preflight.entry.ts

#### Task 1.2: Create a shared decorator and metadata model for discovered capabilities

Expected outputs:

1. Metadata key and decorator usable by both runtime and execution capability definitions.
2. Shared helper for reading capability metadata from provider classes or methods.

Files to change:

1. apps/api/src/tool/runtime-capability.decorator.ts or replacement shared decorator file
2. apps/api/src/tool/runtime-capability.types.ts or new shared capability type file
3. apps/api/src/tool/capability-manifest.types.ts

#### Task 1.3: Add a discovery service that materializes capability manifest entries

Expected outputs:

1. `CapabilityRegistryService` or similarly named discovery-based service.
2. `CapabilityManifestEntry[]` assembly from discovered metadata.
3. JSON schema derivation from Zod for discovered definitions.

Files to change:

1. apps/api/src/tool/capability-catalog.ts
2. apps/api/src/tool/tool-catalog.service.ts
3. apps/api/src/tool/runtime-capability-manifest.builder.ts
4. new discovery service under apps/api/src/tool/
5. module wiring under the owning Nest module(s)

### Phase 2: Zod Contract Consolidation

#### Task 2.1: Define shared execution capability Zod fragments in `@nexus/core`

Expected outputs:

1. Reusable sub-schemas for job context, host mounts, file operations, artifact/skill identifiers, and bridge payload fragments.
2. Typed exports for execution tool inputs.

Files to change:

1. packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts and/or new execution-focused schema files
2. packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.types.ts and/or new execution-focused type files
3. package/core barrel exports as needed

#### Task 2.2: Add artifact lifecycle execution schemas as the first migration slice

Expected outputs:

1. Zod schemas for:
   - `create_artifact`
   - `list_artifacts`
   - `list_artifact_files`
   - `upsert_artifact_file`
   - `delete_artifact_file`
   - `save_script_as_artifact`
2. Generated JSON schema in the manifest for these tools.

Files to change:

1. packages/core schema files
2. apps/api/src/tool/capability-manifest.execution.artifact-lifecycle.entries.ts or replacement provider-owned capability definition file

#### Task 2.3: Define remaining execution schemas incrementally by domain

Expected outputs:

1. Zod schemas for approvals, set-job-output, preflight, tool lifecycle, skill lifecycle, subagent/delegation, and nexus orchestrator bridge payloads.
2. Removal of remaining handwritten JSON schema blocks as each slice migrates.

Files to change:

1. packages/core schema files
2. relevant execution capability definition files in apps/api/src/tool/

### Phase 3: Module-Owned Capability Migration

#### Task 3.1: Migrate artifact capability declarations to discovery-based providers

Expected outputs:

1. One provider or provider-method group owned by the artifact/runtime domain.
2. No artifact capability registration via a large static array.

Files to change:

1. apps/api/src/tool/capability-manifest.execution.artifact-lifecycle.entries.ts or replacement file(s)
2. owning module registration for artifact/runtime capability providers
3. apps/api/src/tool/capability-catalog.ts

#### Task 3.2: Migrate remaining execution capability groups by bounded context

Capability groups:

1. approvals
2. preflight and job output
3. skill lifecycle
4. tool lifecycle
5. subagent and delegation
6. nexus orchestrator bridge

Expected outputs:

1. Capability declarations owned by implementing domains.
2. Global catalog reduced to discovery/composition only.

Files to change:

1. apps/api/src/tool/capability-manifest.execution.entries.ts
2. apps/api/src/tool/capability-manifest.execution.\*.ts
3. module/provider registration files in owning domains

### Phase 4: Bridge Action Discovery and Parity Validation

#### Task 4.1: Replace manual bridge-action arrays with discovered registrations

Expected outputs:

1. metadata/decorator for runner bridge action handlers and telemetry gateway action handlers,
2. discovered action sets for validation,
3. removal of static `RUNNER_BRIDGE_ACTIONS` and `TELEMETRY_GATEWAY_ACTIONS` as the source of truth.

Files to change:

1. apps/api/src/tool/capability-catalog.ts
2. apps/api/src/tool/capability-contract-validator.service.ts
3. apps/api/src/telemetry/telemetry.gateway.ts
4. bridge handler or runner integration files that own these actions

#### Task 4.2: Update the contract validator to operate on discovered definitions

Expected outputs:

1. validator checks against discovered capability definitions,
2. duplicate-name validation,
3. bridge-action parity validation,
4. registry parity validation using discovery output.

Files to change:

1. apps/api/src/tool/capability-contract-validator.service.ts
2. apps/api/src/tool/capability-contract-validator.service.spec.ts

### Phase 5: Cleanup and Authoring Guidance

#### Task 5.1: Remove obsolete execution schema literals and array-only registration code

Expected outputs:

1. obsolete manifest array code removed,
2. remaining compatibility facade kept intentionally thin.

Files to change:

1. apps/api/src/tool/capability-catalog.ts
2. apps/api/src/tool/capability-manifest.execution.entries.ts
3. old execution capability literal files if replaced entirely

#### Task 5.2: Update architecture documentation for the new authoring model

Expected outputs:

1. clear instructions for adding a new capability,
2. explicit guidance on where schemas belong,
3. explicit guidance on how discovery and validation work.

Files to change:

1. docs/architecture/tool-registry.md
2. optionally docs/architecture/agent-capability-orchestration.md if needed

---

## 11. Expected File Scope

### Core API Infrastructure

1. apps/api/src/tool/capability-catalog.ts
2. apps/api/src/tool/capability-manifest.types.ts
3. apps/api/src/tool/runtime-capability.decorator.ts
4. apps/api/src/tool/runtime-capability.types.ts
5. apps/api/src/tool/runtime-capability-manifest.builder.ts
6. apps/api/src/tool/capability-contract-validator.service.ts
7. apps/api/src/tool/tool-catalog.service.ts

### Execution Capability Definitions

1. apps/api/src/tool/capability-manifest.execution.entries.ts
2. apps/api/src/tool/capability-manifest.execution.approvals.entries.ts
3. apps/api/src/tool/capability-manifest.execution.artifact-lifecycle.entries.ts
4. apps/api/src/tool/capability-manifest.execution.skill-lifecycle.entries.ts
5. apps/api/src/tool/capability-manifest.execution.tool-lifecycle.entries.ts
6. apps/api/src/tool/capability-manifest.execution.nexus-orchestrator.entry.ts
7. apps/api/src/tool/capability-manifest.set-job-output.entry.ts
8. apps/api/src/tool/capability-manifest.preflight.entry.ts

### Shared Contracts

1. packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts
2. packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.types.ts
3. additional new `packages/core/src/schemas/workflow-runtime/*` files if the execution surface is split by domain

### Bridge and Telemetry Surfaces

1. apps/api/src/telemetry/telemetry.gateway.ts
2. runner bridge handler files that own execution bridge actions

### Tests

1. apps/api/src/tool/runtime-capability-manifest.builder.spec.ts
2. apps/api/src/tool/runtime-capability.decorator.spec.ts
3. apps/api/src/tool/capability-contract-validator.service.spec.ts
4. new discovery/parity tests for discovered execution capabilities and bridge actions

---

## 12. Validation Strategy

1. targeted lint on touched API and core files,
2. targeted unit tests for discovery, schema derivation, and validator parity,
3. strict capability-contract validation in startup/test mode,
4. verification that seeded tool payload generation is unchanged for migrated capabilities,
5. smoke verification that migrated tool names and transports remain stable.

Suggested commands during implementation:

1. `npm run build:api`
2. `npm run test --workspace=apps/api -- capability-contract-validator`
3. `npm run test --workspace=apps/api -- runtime-capability`
4. targeted eslint commands for touched files

Per current working directive, do not expand into E2E test execution unless explicitly requested.

---

## 13. Risks and Mitigations

### Risk 1: Discovery introduces hidden module-order issues

Mitigation:

1. keep discovery constrained to registered providers,
2. add deterministic sorting before manifest materialization,
3. add tests proving stable output ordering.

### Risk 2: Zod conversion edge cases alter emitted JSON schema

Mitigation:

1. constrain supported Zod patterns,
2. snapshot or parity-test generated schema for migrated capabilities,
3. fail startup validation when schema derivation produces invalid output.

### Risk 3: Incremental migration causes mixed authoring modes for a period

Mitigation:

1. allow compatibility facade during transition,
2. make discovered definitions and static definitions compose through one builder,
3. migrate by domain slice with tests.

### Risk 4: Bridge-action discovery misses legacy handlers

Mitigation:

1. start with parity validation in warn-first local development if needed,
2. complete handler annotation before removing old fallback lists,
3. add explicit validator errors naming the missing owner/action.

---

## 14. Definition of Done

This epic is complete when all of the following are true:

1. Execution capability input contracts are authored in Zod rather than handwritten JSON schema.
2. At least the artifact lifecycle capability slice is fully migrated to discovery-based, module-owned registration.
3. New capability definitions can be added without editing a central static manifest array.
4. `capability-catalog.ts` is reduced to discovery/composition or compatibility-only responsibilities.
5. Bridge-action parity is validated from discovered registrations rather than manual arrays as the source of truth.
6. Default TypeScript tool snippet duplication is removed.
7. Capability contract validation fails fast on duplicate names, incomplete metadata, schema-derivation failures, and bridge parity mismatches.
8. Touched API and shared-contract files are lint-clean and typecheck/build clean.
9. Targeted unit tests covering discovery and schema derivation pass.
10. Documentation exists describing the new capability authoring workflow.

---

## 15. Acceptance Criteria

1. For migrated execution capabilities, the manifest schema is generated from Zod and no duplicate manual schema block remains.
2. Capability declarations live with owning modules/providers, not only inside a monolithic static catalog.
3. Existing tool names, callback routes, and seeded payloads remain backward compatible.
4. Startup contract validation identifies missing bridge registrations and duplicate capability names before runtime use.
5. The artifact lifecycle slice demonstrates the end-to-end pattern and becomes the reference implementation for subsequent slices.

---

## 16. Suggested Delivery Sequence

### Slice 1: Infrastructure and Artifact Pilot

1. shared snippet extraction,
2. shared capability metadata model,
3. discovery service,
4. artifact lifecycle Zod schemas,
5. artifact capability migration.

### Slice 2: Remaining Execution Contracts

1. approvals,
2. preflight and job output,
3. skill lifecycle,
4. tool lifecycle,
5. subagent and delegation.

### Slice 3: Bridge and Validator Hardening

1. bridge action discovery,
2. validator migration,
3. compatibility cleanup,
4. documentation finalization.

---

## 17. Notes for Implementation

1. Reuse the proven Zod-to-JSON-schema adapter introduced under EPIC-106 instead of adding a second schema conversion path.
2. Prefer discovery through Nest provider metadata over custom registries.
3. Keep incremental compatibility while migrating; do not do a flag day rewrite if a thinner compatibility facade avoids churn.
4. Preserve bounded-context ownership: artifact capabilities should not be re-centralized under a generic tool catalog module after migration.
