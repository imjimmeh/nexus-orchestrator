# EPIC-062: Persisted Workflow Events Global and Project Views

> Status: In Progress
> Priority: High
> Estimate: 3-5 days
> Created: 2026-04-06
> Last Updated: 2026-04-06
> Owner: TBD

---

## 1. Epic Summary

Add a first-class Events experience that shows persisted workflow step events in reverse chronological order (newest to oldest), with pagination, in two places:

1. Global Events page reachable from the app sidebar.
2. Project-scoped Events tab inside the project workspace.

This epic closes the gap where some event history is only available via transient telemetry stream reads and not exposed as a persisted, queryable activity feed.

## 2. Problem Statement

Current workflow run detail reads run telemetry from Redis stream history for a single run. This is useful for live execution, but not sufficient for:

1. Cross-run global activity review.
2. Project-wide event timelines.
3. Stable historical browsing with pagination.

The platform already writes workflow events to the database table workflow_events, but there is no dedicated global/project events API and no corresponding web views.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Expose persisted workflow events via paginated API.
2. Support project filtering in the same API.
3. Add global Events page in web app and sidebar navigation.
4. Add project Events tab in Project Workspace tabs.
5. Keep event ordering newest to oldest.
6. Add focused tests for API and web client behavior.

### 3.2 Non-Goals

1. Replacing run-detail live telemetry transport.
2. Reworking event schema or introducing event taxonomy changes.
3. Building advanced filtering/search in v1 beyond project and pagination.

## 4. Functional Requirements

1. API endpoint returns persisted workflow events from workflow_events.
2. API supports query params:
   - limit
   - offset
   - projectId (optional)
3. API returns pagination metadata:
   - total
   - limit
   - offset
4. Global page displays all events newest to oldest with Previous/Next pagination controls.
5. Project tab displays only project events newest to oldest with the same pagination behavior.
6. Existing run telemetry endpoint behavior remains unchanged.

## 5. Technical Design

### 5.1 API

1. Add GET /api/workflows/events in workflow controller.
2. Reuse workflow event log service with new paged query method.
3. Extend workflow event repository to support paged queries and project filtering.
4. Project filtering implemented through workflow_runs trigger.projectId context.

### 5.2 Web

1. Add api client method getWorkflowEvents(query).
2. Add workflow event types and response shape to web API types.
3. Add query key factory for paginated workflow events.
4. Introduce reusable WorkflowEventsFeed component.
5. Add pages/events/Events.tsx for global view.
6. Add project-workspace EventsTab and wire into ProjectWorkspace tabs.
7. Add sidebar link to /events.

## 6. Work Breakdown

### 6.1 Backend

1. Repository query extension for paged workflow event retrieval.
2. Service method for paged events with optional project filter.
3. Controller endpoint for workflows/events.
4. Unit test updates:
   - workflow.controller.spec.ts
   - workflow-event-log.service.spec.ts

### 6.2 Frontend

1. API type additions and API client method.
2. Query key additions.
3. Reusable feed UI with pagination and empty/loading/error states.
4. New global events page and route registration.
5. Sidebar navigation update.
6. Project workspace tab registration and rendering.
7. Client method tests in client.spec.ts.

## 7. Acceptance Criteria

1. Navigating to /events shows persisted events ordered newest to oldest.
2. Sidebar contains Events entry and active route highlighting works.
3. Project workspace has Events tab and shows project-filtered events only.
4. Pagination works in both views.
5. API response includes correct pagination metadata.
6. Existing run telemetry endpoints continue to function.

## 8. Risks and Mitigations

1. Risk: Large event tables could make paged queries slow.
   - Mitigation: Use index-friendly ordering and filtered joins only when projectId is supplied.
2. Risk: Confusion between persisted events and live stream telemetry.
   - Mitigation: Keep endpoint naming and UI descriptions explicit about persisted history.
3. Risk: Route collisions in workflow controller.
   - Mitigation: Place workflows/events route before parameterized workflows/:id route.

## 9. Test Plan

1. Backend unit tests for controller and service pagination/filter behavior.
2. Web API client unit tests for workflows/events request and response mapping.
3. Manual smoke checks:
   - /events loads and paginates.
   - /projects/:projectId?tab=events loads and paginates.
   - Existing /workflows/:id/runs/:runId still loads run telemetry.
