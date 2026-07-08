# Workflow Graph Read-Model Architecture

## Scope

This document describes the graph projection model introduced by EPIC-060.

## Goals

1. Provide canonical workflow DAG snapshots for run and definition views.
2. Normalize node runtime statuses server-side.
3. Avoid per-client reconstruction from raw telemetry/event streams.

## API Endpoints

Run graph projection:

- GET /workflows/runs/:runId/graph

Static workflow graph projection:

- GET /workflows/:id/graph

## Projection Shape

Core fields include:

- workflowId
- workflowRunId
- runStatus
- nodes[]
- edges[]
- activeNodeIds[]
- queuedNodeIds[]
- completedNodeIds[]
- failedNodeIds[]
- cursor (latestEventAt, totalEvents)

Node attributes:

- id
- label
- kind (job or step)
- status
- metadata

## Runtime Status Normalization

Node statuses are normalized into a bounded runtime set:

- idle
- queued
- running
- blocked
- waiting_input
- succeeded
- failed
- cancelled
- skipped

## Data Sources

1. Workflow definition topology.
2. Workflow run state.
3. Workflow event history and runtime context markers.

## Client Usage

Web UI consumes graph projections for:

1. Workflow run detail graph visualization.
2. Workflow definition graph views.
3. Shared status-badge mapping across workflow and kanban-linked surfaces.

## Operational Notes

1. Prefer graph endpoints over client-side heuristic reconstruction.
2. Keep status mapping shared and centralized to avoid cross-surface drift.
3. Use cursor metadata for efficient incremental refresh strategies.

## Related Docs

- docs/architecture/workflow-engine.md
- docs/architecture/rest-api.md
- docs/epics/EPIC-060-workflow-graph-status-unification.md
