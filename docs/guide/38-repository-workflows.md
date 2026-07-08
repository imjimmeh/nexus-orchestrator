# 38 — Repository-Managed Workflows

Repository-managed workflows let project repositories define their own CI/CD gates as standard Nexus workflow YAML files under `.nexus/workflows/`. These workflows are discovered automatically when a project repository is cloned, participate in lifecycle hooks (e.g., blocking merge prechecks), and execute with the full Nexus workflow engine — containerized, observable, and policy-governed.

---

## Why Repository Workflows

Before repository workflows, all workflow definitions lived in `seed/workflows/` — a single global catalog shared by every project. This meant:

- Every project ran the same quality gates, regardless of its technology stack.
- Adding project-specific checks required either modifying seed data or building external CI (GitHub Actions, GitLab CI).
- Merge gates could not vary per repository without custom Kanban wiring.

Repository workflows invert this: the repository owns its gates. Teams version their checks alongside their code, review them in PRs, and change them without touching the Nexus seed catalog.

---

## Where Repository Workflows Live

```
<repository-root>/.nexus/workflows/
├── pre-merge-quality.workflow.yaml
├── security-scan.workflow.yaml
└── feature-branch-smoke.workflow.yaml
```

- Files must match `*.workflow.yaml` (immediate children only, no recursive scanning).
- Each file is a standard Nexus workflow definition — same schema, same job types, same capabilities.
- Discovery happens automatically when a managed project clone completes or when the refresh endpoint is called.

---

## Lifecycle Triggers

Repository workflows can use any standard trigger type (`event`, `webhook`, `manual`) plus a new **lifecycle** trigger for app-owned phases:

```yaml
trigger:
  type: lifecycle
  phase: ready-to-merge # Target Kanban column slug (e.g. refinement, in-progress, ready-to-merge)
  hook: before # "before" (blocking guard) or "after" (non-blocking reaction)
  blocking: true # When true, phase transition waits for result
```

### Lifecycle Phase Reference

`phase` is the **target Kanban column slug** — the column the card is moving _into_. The engine treats this string as opaque; Kanban owns the mapping from column slug to phase name.

| Phase            | Hook     | Blocking | Behavior                                                         |
| ---------------- | -------- | -------- | ---------------------------------------------------------------- |
| `ready-to-merge` | `before` | `true`   | Blocking guard — holds the card in its current column on failure |
| `ready-to-merge` | `after`  | `false`  | Non-blocking reaction fires after the transition commits         |
| `in-review`      | `before` | `true`   | Blocking guard — holds the card in its current column on failure |
| `in-review`      | `after`  | `false`  | Non-blocking reaction fires after the transition commits         |
| `done`           | `before` | `true`   | Blocking guard — holds the card in its current column on failure |
| `done`           | `after`  | `false`  | Non-blocking reaction fires after the transition commits         |

Any column slug recognised by the Kanban board is a valid `phase` value. Additional phases require no API/core changes — the phase string is opaque to the engine.

> **Migration note — `phase: merge`**: Pre-merge checks previously used `phase: merge`. The equivalent binding is now `phase: ready-to-merge, hook: before`. Existing workflows using the old `merge` phase should be updated to the column-slug form.

**`before` hooks** act as blocking guards: the card is held in its current column while the workflow runs. If the run fails, the transition is rejected and the card stays put.

**`after` hooks** are non-blocking reactions: they fire once the transition has committed and cannot veto it. An `after` workflow may call Kanban MCP tools or `invoke_workflow` to re-dispatch work, send notifications, or trigger downstream automation.

---

## Pre-Merge Blocking Flow

When a Kanban work item is merged:

1. Kanban fetches the project's `repository_workflow_settings` from the database and resolves it through `resolveRepositoryWorkflowSettings` (`@nexus/kanban-contracts`). An absent or malformed value resolves to **enabled by default** — the same resolver used by the settings read path, so the gate and UI can never disagree on what an absent value means.
2. If repository workflows are explicitly **disabled** (`enabled: false`) for the project, the merge proceeds immediately.
3. If enabled, Kanban calls `POST /workflows/lifecycle/execute` with:
   - `phase: "ready-to-merge"`, `hook: "before"`, `blockingOnly: true`
   - `scopeId` (project), `contextId` (work item), and repository ref
4. The API resolves all active repository-scoped workflows matching the lifecycle binding.
5. Each matching workflow is launched in a container and polled to completion.
6. Results are aggregated and persisted to `workflow_lifecycle_results`.
7. If the aggregate status is `failed`, `timed_out`, or `unavailable`:
   - Merge is **blocked** with a `ConflictException`.
   - Kanban surfaces the failure in the merge gate UX.
8. If the aggregate status is `passed` or `skipped`:
   - Merge proceeds normally.

---

## Failure Semantics

| Status        | Blocks Merge? | Meaning                                          |
| ------------- | :-----------: | ------------------------------------------------ |
| `passed`      |      No       | All workflow runs completed successfully         |
| `skipped`     |      No       | All bindings had false conditions or no bindings |
| `failed`      |    **Yes**    | At least one workflow run FAILED or CANCELLED    |
| `timed_out`   |    **Yes**    | Polling exceeded the timeout before completion   |
| `unavailable` |    **Yes**    | Workflow could not start or run lookup failed    |

The aggregate status uses worst-status-wins precedence: `timed_out` > `unavailable` > `failed` > `passed` > `skipped`.

---

## Project Configuration

Repository workflow settings are per-project, stored in the Kanban database as JSONB, and editable via:

- **Web UI**: Project workspace → Repository Workflows tab → Lifecycle Gates card
- **API**: `GET/PATCH /projects/:id/repository-workflows/settings`

```json
{
  "enabled": true,
  "overrides": {
    "pre_merge_quality": { "enabled": true },
    "expensive_e2e": { "enabled": false }
  }
}
```

| Field       | Type    | Default | Description                                       |
| ----------- | ------- | ------- | ------------------------------------------------- |
| `enabled`   | boolean | `true`  | Global toggle for all repo workflows              |
| `overrides` | object  | `{}`    | Per-workflow `enabled` overrides by `workflow_id` |

Settings are operational controls (Nexus data/UI), not repository files. They let project admins disable expensive or irrelevant checks without modifying the repository.

---

## API Endpoints

| Method | Path                            | Description                                        |
| ------ | ------------------------------- | -------------------------------------------------- |
| POST   | `/workflows/lifecycle/execute`  | Execute lifecycle workflows for a scope/phase/hook |
| POST   | `/workflows/repository/refresh` | Trigger discovery from a cloned repository path    |

---

## Discovery Refresh

The repository refresh endpoint accepts:

```json
{
  "scopeId": "<project-uuid>",
  "rootPath": "/workspace/clones/<project-uuid>",
  "sourceRef": "main"
}
```

It scans `.nexus/workflows/*.workflow.yaml`, validates each definition, upserts active repository-scoped workflow rows, and deactivates workflows no longer present on disk. This is called automatically after managed clones complete.

---

## Architecture

```
Repository (git)
  └── .nexus/workflows/*.workflow.yaml
         │
         ▼ (clone / push)
Kanban (managed-project-clone)
  └── POST /workflows/repository/refresh
         │
         ▼
API (RepositoryWorkflowDiscoveryService)
  └── upserts Workflow rows with source_type='repository' + scope_id
         │
         ▼ (merge attempt)
Kanban (WorkItemService.requestMerge)
  └── POST /workflows/lifecycle/execute
         │
         ▼
API (WorkflowLifecycleExecutionService)
  ├── resolves lifecycle bindings
  ├── starts workflow runs in containers
  ├── polls run statuses
  └── persists result to workflow_lifecycle_results
         │
         ▼
Kanban receives aggregate status
  ├── passed/skipped → proceed with merge
  └── failed/timed_out/unavailable → block with ConflictException
```

---

## Permissions

v1 repository workflows may use **all** existing Nexus workflow job types and tools, including `run_command`, `execution`, `invoke_workflow`, `git_operation`, and Kanban MCP tools. Future releases may add tool governance restrictions for repository-sourced workflows.

---

## Boundary Constraints

Repository workflows reside at the API/core↔Kanban boundary. The design constraints:

- **API/core** uses only neutral fields: `scopeId`/`scope_id`, `contextId`/`context_id`, `phase`, `hook`. It never references Kanban status names, work items, or project identifiers.
- **Kanban** owns lifecycle semantics: it maps its statuses to phase names, builds lifecycle requests, and interprets aggregate results.
- **Workflow YAML** under `.nexus/workflows/` may reference Kanban tool names — these are repository-owned workflow surfaces, not API/core code.

---

## Related Documents

- [06 — Workflow Engine](06-workflow-engine.md) — triggers, DAG, state machine
- [22 — Kanban Lifecycle](22-kanban-lifecycle.md) — status transitions, automation
- [24 — Kanban Core Integration](24-kanban-core-integration.md) — client, lifecycle stream
- [Design doc](../plans/2026-06-02-repository-managed-workflows-design.md) — full design decisions
