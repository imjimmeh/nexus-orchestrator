# EPIC-047 Frontend UX for Orchestrated Execution (EPIC-043 to EPIC-046)

## Status

Planned

## Parent Epics

- [EPIC-043 Flat Work Items](EPIC-043-flat-work-items-dependency-graph.md)
- [EPIC-044 Orchestrator-Led Execution](EPIC-044-orchestrator-led-execution.md)
- [EPIC-045 Adaptive Scope, Consolidated Review, Parallel Subagents](EPIC-045-adaptive-scope-parallel-subagents.md)
- [EPIC-046 Autonomous Project Orchestrator](EPIC-046-autonomous-project-orchestrator.md)

## Why This Epic Exists

Backend capabilities from EPIC-043 through EPIC-046 are now in place, but the web UI is still largely modeled around pre-043 assumptions (hierarchy-first work items, no orchestration cockpit, no plan/replan visibility, no subagent-level observability).

This epic closes the product gap: operators should be able to configure, understand, trust, and control the new orchestration system from the frontend.

## UX Review Summary

### Confirmed Backend Capabilities Needing UI

1. Flat work item model with dependency graph (`dependsOn`/`blockedBy`) and `scope` (`standard`/`large`).
2. Plan-aware execution metadata (`implementationPlan`, `rejectionFeedback`, `rejectionCount`) on execution config.
3. Parallel subagent controls and safeguards (`spawn_subagent_async`, `wait_for_subagents`, `assigned_files` overlap protection, concurrency limits).
4. Project orchestration lifecycle and controls:
   - Statuses: `idle`, `initializing`, `awaiting_approval`, `bootstrapping`, `orchestrating`, `paused`, `completed`, `failed`
   - Modes: `autonomous`, `supervised`, `notifications_only`
   - Actions: start, approve, reject(with feedback), pause, resume, complete
   - Decision log and strategy summary
   - Project state summary grouped by status

### Current Frontend Gaps

1. Work item UI still assumes hierarchy concepts (`type`, `parentId`) and epic grouping.
2. No orchestration API client methods, hooks, routes, or components.
3. No user-facing approval gate for specs in `awaiting_approval` orchestration state.
4. No UI for implementation plans, delta replans, or structured QA rejection details.
5. No visibility into parallel subagent progress, file ownership, or overlap failures.
6. System settings UI is generic raw JSON editing; high-impact orchestration settings are not task-oriented.
7. Live run views are event-rich but not role-oriented (planner/subagent/orchestrator phases are not surfaced clearly).

## Goals

1. Align project and kanban UX with flat dependency-graph work items.
2. Add full orchestration control surface for EPIC-046 flows.
3. Make planning and review loops observable (plan, delta plan, rejection details).
4. Expose subagent execution health and parallelism signals.
5. Provide proactive feedback and notifications for critical orchestration moments.
6. Improve configuration ergonomics for orchestration-related system settings.

## Non-Goals

1. Changing backend orchestration logic or workflow YAML behavior.
2. Replacing existing telemetry/event transport.
3. Designing multi-project orchestration portfolio views (future epic).

## UX/UI Requirements

### 1) Configuration UX

1. Add typed orchestration settings panel in Settings:
   - `max_concurrent_subagents_per_workflow`
   - `work_item_dispatch_max_active_per_project`
2. Add project-level orchestration setup modal:
   - Goals text area
   - Mode selector (`supervised` default)
   - Start confirmation
3. Add validation and helper text for risky values (for example, warn when subagent concurrency > 3).

### 2) Usage UX (Primary Flows)

1. Project workspace gets a new Orchestration tab with:
   - Current status + mode
   - Primary actions (start, approve, reject, pause, resume, complete)
   - Decision log timeline
   - Strategy summary panel
2. Specs tab gets approval gate UI:
   - When status is `awaiting_approval`, show sticky approval card
   - `Approve` and `Request Revision` (feedback required)
3. Kanban create/edit UX is updated for flat model:
   - Remove `type` and `parent` inputs
   - Add `scope` selector and dependency picker
   - Keep dependency editing first-class in detail view

### 3) User Visibility UX

1. Work item cards and detail sheet show:
   - Scope badge (`standard`/`large`)
   - Dependency readiness summary (`dependsOn`, `blockedBy`)
   - Plan state (`not planned`, `planned`, `delta replan required`)
2. Active session/run detail views show phase markers:
   - Planning
   - Delegation
   - Implementation
   - Review handoff
3. Subagent observability panel (per work item/run):
   - Execution ID, status, assigned files, start/end time
   - Overlap rejection reasons when present
   - Wait/complete aggregation result summary

### 4) Feedback UX

1. Structured QA rejection display in work item detail:
   - Failed deliverables table
   - Failure type tags
   - Affected files
   - Most recent reviewer feedback + rejection count
2. Delta replan explanation banner before re-run:
   - "Only failed deliverables will be re-planned and re-implemented."
3. Action-level toast feedback for orchestration actions and status mutations.

### 5) Notifications UX

1. In-app notifications for orchestration milestones:
   - Specs ready for approval
   - Specs approved/rejected
   - Orchestration paused/resumed/completed/failed
   - Work item blocked by repeated QA rejection
2. Activity feed section in Orchestration tab with filter chips:
   - Lifecycle
   - Review
   - Subagent
   - Dispatch

## Implementation Plan

### Phase 1: Contract and State Alignment

1. Update frontend API types to match backend work item and orchestration contracts.
2. Add API client methods for `/projects/:projectId/orchestration` endpoints.
3. Add React Query hooks for orchestration get/start/update mode/approve/reject/pause/resume/complete.

### Phase 2: Flat Work Item UX Migration

1. Replace hierarchy-driven inputs/views in kanban create/edit/detail with scope + dependencies.
2. Replace epic grouping mode with dependency-centric views:
   - Ready
   - Blocked
   - In-flight
3. Add dependency badges and scope badges across board and global work items page.

### Phase 3: Orchestration Cockpit

1. Add Orchestration tab in project workspace with status hero, mode selector, action bar.
2. Add decision log timeline and strategy summary cards.
3. Add Specs approval gate controls and revision feedback modal.

### Phase 4: Planning, Review, and Subagent Visibility

1. Add plan/replan panels for large-scope execution.
2. Render structured QA rejection details and remediation checklist.
3. Add subagent execution list and overlap error surfacing from telemetry/event payloads.

### Phase 5: Notifications and Polish

1. Add in-app notification center integration for orchestration events.
2. Add role-focused run timeline labels (planner/orchestrator/subagent/reviewer).
3. Add empty/loading/error states for all new orchestration surfaces.

## File Plan

### Files to Modify (expected)

- `apps/web/src/lib/api/types.ts`
- `apps/web/src/lib/api/client.ts`
- `apps/web/src/hooks/useProjects.ts`
- `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`
- `apps/web/src/pages/project-workspace/SpecsTab.tsx`
- `apps/web/src/pages/kanban/KanbanBoard.tsx`
- `apps/web/src/pages/kanban/InlineCreateWorkItem.tsx`
- `apps/web/src/pages/kanban/WorkItemDetailSections.tsx`
- `apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx`
- `apps/web/src/pages/Settings.tsx`
- `apps/web/src/pages/workflows/WorkflowRunDetail.tsx`
- `apps/web/src/pages/active-session/ActiveSessionWorkspace.tsx`

### Files to Create (expected)

- `apps/web/src/hooks/useProjectOrchestration.ts`
- `apps/web/src/pages/project-workspace/OrchestrationTab.tsx`
- `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`
- `apps/web/src/components/orchestration/OrchestrationDecisionTimeline.tsx`
- `apps/web/src/components/orchestration/SpecsApprovalActions.tsx`
- `apps/web/src/components/orchestration/SubagentExecutionPanel.tsx`
- `apps/web/src/components/orchestration/PlanReviewPanel.tsx`
- `apps/web/src/components/notifications/OrchestrationNotificationFeed.tsx`

## Acceptance Criteria

1. Users can run the full EPIC-046 supervised lifecycle from UI only (start -> approval gate -> pause/resume -> complete).
2. Kanban no longer depends on hierarchy-only fields (`type`, `parentId`) for core rendering or creation.
3. Work item details expose scope, dependencies, and plan/rejection metadata when available.
4. Subagent parallel execution is visible with actionable status/error context.
5. Critical orchestration lifecycle events generate user-visible notifications.
6. Settings UI exposes typed controls for orchestration-related system settings.
7. Web tests updated for new flows and pass.

## Risks and Mitigations

| Risk                                                  | Impact                        | Mitigation                                                              |
| ----------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| API/frontend contract drift during rollout            | Broken orchestration controls | Add strict TS interfaces and contract tests for orchestration endpoints |
| Too much raw telemetry exposed to users               | Cognitive overload            | Provide concise summaries first, expandable raw payload second          |
| Migration from hierarchy UX causes operator confusion | Slower adoption               | Provide migration helper copy and dependency-first onboarding hints     |
| Notification fatigue                                  | Important events ignored      | Add severity levels and per-category mute controls                      |

## Definition of Done

1. EPIC-043 to EPIC-046 backend capabilities are represented in web UX with no hidden critical path actions.
2. Project operators can understand why items are blocked, what the orchestrator decided, and what action is needed next.
3. Large-scope planning/review loops are visible and auditable from UI.
4. QA rejection and delta replan cycle is inspectable without log diving.
5. All added frontend tests pass and documentation is updated.
