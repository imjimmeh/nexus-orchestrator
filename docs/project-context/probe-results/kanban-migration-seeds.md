---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-migration-seeds
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/migration/legacy-kanban-import.ts
  - apps/kanban/src/migration/legacy-kanban-import.cli.ts
  - apps/kanban/src/migration/legacy-kanban-import.spec.ts
  - apps/kanban/src/migration/legacy-kanban-import.cli.spec.ts
  - apps/kanban/src/migration/legacy-kanban-import.types.ts
  - apps/kanban/src/migration/legacy-kanban-import-cli.types.ts
  - apps/kanban/package.json (import:legacy-kanban npm script)
  - apps/kanban/src/seeds/kanban-permission.seed.ts
  - apps/kanban/src/app.service.ts (onApplicationBootstrap wires seed)
  - apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts
  - apps/kanban/src/seeds/strategic-tools.seed.spec.ts
  - apps/kanban/src/seeds/work-item-in-progress.seed-contract.spec.ts
  - apps/kanban/src/seeds/workflows.seed.contract.spec.ts
  - seed/workflows/ (YAML seed data referenced by the contract specs)
  - seed/tool-manifests/kanban-tools.seed.json
  - seed/agents/ceo-agent/agent.json (referenced by contract specs)
source_paths:
  - apps/kanban/src/migration
  - apps/kanban/src/seeds
updated_at: 2026-06-15T00:00:00.000Z
---

# Probe Result: Kanban Migrations and Seeds

## Narrative Summary

Both `apps/kanban/src/migration` and `apps/kanban/src/seeds` are fully
implemented. The migration scope delivers a complete legacy-kanban data import
toolkit (mappers, dependency-safe orchestrator, diff/reconcile writer, and a
mode-aware CLI) and is wired into the workspace as the `import:legacy-kanban`
npm script in `apps/kanban/package.json`. The seeds scope ships one real
production seeder (`seedKanbanPermissions`, invoked from
`AppService.onApplicationBootstrap` on Kanban startup) and a substantial
contract-test suite (≈4000 LOC across four spec files) that pins the on-disk
YAML workflow seeds, the kanban tool manifest, and the CEO agent profile
to expected shapes — covering the EPIC-208 phase-3 two-phase strategize/
dispatch contract, work-item in-progress tier rules, war-room alignment
jobs, and the deep-investigation probe-loop playbook.

## Capability Updates

- **Legacy Kanban Data Import** (`apps/kanban/src/migration/`): Six files
  implementing a dependency-safe one-way data migration from the legacy
  API DB (`projects`, `work_items`, `project_goals`,
  `project_goal_worklogs`, `work_item_dependencies`, `work_item_subtasks`)
  to the kanban source-of-truth tables (`kanban_projects`,
  `kanban_work_items`, `kanban_project_goals`,
  `kanban_work_item_dependencies`, `kanban_work_item_subtasks`,
  `kanban_project_goal_worklogs`).
  - `legacy-kanban-import.types.ts` defines row/interface types:
    `LegacyProjectRow`, `LegacyWorkItemRow`, `LegacyGoalRow`,
    `LegacyGoalWorklogRow`, `LegacyWorkItemDependencyRow`,
    `LegacySubtaskRow`, plus `LegacyKanbanImportSource`,
    `LegacyKanbanImportWriter`, `LegacyKanbanTableDiff`, and
    `LegacyKanbanImportResult`.
  - `legacy-kanban-import.ts` provides mappers
    (`mapLegacyProjectRow`, `mapLegacyWorkItemRow`, `mapLegacyGoalRow`,
    `mapLegacyGoalWorklogRow`, `mapLegacyWorkItemDependencyRow`,
    `mapLegacySubtaskRow`), the `runLegacyKanbanImport` orchestrator
    (writes in dependency-safe order: projects → workItems → goals →
    dependencies → subtasks → goalWorklogs, then reads back and diffs),
    and `diffLegacyKanbanRows` for stable-stringify-based
    missing/changed/extra detection.
  - `legacy-kanban-import.cli.ts` provides `parseLegacyKanbanImportCliArgs`
    (handles `--mode`, `--api-database-url`, `--kanban-database-url`,
    `flag=value` shorthand, validates the mode, and rejects unknown
    flags), `runLegacyKanbanImportCli` (initialises two `DataSource`s
    with `API_DATABASE_URL`/`KANBAN_DATABASE_URL`/`DATABASE_URL`
    precedence, treats both `dry-run` and `reconcile` as no-write modes,
    always logs the JSON result, and tears down both connections in a
    `finally`), `readLegacyKanbanSource` (six parallel `dataSource.query`
    reads), `createLegacyKanbanWriter` (parameterised upsert via
    `ON CONFLICT (id) DO UPDATE` and full-table reads), plus a
    `require.main === module` entrypoint that surfaces
    `process.exitCode = 1` on failure.
  - `legacy-kanban-import-cli.types.ts` defines
    `LegacyKanbanImportMode = "dry-run" | "import" | "reconcile"` and
    `LegacyKanbanImportCliOptions`.
  - Two co-located spec files cover the surface:
    `legacy-kanban-import.spec.ts` (mapper assertions, dependency-order
    test, and a reconciliation round-trip that asserts the writes happen
    in `[projects, workItems, goals, dependencies, subtasks, goalWorklogs]`
    order) and `legacy-kanban-import.cli.spec.ts` (default dry-run,
    explicit `import`/`reconcile` mode parsing, `flag=value` shorthand,
    and error paths for unknown modes/flags).
  - The toolkit is exposed to operators via
    `apps/kanban/package.json` → `"import:legacy-kanban": "node dist/migration/legacy-kanban-import.cli.js"`.
- **Kanban Permission Seeding** (`apps/kanban/src/seeds/kanban-permission.seed.ts`):
  Production seeder `seedKanbanPermissions(DataSource)` that idempotently
  inserts `work_items:{read,create,update,delete,manage}` rows in
  `permissions` and links them to `admin`, `platform_admin`, and
  `viewer` roles in `role_permissions`. Both inserts use
  `ON CONFLICT … DO NOTHING` / `NOT EXISTS` guards so re-runs are
  safe. Invoked from
  `apps/kanban/src/app.service.ts:onApplicationBootstrap` (the failure
  path is caught and logged via `Logger`).
- **Workflow Seed Contract Tests** (`apps/kanban/src/seeds/`): Four
  vitest spec files pin the on-disk YAML seeds in
  `seed/workflows/` and `seed/tool-manifests/kanban-tools.seed.json` to
  expected shapes:
  - `project-orchestration-cycle-ceo.seed-contract.spec.ts` —
    extensive assertions on the CEO cycle (no direct
    `kanban.work_item_create`, projected delegation tools present,
    `max_step_loops: 10`, no charter refinement wiring, required
    `decision` + `linked_run_id` output, `forbidden` repeat-without-
    blockedItems contract, lifecycle + dispatch tool allowlist,
    composite decision completion before `step_complete`, project-id
    handoff, stale-execution restart, "Autonomous Zero-Todo Board
    Mandate" with paths a-d, blockedItems format), plus the EPIC-208
    phase-3 two-phase `strategize`/`dispatch` job ordering and the CEO
    agent profile.
  - `strategic-tools.seed.spec.ts` — checks
    `kanban-tools.seed.json` registers
    `kanban.record_strategic_intent` and
    `kanban.record_discovery_completed`.
  - `work-item-in-progress.seed-contract.spec.ts` — asserts every job
    in `work-item-in-progress-default.workflow.yaml` declares a
    `tier` of `light` or `heavy`.
  - `workflows.seed.contract.spec.ts` — ≈3,945-line shared contract
    suite covering tool-policy resolution (`applyToolPolicy` honours
    explicit denies after wildcard allows, supports the
    `tool_policy.rules` format), workflow structure (event emissions,
    trigger types, required output contracts, job conditions, tool
    allow/deny lists, effective-allowed-tools math, prompt contents
    for CEO dispatch, work-item in-progress, refinement, advisor,
    discovery, generation, spec revision, hydration, deep
    investigation, etc.), and deep-investigation specifics (probe-loop
    scope-batching rules, project vs probe scope-id handling, batch vs
    serial execution mode, parent finalization contract).
- **Adjacent infrastructure referenced by the seeds (out of strict
  scope but documented for context)**: The actual workflow YAML data
  lives at the repo-root `seed/workflows/` directory and the kanban
  tool manifest at `seed/tool-manifests/kanban-tools.seed.json` (45
  `kanban.*` and adjacent tool names). The Kanban DB-level schema
  migrations live in
  `apps/kanban/src/database/migrations/` (including
  `20260502130000-migrate-legacy-kanban-data`, the TypeORM migration
  that wires the in-app migration logic into the migration runner) and
  are registered in `apps/kanban/src/database/database.module.ts`.

## Health Findings

- **Test coverage**: Strong. Both production sources in
  `apps/kanban/src/migration/` have co-located `*.spec.ts` files
  covering happy paths, the dependency-safe write order, the round-trip
  reconciliation, and CLI parsing error paths. The seeds scope leans on
  contract tests that pin the on-disk YAML to expected behaviour; those
  tests are extensive (≈4,000 lines across four files) but are by
  nature descriptive rather than behavioural.
- **Code quality**:
  - The migration module uses stable-stringify-based diffing
    (`sortValue` → `stableStringify`) so reconciliation is robust to
    key-order changes across DB drivers.
  - The CLI uses a `require.main === module` guard with a try/catch
    that sets `process.exitCode = 1`, matching the other Node CLIs in
    the repo.
  - `seedKanbanPermissions` is wrapped in `try/catch` at the
    `onApplicationBootstrap` call site so a seeding failure does not
    crash the NestJS boot.
  - The TypeORM-level companion migration
    (`20260502130000-migrate-legacy-kanban-data`) is registered in
    `database.module.ts` next to the rest of the schema migrations,
    indicating the runtime migration path is wired up.
- **Churn/duplication**: None observed. The `migration/` directory is
  the only kanban-owned data-import path. The `seeds/` directory mixes
  one production seeder with contract specs, but the contract specs
  are clearly scoped to the repo-root `seed/` data and do not duplicate
  the production seeder.
- **Open contract surface**:
  - The migration CLI is only invoked through the npm script (no
    on-app-bootstrap integration), which is the right call for a
    destructive one-way data migration but means the seeder
    `seedKanbanPermissions` and the migration CLI are intentionally
    separate run paths.
  - The seeds directory has 4 spec files but only 1 production file;
    the contract specs are the de facto documentation of how the YAML
    seeds must look.

## Open Questions

- None blocking. The probe confirmed wiring end-to-end (npm script →
  compiled `dist/migration/legacy-kanban-import.cli.js`,
  `AppService.onApplicationBootstrap` → `seedKanbanPermissions`, and
  `database.module.ts` → `MigrateLegacyKanbanData20260502130000`).
- Possible follow-up probes (out of scope here): whether the CEO agent
  JSON profile in `seed/agents/ceo-agent/agent.json` and the workflow
  YAMLs in `seed/workflows/` remain in sync with the contract tests in
  this directory — drift between them would fail the contract suite,
  but the contract surface is large enough that a dedicated probe
  could be useful if those seeds start changing frequently.
