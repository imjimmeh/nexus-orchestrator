# EPIC-091: Kanban Service Extraction and Compatibility Proxy

Status: Implemented (compatibility/deprecation omitted by request)
Priority: P0
Depends On: EPIC-088, EPIC-089, EPIC-090
Related: PLAN-REFACTOR Phase 3
Last Updated: 2026-04-13

---

## 1. Epic Summary

Extract project/work-item/orchestration domain ownership from apps/api into a new apps/kanban service while preserving user-facing API continuity through compatibility proxy routes.

---

## 2. Context

Kanban domain logic currently lives in apps/api and is deeply tied to workflow internals:

1. Project module owns project/work-item/orchestration controllers and services.
2. Work-item automation directly starts workflows through workflow engine.
3. Workflow runtime still calls project/work-item services.
4. Existing frontend routes rely on current apps/api paths.

A direct big-bang move would break runtime behavior and web clients.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../../apps/api/src/project/project.module.ts
3. ../../apps/api/src/project/work-item.service.ts
4. ../../apps/api/src/project/work-item-automation.service.ts
5. ../../apps/api/src/project/project-orchestration.service.ts
6. ../../apps/api/src/project/project-war-room.controller.ts
7. ../../apps/api/src/project/work-item.controller.ts
8. ../../apps/api/src/workflow/workflow-runtime-tools.service.ts

---

## 4. Scope

### In Scope

1. Stand up apps/kanban as authoritative owner of project/work-item/review domain APIs.
2. Move write paths for work-item and orchestration decisions to apps/kanban.
3. Integrate apps/kanban with Core internal workflow APIs via shared client contract.
4. Add compatibility proxy routes in apps/api for migration period.
5. Add kanban-side projection of core workflow run status events.

### Out of Scope

1. Full removal of api compatibility routes.
2. Full frontend route migration (handled with web refactor wave).

---

## 5. Implementation Plan

### 5.1 Service Setup and Domain Porting

1. Implement apps/kanban modules for project, work-item, orchestration, review, and war-room policy.
2. Move domain entities/repositories to kanban-owned persistence module (logical schema first).
3. Keep model parity during migration.

### 5.2 Core Integration

1. Replace in-process workflow engine calls with CoreClient workflow run request.
2. Add idempotency keys for dispatch/review/merge run requests.
3. Consume core run lifecycle events for local projection updates.

### 5.3 API Compatibility Layer

1. Preserve current route shapes via proxy/adapter routes in apps/api.
2. Route handlers in apps/api call apps/kanban via service client.
3. Add deprecation headers and migration telemetry.

### 5.4 Data Ownership Transition

1. Stop direct kanban writes inside apps/api.
2. Maintain read-compatibility projection tables where required.
3. Add data reconciliation jobs for cutover windows.

---

## 6. Deliverables

1. apps/kanban service with project/work-item/orchestration endpoints.
2. Core workflow execution client integration from kanban.
3. Compatibility proxy routes in apps/api.
4. Event-driven run projection model in kanban.
5. Migration and rollback runbook.

---

## 7. Acceptance Criteria

1. New/updated work-item and orchestration writes are performed by apps/kanban only.
2. apps/kanban can dispatch workflow runs through Core internal API contracts.
3. Existing frontend calls continue to work through compatibility routes.
4. Run-status projections in kanban remain consistent with core events under replay.
5. No direct kanban-table writes from apps/api after cutover flag is enabled.

---

## 8. Actionable Tasks

- [x] E091-001 Implement apps/kanban project/work-item/orchestration module shells.
- [x] E091-002 Port domain services and DTOs from apps/api project module.
- [x] E091-003 Add CoreClient integration for workflow run lifecycle requests.
- [x] E091-004 Implement core lifecycle event consumers and kanban projections.
- [ ] E091-005 Add compatibility proxy routes in apps/api with deprecation headers. (Intentionally skipped per current delivery direction.)
- [ ] E091-006 Add migration reconciliation jobs for in-flight runs.
- [ ] E091-007 Add deterministic kanban integration tests against split topology.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. npm run test --workspace=apps/kanban
4. npm run test:api
5. npm run test:e2e:kanban:deterministic

---

## 10. Risks and Mitigations

1. Risk: Dispatch race conditions during dual-write/dual-read windows.
   Mitigation: idempotency keys and projection reconciliation checks.
2. Risk: Proxy routes hide latency or transient failures.
   Mitigation: circuit breaker and explicit timeout/retry policy.
3. Risk: In-flight workflow runs lose linkage.
   Mitigation: migration script for run-to-work-item projection backfill.

---

## 11. Exit Criteria

1. Kanban domain write ownership is moved to apps/kanban.
2. Core and kanban communicate only through contracts.
3. Compatibility layer is stable and ready for frontend endpoint migration.
