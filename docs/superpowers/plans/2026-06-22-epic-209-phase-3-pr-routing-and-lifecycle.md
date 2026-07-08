# Plan: EPIC-209 Phase 3 — PR Routing, PR-Tracking Persistence, and `awaiting-pr-merge` Lifecycle

**Date:** 2026-06-22
**Epic:** EPIC-209 (Pull-Request-Based Integration Strategy)
**Spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 6, Phase 3; signatures pinned in Section 10)
**Consumes (earlier phases):** `MergeProviderFactory` (Phase 2), `IntegrationStrategyResolver` (Phase 1), `MERGE_PROVIDER` interface (Phase 1 declares / Phase 2 implements).
**Produces (for Phase 4):** `pull_request_tracking` rows + the `awaiting-pr-merge` lifecycle state.

---

## Goal

Route `merge_integrate` on the resolved integration strategy. For `direct-push` repositories the behaviour is **byte-for-byte unchanged** (`GitMergeService.integrateAndPush` → push to base). For `pull-request` repositories the engine instead pushes the feature branch (hook-free), opens or updates a PR via the Phase-2 `MergeProviderFactory`, persists a neutral `pull_request_tracking` row, and returns `merge_outcome: 'pull_request_opened'` + `pr_url` / `pr_number` in the step output. The seed workflow branches on `{{ trigger.integration_strategy }}`: the PR path records the PR URL into `lifecycle.merge` and transitions the work item `ready-to-merge → awaiting-pr-merge` (a new kanban status) instead of `done`. Re-running `merge_integrate` for a head with an existing tracked PR updates the existing row (find-or-create + unique constraint), never duplicates.

## Architecture

- **API-side (neutral, VCS-domain):** new `PullRequestTracking` TypeORM entity + repository + migration (`pull_request_tracking`); `MergeIntegrateGitActionStrategy` branches on the resolved `IntegrationStrategy`. PR mechanics + tracking persistence carry **only** neutral `scopeId`/`contextId` — no kanban/work-item identifiers (lint rule `nexus-boundaries/no-core-kanban-residue`).
- **Kanban-side (lifecycle):** `awaiting-pr-merge` added to `WorkItemStatusSchema`, `WORK_ITEM_STATUS_GROUPS.completed`, `SUPPORTED_WORK_ITEM_STATUSES`, branch-owning/strategic-state sets, and the web board column config. Transition validity flows through the existing `SUPPORTED_WORK_ITEM_STATUSES` gate.
- **Seed workflow:** strategy branch after the existing `merge_integrate` for the clean path. The pull-request branch pushes feature + opens PR (via the strategy), records `lifecycle.merge`, transitions to `awaiting-pr-merge`. The direct-push branch keeps the current `done` path untouched.

## Tech Stack

TypeScript (strict), NestJS (`nest build`), TypeORM (Postgres), Vitest, Zod, Handlebars-templated YAML workflows, React/Vite (web board config).

## Global Constraints

- **TDD strictly:** failing test → run (expect FAIL) → minimal impl → run (expect PASS) → commit. One behaviour per Red/Green cycle.
- **Test commands:** API `npm run test --workspace=apps/api`; kanban `npm run test --workspace=apps/kanban`; contracts compile via the kanban build. Typecheck before declaring done (`npm run build --workspace=packages/kanban-contracts`, `nest build` via `npm run build:api` / `npm run build:kanban`).
- **Core/Kanban boundary (critical):** the entity, repository, migration, and git-action branch are API-side and must use **only** `scopeId` / `contextId` neutral fields and VCS terms (`provider`, `owner`, `repo`, `pr_number`, `head`, `base`). **No** `kanban`, `workItem`, `work-item`, project-domain identifiers in API/core code, tests, fixtures, comments, or migration SQL. The `awaiting-pr-merge` status, its transition, and `lifecycle.merge` metadata are kanban-side. **Never** add allowlists, `eslint-disable`, `@ts-ignore`, or compatibility aliases to bypass the boundary lint rule.
- **`direct-push` unchanged:** an explicit regression test asserts the `direct-push` branch still calls `integrateAndPush(scopeId, target, base)` and returns the same output shape. Do not alter `GitMergeService.integrateAndPush` or `merge-prepare-git-action.strategy.ts`.
- **No lint suppression.** Strong typing throughout; pinned Section 10 signatures used verbatim.
- **Frequent atomic commits** — one per Green step. End commit messages with the Co-Authored-By trailer.
- **Out of Phase-3 scope (do NOT build here):** the PR webhook controller, the poll reconciler, `core.integration.pr_merged.v1`, the kanban `pr_merged` consumer transition (`awaiting-pr-merge → done`), the `work-item-awaiting-pr-merge-default` workflow, and `auto_merge`/`merge_method` execution. Those are Phase 4/5. Phase 3 only opens the PR, persists tracking, and parks the item in `awaiting-pr-merge`.

---

## File Structure

```
apps/api/src/
  common/git/integration/
    pull-request-tracking.entity.ts                         (NEW — entity, Section 10.4)
    pull-request-tracking.repository.ts                     (NEW — repository, find-or-create)
    pull-request-tracking.repository.types.ts               (NEW — input type)
    pull-request-tracking.repository.spec.ts                (NEW — repo unit test)
    merge-provider.interface.ts                             (EXISTS — Phase 1; consumed)
    merge-provider.factory.ts                               (EXISTS — Phase 2; consumed)
    integration-strategy.resolver.ts                        (EXISTS — Phase 1; consumed)
  database/
    migrations/
      20260622HHmmss-create-pull-request-tracking.ts        (NEW — migration)
    migrations/registered-migrations.ts                     (EDIT — register migration)
    database.module.ts                                      (EDIT — entities + repositories arrays)
  workflow/workflow-special-steps/git-actions/
    merge-integrate-git-action.strategy.ts                  (EDIT — branch on strategy)
    merge-integrate-git-action.strategy.spec.ts             (NEW/EDIT — branch + regression tests)
  workflow/workflow-special-steps/workflow-special-steps.module.ts (EDIT — wire factory + repo + resolver)

packages/kanban-contracts/src/
  work-item.schema.ts                                       (EDIT — enum + groups)
  work-item-status.spec.ts                                  (NEW/EDIT — status contract test)

apps/kanban/src/
  work-item/work-item.service.helpers.ts                    (EDIT — SUPPORTED_WORK_ITEM_STATUSES)
  dispatch/target-branch-claims.ts                          (EDIT — branch-owning set)
  dispatch/project-dispatch-capacity.ts                     (NO CHANGE — see Task 8 note)
  orchestration/strategic/project-strategic-state.service.ts(EDIT — completed set)
  work-item/work-item.service.status.spec.ts                (NEW/EDIT — transition test)

apps/web/src/pages/
  kanban/kanban.utils.ts                                    (EDIT — KANBAN_COLUMNS, IN_FLIGHT, grouping)
  kanban/kanban.board-helpers.ts                            (EDIT — collapsed columns)
  kanban/kanban-card-ui.ts                                  (EDIT — STATUS_PROGRESS)
  project-workspace/SessionsTab.tsx                         (EDIT — fallback status groups)

seed/workflows/
  work-item-ready-to-merge-default.workflow.yaml            (EDIT — strategy branch + PR path)
```

---

## Phase Ordering (build kanban status first, then API persistence, then strategy branch, then YAML)

Task 1 (contracts status) is a prerequisite for the kanban tasks (2–4) and the YAML transition (Task 11). The API entity/repo (Tasks 5–7) and the strategy branch (Tasks 8–10) are independent of the kanban side. Execute in the numbered order.

---

## Task 1 — Add `awaiting-pr-merge` to the contracts status enum + groups

**Files**

- `packages/kanban-contracts/src/work-item.schema.ts` (EDIT)
- `packages/kanban-contracts/src/work-item-status.spec.ts` (NEW)

**Interfaces**

- Produces: the canonical `awaiting-pr-merge` status value + its membership in `WORK_ITEM_STATUS_GROUPS.completed`, consumed by every downstream task and by Phase 4.

### Step 1.1 (Red) — failing contract test

Create `packages/kanban-contracts/src/work-item-status.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUS_GROUPS,
  WorkItemStatusSchema,
  isWorkItemStatusInGroup,
} from "./work-item.schema";

describe("awaiting-pr-merge status", () => {
  it("is a valid work item status", () => {
    expect(WorkItemStatusSchema.safeParse("awaiting-pr-merge").success).toBe(
      true,
    );
  });

  it("belongs to the completed group, between ready-to-merge and done", () => {
    expect(WORK_ITEM_STATUS_GROUPS.completed).toEqual([
      "ready-to-merge",
      "awaiting-pr-merge",
      "done",
    ]);
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "completed")).toBe(
      true,
    );
  });

  it("is not in the active or blocked groups", () => {
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "active")).toBe(false);
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "blocked")).toBe(false);
  });
});
```

Run (expect FAIL — `awaiting-pr-merge` not yet in the enum/group):

```bash
npm run test --workspace=packages/kanban-contracts -- work-item-status
```

Expected: assertions fail (`safeParse` false / group array mismatch).

> If `packages/kanban-contracts` has no `test` script, run via the kanban workspace which compiles the contracts, or add the spec under `apps/kanban` importing `@nexus/kanban-contracts`. Confirm the existing test runner for this package by checking its `package.json` `scripts` before running — use whichever command the package already exposes.

### Step 1.2 (Green) — add the status

Edit `WorkItemStatusSchema` and `WORK_ITEM_STATUS_GROUPS` in `work-item.schema.ts`:

```typescript
export const WorkItemStatusSchema = z.enum([
  "backlog",
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "awaiting-pr-merge",
  "blocked",
  "done",
]);

export const WORK_ITEM_STATUS_GROUPS = {
  active: ["refinement", "in-progress", "in-review"],
  completed: ["ready-to-merge", "awaiting-pr-merge", "done"],
  blocked: ["blocked"],
} as const;
```

Run (expect PASS):

```bash
npm run test --workspace=packages/kanban-contracts -- work-item-status
npm run build --workspace=packages/kanban-contracts
```

### Step 1.3 (Commit)

```bash
git add packages/kanban-contracts/src/work-item.schema.ts packages/kanban-contracts/src/work-item-status.spec.ts
git commit -m "feat(kanban-contracts): add awaiting-pr-merge status to enum and completed group

EPIC-209 Phase 3. New lifecycle state between ready-to-merge and done for
PR-based integration; member of the completed status group.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Accept `awaiting-pr-merge` in the kanban status-support gate + transition validation

**Files**

- `apps/kanban/src/work-item/work-item.service.helpers.ts` (EDIT)
- `apps/kanban/src/work-item/work-item.service.status.spec.ts` (NEW or EDIT existing status spec)

**Interfaces**

- Consumes: Task 1 enum.
- Produces: a valid `ready-to-merge → awaiting-pr-merge` transition through `WorkItemService.updateStatus` (validated by `isSupportedWorkItemStatus` / `SUPPORTED_WORK_ITEM_STATUSES`).

### Step 2.1 (Red) — failing transition-support test

Create/extend `apps/kanban/src/work-item/work-item.service.status.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_WORK_ITEM_STATUSES,
  isSupportedWorkItemStatus,
} from "./work-item.service.helpers";

describe("awaiting-pr-merge support", () => {
  it("is a supported work item status", () => {
    expect(SUPPORTED_WORK_ITEM_STATUSES.has("awaiting-pr-merge")).toBe(true);
    expect(isSupportedWorkItemStatus("awaiting-pr-merge")).toBe(true);
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- work-item.service.status
```

### Step 2.2 (Green) — add to the supported set

Edit `SUPPORTED_WORK_ITEM_STATUSES` in `work-item.service.helpers.ts`:

```typescript
export const SUPPORTED_WORK_ITEM_STATUSES: ReadonlySet<WorkItemStatus> =
  new Set([
    "backlog",
    "todo",
    "refinement",
    "in-progress",
    "in-review",
    "ready-to-merge",
    "awaiting-pr-merge",
    "blocked",
    "done",
  ]);
```

Run (expect PASS):

```bash
npm run test --workspace=apps/kanban -- work-item.service.status
```

### Step 2.3 (Commit)

```bash
git add apps/kanban/src/work-item/work-item.service.helpers.ts apps/kanban/src/work-item/work-item.service.status.spec.ts
git commit -m "feat(kanban): accept awaiting-pr-merge in work-item status-support gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Treat `awaiting-pr-merge` as branch-owning (dispatch claims)

**Files**

- `apps/kanban/src/dispatch/target-branch-claims.ts` (EDIT)
- co-located spec for that file (NEW or EDIT — confirm the existing spec filename, e.g. `target-branch-claims.spec.ts`)

**Interfaces**

- Produces: the feature branch remains claimed while the PR is open, preventing a second dispatch from reusing the branch.

### Step 3.1 (Red)

Add a test asserting an item in `awaiting-pr-merge` still owns its target branch. Mirror the existing test structure in the file's spec; assert the branch-owning predicate/set includes `awaiting-pr-merge`:

```typescript
it("treats awaiting-pr-merge as branch-owning", () => {
  expect(BRANCH_OWNING_STATUSES.has("awaiting-pr-merge")).toBe(true);
});
```

(Adjust the import/symbol to the actual exported name — read the file first; if the set is private, assert via the public claim-resolution function with a fixture item in `awaiting-pr-merge`.)

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- target-branch-claims
```

### Step 3.2 (Green)

Add `"awaiting-pr-merge"` to `BRANCH_OWNING_STATUSES`:

```typescript
const BRANCH_OWNING_STATUSES = new Set([
  "in-progress",
  "in-review",
  "ready-to-merge",
  "awaiting-pr-merge",
]);
```

Run (expect PASS), then commit:

```bash
npm run test --workspace=apps/kanban -- target-branch-claims
git add apps/kanban/src/dispatch/target-branch-claims.ts apps/kanban/src/dispatch/target-branch-claims.spec.ts
git commit -m "feat(kanban): keep target branch claimed while PR is open (awaiting-pr-merge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Count `awaiting-pr-merge` as a completed strategic state

**Files**

- `apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts` (EDIT)
- its co-located spec (NEW or EDIT — confirm filename)

**Interfaces**

- Produces: orchestration treats PR-parked items as completed-pending (not stuck, not active) for strategic snapshots (spec Decision 6: not-stuck).

### Step 4.1 (Red)

Add a test asserting the strategic `COMPLETED_STATUSES` set includes `awaiting-pr-merge`:

```typescript
it("counts awaiting-pr-merge as a completed strategic state", () => {
  expect(COMPLETED_STATUSES.has("awaiting-pr-merge")).toBe(true);
});
```

(If the set is module-private, assert via the public service method that classifies an item — read the service first and use a fixture item with status `awaiting-pr-merge`.)

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- project-strategic-state
```

### Step 4.2 (Green)

```typescript
const COMPLETED_STATUSES: ReadonlySet<string> = new Set([
  "ready-to-merge",
  "awaiting-pr-merge",
  "done",
]);
```

Run (expect PASS), then commit:

```bash
npm run test --workspace=apps/kanban -- project-strategic-state
git add apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts
git commit -m "feat(kanban): classify awaiting-pr-merge as completed-pending in strategic state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Boundary note for Tasks 2–4:** all edits stay inside `apps/kanban` and reference the neutral status string. No API/core file gains a kanban identifier.

---

## Task 5 — Web board: render the `awaiting-pr-merge` column

**Files**

- `apps/web/src/pages/kanban/kanban.utils.ts` (EDIT — `KANBAN_COLUMNS`, `IN_FLIGHT_STATUSES`, `groupWorkItemsByStatus`)
- `apps/web/src/pages/kanban/kanban.board-helpers.ts` (EDIT — `getInitialCollapsedColumns`)
- `apps/web/src/pages/kanban/kanban-card-ui.ts` (EDIT — `STATUS_PROGRESS`)
- `apps/web/src/pages/project-workspace/SessionsTab.tsx` (EDIT — `FALLBACK_WORK_ITEM_STATUS_GROUPS`)

**Interfaces**

- Consumes: Task 1 `WorkItemStatus` union (the `Record<WorkItemStatus, …>` maps below become type errors until updated — that is the compile-time "Red").

### Step 5.1 (Red) — compile failure proves the gap

After Task 1 published the new union member, the exhaustive `Record<WorkItemStatus, …>` objects in these files are missing a key. Run the web typecheck/build to observe the failure:

```bash
npm run build --workspace=apps/web
```

Expected: TS2741 / "property 'awaiting-pr-merge' is missing" on the `Record<WorkItemStatus, …>` literals. (Optionally add a unit assertion that `KANBAN_COLUMNS` contains a `awaiting-pr-merge` entry positioned after `ready-to-merge`.)

### Step 5.2 (Green) — add the column + map entries

`kanban.utils.ts` — `KANBAN_COLUMNS` (insert after `ready-to-merge`):

```typescript
  { status: "ready-to-merge", title: "Ready to Merge" },
  { status: "awaiting-pr-merge", title: "Awaiting PR Merge" },
  { status: "blocked", title: "Blocked" },
```

`kanban.utils.ts` — `IN_FLIGHT_STATUSES` add `"awaiting-pr-merge"`; `groupWorkItemsByStatus` add `"awaiting-pr-merge": []` to the seed record.

`kanban.board-helpers.ts` — `getInitialCollapsedColumns` add `"awaiting-pr-merge": false`.

`kanban-card-ui.ts` — `STATUS_PROGRESS` add `"awaiting-pr-merge": 95` (between `ready-to-merge: 92` and `done: 100`).

`SessionsTab.tsx` — `FALLBACK_WORK_ITEM_STATUS_GROUPS.completed` → `["ready-to-merge", "awaiting-pr-merge", "done"]`.

Run (expect PASS):

```bash
npm run build --workspace=apps/web
npm run test:unit:web -- kanban
```

### Step 5.3 (Commit)

```bash
git add apps/web/src/pages/kanban/kanban.utils.ts apps/web/src/pages/kanban/kanban.board-helpers.ts apps/web/src/pages/kanban/kanban-card-ui.ts apps/web/src/pages/project-workspace/SessionsTab.tsx
git commit -m "feat(web): render awaiting-pr-merge board column and status maps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `PullRequestTracking` entity (API-side, neutral) — Section 10.4

**Files**

- `apps/api/src/common/git/integration/pull-request-tracking.entity.ts` (NEW)

**Interfaces**

- Consumes: nothing.
- Produces: the `PullRequestTracking` entity persisted by Task 7's repository and read by the Phase 4 reconciler.

Section 10.4 columns are pinned: `id (uuid pk)`, `provider`, `owner`, `repo`, `pr_number (int)`, `scope_id`, `context_id`, `workflow_run_id`, `head_branch`, `base_branch`, `pr_url`, `state ('open'|'merged'|'closed')`, `merge_commit_sha (nullable)`, `created_at`, `updated_at`; unique `(provider, owner, repo, pr_number)`; index on `(state)`.

> Entity + migration ship together; the entity is verified via the repository test (Task 7). Write the entity here, then the migration (Task 7.0), then the repository test (Task 7).

```typescript
// apps/api/src/common/git/integration/pull-request-tracking.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { PullRequestState } from "./merge-provider.interface";

/**
 * Neutral mapping from a hosted pull request identity
 * `(provider, owner, repo, pr_number)` back to the originating scope/context and
 * workflow run. The PR webhook / poll reconciler (Phase 4) looks the row up by
 * provider identity and emits the neutral `pr_merged` lifecycle event; no kanban
 * domain identifier ever crosses into this table.
 *
 * Table created by
 * `apps/api/src/database/migrations/20260622HHmmss-create-pull-request-tracking.ts`.
 */
@Entity("pull_request_tracking")
@Unique("uq_pull_request_tracking_provider_owner_repo_number", [
  "provider",
  "owner",
  "repo",
  "pr_number",
])
@Index("idx_pull_request_tracking_state", ["state"])
export class PullRequestTracking {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 32 })
  provider!: string;

  @Column({ type: "varchar", length: 200 })
  owner!: string;

  @Column({ type: "varchar", length: 200 })
  repo!: string;

  @Column({ name: "pr_number", type: "integer" })
  pr_number!: number;

  @Column({ name: "scope_id", type: "varchar", length: 200 })
  scope_id!: string;

  @Column({ name: "context_id", type: "varchar", length: 200 })
  context_id!: string;

  @Column({ name: "workflow_run_id", type: "uuid" })
  workflow_run_id!: string;

  @Column({ name: "head_branch", type: "varchar", length: 400 })
  head_branch!: string;

  @Column({ name: "base_branch", type: "varchar", length: 400 })
  base_branch!: string;

  @Column({ name: "pr_url", type: "text" })
  pr_url!: string;

  @Column({ type: "varchar", length: 16 })
  state!: PullRequestState;

  @Column({
    name: "merge_commit_sha",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  merge_commit_sha!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updated_at!: Date;
}
```

No standalone test for the entity (proven via Task 7). Commit together with Task 7.

---

## Task 7 — Migration + `PullRequestTrackingRepository` (find-or-create / idempotent upsert)

**Files**

- `apps/api/src/database/migrations/20260622HHmmss-create-pull-request-tracking.ts` (NEW — replace `HHmmss` with the real time using the existing `YYYYMMDDHHmmss` pattern; confirm the next free timestamp by inspecting `apps/api/src/database/migrations/`)
- `apps/api/src/database/migrations/registered-migrations.ts` (EDIT — import + append to the array)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.ts` (NEW)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.types.ts` (NEW)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts` (NEW)
- `apps/api/src/database/database.module.ts` (EDIT — `entities` + `repositories` arrays)

**Interfaces**

- Consumes: Task 6 entity.
- Produces: `recordOpenedPullRequest(input)` (find-or-create by `(provider, owner, repo, pr_number)`) consumed by Task 9's strategy branch; `findByProviderIdentity(...)` consumed by Phase 4.

### Step 7.0 — migration (no separate test; exercised by the repository spec running against the live test DB if the suite is DB-backed, otherwise paired with Task 6 entity reflection)

`registered-migrations.ts` follows an **explicit import + array** registration (not a glob). Add the import and append to `registeredMigrations`.

```typescript
// apps/api/src/database/migrations/20260622HHmmss-create-pull-request-tracking.ts
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create the neutral `pull_request_tracking` table (EPIC-209 Phase 3). Maps a
 * hosted PR identity (provider, owner, repo, pr_number) to the originating
 * scope/context and workflow run so the Phase-4 reconciler can close the
 * lifecycle on an observed provider merge. Holds no kanban domain identifiers.
 */
export class CreatePullRequestTracking20260622HHmmss implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pull_request_tracking (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "owner" varchar(200) NOT NULL,
        "repo" varchar(200) NOT NULL,
        "pr_number" integer NOT NULL,
        "scope_id" varchar(200) NOT NULL,
        "context_id" varchar(200) NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "head_branch" varchar(400) NOT NULL,
        "base_branch" varchar(400) NOT NULL,
        "pr_url" text NOT NULL,
        "state" varchar(16) NOT NULL,
        "merge_commit_sha" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pull_request_tracking_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_pull_request_tracking_provider_owner_repo_number"
          UNIQUE ("provider", "owner", "repo", "pr_number")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pull_request_tracking_state"
        ON pull_request_tracking ("state");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pull_request_tracking;`);
  }
}
```

`registered-migrations.ts`:

```typescript
import { CreatePullRequestTracking20260622HHmmss } from "./20260622HHmmss-create-pull-request-tracking";
// ...
export const registeredMigrations = [
  // ...existing entries...
  CreatePullRequestTracking20260622HHmmss,
];
```

### Step 7.1 (Red) — repository spec

`pull-request-tracking.repository.types.ts`:

```typescript
import type { PullRequestState } from "./merge-provider.interface";

export interface RecordOpenedPullRequestInput {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  scopeId: string;
  contextId: string;
  workflowRunId: string;
  headBranch: string;
  baseBranch: string;
  prUrl: string;
}

export type { PullRequestState };
```

`pull-request-tracking.repository.spec.ts` — use the project's testing-unit pattern with a mocked TypeORM `Repository`. Assert find-or-create idempotency (the load-bearing Phase-3 requirement):

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PullRequestTrackingRepository } from "./pull-request-tracking.repository";
import type { PullRequestTracking } from "./pull-request-tracking.entity";

function makeRepoMock() {
  return {
    findOne: vi.fn(),
    create: vi.fn(
      (v: Partial<PullRequestTracking>) => v as PullRequestTracking,
    ),
    save: vi.fn((v: PullRequestTracking) =>
      Promise.resolve({ ...v, id: "row-1" }),
    ),
  };
}

const input = {
  provider: "github",
  owner: "acme",
  repo: "widgets",
  prNumber: 42,
  scopeId: "scope-1",
  contextId: "context-1",
  workflowRunId: "11111111-1111-1111-1111-111111111111",
  headBranch: "feature/x",
  baseBranch: "main",
  prUrl: "https://github.com/acme/widgets/pull/42",
};

describe("PullRequestTrackingRepository.recordOpenedPullRequest", () => {
  let typeormRepo: ReturnType<typeof makeRepoMock>;
  let repo: PullRequestTrackingRepository;

  beforeEach(() => {
    typeormRepo = makeRepoMock();
    repo = new PullRequestTrackingRepository(typeormRepo as never);
  });

  it("inserts a new open row when none exists for the provider identity", async () => {
    typeormRepo.findOne.mockResolvedValue(null);

    const row = await repo.recordOpenedPullRequest(input);

    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: {
        provider: "github",
        owner: "acme",
        repo: "widgets",
        pr_number: 42,
      },
    });
    expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    expect(row.state).toBe("open");
    expect(row.pr_url).toBe(input.prUrl);
  });

  it("updates the existing row instead of duplicating on re-run", async () => {
    typeormRepo.findOne.mockResolvedValue({
      id: "existing",
      provider: "github",
      owner: "acme",
      repo: "widgets",
      pr_number: 42,
      state: "open",
      pr_url: "https://github.com/acme/widgets/pull/42",
      head_branch: "feature/x",
      base_branch: "main",
      scope_id: "scope-1",
      context_id: "context-1",
      workflow_run_id: input.workflowRunId,
      merge_commit_sha: null,
    } as PullRequestTracking);

    const row = await repo.recordOpenedPullRequest({
      ...input,
      prUrl: "https://github.com/acme/widgets/pull/42?updated",
    });

    expect(typeormRepo.create).not.toHaveBeenCalled();
    expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    expect(row.id).toBe("existing");
    expect(row.pr_url).toBe("https://github.com/acme/widgets/pull/42?updated");
  });
});
```

Run (expect FAIL — repository does not exist):

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
```

### Step 7.2 (Green) — repository

```typescript
// apps/api/src/common/git/integration/pull-request-tracking.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PullRequestTracking } from "./pull-request-tracking.entity";
import type { RecordOpenedPullRequestInput } from "./pull-request-tracking.repository.types";

/**
 * Persistence surface for `pull_request_tracking`. `recordOpenedPullRequest` is
 * find-or-create on the unique `(provider, owner, repo, pr_number)` identity so a
 * re-run of `merge_integrate` for the same head updates the row in place instead
 * of duplicating it. Neutral throughout — no kanban identifiers.
 */
@Injectable()
export class PullRequestTrackingRepository {
  constructor(
    @InjectRepository(PullRequestTracking)
    private readonly repository: Repository<PullRequestTracking>,
  ) {}

  async recordOpenedPullRequest(
    input: RecordOpenedPullRequestInput,
  ): Promise<PullRequestTracking> {
    const existing = await this.findByProviderIdentity(
      input.provider,
      input.owner,
      input.repo,
      input.prNumber,
    );

    if (existing) {
      existing.scope_id = input.scopeId;
      existing.context_id = input.contextId;
      existing.workflow_run_id = input.workflowRunId;
      existing.head_branch = input.headBranch;
      existing.base_branch = input.baseBranch;
      existing.pr_url = input.prUrl;
      existing.state = "open";
      return this.repository.save(existing);
    }

    const created = this.repository.create({
      provider: input.provider,
      owner: input.owner,
      repo: input.repo,
      pr_number: input.prNumber,
      scope_id: input.scopeId,
      context_id: input.contextId,
      workflow_run_id: input.workflowRunId,
      head_branch: input.headBranch,
      base_branch: input.baseBranch,
      pr_url: input.prUrl,
      state: "open",
      merge_commit_sha: null,
    });
    return this.repository.save(created);
  }

  findByProviderIdentity(
    provider: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestTracking | null> {
    return this.repository.findOne({
      where: { provider, owner, repo, pr_number: prNumber },
    });
  }
}
```

### Step 7.3 — register entity + repository in `DatabaseModule`

In `apps/api/src/database/database.module.ts` add `PullRequestTracking` to the `entities` array and `PullRequestTrackingRepository` to the `repositories` array (both are also exported via the existing `exports: [..., ...repositories]`). Add the two imports at the top.

Run (expect PASS) + verify the API still boots/builds:

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
npm run build:api
```

### Step 7.4 (Commit)

```bash
git add apps/api/src/common/git/integration/pull-request-tracking.entity.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.types.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts \
  apps/api/src/database/migrations/20260622HHmmss-create-pull-request-tracking.ts \
  apps/api/src/database/migrations/registered-migrations.ts \
  apps/api/src/database/database.module.ts
git commit -m "feat(api): pull_request_tracking entity, migration, and find-or-create repository

EPIC-209 Phase 3. Neutral (provider, owner, repo, pr_number) -> {scopeId,
contextId, workflowRunId, head, base, state} mapping. Unique provider identity +
state index. Idempotent recordOpenedPullRequest updates on re-run.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Branch `MergeIntegrateGitActionStrategy` on the resolved integration strategy

**Files**

- `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts` (EDIT)
- `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts` (NEW or EDIT)
- `apps/api/src/workflow/workflow-special-steps/workflow-special-steps.module.ts` (EDIT — inject the Phase-1 resolver, Phase-2 `MergeProviderFactory`, and Task-7 repository)

**Interfaces**

- Consumes: `IntegrationStrategyResolver.resolve(inputs)` (Phase 1, Section 10.2) → `ResolvedIntegrationConfig.strategy`; `MergeProviderFactory` (Phase 2) → `MergeProvider.openOrUpdatePullRequest(args)` (Section 10.1); `PullRequestTrackingRepository.recordOpenedPullRequest(input)` (Task 7); `GitMergeService` push helper for the feature branch.
- Produces: step output `merge_outcome: 'pull_request_opened'` + `pr_url` + `pr_number` (PR path), unchanged `merge_outcome: 'succeeded'` + commit fields (direct-push path).

### Step 8.1 (Red) — three tests: direct-push regression, pull-request path, idempotent re-run

> Read the existing strategy + its current spec first. Construct mocks for `GitMergeService`, `MergeBranchResolverService`, `IntegrationStrategyResolver`, `MergeProviderFactory`, and `PullRequestTrackingRepository`. The resolver/factory are NOT optional — the constructor gains them in 8.2.

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MergeIntegrateGitActionStrategy } from "./merge-integrate-git-action.strategy";

const triggerContext = {
  repositoryId: "scope-1",
  worktreeId: "context-1",
  branchConfig: { baseBranch: "main", targetBranch: "feature/x" },
};

function buildStrategy(
  overrides: Partial<{
    strategy: "direct-push" | "pull-request";
  }> = {},
) {
  const gitMergeService = {
    integrateAndPush: vi.fn().mockResolvedValue({
      outcome: "succeeded",
      sourceBranch: "feature/x",
      destinationBranch: "main",
      conflictedFiles: [],
      message: "ok",
      baseMergeCommit: "base-sha",
      mergeCommit: "merge-sha",
    }),
    pushFeatureBranch: vi.fn().mockResolvedValue(undefined),
  };
  const branchResolver = {
    resolve: vi.fn().mockResolvedValue({
      baseBranch: "main",
      targetBranch: "feature/x",
      worktreeId: "context-1",
      worktreePath: "/wt",
    }),
  };
  const integrationResolver = {
    resolve: vi.fn().mockReturnValue({
      strategy: overrides.strategy ?? "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    }),
  };
  const mergeProvider = {
    providerKey: "github",
    openOrUpdatePullRequest: vi.fn().mockResolvedValue({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    }),
    getPullRequestStatus: vi.fn(),
    mergePullRequest: vi.fn(),
  };
  const providerFactory = {
    resolveForRepository: vi.fn().mockReturnValue(mergeProvider),
  };
  const trackingRepo = {
    recordOpenedPullRequest: vi.fn().mockResolvedValue({ id: "row-1" }),
  };
  const strategy = new MergeIntegrateGitActionStrategy(
    gitMergeService as never,
    branchResolver as never,
    integrationResolver as never,
    providerFactory as never,
    trackingRepo as never,
  );
  return {
    strategy,
    gitMergeService,
    integrationResolver,
    mergeProvider,
    providerFactory,
    trackingRepo,
  };
}

describe("MergeIntegrateGitActionStrategy", () => {
  let workflowRunId: string;
  beforeEach(() => {
    workflowRunId = "11111111-1111-1111-1111-111111111111";
  });

  it("direct-push (regression): integrates and pushes to base, unchanged output", async () => {
    const { strategy, gitMergeService, mergeProvider, trackingRepo } =
      buildStrategy({ strategy: "direct-push" });

    const result = await strategy.execute({
      workflowRunId,
      stepId: "merge_integrate",
      triggerContext,
      resolvedStepInputs: {},
    });

    expect(gitMergeService.integrateAndPush).toHaveBeenCalledWith(
      "scope-1",
      "feature/x",
      "main",
    );
    expect(mergeProvider.openOrUpdatePullRequest).not.toHaveBeenCalled();
    expect(trackingRepo.recordOpenedPullRequest).not.toHaveBeenCalled();
    expect(result.output.merge_outcome).toBe("succeeded");
    expect(result.output.mergeCommit).toBe("merge-sha");
  });

  it("pull-request: pushes feature branch, opens PR, persists tracking, returns pr_url", async () => {
    const { strategy, gitMergeService, mergeProvider, trackingRepo } =
      buildStrategy({ strategy: "pull-request" });

    const result = await strategy.execute({
      workflowRunId,
      stepId: "merge_integrate",
      triggerContext,
      resolvedStepInputs: {
        repository_url: "https://github.com/acme/widgets.git",
        github_secret_id: "secret-1",
      },
    });

    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
    expect(gitMergeService.pushFeatureBranch).toHaveBeenCalledWith(
      "scope-1",
      "feature/x",
    );
    expect(mergeProvider.openOrUpdatePullRequest).toHaveBeenCalledTimes(1);
    expect(trackingRepo.recordOpenedPullRequest).toHaveBeenCalledTimes(1);
    expect(result.output.merge_outcome).toBe("pull_request_opened");
    expect(result.output.pr_url).toBe(
      "https://github.com/acme/widgets/pull/42",
    );
    expect(result.output.pr_number).toBe(42);
    expect(result.output.ok).toBe(true);
  });

  it("pull-request re-run: delegates to find-or-create (no duplicate insert)", async () => {
    const { strategy, trackingRepo } = buildStrategy({
      strategy: "pull-request",
    });

    await strategy.execute({
      workflowRunId,
      stepId: "merge_integrate",
      triggerContext,
      resolvedStepInputs: {
        repository_url: "https://github.com/acme/widgets.git",
        github_secret_id: "secret-1",
      },
    });

    const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
    expect(recordInput).toMatchObject({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      scopeId: "scope-1",
      contextId: "context-1",
      headBranch: "feature/x",
      baseBranch: "main",
    });
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- merge-integrate-git-action.strategy
```

> **`pushFeatureBranch` note:** the test mocks a `GitMergeService.pushFeatureBranch(scopeId, branch)` helper that does the hook-free feature-branch push (`git -c core.hooksPath=/dev/null push origin <branch>` against the resolved clone root, reusing `resolveGitRepoPath` + `resolveProjectGitAuthEnv`). If this helper does not yet exist on `GitMergeService`, add it under its own Red/Green micro-cycle FIRST (a focused spec asserting it pushes the feature branch hook-free and never touches base), then proceed. It must NOT alter `integrateAndPush`.

### Step 8.2 (Green) — branch the strategy

Rewrite `merge-integrate-git-action.strategy.ts` so the resolver decides the path; the direct-push branch is the existing code verbatim:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { GitMergeService } from "../../../common/git/git-merge.service";
import { IntegrationStrategyResolver } from "../../../common/git/integration/integration-strategy.resolver";
import { MergeProviderFactory } from "../../../common/git/integration/merge-provider.factory";
import { PullRequestTrackingRepository } from "../../../common/git/integration/pull-request-tracking.repository";
import { parseRepositoryIdentity } from "../../../common/git/integration/repository-identity.util";
import type { GitOperationAction } from "../step-git-operation-special-step.types";
import type { SpecialStepHandlerResult } from "../step-special-step.types";
import { getString } from "../step-git-operation-special-step.helpers";
import type { GitActionParams, GitActionStrategy } from "./git-action-strategy";
import { MergeBranchResolverService } from "./merge-branch-resolver.service";

const PULL_REQUEST_OPENED = "pull_request_opened";

@Injectable()
export class MergeIntegrateGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = "merge_integrate";
  private readonly logger = new Logger(MergeIntegrateGitActionStrategy.name);

  constructor(
    private readonly gitMergeService: GitMergeService,
    private readonly branchResolver: MergeBranchResolverService,
    private readonly integrationResolver: IntegrationStrategyResolver,
    private readonly providerFactory: MergeProviderFactory,
    private readonly trackingRepo: PullRequestTrackingRepository,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const { baseBranch, targetBranch } = await this.branchResolver.resolve(
      stepId,
      this.action,
      triggerContext,
      resolvedStepInputs,
    );

    const config = this.integrationResolver.resolve(resolvedStepInputs);
    if (config.strategy === "pull-request") {
      return this.openPullRequest({
        workflowRunId,
        stepId,
        triggerContext,
        resolvedStepInputs,
        baseBranch,
        targetBranch,
      });
    }

    // direct-push: existing behaviour, unchanged.
    this.logger.log(
      `git_operation [${stepId}]: integrating ${targetBranch} into ${baseBranch} for repository ${triggerContext.repositoryId} (hook-free push)`,
    );
    const mergeResult = await this.gitMergeService.integrateAndPush(
      triggerContext.repositoryId,
      targetBranch,
      baseBranch,
    );
    return {
      result: {
        status: "completed",
        mode: "git_operation",
        action: this.action,
      },
      output: {
        ok: mergeResult.outcome === "succeeded",
        stepId,
        action: this.action,
        merge_outcome: mergeResult.outcome,
        merge_message: mergeResult.message,
        auth_error_class: mergeResult.authErrorClass,
        base_branch: baseBranch,
        target_branch: targetBranch,
        source_branch: mergeResult.sourceBranch,
        destination_branch: mergeResult.destinationBranch,
        baseMergeCommit: mergeResult.baseMergeCommit,
        mergeCommit: mergeResult.mergeCommit,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }

  private async openPullRequest(params: {
    workflowRunId: string;
    stepId: string;
    triggerContext: GitActionParams["triggerContext"];
    resolvedStepInputs: Record<string, unknown>;
    baseBranch: string;
    targetBranch: string;
  }): Promise<SpecialStepHandlerResult> {
    const {
      workflowRunId,
      stepId,
      triggerContext,
      resolvedStepInputs,
      baseBranch,
      targetBranch,
    } = params;
    const repositoryUrl = getString(resolvedStepInputs, "repository_url");
    const githubSecretId = getString(resolvedStepInputs, "github_secret_id");
    if (!repositoryUrl || !githubSecretId) {
      throw new Error(
        `Step ${stepId}: pull-request strategy requires inputs.repository_url and inputs.github_secret_id`,
      );
    }

    await this.gitMergeService.pushFeatureBranch(
      triggerContext.repositoryId,
      targetBranch,
    );

    const provider = this.providerFactory.resolveForRepository(repositoryUrl);
    const ref = await provider.openOrUpdatePullRequest({
      scopeId: triggerContext.repositoryId,
      contextId: triggerContext.worktreeId ?? "",
      workflowRunId,
      repositoryUrl,
      githubSecretId,
      headBranch: targetBranch,
      baseBranch,
      title: `Integrate ${targetBranch} into ${baseBranch}`,
      body: `Automated pull request opened by the Nexus orchestration engine for scope ${triggerContext.repositoryId}.`,
    });

    await this.trackingRepo.recordOpenedPullRequest({
      provider: ref.provider,
      owner: ref.owner,
      repo: ref.repo,
      prNumber: ref.number,
      scopeId: triggerContext.repositoryId,
      contextId: triggerContext.worktreeId ?? "",
      workflowRunId,
      headBranch: targetBranch,
      baseBranch,
      prUrl: ref.url,
    });

    this.logger.log(
      `git_operation [${stepId}]: opened/updated PR ${ref.url} for ${triggerContext.repositoryId} (${targetBranch} -> ${baseBranch})`,
    );

    return {
      result: {
        status: "completed",
        mode: "git_operation",
        action: this.action,
      },
      output: {
        ok: true,
        stepId,
        action: this.action,
        merge_outcome: PULL_REQUEST_OPENED,
        pr_url: ref.url,
        pr_number: ref.number,
        pr_provider: ref.provider,
        base_branch: baseBranch,
        target_branch: targetBranch,
        source_branch: targetBranch,
        destination_branch: baseBranch,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }
}
```

> `parseRepositoryIdentity` / `MergeProviderFactory.resolveForRepository` shapes come from Phase 2. If Phase 2 exposes the factory under a different method name, match the actual Phase-2 export — do not invent. The `ref` returned by `openOrUpdatePullRequest` already carries `owner`/`repo`/`number`/`url` (Section 10.1 `PullRequestRef`), so the strategy persists from the ref and does not re-parse the URL itself.

### Step 8.3 — wire the module

In `workflow-special-steps.module.ts` ensure `IntegrationStrategyResolver`, `MergeProviderFactory`, and `PullRequestTrackingRepository` are resolvable for `MergeIntegrateGitActionStrategy`. The repository is exported by `DatabaseModule` (already imported by this module). The resolver/factory are provided/exported by the Phase-1/2 module that owns `apps/api/src/common/git/integration/` (likely `GitWorktreeModule` or a dedicated integration module) — import that module here. Add any not-yet-provided integration providers to the module's `providers` array.

Run (expect PASS) + full API typecheck:

```bash
npm run test --workspace=apps/api -- merge-integrate-git-action.strategy
npm run build:api
```

### Step 8.4 (Commit)

```bash
git add apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts \
  apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts \
  apps/api/src/workflow/workflow-special-steps/workflow-special-steps.module.ts
git commit -m "feat(api): route merge_integrate on integration strategy (direct-push vs pull-request)

EPIC-209 Phase 3. pull-request pushes the feature branch, opens/updates a PR via
the provider factory, persists pull_request_tracking, and returns
merge_outcome=pull_request_opened + pr_url/pr_number. direct-push unchanged
(regression-tested). Neutral scopeId/contextId only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — `GitMergeService.pushFeatureBranch` (only if not added inline in Task 8.1)

**Files**

- `apps/api/src/common/git/git-merge.service.ts` (EDIT)
- `apps/api/src/common/git/git-merge.service.spec.ts` (NEW or EDIT)

**Interfaces**

- Produces: `pushFeatureBranch(scopeId, branch): Promise<void>` — hook-free push of the feature branch to origin. Consumed by Task 8.

> If you already shipped this in Task 8.1's micro-cycle, skip Task 9. Otherwise:

### Step 9.1 (Red)

Spec asserts `pushFeatureBranch` resolves the clone root, resolves auth env, and runs `push origin <branch>` hook-free, never touching the base branch and never calling `integrateAndPush`. Mock `resolveGitRepoPath`, `authEnvResolver`, and `runGit`.

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- git-merge.service
```

### Step 9.2 (Green)

```typescript
/**
 * Push the already-committed feature branch to origin hook-free. Used by the
 * pull-request integration strategy: the PR opens against the pushed head while
 * the base branch is never modified by the engine.
 */
async pushFeatureBranch(scopeId: string, branch: string): Promise<void> {
  const cloneRoot = await this.resolveGitRepoPath(scopeId);
  if (!cloneRoot) {
    throw new BadRequestException(
      `Repository path is not a git repository: ${scopeId}`,
    );
  }
  const authEnv = await this.authEnvResolver.resolveProjectGitAuthEnv(scopeId);
  await this.runGit(
    cloneRoot,
    ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', branch],
    authEnv,
  );
}
```

Run (expect PASS), commit:

```bash
npm run test --workspace=apps/api -- git-merge.service
git add apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "feat(api): GitMergeService.pushFeatureBranch (hook-free feature push for PR strategy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — Seed workflow: strategy branch + PR lifecycle path

**Files**

- `seed/workflows/work-item-ready-to-merge-default.workflow.yaml` (EDIT)

**Interfaces**

- Consumes: trigger key `{{ trigger.integration_strategy }}` (Section 10.6, forwarded by Phase 1 kanban side); the strategy's `merge_outcome == 'pull_request_opened'` + `pr_url` outputs (Task 8); the new `awaiting-pr-merge` status (Task 1).
- Produces: PR-repo work items parked in `awaiting-pr-merge` with `lifecycle.merge` recording the PR URL.

### Step 10.1 — author the branch (no unit test; validated by `validate:seed-data`)

After the existing `merge_integrate` job, branch its `succeeded` transition on the strategy. Because `merge_outcome` for the PR path is `pull_request_opened` (Task 8) and for direct-push is `succeeded`, the cleanest split is on the strategy value at the transition out of `merge_integrate`:

1. Add `integration_strategy`, `repository_url`, and `github_secret_id` inputs to the `merge_integrate` job (forwarded from the trigger payload — neutral VCS keys per Section 10.6):

```yaml
- id: merge_integrate
  type: git_operation
  tier: light
  depends_on: [quality_gate]
  inputs:
    action: merge_integrate
    repository_id: "{{ trigger.scopeId }}"
    worktree_id: "{{ trigger.contextId }}"
    base_branch: "{{ trigger.resource.executionConfig.baseBranch }}"
    target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
    integration_strategy: "{{ trigger.integration_strategy }}"
    repository_url: "{{ trigger.repository_url }}"
    github_secret_id: "{{ trigger.github_secret_id }}"
  transitions:
    - condition: "jobs.merge_integrate.output.merge_outcome == 'succeeded'"
      next: record_merge_metadata_clean
    - condition: "jobs.merge_integrate.output.merge_outcome == 'pull_request_opened'"
      next: record_pr_metadata
    - condition: "jobs.merge_integrate.output.merge_outcome == 'conflict'"
      next: resolve_remote_conflicts
    - condition: "jobs.merge_integrate.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.merge_integrate.output.merge_outcome == 'failed'"
      next: emit_merge_failed
```

2. New PR-path jobs (the direct-push `record_merge_metadata_clean` → `transition_done_clean` chain is untouched):

```yaml
  - id: record_pr_metadata
    type: mcp_tool_call
    tier: light
    depends_on: [merge_integrate]
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.work_item_patch_metadata
      params:
        project_id: "{{ trigger.scopeId }}"
        workItemId: "{{ trigger.contextId }}"
        metadataPatch:
          lifecycle:
            merge:
              status: pull_request_opened
              strategy: pull-request
              prUrl: "{{ jobs.merge_integrate.output.pr_url }}"
              prNumber: "{{ jobs.merge_integrate.output.pr_number }}"
              sourceBranch: "{{ jobs.merge_integrate.output.source_branch }}"
              destinationBranch: "{{ jobs.merge_integrate.output.destination_branch }}"
      policy: *kanban_mcp_policy

  - id: transition_awaiting_pr_merge
    type: mcp_tool_call
    tier: light
    depends_on: [record_pr_metadata]
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.work_item_transition_status
      params:
        project_id: "{{ trigger.scopeId }}"
        workItemId: "{{ trigger.contextId }}"
        status: awaiting-pr-merge
        suppressAutomation: true
      policy: *kanban_mcp_policy

  - id: emit_pr_opened
    type: emit_event
    tier: light
    depends_on: [transition_awaiting_pr_merge]
    inputs:
      event_name: WorkItemPullRequestOpenedEvent
      payload:
        scopeId: "{{ trigger.scopeId }}"
        contextId: "{{ trigger.contextId }}"
        baseBranch: "{{ trigger.resource.executionConfig.baseBranch }}"
        targetBranch: "{{ trigger.resource.executionConfig.targetBranch }}"
        prUrl: "{{ jobs.merge_integrate.output.pr_url }}"
        prNumber: "{{ jobs.merge_integrate.output.pr_number }}"
```

> Do NOT remove the worktree on the PR path — the feature branch must remain pushed and the worktree may still be needed if a Phase-4 reconciler observes the PR closed-unmerged. Worktree cleanup for the PR path is Phase 4 (on observed merge). The direct-push cleanup chain stays exactly as-is.
> `WorkItemPullRequestOpenedEvent` is emitted as a neutral lifecycle breadcrumb; wiring a consumer for it is Phase 4 scope.

### Step 10.2 — validate

```bash
npm run validate:seed-data
```

Expected: PASS (DAG resolves; `awaiting-pr-merge` accepted by the transition tool since Task 2 added it to `SUPPORTED_WORK_ITEM_STATUSES`).

### Step 10.3 (Commit)

```bash
git add seed/workflows/work-item-ready-to-merge-default.workflow.yaml
git commit -m "feat(seed): branch ready-to-merge workflow on integration strategy (PR path -> awaiting-pr-merge)

EPIC-209 Phase 3. pull_request_opened outcome records PR URL into lifecycle.merge
and parks the item in awaiting-pr-merge. direct-push path unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — Full regression sweep + boundary lint

**Files** — none (verification only).

```bash
npm run build --workspace=packages/kanban-contracts
npm run build:api
npm run build:kanban
npm run build --workspace=apps/web
npm run test --workspace=apps/api
npm run test --workspace=apps/kanban
npm run test:unit:web
npm run lint:api
npm run lint:kanban
npm run validate:seed-data
```

Expected: all green. Confirm `nexus-boundaries/no-core-kanban-residue` raises **no** finding against the new `apps/api/src/common/git/integration/*` files or the strategy edit (they contain only `scopeId`/`contextId` and VCS terms). If it flags anything, fix the residue in code — do not add an allowlist or `eslint-disable`.

Final commit if any lint-driven fixes were needed:

```bash
git add -A
git commit -m "chore(epic-209): phase 3 regression sweep and boundary verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes on decisions deliberately deferred

- **`PROJECT_DISPATCH_ACTIVE_STATUSES` (`apps/kanban/src/dispatch/project-dispatch-capacity.ts`):** `awaiting-pr-merge` is **NOT** added — per spec Decision 6 the item is not-stuck and must not consume a dispatch slot. No change in Phase 3.
- **Settings descriptions / docs / `WORKFLOW_EVENT_TRIGGERS.md`:** doc-only; update opportunistically but they are not behaviour and have no test. Not gated here.
- **`work-item-awaiting-pr-merge-default` workflow:** Phase 4 (it consumes the parked state + tracking rows). Do not create it in Phase 3.

---

## Phase boundary — what Phase 4 consumes from Phase 3

Phase 3 leaves two durable handoffs that Phase 4 builds on:

1. **`pull_request_tracking` rows** (API-side, neutral): every opened/updated PR has a row keyed by the unique `(provider, owner, repo, pr_number)` identity, mapping to `{scopeId, contextId, workflowRunId, head_branch, base_branch, pr_url, state: 'open', merge_commit_sha: null}`. Phase 4's PR webhook controller and poll reconciler look up rows by provider identity (`findByProviderIdentity`) and by `state` (the `idx_pull_request_tracking_state` index), flip `state → 'merged'`, set `merge_commit_sha`, and emit the neutral `core.integration.pr_merged.v1` event (Section 10.5) carrying `{scopeId, contextId, prUrl, mergeCommitSha}`.
2. **`awaiting-pr-merge` lifecycle state:** work items routed through the PR path now sit in `awaiting-pr-merge` (completed group, branch-owning, completed-strategic). Phase 4's kanban `core-lifecycle-stream.consumer` handler for `pr_merged` transitions `awaiting-pr-merge → done`, records `mergeCommit` in `lifecycle.merge`, and performs the deferred PR-path worktree cleanup.

Phase 3 ships none of the observation/closure machinery — it only opens the PR, persists the mapping, and parks the item. `direct-push` repositories remain byte-for-byte unchanged.
