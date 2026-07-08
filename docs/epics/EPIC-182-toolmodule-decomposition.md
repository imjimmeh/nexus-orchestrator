# EPIC-182: ToolModule Decomposition

**Status:** Implemented
**Priority:** P0
**Depends On:** EPIC-181 (Capability Domain Consolidation)
**Related Epics:** EPIC-125 (Tool Registry Refactor), EPIC-140 (Capability Registry Policy and Runtime Governance Unification), EPIC-173 (Large Service Decomposition)
**Last Updated:** 2026-05-16

---

## 1. Summary

`ToolModule` (`apps/api/src/tool/tool.module.ts`) is a `@Global()` module that acts as a god module — it imports and wires together services from five different domains (`tool/`, `tool-runtime/`, `tool-registry/`, `capability-governance/`, `capability-infra/`), registers 15+ providers, declares 3 controllers, and exports everything. This means every module in the application gets access to all capability services without explicit declaration, violating the Dependency Inversion Principle and making module seams shallow (interface = everything, implementation = everything).

This epic removes `@Global()`, splits the module into focused submodules with explicit export surfaces, and makes import graphs declarative and testable.

---

## 2. High-Level Context

### 2.1 Current `ToolModule` Structure

```typescript
@Global()
@Module({
  imports: [
    DatabaseModule,
    DiscoveryModule,
    ToolRegistryModule,
    ToolRuntimeModule,
  ],
  providers: [
    CapabilityRegistryService, // from capability-infra/
    PolicyEngineService, // from capability-governance/
    ToolPolicyDecisionService, // from capability-governance/
    ToolPolicyEvaluatorService, // from capability-governance/
    ToolApprovalRuleService, // from capability-governance/
    ToolCallApprovalRequestService, // from capability-governance/
    ApprovalsCapabilityProvider, // from capability-governance/
    ToolSeederService, // from tool/
    CapabilityContractValidatorService, // from tool/
    ToolContractRepairAdapter, // from tool/
    ArtifactCapabilityProvider, // from tool/
    SkillLifecycleCapabilityProvider, // from tool/
    ToolLifecycleCapabilityProvider, // from tool/
  ],
  controllers: [
    ToolController, // from tool/
    ToolApprovalRulesController, // from capability-governance/
    ToolCallApprovalRequestsController, // from capability-governance/
  ],
  exports: [
    CapabilityRegistryService, // all 13 providers + 2 modules
    PolicyEngineService,
    // ... all 13 providers
    ToolRegistryModule,
    ToolRuntimeModule,
  ],
})
export class ToolModule {}
```

### 2.2 Current Pain Points

1. **Global module pollution:** Every module in the app gets access to all 13 providers without declaring any import. This violates DIP — modules should declare what they need.
2. **Shallow module interface:** The module's export surface is nearly as complex as its implementation. Callers don't need to understand the full export surface to use the module, but the module itself exposes everything.
3. **Cross-domain wiring:** `ToolModule` wires together capability infrastructure, governance, runtime, and registry concerns in one place. This violates SoC — each domain should own its own module.
4. **Test coupling:** Testing any module that imports `ToolModule` gets the full provider set, even if it only needs `ToolRegistryModule`.
5. **Ownership ambiguity:** `ToolApprovalRulesController` lives in `capability-governance/` but is wired in `ToolModule`. Who owns that controller?

### 2.3 What `ToolModule` Actually Owns

After EPIC-181 consolidation, `ToolModule` should own only:

- `ToolController` — HTTP controller for tool operations
- `ToolSeederService` — seeding logic
- `CapabilityContractValidatorService` — validation specific to tool contracts
- `ToolContractRepairAdapter` — repair adapter
- Provider classes (`ArtifactCapabilityProvider`, `SkillLifecycleCapabilityProvider`, `ToolLifecycleCapabilityProvider`)

Everything else should be in its own module.

---

## 3. Goals

1. Remove `@Global()` from `ToolModule`.
2. Create four focused modules with explicit export surfaces.
3. Ensure every module declares its actual dependencies.
4. Make the deletion test pass for each module: deleting it removes only its own functionality.
5. Zero behavioral changes — this is a pure structural decomposition.
6. All existing tests should pass without modification (imports may change, but behavior does not).

---

## 4. Non-Goals

1. No changes to the internal logic of any service.
2. No changes to database schemas or entity locations.
3. No changes to external API contracts (HTTP routes, DTOs, event names).
4. No changes to `@Global()` behavior of `DatabaseModule`, `RedisModule`, or other existing global modules.
5. No extraction of subagent orchestration or mesh delegation.

---

## 5. Implementation Phases

### Phase 1: Create Focused Submodules

- **Task E182-001: Create `CapabilityInfraModule`**
  - Move `CapabilityRegistryService`, `CapabilityContractValidatorService`, `CapabilityManifestEntry` types, decorator, schema adapter into this module.
  - Export: `CapabilityRegistryService`, `CapabilityContractValidatorService`.
  - Import: `DatabaseModule`, `DiscoveryModule`.
  - **Files:** `capability-infra/capability-infra.module.ts` (new), update imports in existing files.

- **Task E182-002: Create `CapabilityGovernanceModule`**
  - Move `PolicyEngineService`, `ToolPolicyDecisionService`, `ToolPolicyEvaluatorService`, `ToolApprovalRuleService`, `ToolCallApprovalRequestService`, `ApprovalsCapabilityProvider`, `ToolApprovalRulesController`, `ToolCallApprovalRequestsController` into this module.
  - Export: `PolicyEngineService`, `ToolPolicyDecisionService`, `ToolPolicyEvaluatorService`, `ToolApprovalRuleService`, `ToolCallApprovalRequestService`.
  - Import: `CapabilityInfraModule` (needs `CapabilityRegistryService` for policy decisions).
  - **Files:** `capability-governance/capability-governance.module.ts` (new or update existing), update imports.

- **Task E182-003: Keep `ToolRuntimeModule` as-is**
  - Already exists at `tool-runtime/tool-runtime.module.ts`.
  - Verify it exports only runtime concerns: `ToolMountingService`, `ToolSandboxService`, `ToolRuntimeExecutionService`, `ToolCandidateService`, `SkillMountingService`.
  - No changes needed if already focused.

- **Task E182-004: Keep `ToolRegistryModule` as-is**
  - Already exists at `tool-registry/tool-registry.module.ts`.
  - Verify it exports only registry concerns: `ToolRegistryService`, `ToolCatalogService`, `ToolValidationService`, `ToolPayloadMapper`.
  - No changes needed if already focused.

- **Task E182-005: Slim `ToolModule` to its actual concerns**
  - Remove `@Global()`.
  - Remove providers/controllers that belong in other modules.
  - Import `CapabilityInfraModule`, `CapabilityGovernanceModule`, `ToolRegistryModule`, `ToolRuntimeModule` explicitly.
  - Export only what `ToolModule` actually owns: `ToolController`, `ToolSeederService`, capability providers, `CapabilityContractValidatorService`, `ToolContractRepairAdapter`.
  - **Files:** `tool/tool.module.ts` (modified).

### Phase 2: Update All Importers

- **Task E182-006: Audit all modules that import `ToolModule`**
  - Find every `@Module({ imports: [ToolModule, ...] })` across the codebase.
  - For each, determine which services from `ToolModule`'s export surface they actually use.
  - Replace `ToolModule` with the specific submodule(s) they need.
  - **Example:** If `AiConfigModule` only uses `PolicyEngineService`, import `CapabilityGovernanceModule` instead of `ToolModule`.

- **Task E182-007: Update `app.module.ts`**
  - Replace `ToolModule` import with the specific submodules the app needs at the top level.
  - The app likely needs all four modules, so import them individually:
    ```typescript
    imports: [
      CapabilityInfraModule,
      CapabilityGovernanceModule,
      ToolRegistryModule,
      ToolRuntimeModule,
      // ToolModule removed — no longer global
    ];
    ```

- **Task E182-008: Update cross-module imports**
  - Fix any files that imported services from `ToolModule`'s transitive exports.
  - Update to import from the correct submodule.

### Phase 3: Verify and Test

- **Task E182-009: Run build and typecheck**
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E182-010: Run lint**
  - `npm run lint:api`
  - Fix any lint findings.

- **Task E182-011: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

- **Task E182-012: Verify deletion test**
  - For each new module, verify that deleting it removes only its own functionality.
  - `CapabilityInfraModule` deletion → only capability registry/decorator/schema lost.
  - `CapabilityGovernanceModule` deletion → only policy/approval logic lost.
  - `ToolRuntimeModule` deletion → only mounting/sandboxing/execution lost.
  - `ToolRegistryModule` deletion → only catalog/validation/payload mapping lost.
  - `ToolModule` deletion → only controllers and tool-specific providers lost.

---

## 6. Expected Outcomes

| Metric                   | Before                             | After                             |
| ------------------------ | ---------------------------------- | --------------------------------- |
| `@Global()` modules      | 2 (`DatabaseModule`, `ToolModule`) | 1 (`DatabaseModule`)              |
| `ToolModule` providers   | 13                                 | 6 (tool-specific only)            |
| `ToolModule` controllers | 3                                  | 1 (tool controller only)          |
| Cross-module coupling    | Implicit (via global exports)      | Explicit (per-module imports)     |
| Deletion test            | Fails (global exports everything)  | Passes (each module has one seam) |

---

## 7. Risk and Mitigation

| Risk                                                                                 | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Circular dependency between `CapabilityInfraModule` and `CapabilityGovernanceModule` | Review import graph; use forward refs if needed; consider extracting shared interfaces to `shared/interfaces/` |
| Broken imports in services that relied on `ToolModule`'s transitive exports          | Phase 2 audit catches all importers; update systematically                                                     |
| `ToolModule` tests fail because they mocked the global module                        | Update tests to import specific submodules; use `Test.createTestingModule()` with explicit imports             |
