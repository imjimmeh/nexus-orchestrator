# EPIC-181: Capability Domain Consolidation

**Status:** Implemented
**Priority:** P0
**Depends On:** None
**Related Epics:** EPIC-125 (Tool Registry Refactor), EPIC-140 (Capability Registry Policy and Runtime Governance Unification), EPIC-173 (Large Service Decomposition), EPIC-175 (Core API Self-Improvement Roadmap)
**Last Updated:** 2026-05-16

---

## 1. Summary

The capability domain is fractured across five directories (`tool/`, `tool-runtime/`, `tool-registry/`, `capability-governance/`, `capability-infra/`) with ~30 files having identical basenames duplicated across them. Many files in `tool/` are 1-line pass-through re-exports that add no value. This creates confusion about which directory owns the real implementation, increases maintenance burden, and makes the deletion test fail for `tool/` (deleting it leaves the functionality intact in the other four directories).

This epic consolidates the capability domain into four focused modules with clear responsibility boundaries, eliminates all pass-through re-exports, and reduces the file count in this area by 60%+.

---

## 2. High-Level Context

### 2.1 Current State

The capability system spans these directories:

| Directory                | Non-spec files | Role                                                               |
| ------------------------ | -------------- | ------------------------------------------------------------------ |
| `tool/`                  | 63             | Controllers, providers, and a large set of pass-through re-exports |
| `tool-runtime/`          | 9              | Tool mounting, sandboxing, execution                               |
| `tool-registry/`         | 6              | Catalog, payload mapping, validation                               |
| `capability-governance/` | 8              | Policy engine, approval rules, policy decision                     |
| `capability-infra/`      | 7              | Registry, decorator, schema adapter, types                         |

### 2.2 Duplicate Files (Non-Spec)

**`tool/` ↔ `tool-runtime/` duplicates:**

- `skill-mounting.constants.ts`
- `skill-mounting.service.ts`
- `tool-candidate.service.ts` and `tool-candidate.service.types.ts`
- `tool-mounting.service.ts`
- `tool-runtime-execution.service.ts`
- `tool-sandbox.service.ts` and `tool-sandbox.types.ts`

**`tool/` ↔ `tool-registry/` duplicates:**

- `tool-registry.service.ts`
- `tool-validation.service.ts`
- `tool-catalog.service.ts`
- `tool-payload.mapper.ts`

**`tool/` ↔ `capability-governance/` duplicates:**

- `policy-engine.service.ts`
- `tool-approval-rule.service.ts`
- `tool-call-approval-request.service.ts`
- `tool-call-approval-requests.controller.ts`
- `tool-policy-decision.service.ts`

**`tool/` ↔ `capability-infra/` duplicates:**

- `capability-manifest-to-tool-registry.mapper.ts`
- `capability-registrar.service.ts`
- `capability-registry.service.ts` and `capability-registry.types.ts`
- `capability.decorator.ts`
- `runtime-capability-schema.adapter.ts`
- `runtime-capability.decorator.ts`

### 2.3 Pass-Through Re-Exports (1-Line Files)

Several files in `tool/` are single-line re-exports:

- `tool/tool-mounting.service.ts` → `export { ToolMountingService } from '../tool-runtime/tool-mounting.service';`
- `tool/capability-registry.service.ts` → `export { CapabilityRegistryService } from '../capability-infra/capability-registry.service';`
- `tool/policy-engine.service.types.ts` → `export { ProfileDecision } from '../capability-governance/policy-engine.service.types';`
- `tool/tool-approval-rule.service.types.ts` → `export { ToolApprovalRuleInput } from '../capability-governance/tool-approval-rule.service.types';`
- `tool/tool-call-approval-request.types.ts` → `export { ToolCallApprovalRequest } from '../capability-governance/tool-call-approval-request.types';`
- `tool/tool-policy-decision.service.types.ts` → `export { ProfileDecision } from '../capability-governance/policy-engine.service.types';`
- `tool/runtime-capability.types.ts` → `export { RuntimeCapabilityDefinition } from '../capability-infra/runtime-capability.types';`
- `tool/capability-contract-validator.types.ts` → re-export from `capability-infra/`
- `tool/capability-preflight.types.ts` → re-export from `capability-infra/`
- `tool/capability-manifest.types.ts` → re-export from `capability-infra/`

### 2.4 Current Pain Points

1. **Ownership confusion:** Developers cannot determine which directory owns a capability concept without reading each file.
2. **Maintenance burden:** A change to `ToolMountingService` may need to be mirrored in two places.
3. **Test duplication:** Tests exist for both the implementation and its re-export wrapper.
4. **Import path ambiguity:** Importing `@/tool/tool-mounting.service` vs `@/tool-runtime/tool-mounting.service` returns the same class.
5. **Global module pollution:** `ToolModule` (marked `@Global()`) re-exports services from all five directories, giving every module access to everything.
6. **Deletion test fails:** Deleting `tool/`'s copies leaves all functionality intact — `tool/` is a pass-through, not a deep module.

---

## 3. Goals

1. Eliminate all 1-line pass-through re-export files.
2. Establish a single source of truth for each capability concept.
3. Reduce total file count across the five directories by 60%+ (from ~93 to ~35 non-spec files).
4. Ensure every capability concept has exactly one implementation file.
5. Make the deletion test pass for each concept: deleting the implementation removes the functionality entirely.
6. Zero behavioral changes — this is a pure structural consolidation.
7. Update all import paths across the codebase to point to the canonical location.

---

## 4. Non-Goals

1. No changes to the internal logic of any capability service.
2. No changes to database schemas or entity locations.
3. No changes to external API contracts (HTTP routes, DTOs, event names).
4. No changes to `@Global()` behavior of `ToolModule` — that is covered in EPIC-182.
5. No extraction of subagent orchestration or mesh delegation into separate modules.

---

## 5. Implementation Phases

### Phase 1: Ownership Map and Import Audit

- **Task E181-001: Create ownership map for each capability concept**
  - Document which directory each concept currently lives in and where it is re-exported.
  - Decide canonical location for each concept.
  - **Deliverable:** Decision matrix showing `concept → canonical directory → re-export locations to remove`.

- **Task E181-002: Scan all imports across the codebase**
  - Identify every file that imports from `tool/`, `tool-runtime/`, `tool-registry/`, `capability-governance/`, or `capability-infra/`.
  - Categorize imports by whether they import from a re-export path or the canonical path.
  - **Deliverable:** Import audit report with file paths and line numbers.

### Phase 2: Eliminate Pass-Through Re-Exports

- **Task E181-003: Delete 1-line re-export files in `tool/`**
  - Remove all files that are single-line `export { X } from '...'` statements.
  - Update all callers to import from the canonical location.
  - **Files affected:** ~20 files in `tool/` that are re-exports.

- **Task E181-004: Resolve `tool/` vs `tool-runtime/` duplicates**
  - Keep `tool-runtime/tool-mounting.service.ts` as canonical; delete `tool/tool-mounting.service.ts`.
  - Keep `tool-runtime/tool-candidate.service.ts` as canonical; delete `tool/tool-candidate.service.ts`.
  - Keep `tool-runtime/tool-sandbox.service.ts` as canonical; delete `tool/tool-sandbox.service.ts`.
  - Keep `tool-runtime/tool-runtime-execution.service.ts` as canonical; delete `tool/tool-runtime-execution.service.ts`.
  - Evaluate `skill-mounting.service.ts` — keep in `tool-runtime/` (runtime concern); delete `tool/` copy.
  - Update all callers.

- **Task E181-005: Resolve `tool/` vs `tool-registry/` duplicates**
  - Keep `tool-registry/tool-registry.service.ts` as canonical; delete `tool/tool-registry.service.ts`.
  - Keep `tool-registry/tool-validation.service.ts` as canonical; delete `tool/tool-validation.service.ts`.
  - Keep `tool-registry/tool-catalog.service.ts` as canonical; delete `tool/tool-catalog.service.ts`.
  - Keep `tool-registry/tool-payload.mapper.ts` as canonical; delete `tool/tool-payload.mapper.ts`.
  - Update all callers.

- **Task E181-006: Resolve `tool/` vs `capability-governance/` duplicates**
  - Keep `capability-governance/policy-engine.service.ts` as canonical; delete `tool/policy-engine.service.ts`.
  - Keep `capability-governance/tool-approval-rule.service.ts` as canonical; delete `tool/tool-approval-rule.service.ts`.
  - Keep `capability-governance/tool-call-approval-request.service.ts` as canonical; delete `tool/tool-call-approval-request.service.ts`.
  - Keep `capability-governance/tool-call-approval-requests.controller.ts` as canonical; delete `tool/tool-call-approval-requests.controller.ts`.
  - Keep `capability-governance/tool-policy-decision.service.ts` as canonical; delete `tool/tool-policy-decision.service.ts`.
  - Update all callers.

- **Task E181-007: Resolve `tool/` vs `capability-infra/` duplicates**
  - Keep `capability-infra/capability-registry.service.ts` as canonical; delete `tool/capability-registry.service.ts`.
  - Keep `capability-infra/capability-registrar.service.ts` as canonical; delete `tool/capability-registrar.service.ts`.
  - Keep `capability-infra/capability.decorator.ts` as canonical; delete `tool/capability.decorator.ts`.
  - Keep `capability-infra/runtime-capability-schema.adapter.ts` as canonical; delete `tool/runtime-capability-schema.adapter.ts`.
  - Keep `capability-infra/runtime-capability.decorator.ts` as canonical; delete `tool/runtime-capability.decorator.ts`.
  - Keep `capability-infra/capability-manifest-to-tool-registry.mapper.ts` as canonical; delete `tool/capability-manifest-to-tool-registry.mapper.ts`.
  - Update all callers.

### Phase 3: Streamline `tool/` Module

- **Task E181-008: Reduce `tool/` to controllers and providers only**
  - After deleting re-exports and duplicates, `tool/` should contain only:
    - `tool.controller.ts` — HTTP controller
    - `tool-seeder.service.ts` — seeding logic
    - `capability-contract-validator.service.ts` — validation logic specific to tool contracts
    - `tool-contract-repair.adapter.ts` — repair adapter
    - `providers/` — capability providers (artifact, skill lifecycle, tool lifecycle)
    - `tool-tier-policy.service.ts` — tier-specific policy
    - `internal-tool-registry.service.ts` — internal tool discovery
    - `chat-capability-context.validator.ts` — chat-specific validation
    - `shared-capability-constants.ts` — shared constants
    - `bridge-action.*` files — bridge action decorators/types
    - `canonical-capability.types.ts` — canonical types
    - `capability-preflight.helpers.ts`, `capability-preflight.service.ts` — preflight logic
    - `output-contract.validator.ts` — output contract validation
    - `capability-handler-parity.spec.ts` — parity test
  - Delete any remaining files that are no longer needed.

- **Task E181-009: Update `ToolModule` provider/controller/exports declarations**
  - Remove references to deleted services (they no longer exist in `tool/`).
  - Keep references to services that remain (providers, seeder, validator, etc.).
  - Remove imports of `ToolRegistryModule` and `ToolRuntimeModule` from `ToolModule` if they are no longer needed as transitive exports.

### Phase 4: Update Import Paths and Verify

- **Task E181-010: Update all import paths across the codebase**
  - Replace imports of deleted re-export paths with canonical paths.
  - Use IDE find-and-replace or scripted search for common patterns:
    - `'../tool/tool-mounting.service'` → `'../tool-runtime/tool-mounting.service'`
    - `'../tool/capability-registry.service'` → `'../capability-infra/capability-registry.service'`
    - `'../tool/policy-engine.service'` → `'../capability-governance/policy-engine.service'`
    - etc.
  - **Scope:** `apps/api/src/`, `apps/`, `packages/`.

- **Task E181-011: Run build and typecheck**
  - `npm run build --workspace=packages/core`
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E181-012: Run lint**
  - `npm run lint:api`
  - Fix any lint findings.

- **Task E181-013: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

- **Task E181-014: Verify deletion test**
  - For each consolidated concept, verify that deleting the canonical implementation removes the functionality entirely (no residual pass-through files).

---

## 6. Expected Outcomes

| Metric                                | Before                          | After                              |
| ------------------------------------- | ------------------------------- | ---------------------------------- |
| Non-spec files across 5 directories   | ~93                             | ~35                                |
| 1-line re-export files                | ~20                             | 0                                  |
| Duplicate implementations per concept | 2–3                             | 1                                  |
| Import path ambiguity                 | High (multiple valid paths)     | None (single canonical path)       |
| Deletion test result                  | Fails (`tool/` is pass-through) | Passes (each concept has one seam) |

---

## 7. Risk and Mitigation

| Risk                                                                     | Mitigation                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Broken imports in files outside `apps/api/src/`                          | Scope import audit to entire repo; verify with full build                                     |
| Circular dependency between `capability-governance/` and `tool-runtime/` | Review import graph before deleting files; fix cycles explicitly                              |
| Test failures due to deleted spec files on re-exported classes           | Merge spec files into canonical location; ensure test imports are updated                     |
| `ToolModule` exports break for external consumers                        | Since `ToolModule` is `@Global()`, all consumers get exports transitively — update in Phase 3 |
