# EPIC-116: Controller Input Pipes and Validation Boundaries

Status: Proposed  
Priority: P1  
Depends On: EPIC-009, EPIC-106  
Last Updated: 2026-04-18  
Owner: TBD

---

## 1. Summary

Standardize API controller input handling by replacing route-level parsing logic with NestJS pipes and DTO-driven validation/transformation at transport boundaries.

This epic removes manual parsing patterns like:

1. Query params accepted as strings and coerced with Number(...) in handlers.
2. Controller helper functions that parse limits, offsets, booleans, CSV filters, and optional dates.
3. Repeated inline route-level schema-pipe wiring where small abstraction can reduce duplication.

The end-state is thinner controllers, consistent validation semantics, clearer 400 behavior, and lower regression risk when adding new endpoints.

---

## 2. Current-State Baseline

### 2.1 What already works

1. Global ValidationPipe is enabled with transform=true in API bootstrap.
2. Many query DTOs already use class-transformer and class-validator effectively.
3. ZodValidationPipe exists and is used for runtime-tool endpoints that consume shared schemas.
4. UUID route params are validated in some endpoints via ParseUUIDPipe.

### 2.2 Gaps this epic closes

1. Several controllers still manually parse limit/offset and fallback values in route methods.
2. Boolean and CSV parsing behavior is duplicated across controllers.
3. Optional date parsing is done in controller methods/helpers instead of DTO/pipes.
4. Some controller request-body types are interface-only and rely on manual checks rather than boundary validation.
5. Route-level ZodValidationPipe usage is repetitive and inconsistent with other boundary abstractions.

---

## 3. Problem Statement

Controller methods should primarily map transport input to service calls. In current API code, multiple handlers still perform parsing and coercion logic directly. This causes:

1. Duplicated behavior and drift across endpoints.
2. Inconsistent invalid-input behavior (fallback vs reject).
3. Larger controllers with mixed responsibilities.
4. Harder-to-test boundary rules because parsing logic is scattered.

A unified pipe and DTO strategy will keep boundary concerns declarative and reusable.

---

## 4. Goals

1. Move controller-level query/body parsing into pipes and DTO transformation/validation.
2. Eliminate duplicated parsing helpers for pagination, booleans, CSV filters, and optional dates.
3. Keep behavior stable in phase one (no user-facing semantic changes unless explicitly decided).
4. Improve endpoint consistency for API consumers and docs.
5. Keep controllers thin and service-oriented per project architecture guidance.

---

## 5. Non-Goals

1. Rewriting service/domain logic.
2. Changing orchestration behavior or workflow semantics.
3. Broad API contract redesign unrelated to parsing/validation boundaries.
4. Migrating all Zod-based endpoints to class-validator DTOs in this epic.

---

## 6. Desired End-State Behavior

1. Pagination-style query params are validated/transformed through shared DTOs/pipes.
2. Boolean query flags are parsed declaratively via pipes/DTO transforms, not manual string checks.
3. CSV query filters are parsed via a reusable transform utility/pipe.
4. Optional date fields are validated and transformed at boundary with consistent null/undefined handling.
5. Controller methods no longer contain ad hoc Number(...), Math.min(...), trim/split parser blocks.
6. Runtime-tool controllers use a small, consistent abstraction for schema-backed body parsing where beneficial.

---

## 7. Workstreams

### Workstream A: Shared Boundary Utilities

1. Add reusable query DTOs/pipes for pagination defaults, bounds, and optional filters.
2. Add reusable CSV-to-array transform utility for status-like query inputs.
3. Add reusable optional date transform/validator patterns.

### Workstream B: Controller Refactor Wave

1. Refactor endpoints with manual limit/offset parsing.
2. Refactor manual boolean query handling endpoints.
3. Refactor controllers using duplicated helper parse functions.
4. Apply UUID parsing pipes on id params where UUID semantics are expected.

### Workstream C: Body Validation Hardening

1. Convert interface-only request bodies in targeted controllers to validated DTO classes.
2. Remove redundant controller-side defensive parsing that becomes unnecessary after DTO validation.

### Workstream D: Zod Pipe Ergonomics

1. Introduce a small helper/decorator pattern to reduce repetitive inline ZodValidationPipe wiring.
2. Keep shared Zod schemas as source of truth for runtime-tool routes.

### Workstream E: Verification and Guardrails

1. Add/adjust unit tests for input boundary behavior in touched controllers.
2. Verify stable behavior for defaults and bounds in phase one.
3. Run API lint and targeted API tests for touched modules.

---

## 8. Candidate Targets (Initial)

1. apps/api/src/workflow/workflow-event-log.controller.ts
2. apps/api/src/observability/event-ledger.controller.ts
3. apps/api/src/workflow/workflow-ad-hoc-session.controller.ts
4. apps/api/src/chat/chat-sessions/chat-sessions.controller.ts
5. apps/api/src/chat/memory/chat-memory-observability.controller.ts
6. apps/api/src/memory/chat-memory-admin.controller.ts
7. apps/api/src/ai-config/controllers/agent-skills.controller.ts
8. apps/api/src/project/memory-learning.controller.ts
9. apps/api/src/project/skill-improvement-proposals.controller.ts
10. apps/api/src/tool/tool-approval-rules.controller.ts
11. apps/api/src/workflow/workflow-runtime-tools.controller.ts
12. apps/api/src/common/pipes/zod-validation.pipe.ts
13. apps/api/src/main.ts

---

## 9. Acceptance Criteria

1. Targeted controllers no longer perform manual Number(...)/Math.min/Math.max query coercion in handlers.
2. Boolean/CSV/date parsing for targeted endpoints is implemented through DTO transforms and/or NestJS pipes.
3. Interface-only request bodies in targeted controllers are replaced with validated DTO classes where applicable.
4. Targeted controller tests cover success and invalid-input paths.
5. API lint passes for changed files with no rule suppressions.
6. API build/typecheck remains green.

---

## 10. Verification Strategy

1. Unit tests for parsing boundaries:
   - valid values
   - omitted values (defaults)
   - invalid values
   - out-of-range values
2. Controller-level tests for representative endpoints in each parsing category.
3. Targeted regression checks for endpoint responses and status codes.
4. Repo commands from root:
   - npm run lint:api
   - npm run test:api
   - npm run build:api

---

## 11. Risks and Mitigations

1. Risk: Invalid-input behavior changes unintentionally from fallback to 400.
   Mitigation: Phase rollout with explicit behavior matrix and tests preserving current semantics first.
2. Risk: DTO transform edge cases introduce subtle parsing differences.
   Mitigation: Reuse shared utilities and add table-driven tests for boundary values.
3. Risk: Scope creep into broad API redesign.
   Mitigation: Restrict changes to transport-boundary parsing/validation concerns only.

---

## 12. Open Questions

1. Should invalid numeric query values continue to fallback to defaults, or should they uniformly return 400 after stabilization?
2. For runtime-tool endpoints, should Zod remain the only boundary contract, or should selected routes migrate to class-validator DTOs over time?
3. Should UUID validation be made mandatory for all UUID-like params in this wave, or phased by endpoint risk?
