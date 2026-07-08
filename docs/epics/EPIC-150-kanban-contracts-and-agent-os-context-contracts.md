# EPIC-150: Kanban Contracts and Agent OS Context Contracts

Status: Proposed
Priority: P0
Depends On: EPIC-149
Related: EPIC-089, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Create a shared kanban type library and remove kanban-specific identity from core workflow contracts. `@nexus/core` should describe agent OS concepts such as workflow runs, lifecycle events, opaque contexts, capabilities, and service clients. Kanban-specific project/work-item/goals/review types should move to a kanban-owned package consumed by `apps/kanban` and `apps/web`.

This epic is the contract seam that makes the later code movement safe.

---

## 2. Current State Review

1. `packages/core/src/schemas/workflow-run/workflow-run-contracts.schema.ts` still exposes `projectId` and `workItemId` on `WorkflowRunRequestV1Schema`.
2. `packages/core/src/schemas/events/event-envelope.schema.ts` still exposes `projectId` and `workItemId` on core workflow run event payloads.
3. `packages/core/src/interfaces/work-item.types.ts` contains `CoreProjectWorkItemRecord`.
4. `apps/kanban/src/project/*.types.ts` and `apps/kanban/src/work-item/*.types.ts` duplicate local types that the frontend cannot safely share.
5. `apps/web/src/lib/api/client.projects.ts` and related project client files rely on frontend-local project and work-item types.

---

## 3. Goals

1. Add a shared kanban contract package, likely `packages/kanban-contracts` or an equivalent package name approved during implementation.
2. Move project, work item, goals, review, orchestration, and kanban event schemas into the kanban contract package.
3. Introduce generic core workflow context identity as an opaque object, such as `context: { contextId, contextType, metadata }`.
4. Keep `@nexus/core` free of kanban domain terms except compatibility adapters that are explicitly temporary.
5. Give `apps/web` one canonical source for kanban response and request types.

---

## 4. Non-Goals

1. Do not move persistence in this epic.
2. Do not change runtime behavior in this epic beyond contract translation.
3. Do not move war-room contracts into kanban; war-room is core-owned generic collaboration.
4. Do not keep long-lived duplicate DTOs in web, kanban, and core.
5. Do not add generic abstractions for domains that do not exist yet.

---

## 5. Target Contracts

| Contract Area | Package |
| --- | --- |
| Workflow run request/status/control | `@nexus/core` |
| Core lifecycle events | `@nexus/core` |
| Core service client | `@nexus/core` |
| Kanban project/work-item/goals DTOs | Kanban contract package |
| Kanban work item lifecycle events | Kanban contract package |
| Kanban HTTP client for web and tests | Kanban contract package or web-local adapter built from its schemas |

---

## 6. High-Level Work

1. Create the kanban contract package with TypeScript exports, Zod schemas, and package build scripts.
2. Move existing kanban-local project and work-item types into the package.
3. Add schemas for goals, subtasks, execution config, review decisions, orchestration actions, and kanban event payloads needed by the frontend.
4. Refactor `@nexus/core` workflow run request contracts to use generic context fields instead of `projectId` and `workItemId`.
5. Add temporary translation helpers only where needed to support in-flight migration from project/work-item fields to the generic context object.
6. Update `apps/kanban` and `apps/web` imports to consume the kanban contract package.
7. Add schema compatibility tests for core contracts and kanban contracts.

---

## 7. Deliverables

1. A shared kanban contract package exported through npm workspaces.
2. Generic context-aware workflow run and lifecycle event contracts in `@nexus/core`.
3. Removed or quarantined kanban-specific types from `@nexus/core`.
4. Frontend-ready kanban DTO exports.
5. Contract tests proving request and event payload validation.

---

## 8. Acceptance Criteria

1. `WorkflowRunRequestV1Schema` no longer exposes `projectId` or `workItemId` as core-owned fields.
2. Core workflow lifecycle events no longer expose kanban-specific identity as first-class core payload fields.
3. `apps/web` imports kanban DTOs from the shared kanban contract package for project/work-item APIs.
4. `apps/kanban` imports its public API DTOs from the shared kanban contract package.
5. `@nexus/core` contains no work-item/project types except explicitly named compatibility fixtures scheduled for deletion.
6. Core workflow contracts use a generic opaque context object when first-class correlation beyond `input` is needed.

---

## 9. Suggested Quality Gates

1. `npm run build --workspace=packages/core`
2. `npm run test --workspace=packages/core`
3. `npm run build --workspace=packages/kanban-contracts`
4. `npm run test --workspace=packages/kanban-contracts`
5. `npm run build:kanban`
6. `npm run build:web`

---

## 10. Risks

1. Risk: contract churn blocks domain porting.
2. Mitigation: keep the first kanban contract package minimal and additive, then expand as each domain is ported.
3. Risk: `contextId` becomes a vague replacement for `projectId` with hidden kanban semantics.
4. Mitigation: require core to treat context identity as opaque metadata and force kanban to own interpretation.
