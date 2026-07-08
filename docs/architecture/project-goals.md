# Project Goals Architecture

## Scope

This document describes the first-class project goals domain introduced in EPIC-059.

## Domain Model

Primary entities:

1. project_goals

- Goal metadata, prioritization, lifecycle status, archive state.

2. project_goal_worklogs

- Audit timeline entries for notes, status changes, and work-item linkage.

## Goal Lifecycle

Supported statuses:

- todo
- in_progress
- blocked
- completed
- cancelled

Additional metadata:

- moscow (must, should, could, wont)
- priority (p0, p1, p2, p3)
- target_date
- owner_agent_profile_id

## API Surface

Goal endpoints:

- GET /projects/:projectId/goals
- POST /projects/:projectId/goals
- PATCH /projects/:projectId/goals/:goalId
- PATCH /projects/:projectId/goals/:goalId/status
- PATCH /projects/:projectId/goals/reorder
- POST /projects/:projectId/goals/:goalId/archive
- POST /projects/:projectId/goals/:goalId/unarchive

Worklog endpoints:

- GET /projects/:projectId/goals/:goalId/worklogs
- POST /projects/:projectId/goals/:goalId/worklogs
- POST /projects/:projectId/goals/:goalId/worklogs/link-work-item

Project creation integration:

- POST /projects accepts optional goals[] payload for initial goals.

## UI Integration

Primary workspace route:

- /projects/:projectId/workspace?tab=goals

Capabilities:

1. Goal CRUD and status changes.
2. Archive/unarchive and reorder.
3. Worklog timeline management.
4. Work-item linkage to goals.

## Orchestration Integration

Goals are project-managed records and can be summarized into orchestration context.

Expected behavior:

1. Goals can be updated independently of orchestration start/restart actions.
2. Restart workflows should consume current goal summary from persisted state rather than start-dialog text.

## Related Docs

- docs/architecture/rest-api.md
- docs/architecture/database-schema.md
- docs/epics/EPIC-059-project-goals-first-class-management.md
