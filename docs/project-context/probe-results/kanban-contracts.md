---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-contracts
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - packages/kanban-contracts/src/index.ts
  - packages/kanban-contracts/src/index.spec.ts
  - packages/kanban-contracts/src/work-item-status-groups.spec.ts
  - packages/kanban-contracts/src/project.schema.ts
  - packages/kanban-contracts/src/work-item.schema.ts
  - packages/kanban-contracts/src/goals.schema.ts
  - packages/kanban-contracts/src/orchestration.schema.ts
  - packages/kanban-contracts/src/events.schema.ts
  - packages/kanban-contracts/src/review.schema.ts
  - packages/kanban-contracts/src/settings.schema.ts
  - packages/kanban-contracts/src/common.schema.ts
  - packages/kanban-contracts/src/project.types.ts
  - packages/kanban-contracts/src/work-item.types.ts
  - packages/kanban-contracts/src/goals.types.ts
  - packages/kanban-contracts/src/orchestration.types.ts
  - packages/kanban-contracts/src/events.types.ts
  - packages/kanban-contracts/src/review.types.ts
  - packages/kanban-contracts/src/settings.types.ts
  - packages/kanban-contracts/src/work-item-status.types.ts
source_paths:
  - packages/kanban-contracts/src
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Kanban Contracts and MCP

## Narrative Summary

The `packages/kanban-contracts` package is a well-structured, fully implemented Zod schema and TypeScript type library that serves as the canonical contract layer between the kanban domain service (`apps/kanban`) and the workflow/orchestration layer. It defines all domain objects (projects, work items, goals, reviews, orchestration state, events, and settings) as strict Zod schemas with corresponding inferred TypeScript types. The package is consumed by E2E tests and domain services, and enforces strict schema boundaries that prevent cross-domain leakage into core.

## Capability Updates

**Projects**
- `ProjectRecordSchema` / `ProjectRecord`: Database-level record with `createdAt`/`updatedAt` camelCase timestamps, project goals description, and repository metadata.
- `ProjectSchema` / `Project`: Web/API-level view with snake_case timestamps.
- `CreateProjectInputSchema` / `CreateProjectInput`: Input with optional goals array and source type (create_new, import_local, import_remote).
- `UpdateProjectRequestSchema` / `UpdateProjectRequest`: Partial update support.

**Work Items**
- `WorkItemStatusSchema` / `WorkItemStatus`: 8-state enum (`backlog`, `todo`, `refinement`, `in-progress`, `in-review`, `ready-to-merge`, `blocked`, `done`).
- `WORK_ITEM_STATUS_GROUPS` / `isWorkItemStatusInGroup()`: Grouping utility (active, completed, blocked) with helper function.
- `WorkItemScopeSchema` / `WorkItemScope`: `standard | large`.
- `WorkItemSubtaskSchema` / `WorkItemSubtask`: Subtask with status, order, and dependency chain.
- `WorkItemRecordSchema` / `WorkItemRecord`: DB record with camelCase timestamps and `linkedRunId`.
- `WorkItemSchema` / `WorkItem`: API-level view with snake_case timestamps.
- `WorkItemExecutionConfigSchema` / `WorkItemExecutionConfig`: Branch config, maxTokens, maxLoops, implementationPlan, rejectionFeedback/rejectionCount.
- `WorkItemRejectionFeedbackSchema` / `WorkItemRejectionFeedback`: Rejection feedback with failed deliverables.
- `CreateWorkItemInputSchema` / `CreateWorkItemInput`: Creation input with optional subtasks.
- `UpdateWorkItemRequestSchema` / `UpdateWorkItemRequest`: Partial update with dependency and subtask support.
- `DispatchWorkItemInputSchema` / `DispatchWorkItemInput`, `MergeWorkItemInput` / `MergeWorkItemInput`, `WorkItemRunRequestResultSchema` / `WorkItemRunRequestResult`: Dispatch and run result contracts.

**Goals**
- `ProjectGoalSchema` / `ProjectGoal`: Full goal record with status (todo/in_progress/blocked/completed/cancelled), MoSCoW priority, sort order, target date, owner agent profile, and archived flag.
- `ProjectGoalWorklogSchema` / `ProjectGoalWorklog`: Worklog entries linked to goals and work items.
- `CreateProjectGoalRequestSchema` / `CreateProjectGoalRequest`, `UpdateProjectGoalRequest` / `UpdateProjectGoalRequest`, `UpdateProjectGoalStatusRequestSchema` / `UpdateProjectGoalStatusRequest`: CRUD request schemas.
- `CreateProjectGoalWorklogRequestSchema` / `CreateProjectGoalWorklogRequest`: Worklog creation.
- `ReorderProjectGoalsRequestSchema` / `ReorderProjectGoalsRequest`, `LinkProjectGoalWorkItemRequestSchema` / `LinkProjectGoalWorkItemRequest`: Ordering and linking.

**Orchestration**
- `OrchestrationModeSchema` / `OrchestrationMode`: `supervised | autonomous`.
- `OrchestrationStatusSchema` / `OrchestrationStatus`: lifecycle status enum.
- `ProjectOrchestrationStatusSchema` / `ProjectOrchestrationStatus`: Extended status including `idle`, `awaiting_approval`, `bootstrapping`, `paused`, `completed`, `failed`.
- `ProjectOrchestrationModeSchema` / `ProjectOrchestrationMode`: extended modes including `notifications_only`.
- `ProjectOrchestrationDecisionEntrySchema` / `ProjectOrchestrationDecisionEntry`: Decision log with reasoning, actions, mode evaluation, cycle decision, idempotency key, and autonomous default.
- `ProjectOrchestrationActionRequestSchema` / `ProjectOrchestrationActionRequest`: Action request with full approval/rejection lifecycle.
- `ProjectOrchestrationActionRequestListItemSchema` / `ProjectOrchestrationActionRequestListItem`: List item variant with `projectName` and `workflowId`.
- `ProjectOrchestrationSchema` / `ProjectOrchestration`: Full orchestration record with `probe_results` field for embedding probe outcomes.
- `ProjectStateSnapshotSchema` / `ProjectStateSnapshot`: Aggregate state for all work items grouped by status.
- `ProjectOrchestrationStateSchema` / `ProjectOrchestrationState`: Combined orchestration + project state + pending action requests.
- `StartOrchestrationInputSchema` / `StartOrchestrationInput`: Input with `sourceContext`, `readinessContext`, and `startupHints` for routing.
- `StartupRoutingSourceContextSchema`, `StartupRoutingReadinessContextSchema`, `StartupRoutingHintsSchema`: Routing context schemas.

**Review**
- `ProjectReviewDecisionInputSchema` / `ProjectReviewDecisionInput` (alias `ReviewDecisionInput`): approve/reject decision with workflow ID and optional feedback.

**Events**
- `KanbanWorkItemEventTypeV1Schema` / `KanbanWorkItemEventTypeV1`: Envelope types for created, status_changed, assigned.
- `KanbanWorkItemStatusChangedEventPayloadV1Schema`: Full payload with resource snapshot and previous status.
- `KanbanWorkItemEventEnvelopeV1Schema` / `KanbanWorkItemEventEnvelopeV1`: Discriminated union envelope with eventId, causationId, correlationId, sourceService=kanban, and typed payload.

**Settings**
- `KanbanSettingKeySchema` / `KanbanSettingKey`: 12 setting keys covering dispatch, scheduler, preflight pipeline, polling, and auto-restart configuration.
- `KanbanSettingSchema` / `KanbanSetting`: Setting value with description and timestamps.
- `KanbanSettingsListResponseSchema` / `KanbanSettingsListResponse`, `KanbanSettingResponseSchema` / `KanbanSettingResponse`: Response wrappers.
- `UpdateKanbanSettingRequestSchema` / `UpdateKanbanSettingRequest`: Value-required update.

**Common**
- `TimestampFieldsSchema` / `TimestampFields`: snake_case timestamps.
- `CamelTimestampFieldsSchema` / `CamelTimestampFields`: camelCase timestamps.

## Health Findings

- **Test coverage**: 2 spec files cover core parsing and status group classification. `index.spec.ts` validates all major schemas with positive and negative (throw) cases including invalid status values. `work-item-status-groups.spec.ts` validates the status group classification utility.
- **Strict mode enforcement**: All schemas use `.strict()` to reject unknown keys, enforcing clean contract boundaries.
- **Type coverage**: Every schema has a corresponding `*.types.ts` file that exports inferred TypeScript types — no schema-to-type drift.
- **Export surface**: `index.ts` re-exports everything, providing a single entry point for consumers.
- **No runtime logic**: This is a pure schema/type package with no side effects; minimal churn risk.
- **Consumer usage**: Schemas are referenced in E2E tests (`packages/e2e-tests/src/kanban-lifecycle/`) and domain service `apps/kanban`. The `ProjectOrchestrationStateSchema` includes a `probe_results` map that embeds probe outcomes (e.g., `"web-ui": { outcome, result }`).

## Open Questions

- **kanban-mcp package**: The `OPEN_QUESTIONS.md` notes that `kanban-mcp` may not be initialized. The `kanban-contracts` package could serve as the contract layer for a future MCP server, but no MCP-specific transport or tool schemas are present in this package. If a `kanban-mcp` package is created, it would likely import `kanban-contracts` and add MCP transport wrappers.
- **Schema versioning strategy**: Events use a `v1` envelope pattern, but there is no explicit schema versioning policy for other contracts. Future breaking changes to `ProjectRecordSchema` or `WorkItemSchema` would require a migration or versioned schema.
- **Probe result embedding**: `ProjectOrchestrationSchema` has a loose `probe_results: z.record(z.string(), z.unknown())` field. Consider tightening this to a known probe result shape to improve type safety for probe scope reporting.