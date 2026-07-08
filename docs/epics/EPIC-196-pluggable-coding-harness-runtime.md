# EPIC-196: Pluggable Coding Harness Runtime

Status: Proposed
Priority: P1
Created: 2026-05-18
Updated: 2026-05-18
Owner: Runtime Platform / Workflow Execution
Depends On: EPIC-140, EPIC-160, EPIC-169, EPIC-193
Related: EPIC-048, EPIC-083, EPIC-103, EPIC-122, EPIC-159

---

## 1. Summary

Abstract the current PI-specific coding harness behind a provider-agnostic runtime contract so the orchestrator can run multiple harness backends and users can choose a backend per workflow, per step, per agent profile, or by global default.

This epic introduces a harness provider model with:

1. A stable internal execution contract owned by API/core.
2. A pluggable provider adapter layer for PI and future harnesses.
3. User-facing configuration to select built-in harnesses or register custom harness adapters.
4. Migration that keeps existing PI behavior working while enabling incremental rollout.

---

## 2. Problem Statement

The current execution path is functionally solid but tightly coupled to PI-specific runtime and transport assumptions.

Observed coupling points:

1. `RunnerConfigPayload` in `@nexus/core` encodes PI-centric fields (`provider`, `model`, `apiKey`, `baseUrl`, `systemPrompt`) and no harness identity.
2. `RunnerConfigStoreService` stores PI-shaped payloads directly and assumes one runner protocol.
3. Subagent kickoff and step execution post directly to PI runner endpoints (`/execute/agent`, `/execute/command`) via `ContainerHttpClientService`.
4. `packages/pi-runner` server and `createNexusSession` are hardwired to `@mariozechner/pi-coding-agent` session lifecycle and tool wiring.
5. Container provisioning assumes PI image/runtime conventions (extensions mount path, env naming, PI bridge semantics).

Resulting limitations:

1. Swapping harnesses requires broad code changes across API, shared contracts, and runtime container.
2. Users cannot choose different harnesses by use case.
3. Bring-your-own harness configuration is not first-class.
4. Orchestrator policy/governance is partially entangled with one harness implementation.

---

## 3. Current State Review (What We Keep vs Change)

### 3.1 What is working and should be preserved

1. API-side governance (`check-permission`) before tool execution.
2. Redis-backed ephemeral runner config handoff with TTL and one-time pop options.
3. Container orchestration lifecycle, mounts, and telemetry bridge architecture.
4. Existing AI config precedence and provider secret resolution in API.
5. Workflow-level execution orchestration and subagent control-plane semantics.

### 3.2 What needs abstraction

1. Harness identity and selection in execution contracts.
2. Runtime handshake between API and containerized harness server.
3. Harness-specific request/response payload shape.
4. Harness capability declaration (supports sessions, branching, command execution, browser, tool model, telemetry richness).
5. Harness-specific image/bootstrap assumptions.

---

## 4. Goals

1. Introduce a harness provider abstraction that decouples orchestration from PI internals.
2. Allow users/operators to choose harness by default, agent profile, workflow, and step override.
3. Support registration of additional harness adapters without invasive workflow-engine changes.
4. Preserve existing runtime governance, auditing, and policy enforcement.
5. Keep migration backward-compatible with PI as default provider.

## 5. Non-Goals

1. Removing PI runner in the first rollout.
2. Replacing Docker execution backend.
3. Reworking AI provider precedence rules.
4. Full marketplace UX for third-party harnesses in the first phase.

---

## 6. Target Architecture

### 6.1 Canonical Harness Contract (Core-owned)

Define a provider-agnostic contract in `@nexus/core` for runtime execution requests and responses.

Key contract concepts:

1. `harnessId` (required): stable identifier (`pi`, `openai-codex`, `custom:<name>`).
2. `executionMode`: agent turn, command, interactive session, background run.
3. `modelConfig`: normalized model/provider references and secret references (no plain API key requirement at callsite contract level).
4. `promptConfig`: system/user prompt envelope.
5. `toolPolicyContext`: allowed tools, governance metadata, approval behavior.
6. `telemetryContractVersion`: expected event schema version.

### 6.2 Harness Provider Registry (API-owned)

Add a provider registry that resolves `harnessId` to an adapter implementation.

Adapter responsibilities:

1. Validate requested capabilities.
2. Build harness-specific container/server request payload.
3. Map canonical request/response to harness-specific protocol.
4. Expose capabilities and health diagnostics.

### 6.3 Transport/Runtime Adapter Boundary

Refactor `ContainerHttpClientService` interaction from PI endpoints to adapter-provided endpoint maps.

Principle:

1. Workflow engine and subagent orchestrator call canonical adapter methods.
2. Only adapter layer knows concrete endpoint paths and payload shape.

### 6.4 Configuration Hierarchy for Harness Selection

Harness selection precedence (mirrors existing model precedence style):

1. Workflow step override (`steps[].inputs.harness_id`)
2. Agent profile default harness
3. Use-case or project default harness
4. Platform default harness

### 6.5 Bring-Your-Own Harness Path

Support operator/user-defined harness entries with:

1. Harness metadata (id, display name, capability flags).
2. Runtime endpoint/image config.
3. Secret references for authentication.
4. Policy controls (who can use which harness).

---

## 7. Phased High-Level Plan

### Phase 1: Contract and Compatibility Layer

1. Introduce canonical harness interfaces in `packages/core`.
2. Add PI adapter implementing the new interface with zero behavior change.
3. Add compatibility translator from existing `RunnerConfigPayload` to canonical contract.
4. Keep existing PI code paths behind adapter facade until cutover.

### Phase 2: Provider Registry and Selection

1. Implement API-side `HarnessProviderRegistryService`.
2. Add harness selection resolution in step execution and subagent provisioning.
3. Persist harness selection into runner-config store payloads.
4. Emit event-ledger diagnostics for selected harness and fallback reasons.

### Phase 3: Runtime Transport Decoupling

1. Introduce adapter-driven container HTTP client contract.
2. Move PI endpoint assumptions (`/execute/agent`, `/execute/command`) into PI adapter.
3. Ensure command execution and background execution are exposed via canonical methods.
4. Add strict contract tests for request/response mapping.

### Phase 4: Configuration Surface and Governance

1. Add DB/config model for harness definitions and defaults.
2. Add API endpoints for listing/validating harness options.
3. Add policy guardrails for harness usage permissions.
4. Add admin/operator docs for registering a custom harness.

### Phase 5: Additional Harness Enablement

1. Implement at least one non-PI harness adapter to prove abstraction.
2. Validate parity for required telemetry/governance behaviors.
3. Add migration guide and deprecation timeline for PI-only assumptions in older contracts.

---

## 8. Workstreams

### Workstream A: Shared Contract Evolution

1. Add new harness-agnostic types in `packages/core`.
2. Keep old types for transitional compatibility.
3. Provide explicit versioning/migration notes.

### Workstream B: API Orchestration Integration

1. Wire harness resolver into step executor and subagent orchestration.
2. Replace direct PI payload creation with canonical execution request creation.
3. Preserve current retry, timeout, and completion semantics.

### Workstream C: Runner Runtime Adapters

1. Extract PI-specific runtime mapping into adapter package/module.
2. Define adapter lifecycle (validate, executeAgent, executeCommand, health, shutdown).
3. Add adapter conformance tests.

### Workstream D: Config, UI, and Operator Controls

1. Add harness configuration APIs and seed defaults.
2. Provide web UI selectors for default and override scopes.
3. Add audit logging for harness config changes and runtime usage.

### Workstream E: Observability and Reliability

1. Standardize harness lifecycle events independent of provider.
2. Record selected harness and capability mismatch failures.
3. Add diagnostics endpoint(s) for harness health and compatibility checks.

---

## 9. Backlog (High-Level)

- [ ] E196-001 Define canonical harness runtime interfaces in `@nexus/core`.
- [ ] E196-002 Add PI compatibility adapter implementing canonical interfaces.
- [ ] E196-003 Add harness provider registry and dependency injection wiring.
- [ ] E196-004 Refactor runner config store payload to include harness identity.
- [ ] E196-005 Refactor step execution path to resolve harness via precedence.
- [ ] E196-006 Refactor subagent kickoff path to use adapter-based transport.
- [ ] E196-007 Add harness configuration domain (schema/entity/service).
- [ ] E196-008 Add API endpoints for harness list/validate/default/override.
- [ ] E196-009 Add policy checks for harness usage authorization.
- [ ] E196-010 Add event-ledger lifecycle events for harness selection and failures.
- [ ] E196-011 Add one non-PI harness adapter pilot.
- [ ] E196-012 Add docs and migration guide for custom harness registration.

---

## 10. Acceptance Criteria

1. Step and subagent execution no longer hardcode PI endpoint/payload assumptions in orchestration services.
2. A harness can be selected through precedence rules and is visible in runtime diagnostics.
3. PI remains fully functional as the default harness via adapter.
4. At least one additional harness can execute a representative workflow job via the same canonical orchestration flow.
5. Governance checks, approval flows, and telemetry auditing remain intact across harness providers.
6. Operators can configure harness defaults and register custom harness definitions without code edits to workflow engine core.

---

## 11. Risks and Mitigations

1. Risk: Contract churn breaks active runners.
   Mitigation: Introduce compatibility adapter and phased dual-contract support.
2. Risk: Governance parity differs by harness.
   Mitigation: Enforce a provider conformance suite for policy-critical behaviors.
3. Risk: Secret handling becomes fragmented.
   Mitigation: Keep secret resolution centralized in API and pass only required runtime credentials.
4. Risk: Configuration complexity overwhelms users.
   Mitigation: Provide sensible defaults with optional advanced override layers.
5. Risk: Migration introduces subtle behavior regressions.
   Mitigation: Maintain PI golden-path regression tests before and after each phase.

---

## 12. Exit Criteria

1. Harness runtime selection is provider-agnostic and configurable at multiple scopes.
2. Orchestration core depends on canonical harness contracts, not PI-specific APIs.
3. PI-specific logic is isolated to a dedicated adapter.
4. Documentation and operational playbooks cover adding and validating new harness providers.
