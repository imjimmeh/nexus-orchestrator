# EPIC-158: Core Kanban Cutover Cleanup

Status: Completed
Priority: P0
Depends On: EPIC-150, EPIC-151, EPIC-152, EPIC-153, EPIC-154, EPIC-155, EPIC-156, EPIC-157
Related: EPIC-089, EPIC-090, EPIC-091, EPIC-134, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-05-01

---

## 1. Summary

Finish the missed cleanup from the EPIC-150 through EPIC-157 kanban cutover. The first cutover established the major split-service seams, but audit still shows residual kanban identity and behavior in `@nexus/core` and `apps/api`. This epic turns those misses into an explicit cleanup backlog with allowlists, boundary tests, and split-service verification.

Core should remain an agent OS: workflow runs, lifecycle events, sessions, tools, runtime capabilities, automation, chat, war-room, and operational telemetry. Kanban should own project, work item, goals, dispatch, review, and kanban lifecycle interpretation.

---

## 2. Current State Review

1. `packages/core/src/schemas/workflow-run/workflow-run-contracts.schema.ts` now uses generic `context`, and tests reject top-level `projectId` and `workItemId` on workflow run requests.
2. `packages/core/src/schemas/events/event-envelope.schema.ts` now uses generic `context` for core workflow lifecycle payloads, but still exposes `projectId` on `ChatSessionEventPayloadV1Schema`.
3. `packages/core/src/interfaces/chat-session.types.ts`, `packages/core/src/interfaces/internal-tool.types.ts`, `packages/core/src/interfaces/automation.types.ts`, `packages/core/src/interfaces/scheduled-job.types.ts`, `packages/core/src/interfaces/workflow-legacy.types.ts`, and `packages/core/src/schemas/workflow-runtime` still contain project/work-item terminology.
4. `packages/core/src/interfaces/automation.types.ts` defines `AutomationHookTriggerType` with kanban-specific values like `WORK_ITEM_STATUS_CHANGED` and `PROJECT_ORCHESTRATION_COMPLETED`.
5. `packages/core/src/schemas/tools/nexus-orchestrator` still exposes legacy kanban tool contracts under core exports, prefixed with `LegacyKanban*`.
6. `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts` still knows kanban statuses and can update work-item status through `handleDispatchStartWorkItemsCompat`.
7. `apps/api/src/workflow/workflow-runtime/workflow-runtime-tools-formatting.ts` still formats project and work-item state (`formatProjectStateMarkdown`, `formatWorkItemsListMarkdown`) as core runtime output.
8. `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts` and `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` still read legacy `trigger.projectId` and `trigger.workItemId` for context resolution.
9. `apps/api/src/common/git/git-worktree.service.ts` and `GitPathService` still organize worktrees using `projectId` and `workItemId`.
10. `apps/api/src/database/entities/automation-hook.entity.ts` and related automation entities still use `project_id` as a primary scoping field.
11. `basePath` handling has been introduced as a generic alternative to `projectId` for project-level workflows but is not yet fully unified.
12. `apps/api/src/core-kanban-cutover.boundary.spec.ts` exists but does not yet encode a complete allowlist for residual kanban/project/work-item references.

---

## 3. Goals

1. Classify every remaining `projectId`, `workItemId`, `WorkItem`, `ProjectModule`, `ProjectGoals`, `amend_entity`, and kanban-owned term in `packages/core/src` and `apps/api/src` as keep, migrate, quarantine, or delete.
2. Remove or migrate residual first-class kanban identity from `@nexus/core` contracts unless the symbol is explicitly named `LegacyKanban*` and scheduled for deletion.
3. Remove core API behavior that mutates, formats, queries, or fans out kanban domain state in-process.
4. Replace legacy `trigger.projectId` and `trigger.workItemId` readers with generic `trigger.context` readers where core correlation is required, or use `scopeId`/`contextId`.
5. Move or delete legacy core-hosted kanban tool schemas so kanban MCP is the owner of kanban runtime tools.
6. Expand automated boundary tests so future changes cannot reintroduce core-owned kanban domain behavior.
7. Re-run split-service verification after cleanup to prove kanban and core still communicate only through approved seams.

---

## 4. Non-Goals

1. Do not remove generic chat, war-room, telemetry, automation, scheduled job, tool, or workflow features merely because they currently carry legacy project metadata.
2. Do not drop production database tables in this epic unless EPIC-157 database cutover runbooks and backups are already complete.
3. Do not preserve old project/work-item compatibility routes without an explicit owner, expiry date, and test coverage.
4. Do not introduce a new generic domain abstraction that simply renames kanban semantics.
5. Do not weaken split-service tests to make cleanup easier.

---

## 5. Classification Rules

| Classification | Meaning                                                                     | Required Action                                                                                        |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Keep           | Generic core concept, not kanban-owned, and safe under agent OS terminology | Rename fields away from `project`/`workItem` if possible, or document why the name remains             |
| Migrate        | Core still needs correlation but not kanban semantics                       | Convert to `context`, `scope`, `resource`, `session`, or another generic contract                      |
| Quarantine     | Temporary compatibility needed for an active caller                         | Prefix with `LegacyKanban`, isolate in a legacy boundary file, add expiry issue, and test the boundary |
| Delete         | Stale core-owned kanban behavior after split-service cutover                | Remove code, tests, exports, routes, providers, and docs                                               |

---

## 6. High-Level Work

1. Build a residual-reference inventory for `packages/core/src` and `apps/api/src` using static searches and source-level review.
2. Update `apps/api/src/core-kanban-cutover.boundary.spec.ts` to encode the allowed reference list before changing implementation.
3. Write failing tests for generic context extraction from workflow run triggers and lifecycle events.
4. Replace legacy `trigger.projectId` and `trigger.workItemId` readers with generic context helpers in workflow run operations, workflow event queries, notifications, step support, and git-worktree services.
5. Delete or move `packages/core/src/schemas/tools/nexus-orchestrator/work-items.*` and associated core action registrations if all consumers have moved to kanban MCP.
6. Remove core runtime markdown formatting that describes kanban project/work-item state; if a generic runtime status output is still needed, make it context-agnostic.
7. Remove telemetry compatibility code that mutates kanban work-item status from core, or quarantine it as `LegacyKanban*` with a removal test and expiry.
8. Review chat, automation, scheduled job, internal tool, and telegram settings contracts and migrate project-scoped fields to generic scope/context terminology where they are not truly kanban-owned.
9. Rename `project_id` to `scope_id` in automation-related database entities and repositories in `apps/api`.
10. Expand split-service integration tests to assert approved communication paths: kanban to core workflow HTTP, core lifecycle Redis stream consumption, and kanban MCP for kanban tools.
11. Update docs for the final allowed seams and the cleanup inventory.

---

## 7. Implementation Plan

### Task 1: Residual Reference Inventory

**Files:**

- Modify: `docs/analysis/2026-05-01-core-kanban-cutover-residual-reference-inventory.md`
- Inspect: `packages/core/src/**/*.ts`
- Inspect: `apps/api/src/**/*.ts`

**Steps:**

1. Run static searches for `projectId`, `workItemId`, `WorkItem`, `ProjectModule`, `ProjectGoals`, `amend_entity`, `kanban`, `project_id`, and `work_item_id`.
2. Classify each production-code match as keep, migrate, quarantine, or delete.
3. Record exact file paths and the planned action for each match.
4. Treat tests as coverage evidence only after production references are classified.

### Task 2: Boundary Test Red Phase

**Files:**

- Modify: `apps/api/src/core-kanban-cutover.boundary.spec.ts`
- Test: `apps/api/src/core-kanban-cutover.boundary.spec.ts`

**Steps:**

1. Add an explicit allowlist for residual terms in `apps/api/src`.
2. Add assertions that fail for unclassified `projectId`, `workItemId`, `WorkItem`, `ProjectModule`, `ProjectGoals`, and `amend_entity` references.
3. Run `npm run test:api -- apps/api/src/core-kanban-cutover.boundary.spec.ts` and confirm it fails on the current residual references.

### Task 3: Core Contract Cleanup

**Files:**

- Modify: `packages/core/src/schemas/events/event-envelope.schema.ts`
- Modify: `packages/core/src/schemas/chat/chat-service-contracts.schema.ts`
- Modify: `packages/core/src/interfaces/chat-session.types.ts`
- Modify: `packages/core/src/interfaces/internal-tool.types.ts`
- Modify: `packages/core/src/interfaces/automation.types.ts`
- Modify: `packages/core/src/interfaces/scheduled-job.types.ts`
- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts`
- Modify: `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`
- Test: matching `*.spec.ts` and `*.typecheck.ts` files

**Steps:**

1. Write or update tests that reject new first-class kanban identity in core workflow and lifecycle contracts.
2. Migrate generic core-owned contracts to `contextId`, `scopeId`, or equivalent neutral names.
3. Move kanban-specific `AutomationHookTriggerType` values to a kanban-owned contract or quarantine them.
4. Rename temporary compatibility exports with `LegacyKanban*` if they cannot be deleted in this pass.
5. Run `npm run test --workspace=packages/core` and `npm run build --workspace=packages/core`.

### Task 4: Core Runtime and Git Worktree Cleanup

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-support.service.ts`
- Modify: `apps/api/src/common/git/git-worktree.service.ts`
- Modify: `apps/api/src/common/git/path/git-path.service.ts`
- Modify: `apps/api/src/notifications/notification-producer.service.ts`
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-tools-formatting.ts`

**Steps:**

1. Write failing unit tests for generic context extraction and legacy trigger rejection.
2. Replace direct `trigger.projectId` and `trigger.workItemId` access with generic context helpers or `basePath`.
3. Update `GitWorktreeService` to use generic `scopeId` and `contextId`.
4. Remove kanban-specific markdown formatting from core runtime outputs.
5. Run targeted API tests for each touched module.

### Task 5: Telemetry Compatibility Removal

**Files:**

- Modify: `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`
- Modify: matching telemetry specs

**Steps:**

1. Write a failing test proving core telemetry no longer mutates kanban work-item status.
2. Remove `handleDispatchStartWorkItemsCompat` and direct kanban status mapping from core telemetry.
3. If a short-lived compatibility path is still required, isolate it under an explicit `LegacyKanban*` name.
4. Run the telemetry test file and the API boundary test.

### Task 6: Kanban Tool Ownership Cleanup

**Files:**

- Modify or delete: `packages/core/src/schemas/tools/nexus-orchestrator/work-items.schemas.ts`
- Modify or delete: `packages/core/src/schemas/tools/nexus-orchestrator/work-items.types.ts`
- Modify: `packages/core/src/schemas/tools/nexus-orchestrator/action.schema.ts`
- Inspect: `apps/kanban/src/mcp/**`
- Inspect: seeded workflow files under `apps/api/src/database/seeds`

**Steps:**

1. Prove all kanban runtime tools are reachable through kanban MCP.
2. Remove core-hosted work-item tool schemas and action registrations if unused.
3. Keep only explicitly named legacy schema exports if a seeded workflow still requires a temporary bridge.
4. Run `npm run test --workspace=packages/core`, `npm run test:kanban`, and the split-service MCP tests.

### Task 7: Automation and Entity Cleanup

**Files:**

- Modify: `apps/api/src/database/entities/automation-hook.entity.ts`
- Modify: `apps/api/src/database/entities/heartbeat-profile.entity.ts`
- Modify: `apps/api/src/database/entities/standing-order.entity.ts`
- Modify: `apps/api/src/database/entities/scheduled-job.entity.ts`
- Modify: related repositories and services in `apps/api/src/automation`

**Steps:**

1. Create a migration to rename `project_id` to `scope_id` (or similar generic name) in automation-related tables.
2. Update entities, repositories, DTOs, and services to use the new generic field name.
3. Ensure `AutomationHookTriggerType` usage is updated to reflect the split between core and kanban triggers.
4. Run automation tests.

### Task 8: Split-Service Regression Verification

**Files:**

- Modify: `apps/kanban/test/split-service/*.integration-spec.ts`
- Modify: `packages/e2e-tests/src/split-service-kanban-core/split-service-kanban-core.test.ts`

**Steps:**

1. Add assertions that core does not expose kanban mutation routes or in-process kanban tool behavior.
2. Verify kanban can still launch core workflow runs using opaque context.
3. Verify kanban can still consume lifecycle events and rebuild projections from generic context.
4. Verify kanban MCP remains the only kanban tool execution seam.
5. Run split-service integration tests.

### Task 9: Final Documentation and Boundary Report

**Files:**

- Modify: `docs/analysis/2026-05-01-core-kanban-cutover-residual-reference-inventory.md`
- Modify: `docs/epics/EPIC-158-core-kanban-cutover-cleanup.md`

**Steps:**

1. Update the inventory with final keep/migrate/quarantine/delete outcomes.
2. Record any remaining `LegacyKanban*` symbols with owners and deletion conditions.
3. Run final quality gates.

---

## 8. Deliverables

1. Residual-reference inventory with every core/API kanban term classified.
2. Expanded static boundary tests for `@nexus/core` and `apps/api`.
3. Core contracts migrated to generic context/scope names or quarantined under `LegacyKanban*`.
4. Removed or quarantined core runtime, notification, telemetry, and repository logic that reads kanban-specific trigger fields.
5. Unified `basePath` handling in Core services as the generic alternative to project-scoping.
6. Removed core-owned kanban tool schemas and action registrations, or explicitly quarantined temporary legacy exports.
7. Automation entities and services migrated to generic scoping terminology.
8. Split-service verification showing kanban/core communication only through approved HTTP, Redis stream, and MCP seams.
9. Updated documentation for the final boundary and any remaining legacy expiry items.

---

## 9. Acceptance Criteria

1. `packages/core/src` has no unclassified `projectId`, `workItemId`, `WorkItem`, project-goal, or kanban-owned contracts.
2. `apps/api/src` has no unclassified `projectId`, `workItemId`, `WorkItem`, `ProjectModule`, `ProjectGoals`, `amend_entity`, or kanban-owned behavior.
3. Any remaining compatibility symbol is prefixed `LegacyKanban`, isolated behind a boundary file, covered by a test, and listed in the cleanup inventory with a deletion condition.
4. Core workflow-run, lifecycle-event, notification, telemetry, and workflow-event query paths use generic `context` or neutral scope metadata when correlation is needed.
5. Core no longer mutates kanban work-item status or formats kanban project/work-item state as an agent OS runtime response.
6. Kanban-owned runtime tools execute through kanban MCP or another kanban-owned seam, not through core internal tool action schemas.
7. Boundary tests fail if a new unclassified kanban/project/work-item reference is added to `packages/core/src` or `apps/api/src`.
8. Split-service tests pass for kanban-to-core workflow launch, core lifecycle stream projection, and kanban MCP tool calls.

---

## 10. Suggested Quality Gates

1. `npm run test --workspace=packages/core`
2. `npm run build --workspace=packages/core`
3. `npm run test:api -- apps/api/src/core-kanban-cutover.boundary.spec.ts`
4. `npm run test:api`
5. `npm run build:api`
6. `npm run test:kanban`
7. `npm run build:kanban`
8. `npm run test:integration:kanban-core`
9. `npm run typecheck --workspace=packages/e2e-tests`
10. `npm run test:e2e:split-service:kanban-core` when split-service environment variables and services are available

---

## 11. Risks

1. Risk: some `projectId` fields are genuinely generic user-facing scope concepts and renaming them could cause churn.
2. Mitigation: classify before changing and keep only documented generic scope fields with explicit rationale.
3. Risk: deleting legacy kanban tool schemas breaks seeded workflows that still reference old core actions.
4. Mitigation: audit seeds and workflow YAML first, then use `LegacyKanban*` quarantine only for live migration bridges.
5. Risk: moving legacy trigger readers to `context` breaks historical workflow runs.
6. Mitigation: support historical reads only in a narrow migration helper with tests and an expiry condition, not throughout core business logic.
7. Risk: boundary tests become noisy if they only grep strings.
8. Mitigation: combine static grep checks with exact allowlists and source-level inventory so allowed references are intentional.
