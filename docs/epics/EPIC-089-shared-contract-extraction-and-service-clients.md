# EPIC-089: Shared Contract Extraction and Service Clients

Status: Completed
Priority: P0
Depends On: EPIC-088
Related: PLAN-REFACTOR Phase 1
Last Updated: 2026-04-13

---

## 1. Epic Summary

Establish packages/core as the canonical source for all cross-service contracts before moving domain code into new services.

This epic defines and rolls out:

1. Versioned inter-service API DTOs
2. Versioned event envelope and event schemas
3. Service client interfaces/SDKs for Core, Kanban, and Chat
4. Contract validation and compatibility tests

---

## 2. Context

Current shared package exports workflow and utility types, but does not yet provide a complete service-split contract model:

1. packages/core has no canonical event envelope for eventId/eventType/eventVersion/correlationId/causationId.
2. Workflow job types include domain-heavy special-step identifiers.
3. Core workflow and domain interactions are mostly in-process service calls.

Contract-first extraction is required to avoid ad hoc APIs and breaking consumers during migration.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../specs/SDD-multi-service-control-and-domain-architecture.md
3. ../../packages/core/src/interfaces/index.ts
4. ../../packages/core/src/schemas/index.ts
5. ../../apps/api/src/workflow/workflow-launch.controller.ts
6. ../../apps/api/src/workflow/workflow-runs.controller.ts
7. ../../apps/api/src/project/project-orchestration-workflow-invocation.service.ts
8. ../../apps/api/src/session/session.controller.ts

---

## 4. Scope

### In Scope

1. Define canonical event envelope and per-domain event payload schemas in packages/core.
2. Define workflow-run request/status contracts for service-to-core execution requests.
3. Define internal service client interfaces (CoreClient, KanbanClient, ChatClient).
4. Add schema validation tests and consumer-driven contract tests.
5. Migrate apps/api call sites to use shared contracts where feasible.

### Out of Scope

1. Full service extraction.
2. Transport migration to a new message broker.
3. Endpoint removals.

---

## 5. Implementation Plan

### 5.1 Event Envelope and Schemas

1. Add EventEnvelopeV1 schema with strict required fields.
2. Add initial event families:
   - core.workflow.run.\*.v1
   - kanban.work_item.\*.v1
   - chat.message/session/memory.\*.v1
3. Add zod (or project standard) runtime validators and exported TypeScript types.

### 5.2 Execution Contracts

1. Add Core workflow run request/response contracts:
   - WorkflowRunRequestV1
   - WorkflowRunAcceptedV1
   - WorkflowRunStatusV1
2. Add run-control contracts (pause/resume/abort) and result schema.
3. Add typed idempotency and correlation metadata contract.

### 5.3 Service Client Interfaces

1. Add interfaces and HTTP client adapters for:
   - Core execution client
   - Kanban domain client
   - Chat domain client
2. Keep adapters transport-focused, with no domain policy logic.

### 5.4 Consumer Contract Tests

1. Add contract tests in apps/api for producer compatibility.
2. Add initial consumer stubs in apps/kanban and apps/chat (from EPIC-088 scaffolds).
3. Enforce additive-only schema changes in CI.

---

## 6. Deliverables

1. New contract modules in packages/core (interfaces + schemas).
2. Service client interfaces and default implementations.
3. Contract test suites and CI checks.
4. Migration guide for replacing local DTO duplicates.

---

## 7. Acceptance Criteria

1. Core workflow run request/status contracts are available from packages/core and used by at least one in-repo caller.
2. EventEnvelopeV1 exists with validation tests and example payloads.
3. Contract tests enforce backward compatibility for v1 schemas.
4. No cross-service DTO duplication in new code merged after this epic.
5. Lint and type-check pass for touched workspaces.

---

## 8. Actionable Tasks

- [x] E089-001 Add EventEnvelopeV1 and shared event schema modules in packages/core.
- [x] E089-002 Add workflow run request/status contracts in packages/core.
- [x] E089-003 Add run-control and idempotency metadata contracts.
- [x] E089-004 Add Core/Kanban/Chat client interfaces and default adapters.
- [x] E089-005 Add contract tests in packages/core and consumer tests in apps/api.
- [x] E089-006 Migrate selected apps/api call sites to shared contracts.
- [x] E089-007 Document contract versioning policy and additive-change rules.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. npm run test --workspace=packages/core
4. npm run test --workspace=apps/api

---

## 10. Risks and Mitigations

1. Risk: Over-designing contracts before real extraction.
   Mitigation: keep v1 minimal and additive.
2. Risk: Hidden consumers break from schema tightening.
   Mitigation: add sample fixtures and compatibility tests before enforcing.
3. Risk: Domain-specific naming leaks into core envelopes.
   Mitigation: event payload ownership review per bounded context.

---

## 11. Exit Criteria

1. Versioned contract package is authoritative for cross-service APIs/events.
2. Core and domain services can compile against shared interfaces without local duplicates.
3. Downstream extraction epics can depend on stable contract primitives.
