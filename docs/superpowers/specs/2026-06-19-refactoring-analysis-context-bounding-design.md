# Design: Bound `codebase_refactoring_analysis` Context for Large Monorepos

- **Date:** 2026-06-19
- **Status:** Approved (pending spec review)
- **Workflow:** `seed/workflows/codebase_refactoring_analysis.workflow.yaml`

## Problem

The nightly `codebase_refactoring_analysis` workflow overflows agent context windows on
large monorepos. There are two unbounded funnels:

1. **Coordinator funnel** (`scan_codebase`): the Investigation Coordinator collects every
   subagent's complete findings list into its own context via `wait_for_subagents`, then
   synthesizes a single `refactoring_findings` array. With many modules this array is huge.
2. **Architect funnel** (`dedup_and_create`): the entire `refactoring_findings` array is
   injected verbatim into the architect prompt via
   `{{json jobs.scan_codebase.output.refactoring_findings}}`, re-loading the whole payload.

Both grow without bound as module count and findings-per-module grow. There is also no
cross-run rotation: every run re-analyzes the same high-priority modules, so deeper modules
are never reached and the same findings churn.

## Goals

- **Bound per-subagent output** to the top-N highest-severity findings (default 3).
- **Hard-cap total tickets per run** (default 20), regardless of module count.
- **Keep tickets per module** — each ticket is created by the module's own subagent and is
  scoped to that module.
- **Rotate across runs** — analyze modules not (recently) covered, moving through the repo
  over successive nightly runs instead of re-hitting the same modules.

## Approach (Hybrid + per-run coverage files)

- **Cap each subagent** to the top-N highest-severity findings, N from a scoped orchestration
  variable (default 3) — consistent with the CEO gate / ideation toggle pattern.
- **Subagents create their own tickets.** Each subagent dedups against existing work items
  (it already calls `kanban.list_work_items`) and creates new ones with
  `kanban.work_item_create`, returning only a compact summary.
- **Coordinator drives rotation and the run budget.** It reads the most recent K per-run
  coverage files, selects the stalest/never-analyzed modules, and hands each subagent
  `min(cap, remaining_run_budget)` so the run total never exceeds the run budget (default 20).
- **Coordinator aggregates counts**, not findings.
- **Finalize step** (repurposed architect) does a light cross-module dedup sweep over the
  freshly-created ticket ids/titles, then **writes one new per-run coverage file**.
  `commit_findings` commits and pushes it.

```
scan_codebase (coordinator)
  → ls docs/analysis/refactoring/ ; read the K most recent <date>-<run>.md files
  → select stalest/uncovered modules within the run budget
  ├─ subagent[auth] → top min(cap,remaining) → dedup vs existing → work_item_create → summary
  ├─ subagent[api]  → …                       (≤3 concurrent batches, as today)
  └─ … stop dispatching once run budget spent
  → coordinator sums summaries
  → output { created_items[], items_created, duplicates_skipped, scope_manifest }

cross_module_dedup (finalize, light)
  → reads jobs.scan_codebase.output.created_items (id + title + module — bounded)
  → detects cross-module duplicate titles; closes/annotates the redundant one
  → writes docs/analysis/refactoring/<date>-<run_id>.md  (this run's coverage)
  → output { merged }

commit_findings (git_operation)   — commits docs/analysis (incl. the new file), pushes
emit_analysis_complete (emit_event)
```

## Cross-run coverage: one markdown file per run

Each run writes a single small markdown file under `docs/analysis/refactoring/`:

- **Filename:** `<utc-date>-<run_id>.md`, e.g. `2026-06-19-3f9c1a20.md`.
  - `<utc-date>` is the date portion of the `{{ now }}` helper (see Changes §1) — sorts
    chronologically and is human-readable.
  - `<run_id>` is the workflow run id, already present in the finalize agent's runtime
    context. Including it makes the write **idempotent**: a step retry overwrites the same
    file rather than creating a duplicate.
- **Why per-run files (not one rewritten ledger):** no LLM rewrite/merge of a growing
  document each run (drift-free), and every file stays tiny.

File contents (small, machine-readable enough to parse on the next run):

```markdown
# Refactoring Analysis — 2026-06-19 (run 3f9c1a20)

Run budget: 20 · per-subagent cap: 3 · tickets created: 18 · duplicates skipped: 5 · merged: 1

## Modules analyzed

- apps/api/src/auth — created (2): wi-123, wi-130
- apps/web — clean (0)
- packages/core — created (3): wi-131, wi-132, wi-133
```

The `## Modules analyzed` list is the contract the coordinator parses next run: one bullet per
module, `<module_path> — <outcome> (<created count>)[: <ids>]`. `outcome` is `created` or
`clean` (analyzed, no novel findings) — so clean-but-analyzed modules are recorded and
correctly deprioritized next run.

**Rotation order (coordinator):** `ls docs/analysis/refactoring/`; take the K most recent
files (lexical sort = chronological); read them newest-first to build, per module, the most
recent run it appeared in. Then prioritize: modules absent from all K files first (never/long
ago analyzed), then by stalest appearance; within the same recency fall back to the existing
size/complexity/debt heuristics. Reading only K files bounds coordinator context regardless of
total history.

- First ever run: directory empty/missing → all modules treated as never-analyzed.
- `concurrency.max_runs: 1` per scope (`on_conflict: skip`) → single writer, no race.
- Retention: files are tiny; the coordinator only ever reads the newest K, so unbounded history
  does not affect context. Pruning old files is out of scope (optional future housekeeping).

## Changes

### 1. New `now` handlebars helper

Add a `now` template helper so the current UTC timestamp can be injected declaratively into
prompts (and YAML) at render time, rather than every agent shelling out to `date`.

- New file `apps/api/src/workflow/workflow-date-helpers.ts` exporting
  `registerDateHelpers(hbs)` — matching the existing `registerComparisonHelpers` /
  `registerBooleanHelpers` pattern (one concern per file).
- Register it from `apps/api/src/workflow/state-manager.service.ts` alongside the others.
- `now` takes no arguments and returns an ISO-8601 UTC string, e.g.
  `2026-06-19T03:00:00.000Z`. (Scope is intentionally just `now` — no `date`/`today`/format
  variants yet.)
- Unit test in `apps/api/src/workflow/workflow-date-helpers.spec.ts`: `{{ now }}` renders a
  valid ISO-8601 UTC string (assert with a regex / `Date.parse`, not an exact value).
- **Determinism caveat:** `now` is non-deterministic by design. Do not use it in step
  `condition`s or anywhere workflow diffing/dry-run assumes stable renders; it is for
  injecting timestamps into prompt/file content only.

### 2. Scoped variables

`seed/variables/orchestration-defaults.json`: add

```json
{ "key": "analysis.refactoring_findings_cap", "value": 3, "valueType": "number" },
{ "key": "analysis.refactoring_run_item_budget", "value": 20, "valueType": "number" },
{ "key": "analysis.refactoring_rotation_lookback_runs", "value": 10, "valueType": "number" }
```

Update `apps/api/src/database/seeds/variables/scoped-variables.seed.spec.ts` for the new keys
/count. `vars` is snapshotted into `state_variables` at launch
(`workflow-initial-state.util.ts`), so all are available in conditions, inputs, and prompts as
`{{ vars.analysis.refactoring_findings_cap }}` etc.

### 3. Subagent prompt — `subagent-probe.md`

- Cap to the top-N highest-severity findings (N supplied in the task brief). When more than N
  qualify, keep the highest severity; break ties by impact in the rationale.
- For each kept finding, call `kanban.list_work_items` and skip if an existing non-terminal
  item already covers the same module + concern.
- For each novel finding, call `kanban.work_item_create`. The `[Refactoring] <title>` format,
  description block, and severity→scope/priority mapping move here from the old architect prompt:
  - critical → scope: large, priority: urgent
  - high → scope: medium, priority: high
  - medium → scope: small, priority: medium
  - low → scope: small, priority: low
- Set work-item metadata `refactoring_module: <module_path>` on create so coverage is queryable
  without parsing descriptions.
- Return via `set_job_output` exactly once, a compact summary only:

```json
{
  "scope_id": "<from task brief>",
  "module_path": "apps/api/src/auth",
  "items_created": 2,
  "duplicates_skipped": 1,
  "outcome": "created",
  "created_items": [
    {
      "work_item_id": "wi-123",
      "title": "[Refactoring] Auth module violates SRP",
      "module_path": "apps/api/src/auth"
    }
  ]
}
```

### 4. Coordinator prompt — `coordinator-scan.md`

- **Read recent coverage:** `ls docs/analysis/refactoring/`, take the most recent
  `{{ vars.analysis.refactoring_rotation_lookback_runs }}` files, `read` them, parse each
  `## Modules analyzed` list (missing directory → none).
- **Select modules** by rotation order (never-in-window first, then stalest), enough to spend
  but not exceed the run budget.
- **Enforce the run budget:** maintain `remaining = vars.analysis.refactoring_run_item_budget`;
  give each subagent a cap of `min(vars.analysis.refactoring_findings_cap, remaining)`; after
  each batch's summaries, subtract `items_created`; stop dispatching once `remaining <= 0`.
- Subagents now dedup + create tickets (top-N) and return summaries. Subagent tool list becomes
  `["read", "ls", "bash", "kanban.project_state", "kanban.list_work_items", "kanban.work_item_create"]`.
- Coordinator no longer synthesizes a `refactoring_findings` array. It sums the subagent
  summaries and emits:

```json
{
  "items_created": 18,
  "duplicates_skipped": 5,
  "created_items": [
    { "work_item_id": "...", "title": "...", "module_path": "..." }
  ],
  "scope_manifest": [
    {
      "scope_id": "auth",
      "label": "...",
      "paths": ["apps/api/src/auth"],
      "outcome": "created",
      "created": 2
    }
  ]
}
```

`scope_manifest` carries each analyzed module's outcome/created count so the finalize step can
write the per-run file without re-deriving it.

### 5. Workflow YAML — `codebase_refactoring_analysis.workflow.yaml`

- `scan_codebase`:
  - Add `kanban.list_work_items` and `kanban.work_item_create` to its `tool_policy` (the
    subagent tool ceiling — final catalog is job ∩ profile, so the job must allow them).
  - Change `output_contract.required` to
    `[items_created, duplicates_skipped, created_items, scope_manifest]` with
    `items_created: integer`, `duplicates_skipped: integer`.
- `dedup_and_create` → rename to `cross_module_dedup`:
  - Remove the `refactoring_findings` injection; the new prompt receives
    `{{json jobs.scan_codebase.output.created_items}}` and
    `{{json jobs.scan_codebase.output.scope_manifest}}` (ids/titles/module/outcomes only).
  - Tools: `read`, `write`, `edit` (for the per-run file), `kanban.list_work_items`,
    `kanban.work_item`, `kanban.work_item_transition_status`
    (close a duplicate), `kanban.work_item_patch_metadata` (annotate "duplicate of <id>"),
    plus `set_job_output` / `step_complete`. Drop `kanban.work_item_create`.
  - `output_contract.required`: `[merged]` with `merged: integer`.
- `commit_findings`: keep `paths: [docs/analysis]` (covers `docs/analysis/refactoring/`);
  update `depends_on` to `cross_module_dedup`. Confirm it pushes.
- `emit_analysis_complete`: read `items_created` / `duplicates_skipped` from
  `jobs.scan_codebase.output`; add `merged: "{{ jobs.cross_module_dedup.output.merged }}"`;
  update `depends_on` to `cross_module_dedup`.

### 6. Finalize prompt — `cross-module-dedup.md` (new)

- Cross-module dedup over `created_items` (titles + module only): detect near-duplicate titles
  spanning modules; for each dup keep one, close the other via
  `kanban.work_item_transition_status` and annotate via `kanban.work_item_patch_metadata`
  (`duplicate_of: <id>`). Count closures as `merged`.
- **Write the per-run file:** the prompt receives the timestamp via `{{ now }}`; derive the
  `<date>` prefix from it and take the workflow run id from runtime context; `write`
  `docs/analysis/refactoring/<date>-<run_id>.md` with the run header (full `{{ now }}`
  timestamp) + the `## Modules analyzed` list built from `scope_manifest` (+ `created_items`
  ids per module). Create the directory if needed.
- `set_job_output { merged }`, then `step_complete`.

### 7. Prompts on disk

- Add `seed/workflows/prompts/codebase-refactoring-analysis/cross-module-dedup.md`.
- Delete `seed/workflows/prompts/codebase-refactoring-analysis/dedup-create.md`.
- Update the `prompt_file` reference in the YAML for the renamed job.

## Trade-offs

- Subagents analyze disjoint module paths, so cross-subagent duplicates are rare; the sweep is
  a safety net, not the primary dedup mechanism.
- Findings below the per-subagent cap, and modules beyond the run budget, are deferred — but
  rotation reaches them on subsequent runs, and each run's file records progress.
- No single global-prioritization pass across all findings; prioritization is local to each
  module, with cross-run fairness from the lookback window.
- Rotation depends on the finalize step parsing/writing the `## Modules analyzed` list
  correctly. A malformed or missing file degrades a module to "treat as never-analyzed in the
  window" (safe failure mode — at worst it gets re-analyzed sooner).
- The lookback window K must be ≥ the number of runs it takes to cycle the repo, or a module
  could fall out of the window and be re-picked before the cycle completes; the default (10)
  and the run budget are tunable per project.

## Testing

- `workflow-date-helpers.spec.ts`: `{{ now }}` renders a valid ISO-8601 UTC string.
- `scoped-variables.seed.spec.ts`: assert the new `analysis.refactoring_findings_cap` (3),
  `analysis.refactoring_run_item_budget` (20), and `analysis.refactoring_rotation_lookback_runs`
  (10) defaults.
- A workflow contract test (following `orchestration-cycle-vars.contract.spec.ts`) asserting:
  - `scan_codebase` output contract is the counts shape, not the old `refactoring_findings`;
  - the coordinator prompt references the three `vars.analysis.*` keys and lists
    `docs/analysis/refactoring/`;
  - the renamed `cross_module_dedup` job exists, has `write`/`edit`/`bash`, and all downstream
    `depends_on` / templating point at it (no dangling `dedup_and_create` refs).

## Out of Scope

- No change to subagent concurrency (still ≤3 per turn / per batch).
- No change to the trigger or concurrency policy.
- No web UI surface for the new variables (seed defaults, editable via the scoped-variable store).
- `now` is the only new date helper — no `date`/`today`/format-arg variants in this change.
- No pruning/retention of old per-run coverage files.
