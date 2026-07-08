# Work Item Markdown Canonical Contract

This document defines the canonical markdown schema for work item definitions reconciled into the `work_items` DB projection.

## Ownership Boundary

- Markdown is canonical for definition fields:
  - `item_id`
  - `title`
  - `priority`
  - `scope`
  - `depends_on_item_ids`
  - markdown body (description/spec content)
- Database is canonical for runtime lifecycle fields:
  - `status`
  - `current_execution_id`
  - assignment and runtime metadata
  - telemetry counters

## File Location

- Canonical files live under `docs/work-items/`.
- One markdown file defines one work item.

## Required Frontmatter

```yaml
---
item_id: TASK-001
title: Implement authentication flow
priority: p1
scope: standard
depends_on_item_ids:
  - TASK-000
---
```

Required fields:

- `item_id`: stable immutable canonical identity
- `title`: display title for the work item
- `priority`: one of `p0`, `p1`, `p2`, `p3`
- `scope`: one of `standard`, `large` (optional; inferred when missing)
- `depends_on_item_ids`: optional dependency list by canonical identity

The markdown body becomes the projected work item description.

## Reconcile Behavior

`kanban.publish_specs` performs deterministic reconcile through the Kanban-owned publishing path. The legacy API hydrate special step has been removed from the active runtime surface.

- Creates missing DB rows for canonical files.
- Updates projected definition fields when canonical content changes.
- Archives canonical rows whose source files were removed (with runtime-state safety gating).
- Skips writes when canonical hash and projected fields are unchanged.

## Projection Metadata

The DB projection stores source-tracking metadata:

- `source_id`
- `source_path`
- `source_hash`
- `source_last_synced_at`

These fields support idempotent reconcile and explainable create/update/archive decisions.

## Persistence Guarantee & Consumer Resilience

The markdown file is a **projection of DB state**, not an independent source of
truth for its content: the body is stored in `work_items.description` and the
frontmatter is decomposed into typed columns / `metadata`. `metadata.workItemMarkdownPath`
records the file's repo-relative path but is **advisory** — it does not guarantee
the file exists in any given worktree.

- **`publish_specs` items** are hydrated from an already-authored file. Kanban does
  not re-write or commit that file while it exists (the authored file is the source
  of truth). If the referenced file was never committed to the project's base branch
  (e.g. it was authored in an ephemeral worktree and lost), the reference would
  otherwise dangle and every worktree provisioned from the base branch would lack it.
  To prevent this, `writeWorkItemSpecFile` (`apps/kanban/src/work-item/work-item.service.helpers.ts`)
  **materializes a regenerated copy from the DB record at the recorded path and commits
  it** when the authored file is absent, so the reference always resolves for future
  runs. A committed authored file is never clobbered; the recorded relative path is
  preserved.
- **Workflow consumers must tolerate a missing file.** A step that reads the spec must
  treat an absent/unreadable `workItemMarkdownPath` as "no spec available" and fall back
  to the DB-backed trigger context (title, description, `executionConfig.rejectionFeedback`,
  `metadata.qaFeedback`) rather than retrying or stalling. Missing markdown is never a
  workflow failure. See the `implement` and `check_escalation` steps in
  `seed/workflows/work-item-in-progress-default.workflow.yaml` for the canonical pattern.
- **Review history is not persisted to the DB.** Any `## Review History` appended to a
  spec file post-authoring lives only on the filesystem. The DB-resident equivalent is
  the structured rejection data (`executionConfig.rejectionFeedback.failedDeliverables`,
  `metadata.qaFeedback`); prefer it for autonomous decisions.

## Autonomous Workflow Tool Policy

Event-triggered work-item workflows run with **no interactive user**. They must not
grant interactive capabilities such as `ask_user_questions` at the workflow, job, step,
or agent-profile layer — a granted interactive tool lets an agent park the run
indefinitely waiting for an answer that never arrives. The autonomous `qa_automation`
agent profile therefore does not grant `ask_user_questions`, and a seed contract test
enforces the absence of the grant for the work-item execution workflows
(`apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts`).
