# EPIC-174: Shared Contracts, Validation, and DRY Cleanup

Status: Proposed
Priority: P2
Created: 2026-05-14
Last Updated: 2026-05-14
Owner: Core Platform + API + Web
Depends On: EPIC-089, EPIC-106, EPIC-116, EPIC-122, EPIC-150, EPIC-171, EPIC-172
Related Analysis:
- `docs/analysis/ANALYSIS-type-duplication.md`
- `docs/analysis/ANALYSIS-codebase-review-2026-04-25.md`
- Refactor scan performed 2026-05-14

---

## 1. Summary

This epic consolidates duplicated types, validation approaches, status constants, and small infrastructure utilities into shared contracts. The codebase currently mixes Zod schemas, TypeScript interfaces, `class-validator` DTOs, manual validation, local status arrays, and repeated infrastructure helpers. That creates drift and makes API, web, kanban, runner, and core packages harder to evolve together.

The target state is schema-first shared contracts in `packages/core` or a dedicated platform/contracts package. Runtime validation should use the same schemas that generate TypeScript types. Domain statuses and event envelopes should be defined once and imported everywhere.

---

## 2. Problem Statement

A recurring source of quality issues is duplicated domain knowledge. Examples include workflow run types, event envelope types, todo/work item statuses, request DTOs, and local utility implementations. When these definitions diverge, the system can compile while still disagreeing at runtime.

This epic reduces duplication and improves type safety by making core contracts authoritative.

---

## 3. Evidence and Affected Areas

### 3.1 Duplicated workflow run contracts

Prior analysis identified workflow run contracts defined separately as TypeScript interfaces and Zod schemas:

- `packages/core/src/interfaces/workflow-run.types.ts`
- `packages/core/src/schemas/workflow-run/workflow-run-contracts.schema.ts`

Problem:

- Interfaces and schemas can drift.
- Runtime validation may not match compile-time assumptions.

Target:

- Zod schema is authoritative.
- Export types via `z.infer<typeof Schema>`.

### 3.2 Duplicated event envelope contracts

Prior analysis identified separate event envelope definitions:

- `packages/core/src/interfaces/event-envelope.types.ts`
- `packages/core/src/schemas/events/event-envelope.schema.ts`

This is especially risky because EPIC-172 introduces durable event bus/outbox behavior. Event envelopes need one canonical schema before persistence and cross-service delivery are expanded.

### 3.3 Mixed validation approaches

The API layer uses multiple validation strategies:

1. Zod schemas and decorators in some controllers.
2. `class-validator` DTO classes in many controllers.
3. Manual validation in services.

Examples from prior analysis:

- ACP DTOs under `apps/api/src/acp/dto/**`
- User DTOs in `apps/api/src/users/users.controller.ts`
- Project DTOs under `apps/api/src/project/dto/**`
- Chat session DTOs under `apps/api/src/chat/chat-sessions/**`
- Work item DTOs such as `update-work-item.dto.ts` and `update-work-item-status.dto.ts`

Problem:

- Duplicate validation rules.
- Boilerplate-heavy DTOs.
- Frontend cannot reliably share API contracts.
- Services sometimes accept shapes not represented by controller DTOs.

### 3.4 Local status constants and policy metadata

Observed local constants include:

- `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`
  - `DISPATCH_ACTIVE_STATUSES`
- `apps/web/src/pages/project-workspace/SessionsTab.tsx`
  - `ACTIVE_STATUSES`
- `apps/api/src/workflow/workflow-subagents/mesh-delegation.service.types.ts`
  - `MESH_DELEGATION_ACTIVE_STATUSES`
- `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`
  - `TODO_STATUSES`
- `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts`
  - `TODO_STATUS_VALUES`

Problem:

- Status groupings become policy by accident.
- UI and backend may interpret lifecycle state differently.
- EPIC-170's workflow/agent authority model is weakened if each layer invents its own policy arrays.

### 3.5 Excessive `as any` and weak public boundaries

Scan found 192 `as any` matches in 37 files. Many are test files, but some production code uses dynamic typing at public boundaries.

Known production concern:

- `apps/api/src/workflow/kernel/workflow-kernel.module.ts`
  - `(service as any)[prop]`, addressed by EPIC-172.

Prior analysis also identified:

- `packages/pi-runner/src/tools/tool-builder.ts`
  - `NexusTool` public boundaries use `any`.
- `packages/pi-runner/src/tools/orchestrator/orchestrator-tool.types.ts`
  - `NexusActionHandler` typed as `payload: any`.
- `apps/api/src/workflow/step-special-step-executor.service.ts`
  - `job as unknown as IWorkflowStep` due to parse-time/runtime type split.

### 3.6 Duplicated infrastructure helpers

Prior analysis identified duplication in:

- correlation-id middleware
  - `apps/api/src/common/correlation-id.middleware.ts`
  - `apps/api/src/chat/common/correlation-id.middleware.ts`
  - `apps/kanban/src/common/correlation-id.middleware.ts`
- request context service implementations
- password validation services
  - `apps/api/src/auth/password-validation.service.ts`
  - `apps/api/src/users/password-validation.service.ts`
- MCP/ACP normalization helpers
  - `apps/api/src/mcp/mcp.service.ts`
  - `apps/api/src/acp/acp.service.ts`
- MCP/ACP runtime manager structural mirror
  - `apps/api/src/mcp/mcp-runtime-manager.service.ts`
  - `apps/api/src/acp/acp-runtime-manager.service.ts`

---

## 4. Goals

1. Make `packages/core` schemas authoritative for shared request/response/event/domain contracts.
2. Export TypeScript types from schemas via `z.infer` instead of maintaining duplicate interfaces.
3. Standardize API validation around Zod for new and migrated controllers.
4. Move domain statuses and status group metadata into canonical shared definitions.
5. Reduce production `any` usage at public boundaries.
6. Extract duplicated infrastructure into shared packages or base classes.
7. Add automated checks preventing reintroduced duplication for critical contracts.

---

## 5. Non-Goals

1. Do not migrate every controller DTO in one PR.
2. Do not remove `class-validator` globally before all consumers are migrated.
3. Do not change public API payloads without compatibility handling.
4. Do not make UI import server-only code.
5. Do not collapse legitimately distinct domain concepts just because they share names.

---

## 6. Proposed Contract Strategy

### 6.1 Schema-first pattern

For shared contracts:

```ts
export const WorkflowRunRequestV1Schema = z.object({
  workflowId: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  launchSource: z.string().min(1),
});

export type WorkflowRunRequestV1 = z.infer<typeof WorkflowRunRequestV1Schema>;
```

Rules:

1. Runtime schemas live in `packages/core/src/schemas/**`.
2. Types are inferred from schemas.
3. API controllers validate with schemas.
4. Web/API clients import inferred types or generated client types.
5. Manual interfaces are allowed only for non-runtime internal-only shapes.

### 6.2 Status metadata pattern

Define statuses and groups once:

```ts
export const WorkItemStatusSchema = z.enum([
  'todo',
  'in_progress',
  'in_review',
  'ready_to_merge',
  'done',
  'blocked',
]);

export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;

export const WorkItemStatusGroups = {
  active: ['in_progress', 'in_review', 'ready_to_merge'],
  terminal: ['done'],
  blocked: ['blocked'],
} as const satisfies Record<string, readonly WorkItemStatus[]>;
```

Actual values must match current domain statuses. The above is illustrative, not authoritative.

### 6.3 DTO migration pattern

For each controller:

1. Add or reuse core schema.
2. Introduce `@ZodBody`, `@ZodQuery`, or equivalent pipe.
3. Keep old DTO class only as compatibility wrapper if required.
4. Update tests to assert invalid payload rejection.
5. Export shared response schema where frontend consumes it.

---

## 7. Implementation Tasks

### Task 1: Contract inventory

Create a table of all duplicated contracts and decide canonical owner.

Minimum inventory:

- workflow run request/response/status
- event envelope
- workflow runtime todo inputs/statuses
- work item status and status groups
- chat service contracts
- user create/update/response contracts
- project/work item mutation contracts
- tool/action payload contracts

### Task 2: Workflow run and event envelope consolidation

- Make schema files authoritative.
- Replace duplicate interfaces with `z.infer` exports.
- Update imports in API, web, kanban, and tests.
- Add type-level tests where useful.

### Task 3: Status and policy metadata consolidation

- Define canonical status enums/group metadata in `packages/core`.
- Replace local status arrays in:
  - `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`
  - `apps/web/src/pages/project-workspace/SessionsTab.tsx`
  - `apps/api/src/workflow/workflow-subagents/mesh-delegation.service.types.ts`
  - `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts`
  - `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`

### Task 4: Zod DTO migration wave 1

Prioritize endpoints with existing core schemas:

- users create/update/response
- chat contracts
- workflow runtime tools
- work item status update if schema exists or can be added cleanly

### Task 5: Replace production public-boundary `any`

Prioritize:

- `packages/pi-runner/src/tools/tool-builder.ts`
- `packages/pi-runner/src/tools/orchestrator/orchestrator-tool.types.ts`
- workflow special-step parse-time/runtime type casts
- production `as any` remaining after EPIC-172

Use `unknown` plus schema parsing at runtime boundaries.

### Task 6: Extract duplicated infrastructure helpers

- Move correlation-id middleware into shared package.
- Move request context base implementation into shared package.
- Consolidate password validation service/interface.
- Extract MCP/ACP payload normalization helpers.
- Extract a base plugin runtime manager for MCP/ACP if the structural mirror remains.

---

## 8. Testing Strategy

1. Schema tests for valid/invalid payloads.
2. Controller tests proving Zod validation rejects invalid requests.
3. Type-level compile tests for inferred contracts where feasible.
4. Regression tests for status group consumers.
5. Unit tests for extracted shared infrastructure.
6. Grep/lint checks for forbidden duplicate declarations in critical contract areas.

---

## 9. Sequencing

1. Complete EPIC-171 before requiring strict startup validation everywhere.
2. Coordinate status metadata with EPIC-172 so event/orchestration behavior reads canonical lifecycle data.
3. Migrate one contract family at a time.
4. Avoid large-bang DTO migration. Each wave should be independently shippable.

---

## 10. Acceptance Criteria

1. Workflow run contracts have one authoritative schema source and exported inferred types.
2. Event envelopes have one authoritative schema source suitable for durable outbox persistence.
3. Work item/workflow todo status values and groups are imported from shared metadata, not redefined locally.
4. At least one controller family is migrated from `class-validator` DTOs to Zod shared schemas.
5. Production public-boundary `any` usage is reduced in prioritized files.
6. Correlation ID and request context duplicate implementations are consolidated or have a documented migration PR ready.
7. MCP/ACP duplicated normalization helpers are extracted or tracked with exact follow-up work.
8. API and web compile against shared contracts.

---

## 11. Definition of Done

- Shared schemas/types are documented and exported from package entry points.
- Migrated controllers use Zod validation and have request validation tests.
- Local duplicated status arrays are removed from targeted consumers.
- Production `any` usage has a measured before/after count.
- Duplication cleanup does not break public API compatibility.
- CI passes for API, web, kanban, core, and pi-runner packages relevant to migrated contracts.

---

## 12. Implementation Update (2026-05-15)

### 12.1 Completed in this delivery

1. Status metadata consolidation and consumer migration:
   - Added canonical work-item status groups in `packages/kanban-contracts/src/work-item.schema.ts` (`WORK_ITEM_STATUS_GROUPS`).
   - Migrated `apps/web/src/pages/project-workspace/SessionsTab.tsx` to import shared status groups rather than local status arrays.
   - Consolidated runtime todo status validation by reusing `TodoStatusSchema` in:
     - `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`
     - `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts`

2. Zod migration wave for chat/domain-event controller boundaries:
   - Added explicit `@ZodBody` validation to chat controller request bodies:
     - `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts`
     - `apps/api/src/chat/chat-messages/chat-messages.controller.ts`
   - Added explicit schema-validated generic domain event ingestion body in:
     - `apps/api/src/workflow/workflow-internal-domain-events.controller.ts`

3. Public-boundary typing hardening (`any` reduction):
   - Replaced interface boundary `any` usages with `unknown` in:
     - `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`
   - Removed `as any` in workflow metadata summary extraction in:
     - `apps/api/src/workflow/workflow-internal-tools/handlers/workflow-meta-tools.handler.ts`

4. Test coverage added for migrated behavior:
   - `packages/kanban-contracts/src/work-item-status-groups.spec.ts`
   - `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.spec.ts`
   - `apps/api/src/workflow/workflow-internal-tools/handlers/workflow-meta-tools.handler.spec.ts`
   - `apps/api/src/chat/chat-messages/chat-messages.controller.spec.ts`

### 12.2 Decisions and rationale

1. Adopt existing canonical todo status schema (`TodoStatusSchema`) as source-of-truth rather than introducing a parallel status declaration.
2. Add explicit controller-level Zod validation (`@ZodBody`) even where global metatype validation exists, to make boundary contracts self-describing and resilient to metadata drift.
3. Place work-item status groups in `@nexus/kanban-contracts` because the lifecycle is owned by kanban domain contracts and consumed by web/API.

### 12.3 Challenges and mitigations

1. Generic domain event ingestion accepts multiple envelope styles (snake_case/camelCase and domain-specific payloads). A strict inter-service envelope schema would be incompatible for current internal callers.
   - Mitigation: introduce a permissive but validated generic schema requiring an event type while preserving passthrough fields.
2. Legacy workflow job types do not formally declare `agent_profile` on `IJob`, but runtime data may include it.
   - Mitigation: replace unsafe cast with typed record narrowing and optional-string extraction.

### 12.4 Follow-up items

1. Extend the same status-group migration to other duplicated consumers (dashboard/session summary projections and kanban orchestration consumers).
2. Continue public-boundary `any` reduction for remaining workflow kernel and runtime adapter surfaces.
3. Evaluate introducing shared request schemas for chat create/message inputs in `@nexus/core` for full request/response contract symmetry.
