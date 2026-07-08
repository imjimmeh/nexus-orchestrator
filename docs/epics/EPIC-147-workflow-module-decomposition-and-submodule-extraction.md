# EPIC-147: Workflow Module Decomposition and Submodule Extraction

Status: Proposed
Priority: P2
Depends On: None
Last Updated: 2026-04-29

---

## 1. Summary

The `WorkflowModule` in `apps/api/src/workflow/` has grown into a monolith of ~312 files spanning ~15,000–20,000 lines. It currently contains at least five distinct subsystems that have achieved clean internal boundaries but remain physically nested inside a single NestJS module. This epic decomposes the module by:

1. Extracting two fully decoupled domains into **top-level modules** (`WebAutomationModule`, `WarRoomModule`).
2. Creating **three focused NestJS submodules** inside the workflow directory (`WorkflowInternalToolsModule`, `WorkflowRuntimeModule`, `WorkflowRepairModule`).
3. Moving **generic tool infrastructure** that was misplaced in `workflow/` back to the `tool` module where it belongs.
4. Leaving the **core workflow engine** (parser, DAG resolver, state machine, persistence, launch orchestration) as a lean, focused `WorkflowModule`.

The goal is not to change behavior — it is to give existing seams physical module boundaries, improve AI-navigability, reduce cognitive load when changing a subsystem, and make the deletion test pass for each extracted domain.

---

## 2. High-Level Context

### 2.1 Why Now

The `WorkflowModule` registration file (`workflow.module.ts`) is **460 lines** of provider and controller declarations. Understanding the module requires scrolling through ~120 provider registrations and ~15 controller declarations. New developers cannot determine which services are related without reading every file name.

Several subsystems inside `workflow/` have naturally evolved into deep modules with small, stable interfaces:

- **Web automation** — a complete Playwright-based browser automation subsystem with its own data model, retry policies, session management, and artifact capture. It imports **zero** workflow services.
- **War room** — a multi-agent deliberation and consensus engine with its own database entities (session, participant, message, blackboard, signoff). It is already consumed by `project/intelligence` and `telemetry` sibling modules.
- **Internal tools** — 29 thin adapter classes and 6 handler services that bridge the workflow runtime to internal tool execution. They have a clean registry pattern but are buried among unrelated providers.
- **Runtime capabilities** — agent-facing runtime surface (capability discovery, orchestration actions, subagent tools, mesh delegation tools, etc.). These are thin adapters over core workflow services but clutter the root `workflow/` directory. Historical runtime publish-specs files are superseded by Kanban-owned `kanban.publish_specs` and should not be treated as active `WorkflowRuntimeModule` scope.
- **Failure classification + repair delegation** — two directories that are actually two phases of the same autonomous-repair lifecycle. They have tight bidirectional coupling and should never have been separate.

### 2.2 Current Pain Points

1. **Cognitive overload:** 312 files in one directory tree makes it impossible to hold the module in working memory.
2. **Tight accidental coupling:** Because everything is in one module, changes to web-automation retry logic appear in the same diff as workflow engine state-machine changes.
3. **Sibling module burden:** `project/intelligence` and `telemetry` must import the entire `WorkflowModule` export surface just to get `WarRoomService`.
4. **Ownership ambiguity:** `internal-tools/` is generic tool infrastructure, yet it lives in `workflow/` and is re-exported by the `tool` module via shims.
5. **Test locality:** Running tests for a single subsystem (e.g., browser automation) still requires the full `WorkflowModule` testing context.

### 2.3 What Stays in Core Workflow

The following are genuinely the workflow domain and remain in the slimmed `WorkflowModule`:

- **Engine:** `workflow-engine.service.ts`, `workflow-parser.service.ts`, `dag-resolver.service.ts`, `state-machine.service.ts`, `state-manager.service.ts`
- **Persistence & repositories:** `workflow-persistence.service.ts`, `workflow-repository-aggregator.service.ts`
- **Launch & execution:** `workflow-launch-orchestration.service.ts`, `workflow-launch-contract.service.ts`, `workflow-run-job-execution.service.ts`, `step-execution.service.ts`, `step-execution-orchestrator.service.ts`, `step-execution.consumer.ts`
- **Validation & contracts:** `workflow-validation.service.ts`, `workflow-bootstrap-validator.service.ts`, `workflow-run-request.contract.ts`, `workflow-output-contract.service.ts`
- **Steering & lifecycle:** `workflow-run-steering.service.ts`, `workflow-run-reconciliation.service.ts`, `workflow-concurrency-manager.service.ts`, `workflow-core-lifecycle-fanout.service.ts`
- **Eventing:** `workflow-event-trigger.service.ts`, `workflow-events.constants.ts`, `workflow-events.types.ts`, plus listeners that are intrinsically workflow-lifecycle bound
- **Graph & read-models:** `workflow-graph-read-model.service.ts`
- **Controllers:** `workflow.controller.ts`, `workflow-runs.controller.ts`, `workflow-launch.controller.ts`, `workflow-ad-hoc-session.controller.ts`

---

## 3. Goals

1. Reduce `WorkflowModule` provider registrations from ~120 to ~60.
2. Reduce `WorkflowModule` controller declarations from ~15 to ~8.
3. Reduce `WorkflowModule` file count from ~312 to ~180.
4. Create two new top-level modules (`WebAutomationModule`, `WarRoomModule`) with clean export surfaces.
5. Create three workflow submodules (`WorkflowInternalToolsModule`, `WorkflowRuntimeModule`, `WorkflowRepairModule`) that are imported by `WorkflowModule`.
6. Eliminate the `internal-tools/` ownership smell by moving generic tool infrastructure to the `tool` module.
7. Ensure every commit leaves the codebase buildable and testable.
8. Zero behavioral changes — this is a pure structural refactor.

---

## 4. Non-Goals

1. No changes to database schemas or entity locations (entities stay in `database/entities/`).
2. No changes to the core workflow engine logic (parser, state machine, DAG resolver).
3. No extraction of subagent orchestration, mesh delegation, or agent communication — these are tightly coupled to core workflow infrastructure and require prerequisite seam work.
4. No changes to external API contracts (HTTP routes, DTOs, event names).
5. No refactoring of the web-automation, war-room, or repair internals — only their physical location and module boundaries.
6. No introduction of new abstractions (ports/adapters) beyond the minimum needed to decouple war-room from `WorkflowEventLogService`.

---

## 5. Scope (Detailed)

### 5.1 Phase 1: Move Misplaced Generic Infrastructure

**Scope:** `workflow/internal-tools/` → `tool/`

**What moves:**
- `workflow/internal-tools/internal-tool-registry.service.ts` → `tool/internal-tool-registry.service.ts`
- `workflow/internal-tools/internal-tool.tokens.ts` → `tool/internal-tool.tokens.ts`

**What gets deleted:**
- Re-export shims in `tool/internal-tool-registry.service.ts` and `tool/tool.tokens.ts`

**Why:** This is generic tool lifecycle infrastructure with zero workflow coupling. The `tool` module already re-exports these files via shims — a clear ownership smell.

---

### 5.2 Phase 2: Extract Web Automation to Top-Level Module

**Scope:** `workflow/web-automation/*` → `apps/api/src/web-automation/`

**What moves:**
- All 10 implementation files in `workflow/web-automation/`
- 5 spec files in `workflow/web-automation/`
- `workflow/validation/workflow-validation.web-automation-validator.ts` → `web-automation/validation/web-automation-validator.ts`

**New module:** `WebAutomationModule`

**Export surface (3 services):**
- `WebAutomationActionExecutorService` — consumed by `step-web-automation-special-step.handler.ts` and `workflow-runtime-browser-actions.service.ts`
- `WebAutomationSessionStoreService` — consumed by `workflow-runtime-browser-actions.service.ts` and `workflow-run-browser-session-cleanup.listener.ts`
- `WebAutomationArtifactQueryService` — consumed by `workflow-runtime-browser-actions.service.ts` and `workflow-runs.controller.ts`

**Why:** Web automation imports zero workflow services. It is a complete subsystem with its own data model (`WebAutomationFailureArtifact`), external infrastructure (Playwright), and lifecycle. It is the textbook extraction candidate.

---

### 5.3 Phase 3: Extract War Room to Top-Level Module

**Scope:** `workflow/war-room*.ts` → `apps/api/src/war-room/`

**What moves:**
- All 14 `war-room*.ts` files
- `workflow/validation/workflow-validation.war-room-validator.ts` (if it exists)

**New module:** `WarRoomModule`

**Decoupling work:**
1. Define `WarRoomEventLogPort` interface in `war-room/ports/event-log.port.ts`:
   ```ts
   export interface WarRoomEventLogPort {
     appendBestEffort(runId: string, event: unknown): Promise<void>;
   }
   ```
2. Create `WarRoomEventLogAdapter` in `workflow/` that implements the port using `WorkflowEventLogService`.
3. Move `resolveAgentMentionTriggerScope` to `shared/agent-scope.utils.ts` (it is stateless and used by both agent-communication and war-room).

**Export surface:** `WarRoomService` (the existing facade).

**Why:** War room is a distinct collaboration domain with its own data model. It is already consumed by `project/intelligence` and `telemetry` — forcing those modules to import the entire `WorkflowModule` export surface just for war-room functionality.

---

### 5.4 Phase 4: Merge Failure Classification + Repair into Submodule

**Scope:** `workflow/failure-classification/*` + `workflow/repair-delegation/*` + `workflow/workflow-failure-doctor-completion.listener.ts` → `workflow/workflow-repair/`

**New module:** `WorkflowRepairModule`

**What moves:**
- All 12 files from `failure-classification/`
- All 10 files from `repair-delegation/`
- `workflow/workflow-failure-doctor-completion.listener.ts` (it belongs to the repair lifecycle but currently sits in the parent directory)

**Decoupling work:**
- Move repair-delegation setting key constants from `repair-delegation.types.ts` to the `settings` module (or a shared constants package) to eliminate the outward leak into `settings/system-settings.service.ts` and `operations/doctor-repair-delegation.listener.ts`.

**Why:** These two directories are not independent. The classification listener directly calls `WorkflowRepairDispatchService`, and the dispatch service imports classification decision types. They are two phases of the same autonomous-repair lifecycle. Keeping them separate creates artificial boundaries while preserving tight coupling.

---

### 5.5 Phase 5: Extract Runtime Capabilities into Submodule

**Scope:** Active `workflow/workflow-runtime-*.ts` files → `workflow/workflow-runtime/`. Exclude removed/superseded runtime publish-specs files; current spec publication flows through `kanban.publish_specs`.

**New module:** `WorkflowRuntimeModule`

**What moves:**
- 46 files matching `workflow-runtime-*.ts`
- Controllers: `workflow-runtime-lifecycle.controller.ts`, `workflow-runtime-tools.controller.ts`, `workflow-runtime-subagents.controller.ts`, `workflow-runtime-artifacts.controller.ts`
- Services: capability executor, capability lifecycle, preflight, orchestration actions, browser actions, mesh delegation tools, subagent tools, set job output, investigation findings, tools service, tools formatting, tools context, tools helpers

**Internal grouping (optional, can be flat):**
- `capability/` — `workflow-runtime-capability-*.ts`
- `actions/` — `workflow-runtime-orchestration-actions.*`, `workflow-runtime-set-job-output.*`, `workflow-runtime-preflight.*`
- `adapters/` — `workflow-runtime-subagent-tools.*`, `workflow-runtime-mesh-delegation-tools.*`, `workflow-runtime-browser-actions.*`
- `publish-specs/` — historical/superseded runtime publish-spec files only; do not reintroduce them as active runtime capability files
- `findings/` — `workflow-runtime-investigation-findings.*`

**Why:** These 46 files are the agent-facing runtime surface of the workflow engine. They are thin adapters over core workflow services, but they clutter the root `workflow/` directory and make it hard to see the engine underneath.

---

### 5.6 Phase 6: Extract Internal Tools into Submodule

**Scope:** `workflow/tools/*` + `workflow/handlers/*` → `workflow/workflow-internal-tools/`

**New module:** `WorkflowInternalToolsModule`

**What moves:**
- 29 tool adapter files (`tools/memory/*`, `tools/project/*`, `tools/schedule/*`, `tools/work-items/*`, `tools/workflow/*`)
- 6 handler services (`handlers/*.ts`) plus their specs
- `internal-tool-registry.service.ts` reference (after Phase 1 move)

**Why:** The tool adapters have low coupling to the rest of the workflow module. The handlers are deeply embedded in workflow domain logic, so they cannot leave the workflow directory tree. A submodule keeps adapter/handler pairs together while removing ~35 provider registrations from the bloated `WorkflowModule`.

**Note on external consumers:** `database/seeds/seed-data-validation.tool-discovery.helpers.ts` and `tool/capability-handler-parity.spec.ts` import the tool classes. After extraction, these should import from the submodule export rather than deep paths.

---

## 6. Out of Scope

1. **Subagent orchestration, mesh delegation, agent communication extraction** — These are tightly coupled to each other (subagent and mesh should never be separated) and to core workflow infrastructure (`workflow-stage-skill-policy.service`, `host-mount-resolution.service`, `workflow-event-log.service`). Extracting them now would create circular dependencies. Revisit after stabilizing generic workflow infrastructure into a `workflow-core` internal package or port interfaces.
2. **Core engine decomposition** — The parser, state machine, DAG resolver, and persistence are the genuine workflow domain. Keep them together.
3. **Database entity relocation** — All entities remain in `database/entities/`.
4. **Behavioral changes** — Zero functional changes. If a test fails, the refactor commit is wrong.
5. **New abstractions beyond minimum** — Only `WarRoomEventLogPort` is introduced; everything else uses existing NestJS module boundaries.
6. **Publish-specs domain relocation** — The former runtime publish-specs service has been removed from `WorkflowRuntimeModule`; current spec publication flows through the Kanban-owned `kanban.publish_specs` resource publishing boundary. Do not reintroduce runtime publish-spec coupling during this decomposition.

---

## 7. Implementation Plan (Tiny Commits)

Each commit must leave the codebase buildable and testable.

### Phase 1: Move Misplaced Generic Infrastructure

**Commit 1.1:** Move `internal-tools/` to `tool/` module
- Move `workflow/internal-tools/internal-tool-registry.service.ts` → `tool/internal-tool-registry.service.ts`
- Move `workflow/internal-tools/internal-tool.tokens.ts` → `tool/internal-tool.tokens.ts`
- Delete re-export shims in `tool/tool.tokens.ts` and `tool/internal-tool-registry.service.ts`
- Update imports in `workflow.module.ts`, `workflow-runtime-tools.service.ts`, and any specs
- Run tests for `tool/` and `workflow/`

### Phase 2: Extract Web Automation

**Commit 2.1:** Create `WebAutomationModule` skeleton and move files
- Create `apps/api/src/web-automation/web-automation.module.ts`
- Move all `workflow/web-automation/*` files to `apps/api/src/web-automation/`
- Move `workflow/validation/workflow-validation.web-automation-validator.ts` → `web-automation/validation/web-automation-validator.ts`
- Update all import paths within moved files
- Run tests

**Commit 2.2:** Wire `WebAutomationModule` into application module graph
- Add `WebAutomationModule` to `AppModule` imports
- Remove web-automation providers/controllers from `WorkflowModule`
- Have `WorkflowModule` import `WebAutomationModule`
- Update `WorkflowRunsController` imports to use `web-automation/` paths
- Update `step-web-automation-special-step.handler.ts` imports
- Update `workflow-runtime-browser-actions.service.ts` imports
- Update `workflow-run-browser-session-cleanup.listener.ts` imports
- Run tests

### Phase 3: Extract War Room

**Commit 3.1:** Create `WarRoomModule` skeleton and move files
- Create `apps/api/src/war-room/war-room.module.ts`
- Move all `workflow/war-room*.ts` files to `apps/api/src/war-room/`
- Move `resolveAgentMentionTriggerScope` to `shared/agent-scope.utils.ts`
- Update all import paths within moved files
- Run tests

**Commit 3.2:** Decouple war-room from workflow event log
- Define `WarRoomEventLogPort` interface in `war-room/ports/event-log.port.ts`
- Create `WarRoomEventLogAdapter` in `workflow/` that implements the port using `WorkflowEventLogService`
- Update `WarRoomModule` to accept `WarRoomEventLogPort` as a provider
- Wire the adapter in `WorkflowModule` (provide the adapter, inject into `WarRoomModule`)
- Run tests

**Commit 3.3:** Wire `WarRoomModule` into application module graph
- Update `project/intelligence/project-war-room.service.ts` imports to use `war-room/` paths
- Update `telemetry/telemetry-war-room.gateway.ts` imports to use `war-room/` paths
- Update `telemetry/telemetry-gateway-war-room.command-helpers.types.ts` imports
- Remove `WarRoomService` from `WorkflowModule` exports
- Add `WarRoomModule` to `AppModule` imports
- Run tests

### Phase 4: Merge Failure Classification + Repair

**Commit 4.1:** Create `WorkflowRepairModule` skeleton and move files
- Create `workflow/workflow-repair/workflow-repair.module.ts`
- Move `failure-classification/*` → `workflow/workflow-repair/`
- Move `repair-delegation/*` → `workflow/workflow-repair/`
- Move `workflow/workflow-failure-doctor-completion.listener.ts` → `workflow/workflow-repair/`
- Update all import paths within moved files
- Run tests

**Commit 4.2:** Move repair-delegation setting keys to settings module
- Extract setting key constants from `repair-delegation.types.ts` (or `workflow-repair/repair-delegation.types.ts`) to `settings/repair-delegation-settings.constants.ts`
- Update `system-settings.service.ts` and its spec to import from `settings/`
- Update `operations/doctor-repair-delegation.listener.ts` and its spec to import from `settings/`
- Run tests

**Commit 4.3:** Wire `WorkflowRepairModule` into `WorkflowModule`
- Import `WorkflowRepairModule` in `WorkflowModule`
- Remove individual repair/failure-classification providers from `WorkflowModule`
- Update `workflow-runs.controller.ts` to import `WorkflowFailureClassificationService` from submodule
- Run tests

### Phase 5: Extract Runtime Capabilities

**Commit 5.1:** Create `WorkflowRuntimeModule` skeleton and move files
- Create `workflow/workflow-runtime/workflow-runtime.module.ts`
- Move all `workflow/workflow-runtime-*.ts` files into `workflow/workflow-runtime/`
- Keep internal file names unchanged
- Update all import paths within moved files
- Run tests

**Commit 5.2:** Wire `WorkflowRuntimeModule` into `WorkflowModule`
- Import `WorkflowRuntimeModule` in `WorkflowModule`
- Remove ~46 provider/controller declarations from `WorkflowModule`
- Update any remaining imports in core workflow files that reference runtime files
- Run tests

### Phase 6: Extract Internal Tools

**Commit 6.1:** Create `WorkflowInternalToolsModule` skeleton and move files
- Create `workflow/workflow-internal-tools/workflow-internal-tools.module.ts`
- Move `workflow/tools/*` and `workflow/handlers/*` into `workflow/workflow-internal-tools/`
- Update all import paths within moved files
- Run tests

**Commit 6.2:** Wire `WorkflowInternalToolsModule` into `WorkflowModule`
- Import `WorkflowInternalToolsModule` in `WorkflowModule`
- Remove tool/handler providers from `WorkflowModule`
- Update `database/seeds/seed-data-validation.tool-discovery.helpers.ts` to import from submodule export
- Update `tool/capability-handler-parity.spec.ts` to import from submodule export
- Run tests

### Phase 7: Verification & Cleanup

**Commit 7.1:** Verify `WorkflowModule` slim-down
- Confirm `workflow.module.ts` is ~150–200 lines (down from 460)
- Confirm no broken imports across the API project (`npm run build:api`)
- Run full test suite: `npm run test:api`

**Commit 7.2:** Update documentation
- Update `AGENTS.md` with new module boundaries
- Document which modules are top-level vs. workflow submodules
- Add a module dependency diagram (ASCII or Mermaid) to `docs/architecture/workflow-module-decomposition.md`

---

## 8. Definition of Done

1. [ ] `workflow.module.ts` is ≤200 lines.
2. [ ] `WorkflowModule` provider count is ≤60.
3. [ ] `WorkflowModule` controller count is ≤8.
4. [ ] `apps/api/src/web-automation/web-automation.module.ts` exists and exports the 3 required services.
5. [ ] `apps/api/src/war-room/war-room.module.ts` exists and exports `WarRoomService`.
6. [ ] `workflow/workflow-repair/workflow-repair.module.ts` exists and is imported by `WorkflowModule`.
7. [ ] `workflow/workflow-runtime/workflow-runtime.module.ts` exists and is imported by `WorkflowModule`.
8. [ ] `workflow/workflow-internal-tools/workflow-internal-tools.module.ts` exists and is imported by `WorkflowModule`.
9. [ ] `tool/internal-tool-registry.service.ts` and `tool/internal-tool.tokens.ts` exist (moved from `workflow/internal-tools/`).
10. [ ] No re-export shims remain in `tool/` for internal-tool registry.
11. [ ] `npm run build:api` passes with zero errors.
12. [ ] `npm run test:api` passes with zero failures.
13. [ ] No behavioral changes — all existing HTTP contracts, event names, DTOs, and database schemas are unchanged.
14. [ ] External consumers (`project/intelligence`, `telemetry`) import `WarRoomModule` directly, not through `WorkflowModule`.
15. [ ] `database/seeds` and `tool/capability-handler-parity.spec.ts` import tool classes through `WorkflowInternalToolsModule` exports, not deep paths.

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Import path breaks in moved files | High | Medium | Use IDE refactor (F2 / rename symbol) and run `npm run build:api` after every commit. |
| Circular dependency introduced | Medium | High | Never extract a subsystem that depends on `WorkflowModule` internals unless those internals are also extracted or ported. The plan explicitly avoids extracting subagent/mesh for this reason. |
| NestJS DI token resolution failures | Medium | High | Ensure `forwardRef` is preserved where needed. Test with `npm run test:api` after every wiring commit. |
| Missing provider export causes runtime error | Medium | High | The definition-of-done checklist includes explicit verification of export surfaces for each new module. |
| Merge conflicts with active feature branches | High | Medium | Coordinate with team. Prefer small, frequent commits so rebasing is granular. Document the file moves in team chat so other developers know to rebase. |
| WarRoomModule decouple breaks event logging | Low | High | The `WarRoomEventLogPort` is a thin interface; the adapter is a one-liner delegation to `WorkflowEventLogService`. Minimal risk. |
| Seed validation breaks after tool move | Low | Medium | Update seed helper imports in Commit 6.2. Run seed validation tests. |

---

## 10. Expected Outcome

| Metric | Before | After |
|---|---|---|
| `WorkflowModule` provider registrations | ~120 | ~60 |
| `WorkflowModule` controller declarations | ~15 | ~8 |
| `WorkflowModule` file count | ~312 | ~180 |
| Top-level modules in `apps/api/src/` | ~12 | ~14 (+ `web-automation`, `war-room`) |
| Workflow submodules | 0 | 4 (`internal-tools`, `runtime`, `repair`, core) |
| `workflow.module.ts` line count | 460 | ~150–200 |

### Long-term architectural benefits

1. **AI-navigability:** A developer can now understand the workflow module by reading ~180 files instead of ~312. Each submodule has a clear, narrow responsibility.
2. **Test locality:** Changes to web-automation retry logic only require the `WebAutomationModule` test context. Changes to war-room consensus only require the `WarRoomModule` context.
3. **Deletion test:** If the organization decides to remove browser automation, deleting `apps/api/src/web-automation/` removes exactly one subsystem. If war-room is no longer needed, deleting `apps/api/src/war-room/` removes exactly one collaboration domain.
4. **Sibling module health:** `project/intelligence` and `telemetry` no longer depend on the workflow monolith for war-room functionality.
5. **Future extraction readiness:** Once generic workflow infrastructure (event log, skill policy, host mounts) is stabilized into a `workflow-core` internal package, subagent orchestration and mesh delegation become extractable. This epic creates the precedent and pattern for that future work.

---

## 11. Related Work

- **EPIC-085** (`web-automation-actions-selectors-and-reliability`) — Web automation feature work. Coordinate so that active web-automation branches rebase cleanly after Commit 2.1.
- **EPIC-112** (`chat-session-context-history-and-war-room-context`) — War-room feature work. Coordinate so that active war-room branches rebase cleanly after Commit 3.1.
- **EPIC-144** (`failure-classification-and-repair-policy`) — Repair policy feature work. Coordinate so that active repair branches rebase cleanly after Commit 4.1.
- **EPIC-090** (`core-control-plane-decoupling-and-special-step-extension-boundary`) — Related decomposition work. This epic is a concrete execution of the broader control-plane decoupling vision.
- **EPIC-123** (`core-service-decomposition`) — Precedent for service decomposition in the codebase. This epic follows the same discipline for the workflow module specifically.

---

## 12. Further Notes

### Naming Conventions

- Top-level modules use PascalCase without the `Workflow` prefix if they are domain-extractive: `WebAutomationModule`, `WarRoomModule`.
- Workflow submodules use the `Workflow` prefix to signal they are still inside the workflow bounded context: `WorkflowRuntimeModule`, `WorkflowRepairModule`, `WorkflowInternalToolsModule`.
- The slimmed core remains `WorkflowModule`.

### Module Dependency Diagram (Target State)

```
AppModule
├── WorkflowModule (imports submodules, exports core services)
│   ├── WorkflowInternalToolsModule
│   ├── WorkflowRuntimeModule
│   ├── WorkflowRepairModule
│   └── Core engine, persistence, launch, execution, controllers
├── WebAutomationModule (standalone, imported by WorkflowModule)
├── WarRoomModule (standalone, imported by AppModule directly)
├── ToolModule (now owns internal-tool registry)
├── ProjectModule
├── TelemetryModule (imports WarRoomModule)
└── ... other existing modules
```

### Rollback Plan

Each commit is independently revertible. If a commit introduces a build or test failure:
1. Revert the single commit.
2. Fix the issue.
3. Re-apply as a new commit.

Because this is a pure move refactor with zero behavioral changes, `git revert` is safe for every commit in the plan.
