# EPIC-018: Telemetry Streaming, Dehydrate Safety, and Runner Bridge Tools

> **Status:** Completed  
> **Priority:** Critical  
> **Created:** 2026-03-25

---

## 1. Epic Summary

Close three high-impact execution-plane gaps discovered during SDD conformance review:

1. Stream partial tool output (`tool_execution_update`) from pi-runner to UI telemetry.
2. Harden dehydrate shutdown sequencing in pi-runner to reduce premature process-exit risk.
3. Add native runner bridge tools so agent tool calls can emit orchestrator control events (e.g., subagent requests).

This epic is focused on end-to-end runtime behavior across `packages/pi-runner` and `apps/api` telemetry paths.

### Success Criteria

- [x] `tool_execution_update` events are emitted by pi-runner and persisted/broadcast by TelemetryGateway.
- [x] Live tool output can be consumed incrementally by UI/clients without waiting for `tool_execution_end`.
- [x] Dehydrate path provides deterministic shutdown ordering and explicit flush barrier.
- [x] Runner-native bridge tool exists and can emit orchestrator-facing events for subagent orchestration.
- [x] Unit/integration tests cover positive and failure paths for all new behavior.

---

## 2. Scope

### In Scope

- Pi-runner telemetry mapping updates.
- Telemetry gateway event handlers and persistence/broadcast updates.
- Pi-runner dehydrate/abort shutdown sequencing hardening.
- Runner bridge tool design + implementation for orchestrator event emission.
- Test updates in `packages/pi-runner` and `apps/api`.

### Out of Scope

- New UI screens or visual redesign.
- Major workflow-engine redesign beyond event compatibility.
- External IAM or policy model changes.

---

## 3. Implementation Slices

### Slice A — Tool Output Streaming (Immediate)

- Add `tool_execution_update` mapping in `packages/pi-runner/src/telemetry-bridge.ts`.
- Add `tool_execution_update` socket handler in `apps/api/src/telemetry/telemetry.gateway.ts`.
- Add/extend tests:
  - `packages/pi-runner/src/telemetry-bridge.spec.ts`
  - `apps/api/src/telemetry/telemetry.gateway.spec.ts`

### Slice B — Dehydrate Shutdown Safety

- Refine command handling in `packages/pi-runner/src/main.ts` so dehydrate/abort sequencing ensures pending telemetry and disconnect ordering before process exit.
- Add focused tests for command-path lifecycle behavior.

### Slice C — Native Runner Bridge Tool

- Implement a runner-native tool with access to `OrchestratorClient` (e.g., `spawn_subagent` request emission).
- Wire tool injection prior to session creation in `session-factory` path.
- Align seed/tool-registry behavior with actual runtime bridge behavior.

---

## 4. Risks and Mitigations

- **Event volume growth** from streaming updates  
  Mitigation: keep payload bounded and client replace-by-toolCallId semantics.

- **Command-path regressions** in dehydrate flow  
  Mitigation: add deterministic command lifecycle tests + timeout/error handling.

- **Runtime/seed drift** between seeded tools and native bridge tools  
  Mitigation: define canonical behavior contract and validate in tests.

---

## 5. Technical Touchpoints

- `packages/pi-runner/src/telemetry-bridge.ts`
- `packages/pi-runner/src/main.ts`
- `packages/pi-runner/src/session-factory.ts`
- `apps/api/src/telemetry/telemetry.gateway.ts`
- `apps/api/src/tool/tool-registry.service.ts`
- `packages/pi-runner/src/telemetry-bridge.spec.ts`
- `apps/api/src/telemetry/telemetry.gateway.spec.ts`
