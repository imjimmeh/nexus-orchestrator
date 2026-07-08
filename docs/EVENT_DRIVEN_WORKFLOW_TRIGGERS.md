# Event-Driven Workflow Triggers (Legacy)

This document is retained for historical context only.

The implementation it described (hardcoded listener + env-driven workflow ID wiring) has been removed.

## Use This Instead

- Canonical guide: `docs/WORKFLOW_EVENT_TRIGGERS.md`
- Implementation summary: `docs/WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md`

## What Changed

- Workflow event bindings are now declared in workflow YAML (`trigger.type: event`, `trigger.name`).
- Event listeners are auto-registered by `WorkflowEventTriggerService` at API startup.
- `INCEPTION_EXTRACTION_WORKFLOW_ID` is no longer used.
- The legacy `InceptionWorkflowTriggerListener` class is no longer part of the codebase.

## Current API Route Prefix

Examples in older docs may reference `/v1/*` routes. Current routes are served under `/api/*`.

- Create workflow: `POST /api/workflows`
- Execute workflow: `POST /api/workflows/:id/execute`
- List workflows: `GET /api/workflows`

## Status

Deprecated and superseded.
