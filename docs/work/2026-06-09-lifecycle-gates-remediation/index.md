# Lifecycle Gates — Gap Analysis & Remediation Plan

**Date**: 2026-06-09  
**Status**: Draft  
**References**: [`2026-06-08-lifecycle-gates-kanban-integration-plan.md`](../../plans/2026-06-08-lifecycle-gates-kanban-integration-plan.md)

---

## Summary

The lifecycle gates implementation is structurally correct — the backend `runTransitionGate` / `transitionStatus` chokepoint and the frontend gate badge / error handling were all implemented. However three separate gaps prevent the feature from working end-to-end in the running application.

---

## Issue 1: Gate badges never appear on Kanban board cards

### Symptoms
`KanbanWorkItemGateBadge` is wired into the card rendering pipeline correctly, but no badge ever appears on any card.

### Root Causes

**RC1a — Phase mismatch (blocking)**  
The seed workflow `seed/cicd/pre-merge-ci.workflow.yaml` declares `trigger.phase: "merge"`. The transition gate system calls `executeLifecycleWorkflows` with `phase: targetStatus` — a Kanban status slug like `"ready-to-merge"`. The match in `WorkflowTriggerRegistryService.resolveLifecycleBindings()` is exact (`trigger.phase !== options.phase`), so `"merge" !== "ready-to-merge"` → workflow skipped → aggregate `"skipped"` (a passing status) → no held marker → badge never shows.

**RC1b — Workflow not registered in database (blocking)**  
The file lives in `seed/cicd/`, which is NOT in `WorkflowSeedService`'s candidate paths (it looks for `seed/workflows/`). For a repository workflow to run it must be discovered via "Refresh Discovery" (UI) or `api.refreshRepositoryWorkflows`. Without discovery, `findActiveBySourceScope('repository', project_id)` returns `[]` → lifecycle execution always returns `{ status: 'skipped', results: [] }` → gate silently bypassed.

**RC1c — Project settings not enabled (blocking)**  
`runTransitionGate` checks `project.repository_workflow_settings.enabled !== true` and returns `{ aggregateStatus: "disabled", blocked: false, failures: [] }` immediately if not enabled. The project must be explicitly opted in.

**RC1d — Missing phase migration (design gap)**  
The design document (§9.2) states: *"Re-point pre-merge: repositories using `phase: "merge"` are interpreted as `before ready-to-merge`."* This alias mapping was NOT implemented. Trigger registry still does exact matching.

### Implementation Gap vs Plan
Tasks 1–5 are correctly implemented. The gap is the phase migration (design §9.2) and the prerequisite that workflows must be named/placed to be discoverable.

---

## Issue 2: Recent Runs card shows ALL workflow runs (unfiltered)

### Symptoms
The "Recent Runs" card on the Repository Workflows tab shows the most recent workflow runs across all projects and all source types — not just repository lifecycle runs for the current project.

### Root Cause

**RC2 — `ValidationPipe({ whitelist: true })` strips undecorated DTO fields**  
`apps/api/src/main.ts` registers `new ValidationPipe({ whitelist: true })` globally. With `whitelist: true`, NestJS strips any DTO property that lacks a class-validator decorator (`@IsOptional()`, `@IsString()`, etc.).

`WorkflowRunsQueryDto` declares `scopeId`, `contextId`, `status`, and `sourceType` as TypeScript properties with NO class-validator decorators. These are stripped before the controller receives them:

- `query.scopeId` → `undefined` → no project filter → all projects' runs  
- `query.sourceType` → `undefined` → no source-type filter → all source types' runs  

The global `ZodValidationPipe` (registered second) cannot restore stripped values; it receives the already-stripped object, parses it as `{}` (all fields optional → valid), and returns `{}`.

---

## Issue 3: Workflow appears in "Other" grouping, not "Ready to Merge"

### Symptoms
The pre-merge-ci workflow appears under "Other" instead of the "Ready to Merge" column section.

### Root Causes

**RC3a — Filename convention mismatch**  
`parseTriggerFromFilename()` expects `<phase>.(before|after).workflow.yaml` (e.g. `ready-to-merge.before.workflow.yaml`). The file is named `pre-merge-ci.workflow.yaml` → no match → falls through to "Other".

**RC3b — Grouping reads filenames, not trigger metadata**  
`workflowFilesClient.list()` returns only file paths. The grouping cannot read the YAML `trigger.phase` from the database-registered workflow definition. Any descriptively-named file fails to group correctly regardless of its YAML content.

---

## Remediation Plan

### Fix 1 — `WorkflowRunsQueryDto`: add class-validator decorators (HIGH)

**File**: `apps/api/src/workflow/workflow.controller.dto.ts`

Add `@IsOptional() @IsString()` to `scopeId`, `contextId`, `status`, `sourceType` in `WorkflowRunsQueryDto`. Also audit `PaginationQueryDto` (`workflowId`, `search`, `sortBy`, `sortDir`) and `WorkflowEventsQueryDto`.

Import: `import { IsOptional, IsString } from 'class-validator';`

**Tests to add**: Integration test asserting that `GET /workflows/runs?sourceType=repository&scopeId=<id>` applies both filters.

**Impact**: Fixes Recent Runs filtering. Also unblocks any other filter silently broken by the same issue.

---

### Fix 2 — Rename + relocate seed workflow (HIGH)

**Delete**: `seed/cicd/pre-merge-ci.workflow.yaml`  
**Create**: `seed/workflows/ready-to-merge.before.workflow.yaml`

Change the trigger block:
```yaml
trigger:
  type: lifecycle
  phase: ready-to-merge   # was: merge
  hook: before
  blocking: true
```

This makes the workflow:
- Discoverable by the seeder (now in `seed/workflows/`)
- Grouped correctly in the UI (filename matches `<phase>.(before|after).workflow.yaml`)
- Triggered on the correct transition (phase matches `"ready-to-merge"` slug)

> **Note**: `seed/workflows/` seeds GLOBAL workflows (source_type = `seed`), not per-project repository workflows. For repository workflows, teams place YAML files in their project's `.nexus/workflows/` directory and click "Refresh Discovery". Consider whether this seed file should remain as a global example or be documented as a per-project template.

---

### Fix 3 — Implement `phase: "merge"` → `"ready-to-merge"` alias (MEDIUM)

**File**: `apps/api/src/workflow/workflow-lifecycle-execution.service.ts`

Per design §9.2, legacy `phase: "merge"` bindings should match the `ready-to-merge` transition. Add a phase alias resolution before fetching bindings:

```ts
private resolvePhaseAliases(phase: string): string[] {
  if (phase === 'ready-to-merge') return ['ready-to-merge', 'merge'];
  return [phase];
}
```

Then pass both phases to the binding filter, OR run `resolveLifecycleBindings` for each alias and merge results.

**Alternative**: add the alias map in `WorkflowTriggerRegistryService.resolveLifecycleBindings()`.

**Tests to add**: Unit test asserting a workflow with `phase: "merge"` is matched when `phase: "ready-to-merge"` is requested.

---

### Fix 4 — Enrich file listing with trigger metadata from registered workflow (LOW)

**Files**: `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.tsx` and the workflow files API

When listing workflow files, join/cross-reference with the registered workflow entity to include trigger metadata (phase, hook, blocking). The UI can then group by `trigger.phase` rather than by filename pattern.

**Simpler short-term alternative**: Enforce the naming convention in the "Create Workflow" dialog via a helper that auto-generates the filename from the phase/hook selections.

---

### Fix 5 — Document prerequisites in guide (LOW)

**File**: `docs/guide/38-repository-workflows.md`

Add a clear prerequisites section:
1. Project must have `repository_workflow_settings.enabled = true`
2. Repository workflows live in `.nexus/workflows/` within the project's git repo
3. After adding/modifying workflow files, click "Refresh Discovery" to register them
4. Follow the `<phase>.(before|after).workflow.yaml` naming convention for correct UI grouping

---

## Priority Order

| # | Fix | Priority | Effort |
|---|-----|----------|--------|
| 1 | Add class-validator decorators to `WorkflowRunsQueryDto` | HIGH | Small |
| 2 | Rename/move/update seed workflow | HIGH | Small |
| 3 | Add `phase: "merge"` alias mapping | MEDIUM | Small |
| 4 | Enrich file listing with trigger metadata | LOW | Medium |
| 5 | Update guide docs | LOW | Small |

Fixes 1 + 2 + enabling `repository_workflow_settings` on the project should be sufficient to get the full lifecycle gate experience working.
