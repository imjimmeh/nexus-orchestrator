# Work Item Types + Story Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give work items a first-class `type` (`epic | story | task | bug | spike`), a self-referencing `parent_work_item_id`, and Fibonacci `story_points`; make dispatch skip any container (an `epic`, or anything with children); and surface all of it through estimation/decomposition workflows and the web board.

**Architecture:** All changes are Kanban-side (`apps/kanban`, `packages/kanban-contracts`, `apps/web`). A single pure module (`work-item-type.rules.ts`) is the only place type literals live. Dispatchability becomes a function of shape — `type !== 'epic' && !hasChildren` — enforced at the dispatch core plus every "dispatchable todo" read predicate. `scope` is removed; `story_points` replaces it as the sizing signal.

**Tech Stack:** TypeScript, NestJS, TypeORM (Postgres), Zod (`@nexus/kanban-contracts`), Vitest, Vite + React + Tailwind (web), YAML seed workflows.

## Global Constraints

- **Boundary:** No `type`, `epic`, `story`, `story_points`, `parent`, or hierarchy vocabulary may appear in `apps/api/src` or `packages/core/src` (tests, migrations, fixtures, comments included). `nexus-boundaries/no-core-kanban-residue` must stay green — no allowlists, no `eslint-disable`. Verify with `npm run lint:kanban` and `npm run lint:api`.
- **No lint suppression:** never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`. Fix in code.
- **Type set (verbatim):** `epic | story | task | bug | spike`.
- **Fibonacci set (verbatim):** `1, 2, 3, 5, 8, 13`. `13` is the "too big" sentinel.
- **Dispatch rule (verbatim):** `isDispatchable = type !== 'epic' && hasChildWorkItems === false`.
- **Default type on create/migrate (verbatim):** `story`.
- **Parent matrix (verbatim):** `epic → {story,task,bug,spike}`; `story → {task,bug,spike}`; `task|bug|spike → nothing`; nothing → `epic`.
- **TDD:** every task is Red → Green → Refactor → Commit. Build `@nexus/kanban-contracts` before running kanban tests that consume new contract exports: `npm run build --workspace=packages/kanban-contracts`.
- **NestJS build:** use `nest build` / workspace scripts, never bare `tsc`.
- **Commit style:** conventional commits, one per task step-5.

---

## File Structure

**`packages/kanban-contracts/src/`**

- `work-item-type.ts` (create) — `WorkItemTypeSchema`, `WorkItemType`, `WORK_ITEM_TYPES`, `STORY_POINT_VALUES`, `StoryPointsSchema`.
- `work-item.schema.ts` (modify) — add `type`/`parentWorkItemId`/`storyPoints`/derived read fields; remove `WorkItemScopeSchema` + all `scope`.

**`apps/kanban/src/work-item/`**

- `work-item-type.rules.ts` (create) — pure predicates: `isEpicType`, `canHaveChildren`, `canParent`, `allowsStoryPoints`, `isDispatchable`.
- `work-item-invariants.ts` (create) — `assertWorkItemInvariants(...)` throwing `BadRequestException`.
- `work-item.factory.ts` (modify) — defaults gain `type: "story"`, `parent_work_item_id: null`, `story_points: null`; drop `scope`.
- `work-item.service.ts` (modify) — call invariants on create/update; wire promotion detach.
- `work-item.service.helpers.ts` / `work-item-run.helpers.ts` (modify) — patch shape gains new fields; `toWorkItemRecord` maps them + derived `hasChildren`/`rolledUpPoints`.

**`apps/kanban/src/database/`**

- `entities/kanban-work-item.entity.ts` (modify) — add columns, drop `scope`.
- `repositories/kanban-work-item.repository.ts` (modify) — `existsChildrenFor(ids)`, `findChildIds(id)`, `computeRolledUpPoints(...)`.
- `migrations/20260706120000-add-work-item-type-points-hierarchy.ts` (create).

**`apps/kanban/src/dispatch/`**

- `dispatch-internal.types.ts` (modify) — `WorkItemRecord` gains `type`, `parent_work_item_id`.
- `dispatch-container.helper.ts` (create) — `isContainerCandidate(item, childrenIndex)`.
- `dispatch-work-items.core.ts` (modify) — build a children index; gate in `processCandidate`.
- `dispatch.service.types.ts` (modify) — `PreFlightSkip.reason` union gains `container_not_dispatchable` (actually a pre-preflight skip; see Task 8).

**`apps/kanban/src/orchestration/` + `mcp/tools/read/`** (modify) — apply `isDispatchable` in the five read predicates.

**Workflows (Phase 4):** `apps/kanban/src/**/seed/**` YAML + `propose-work-items.tool.ts`, `work-item-resolve-umbrella-parent.tool.ts`, an estimation tool.

**Web (Phase 5):** `apps/web/src/**` board card, point chip, hierarchy, filter, create form.

---

# Phase 1 — Contracts & type rules (no behavior change yet)

### Task 1: Work item type + story-point contracts

**Files:**

- Create: `packages/kanban-contracts/src/work-item-type.ts`
- Test: `packages/kanban-contracts/src/work-item-type.spec.ts`
- Modify: `packages/kanban-contracts/src/index.ts` (add exports)

**Interfaces:**

- Produces: `WORK_ITEM_TYPES: readonly ["epic","story","task","bug","spike"]`, `WorkItemTypeSchema`, `type WorkItemType`, `STORY_POINT_VALUES: readonly [1,2,3,5,8,13]`, `StoryPointsSchema` (`z.union` of literals), `type StoryPoints`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/kanban-contracts/src/work-item-type.spec.ts
import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_TYPES,
  WorkItemTypeSchema,
  STORY_POINT_VALUES,
  StoryPointsSchema,
} from "./work-item-type";

describe("work item type contract", () => {
  it("enumerates exactly the five types", () => {
    expect([...WORK_ITEM_TYPES]).toEqual([
      "epic",
      "story",
      "task",
      "bug",
      "spike",
    ]);
  });

  it("rejects unknown types", () => {
    expect(WorkItemTypeSchema.safeParse("initiative").success).toBe(false);
    expect(WorkItemTypeSchema.parse("story")).toBe("story");
  });

  it("accepts only Fibonacci story points", () => {
    expect([...STORY_POINT_VALUES]).toEqual([1, 2, 3, 5, 8, 13]);
    for (const v of STORY_POINT_VALUES) {
      expect(StoryPointsSchema.parse(v)).toBe(v);
    }
    expect(StoryPointsSchema.safeParse(4).success).toBe(false);
    expect(StoryPointsSchema.safeParse(0).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- work-item-type`
Expected: FAIL — cannot resolve `./work-item-type`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/kanban-contracts/src/work-item-type.ts
import { z } from "zod";

export const WORK_ITEM_TYPES = [
  "epic",
  "story",
  "task",
  "bug",
  "spike",
] as const;

export const WorkItemTypeSchema = z.enum(WORK_ITEM_TYPES);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

export const StoryPointsSchema = z.union(
  STORY_POINT_VALUES.map((v) => z.literal(v)) as [
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<3>,
    z.ZodLiteral<5>,
    z.ZodLiteral<8>,
    z.ZodLiteral<13>,
  ],
);
export type StoryPoints = z.infer<typeof StoryPointsSchema>;
```

Add to `packages/kanban-contracts/src/index.ts`:

```ts
export * from "./work-item-type";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/kanban-contracts -- work-item-type`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-contracts/src/work-item-type.ts packages/kanban-contracts/src/work-item-type.spec.ts packages/kanban-contracts/src/index.ts
git commit -m "feat(kanban-contracts): add work item type + story point schemas"
```

---

### Task 2: Wire type/points/parent into work-item schemas; remove `scope`

**Files:**

- Modify: `packages/kanban-contracts/src/work-item.schema.ts`
- Test: `packages/kanban-contracts/src/work-item.schema.spec.ts` (create if absent; otherwise extend)

**Interfaces:**

- Consumes: `WorkItemTypeSchema`, `StoryPointsSchema` (Task 1).
- Produces: `WorkItemRecordSchema` / `WorkItemSchema` with `type`, `parentWorkItemId`, `storyPoints`, and read-only derived `hasChildren`, `rolledUpPoints`; `CreateWorkItemInputSchema` / `CreateWorkItemRequestSchema` / `UpdateWorkItemRequestSchema` with `type?`, `parentWorkItemId?`, `storyPoints?`. `WorkItemScopeSchema` **removed**.

- [ ] **Step 1: Write the failing test**

```ts
// packages/kanban-contracts/src/work-item.schema.spec.ts
import { describe, expect, it } from "vitest";
import {
  CreateWorkItemInputSchema,
  WorkItemRecordSchema,
} from "./work-item.schema";

describe("work item schema with types", () => {
  it("accepts type + storyPoints + parentWorkItemId on create", () => {
    const parsed = CreateWorkItemInputSchema.parse({
      title: "Add login",
      type: "task",
      storyPoints: 3,
      parentWorkItemId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed.type).toBe("task");
    expect(parsed.storyPoints).toBe(3);
  });

  it("rejects non-Fibonacci storyPoints", () => {
    expect(
      CreateWorkItemInputSchema.safeParse({ title: "x", storyPoints: 4 })
        .success,
    ).toBe(false);
  });

  it("exposes derived hasChildren + rolledUpPoints on the record", () => {
    const rec = WorkItemRecordSchema.parse({
      id: "a",
      project_id: "p",
      title: "Epic",
      status: "todo",
      type: "epic",
      hasChildren: true,
      rolledUpPoints: 8,
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      linkedRunId: null,
    });
    expect(rec.hasChildren).toBe(true);
    expect(rec.rolledUpPoints).toBe(8);
  });

  it("no longer accepts scope", () => {
    const parsed = CreateWorkItemInputSchema.safeParse({
      title: "x",
      scope: "large",
    });
    expect(parsed.success).toBe(false); // .strict() rejects unknown key
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- work-item.schema`
Expected: FAIL — `type`/`storyPoints` unknown (strict) and `scope` still allowed.

- [ ] **Step 3: Write minimal implementation**

In `work-item.schema.ts`:

1. Add import at top:

```ts
import { WorkItemTypeSchema, StoryPointsSchema } from "./work-item-type";
```

2. Delete `export const WorkItemScopeSchema = z.enum(["standard", "large"]);` (line 29).

3. In `WorkItemRecordSchema` (`.strict()` object): remove the `scope: WorkItemScopeSchema.optional(),` line and add:

```ts
    type: WorkItemTypeSchema,
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
    hasChildren: z.boolean().optional(),
    rolledUpPoints: z.number().nullable().optional(),
```

4. In `WorkItemSchema`: remove `scope: WorkItemScopeSchema,` and add the same `type` (required), `parentWorkItemId`, `storyPoints`, `hasChildren`, `rolledUpPoints` lines.

5. In `CreateWorkItemInputSchema`: remove `scope: WorkItemScopeSchema.optional(),` and add:

```ts
    type: WorkItemTypeSchema.optional(),
    parentWorkItemId: z.string().nullable().optional(),
    storyPoints: StoryPointsSchema.nullable().optional(),
```

6. In `CreateWorkItemRequestSchema` and `UpdateWorkItemRequestSchema`: remove `scope: WorkItemScopeSchema.optional(),`; add `type: WorkItemTypeSchema.optional(),`, `parentWorkItemId: z.string().nullable().optional(),`, `storyPoints: StoryPointsSchema.nullable().optional(),`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build --workspace=packages/kanban-contracts && npm run test --workspace=packages/kanban-contracts -- work-item.schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-contracts/src/work-item.schema.ts packages/kanban-contracts/src/work-item.schema.spec.ts
git commit -m "feat(kanban-contracts): add type/points/parent to work item schemas, drop scope"
```

---

### Task 3: Type-rules registry (pure predicates)

**Files:**

- Create: `apps/kanban/src/work-item/work-item-type.rules.ts`
- Test: `apps/kanban/src/work-item/work-item-type.rules.spec.ts`

**Interfaces:**

- Consumes: `WorkItemType` (Task 1).
- Produces:
  - `isEpicType(type: WorkItemType): boolean`
  - `canHaveChildren(type: WorkItemType): boolean` — `epic | story`
  - `canParent(parent: WorkItemType, child: WorkItemType): boolean`
  - `allowsStoryPoints(type: WorkItemType): boolean` — everything except `epic`
  - `isDispatchable(type: WorkItemType, hasChildren: boolean): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item-type.rules.spec.ts
import { describe, expect, it } from "vitest";
import {
  isEpicType,
  canHaveChildren,
  canParent,
  allowsStoryPoints,
  isDispatchable,
} from "./work-item-type.rules";

describe("work-item-type.rules", () => {
  it("epic is the only always-container type", () => {
    expect(isEpicType("epic")).toBe(true);
    expect(isEpicType("story")).toBe(false);
    expect(canHaveChildren("epic")).toBe(true);
    expect(canHaveChildren("story")).toBe(true);
    expect(canHaveChildren("task")).toBe(false);
  });

  it("enforces the parent matrix", () => {
    expect(canParent("epic", "story")).toBe(true);
    expect(canParent("epic", "task")).toBe(true);
    expect(canParent("story", "task")).toBe(true);
    expect(canParent("story", "story")).toBe(false);
    expect(canParent("epic", "epic")).toBe(false);
    expect(canParent("task", "bug")).toBe(false);
  });

  it("forbids points only on epics", () => {
    expect(allowsStoryPoints("epic")).toBe(false);
    expect(allowsStoryPoints("story")).toBe(true);
    expect(allowsStoryPoints("spike")).toBe(true);
  });

  it("dispatchable = not epic AND no children", () => {
    expect(isDispatchable("epic", false)).toBe(false);
    expect(isDispatchable("story", false)).toBe(true);
    expect(isDispatchable("story", true)).toBe(false);
    expect(isDispatchable("task", false)).toBe(true);
    expect(isDispatchable("task", true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-type.rules`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/kanban/src/work-item/work-item-type.rules.ts
import type { WorkItemType } from "@nexus/kanban-contracts";

const CONTAINER_CAPABLE: ReadonlySet<WorkItemType> = new Set(["epic", "story"]);

const PARENT_TO_CHILDREN: Readonly<
  Record<WorkItemType, ReadonlySet<WorkItemType>>
> = {
  epic: new Set(["story", "task", "bug", "spike"]),
  story: new Set(["task", "bug", "spike"]),
  task: new Set(),
  bug: new Set(),
  spike: new Set(),
};

export function isEpicType(type: WorkItemType): boolean {
  return type === "epic";
}

export function canHaveChildren(type: WorkItemType): boolean {
  return CONTAINER_CAPABLE.has(type);
}

export function canParent(parent: WorkItemType, child: WorkItemType): boolean {
  if (child === "epic") return false;
  return PARENT_TO_CHILDREN[parent].has(child);
}

export function allowsStoryPoints(type: WorkItemType): boolean {
  return type !== "epic";
}

export function isDispatchable(
  type: WorkItemType,
  hasChildren: boolean,
): boolean {
  return type !== "epic" && hasChildren === false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build --workspace=packages/kanban-contracts && npm run test --workspace=apps/kanban -- work-item-type.rules`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item-type.rules.ts apps/kanban/src/work-item/work-item-type.rules.spec.ts
git commit -m "feat(kanban): add work item type rules registry"
```

---

# Phase 2 — Persistence, invariants & derived reads

### Task 4: Entity + factory columns; migration

**Files:**

- Modify: `apps/kanban/src/database/entities/kanban-work-item.entity.ts`
- Modify: `apps/kanban/src/work-item/work-item.factory.ts`
- Create: `apps/kanban/src/database/migrations/20260706120000-add-work-item-type-points-hierarchy.ts`
- Test: `apps/kanban/src/work-item/work-item.factory.spec.ts` (extend if present; else create)

**Interfaces:**

- Produces: entity columns `type: string` (default `"story"`), `parent_work_item_id: string | null`, `story_points: number | null`; `scope` removed. `KANBAN_WORK_ITEM_CREATE_DEFAULTS` gains `type: "story"`, `parent_work_item_id: null`, `story_points: null`, drops `scope`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item.factory.spec.ts
import { describe, expect, it } from "vitest";
import {
  KANBAN_WORK_ITEM_CREATE_DEFAULTS,
  toCreateEntity,
} from "./work-item.factory";

describe("work item factory defaults", () => {
  it("defaults type to story with null parent/points and no scope", () => {
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.type).toBe("story");
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.parent_work_item_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.story_points).toBeNull();
    expect("scope" in KANBAN_WORK_ITEM_CREATE_DEFAULTS).toBe(false);
  });

  it("merges overrides over defaults", () => {
    const shape = toCreateEntity({
      id: "1",
      project_id: "p",
      title: "t",
      status: "backlog",
      type: "epic",
    });
    expect(shape.type).toBe("epic");
    expect(shape.priority).toBe("p2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item.factory`
Expected: FAIL — `type` missing, `scope` present.

- [ ] **Step 3: Write minimal implementation**

Entity (`kanban-work-item.entity.ts`): replace the `scope` column (lines 31-32) with:

```ts
  @Column({ type: "varchar", length: 16, default: "story" })
  type!: string;

  @Column({ name: "parent_work_item_id", type: "uuid", nullable: true })
  @Index("idx_kanban_work_items_parent")
  parent_work_item_id!: string | null;

  @Column({ name: "story_points", type: "smallint", nullable: true })
  story_points!: number | null;
```

Factory (`work-item.factory.ts`): in `KANBAN_WORK_ITEM_CREATE_DEFAULTS`, remove `scope: "standard",` and add:

```ts
  type: "story",
  parent_work_item_id: null,
  story_points: null,
```

Migration:

```ts
// apps/kanban/src/database/migrations/20260706120000-add-work-item-type-points-hierarchy.ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemTypePointsHierarchy20260706120000 implements MigrationInterface {
  name = "AddWorkItemTypePointsHierarchy20260706120000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT 'story',
        ADD COLUMN IF NOT EXISTS parent_work_item_id uuid NULL
          REFERENCES kanban_work_items(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS story_points smallint NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_items_parent
        ON kanban_work_items(parent_work_item_id)
    `);

    // Preserve existing split hierarchies: children referenced by a parent's
    // metadata.split.proposedChildIds become type=task parented to that item.
    await queryRunner.query(`
      UPDATE kanban_work_items child
      SET type = 'task',
          parent_work_item_id = parent.id
      FROM kanban_work_items parent
      WHERE parent.metadata -> 'split' -> 'proposedChildIds' ? child.id
    `);

    await queryRunner.query(
      `ALTER TABLE kanban_work_items DROP COLUMN IF EXISTS scope`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        ADD COLUMN IF NOT EXISTS scope varchar(10) NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_kanban_work_items_parent`,
    );
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        DROP COLUMN IF EXISTS story_points,
        DROP COLUMN IF EXISTS parent_work_item_id,
        DROP COLUMN IF EXISTS type
    `);
  }
}
```

> Confirm the migration glob picks this file up: check the `migrations` array/glob in `apps/kanban`'s TypeORM datasource config and register if it uses an explicit list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item.factory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-work-item.entity.ts apps/kanban/src/work-item/work-item.factory.ts apps/kanban/src/database/migrations/20260706120000-add-work-item-type-points-hierarchy.ts apps/kanban/src/work-item/work-item.factory.spec.ts
git commit -m "feat(kanban): add type/parent/story_points columns + migration, drop scope"
```

---

### Task 5: Invariant guard

**Files:**

- Create: `apps/kanban/src/work-item/work-item-invariants.ts`
- Test: `apps/kanban/src/work-item/work-item-invariants.spec.ts`

**Interfaces:**

- Consumes: `canParent`, `allowsStoryPoints`, `isEpicType` (Task 3); `StoryPointsSchema` (Task 1).
- Produces: `assertWorkItemInvariants(input: WorkItemInvariantInput): void` throwing `BadRequestException`. `WorkItemInvariantInput = { type: WorkItemType; storyPoints?: number | null; parentType?: WorkItemType | null }` — `parentType` is the resolved parent's type (or `null` for standalone).

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item-invariants.spec.ts
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertWorkItemInvariants } from "./work-item-invariants";

describe("assertWorkItemInvariants", () => {
  it("passes a standalone story with valid points", () => {
    expect(() =>
      assertWorkItemInvariants({
        type: "story",
        storyPoints: 5,
        parentType: null,
      }),
    ).not.toThrow();
  });

  it("rejects points on an epic", () => {
    expect(() =>
      assertWorkItemInvariants({
        type: "epic",
        storyPoints: 3,
        parentType: null,
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects an epic with a parent", () => {
    expect(() =>
      assertWorkItemInvariants({ type: "epic", parentType: "epic" }),
    ).toThrow(BadRequestException);
  });

  it("rejects a disallowed parent/child pairing", () => {
    expect(() =>
      assertWorkItemInvariants({ type: "task", parentType: "task" }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertWorkItemInvariants({ type: "story", parentType: "story" }),
    ).toThrow(BadRequestException);
  });

  it("rejects non-Fibonacci points", () => {
    expect(() =>
      assertWorkItemInvariants({
        type: "task",
        storyPoints: 4,
        parentType: null,
      }),
    ).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-invariants`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/kanban/src/work-item/work-item-invariants.ts
import { BadRequestException } from "@nestjs/common";
import { StoryPointsSchema, type WorkItemType } from "@nexus/kanban-contracts";
import { allowsStoryPoints, canParent } from "./work-item-type.rules";

export interface WorkItemInvariantInput {
  type: WorkItemType;
  storyPoints?: number | null;
  parentType?: WorkItemType | null;
}

export function assertWorkItemInvariants(input: WorkItemInvariantInput): void {
  const { type, storyPoints, parentType } = input;

  if (storyPoints !== undefined && storyPoints !== null) {
    if (!allowsStoryPoints(type)) {
      throw new BadRequestException(
        `story points are not allowed on ${type} items`,
      );
    }
    if (!StoryPointsSchema.safeParse(storyPoints).success) {
      throw new BadRequestException(
        `story points must be one of 1, 2, 3, 5, 8, 13`,
      );
    }
  }

  if (parentType !== undefined && parentType !== null) {
    if (type === "epic") {
      throw new BadRequestException("an epic cannot have a parent");
    }
    if (!canParent(parentType, type)) {
      throw new BadRequestException(`a ${parentType} cannot parent a ${type}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-invariants`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item-invariants.ts apps/kanban/src/work-item/work-item-invariants.spec.ts
git commit -m "feat(kanban): add work item invariant guard"
```

---

### Task 6: Repository — children existence + rollup points

**Files:**

- Modify: `apps/kanban/src/database/repositories/kanban-work-item.repository.ts`
- Test: `apps/kanban/src/database/repositories/kanban-work-item.repository.spec.ts` (extend; else create)

**Interfaces:**

- Produces on `KanbanWorkItemRepository`:
  - `existsChildrenFor(parentIds: string[]): Promise<Set<string>>` — subset of `parentIds` that have ≥1 child.
  - `findChildIds(parentId: string): Promise<string[]>`
  - `computeRolledUpPoints(parentId: string): Promise<number | null>` — recursive sum of descendants' `story_points` (null when no pointed descendants).

- [ ] **Step 1: Write the failing test**

```ts
// excerpt — add to kanban-work-item.repository.spec.ts
it("existsChildrenFor returns only parents that have children", async () => {
  const epic = await repo.save(makeItem({ type: "epic" }));
  await repo.save(makeItem({ type: "task", parent_work_item_id: epic.id }));
  const lone = await repo.save(makeItem({ type: "task" }));

  const withChildren = await repo.existsChildrenFor([epic.id, lone.id]);
  expect(withChildren.has(epic.id)).toBe(true);
  expect(withChildren.has(lone.id)).toBe(false);
});

it("computeRolledUpPoints sums descendant points", async () => {
  const epic = await repo.save(makeItem({ type: "epic" }));
  const story = await repo.save(
    makeItem({ type: "story", parent_work_item_id: epic.id, story_points: 5 }),
  );
  await repo.save(
    makeItem({ type: "task", parent_work_item_id: story.id, story_points: 3 }),
  );
  expect(await repo.computeRolledUpPoints(epic.id)).toBe(8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item.repository`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Write minimal implementation**

Add to the repository class (adjust to the repo's existing `this.repo`/`manager` access pattern):

```ts
  async existsChildrenFor(parentIds: string[]): Promise<Set<string>> {
    if (parentIds.length === 0) return new Set();
    const rows = await this.repo
      .createQueryBuilder("wi")
      .select("DISTINCT wi.parent_work_item_id", "parentId")
      .where("wi.parent_work_item_id IN (:...parentIds)", { parentIds })
      .getRawMany<{ parentId: string }>();
    return new Set(rows.map((r) => r.parentId));
  }

  async findChildIds(parentId: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder("wi")
      .select("wi.id", "id")
      .where("wi.parent_work_item_id = :parentId", { parentId })
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  async computeRolledUpPoints(parentId: string): Promise<number | null> {
    const result = await this.repo.query(
      `
      WITH RECURSIVE descendants AS (
        SELECT id, story_points FROM kanban_work_items
          WHERE parent_work_item_id = $1
        UNION ALL
        SELECT c.id, c.story_points FROM kanban_work_items c
          JOIN descendants d ON c.parent_work_item_id = d.id
      )
      SELECT COALESCE(SUM(story_points), NULL)::int AS total FROM descendants
      `,
      [parentId],
    );
    const total = result?.[0]?.total;
    return total === null || total === undefined ? null : Number(total);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-work-item.repository.ts apps/kanban/src/database/repositories/kanban-work-item.repository.spec.ts
git commit -m "feat(kanban): repository helpers for child existence and rolled-up points"
```

---

### Task 7: Service create/update — enforce invariants, resolve parent type, map new fields

**Files:**

- Modify: `apps/kanban/src/work-item/work-item.service.ts`
- Modify: `apps/kanban/src/work-item/work-item.service.helpers.ts` (patch shape + `toWorkItemRecord`)
- Modify: `apps/kanban/src/work-item/work-item-run.helpers.ts` (`applyPatchToWorkItem`)
- Test: `apps/kanban/src/work-item/work-item.service.spec.ts` (extend)

**Interfaces:**

- Consumes: `assertWorkItemInvariants` (Task 5), `existsChildrenFor`/`computeRolledUpPoints` (Task 6), factory (Task 4).
- Produces: create/update reject invalid type/points/parent; `toWorkItemRecord` emits `type`, `parentWorkItemId`, `storyPoints`, and (when a `childrenIndex`/rollup is provided) `hasChildren`, `rolledUpPoints`.

- [ ] **Step 1: Write the failing test**

```ts
// excerpt — add to work-item.service.spec.ts
it("rejects creating an epic with story points", async () => {
  await expect(
    service.createWorkItem(projectId, {
      title: "Epic",
      type: "epic",
      storyPoints: 3,
    }),
  ).rejects.toThrow(/story points are not allowed/);
});

it("rejects parenting a task under a task", async () => {
  const parent = await service.createWorkItem(projectId, {
    title: "Parent",
    type: "task",
  });
  await expect(
    service.createWorkItem(projectId, {
      title: "Child",
      type: "task",
      parentWorkItemId: parent.id,
    }),
  ).rejects.toThrow(/cannot parent/);
});

it("persists a valid parented task", async () => {
  const epic = await service.createWorkItem(projectId, {
    title: "Epic",
    type: "epic",
  });
  const task = await service.createWorkItem(projectId, {
    title: "Task",
    type: "task",
    storyPoints: 2,
    parentWorkItemId: epic.id,
  });
  expect(task.type).toBe("task");
  expect(task.parentWorkItemId).toBe(epic.id);
  expect(task.storyPoints).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item.service`
Expected: FAIL — invariants not enforced / fields not mapped.

- [ ] **Step 3: Write minimal implementation**

In `createWorkItem` (before the `save`), resolve the parent type and assert:

```ts
const parentWorkItemId = input.parentWorkItemId ?? null;
const parentType = parentWorkItemId
  ? (await requireWorkItem(project_id, parentWorkItemId, this.workItems)).type
  : null;
assertWorkItemInvariants({
  type: input.type ?? "story",
  storyPoints: input.storyPoints ?? null,
  parentType: parentType as WorkItemType | null,
});
```

Extend the `toCreateEntity({...})` call with:

```ts
        type: input.type ?? "story",
        parent_work_item_id: parentWorkItemId,
        story_points: input.storyPoints ?? null,
```

Add imports:

```ts
import { assertWorkItemInvariants } from "./work-item-invariants";
import type { WorkItemType } from "@nexus/kanban-contracts";
```

In `updateWorkItem`, after loading `item` and building `patch`, if `patch.type`/`patch.storyPoints`/`patch.parentWorkItemId` are present, resolve the effective parent type and call `assertWorkItemInvariants({ type: patch.type ?? item.type, storyPoints: patch.storyPoints ?? item.story_points, parentType })` before `save`.

In `work-item.service.helpers.ts`:

- Extend the patch type and `asWorkItemPatch` to carry `type?`, `parentWorkItemId?`, `storyPoints?`.
- In `toWorkItemRecord(item, dependencyIds, subtasks, derived?)` add optional `derived?: { hasChildren: boolean; rolledUpPoints: number | null }` and map:

```ts
    type: item.type,
    parentWorkItemId: item.parent_work_item_id ?? null,
    storyPoints: item.story_points ?? null,
    hasChildren: derived?.hasChildren,
    rolledUpPoints: derived?.rolledUpPoints,
```

In `work-item-run.helpers.ts` `applyPatchToWorkItem`, map `type`/`parent_work_item_id`/`story_points` from patch onto the entity when present.

> `WorkItemRecord`/`CreateWorkItemInput` types in `work-item.types.ts` are `z.infer` of the contracts — they gain the fields automatically after Task 2. If they are hand-authored, add the fields there too.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item.service.ts apps/kanban/src/work-item/work-item.service.helpers.ts apps/kanban/src/work-item/work-item-run.helpers.ts apps/kanban/src/work-item/work-item.service.spec.ts
git commit -m "feat(kanban): enforce type/points/parent invariants in work item service"
```

---

# Phase 3 — Dispatch guard (the fix)

### Task 8: Container guard in the dispatch core

**Files:**

- Modify: `apps/kanban/src/dispatch/dispatch-internal.types.ts` (add `type`, `parent_work_item_id` to `WorkItemRecord`)
- Create: `apps/kanban/src/dispatch/dispatch-container.helper.ts`
- Modify: `apps/kanban/src/dispatch/dispatch-work-items.core.ts`
- Modify: `apps/kanban/src/dispatch/dispatch.service.types.ts` (skip-reason union)
- Test: `apps/kanban/src/dispatch/dispatch-container.helper.spec.ts` + extend `dispatch-work-items.core.spec.ts`

**Interfaces:**

- Consumes: `isDispatchable` (Task 3). The parent-id set is built inline from the already-loaded `projectItems` (no repository call needed — the whole project is in memory here).
- Produces: `isContainerCandidate(item, childrenParentIds: Set<string>): boolean` = `!isDispatchable(item.type, childrenParentIds.has(item.id))`. `DispatchContext` gains `childrenParentIds: Set<string>`. Skip reason `container_not_dispatchable`.

- [ ] **Step 1: Write the failing test (helper)**

```ts
// apps/kanban/src/dispatch/dispatch-container.helper.spec.ts
import { describe, expect, it } from "vitest";
import { isContainerCandidate } from "./dispatch-container.helper";

const base = { id: "x", status: "todo" } as never;

describe("isContainerCandidate", () => {
  it("treats an epic as a container", () => {
    expect(isContainerCandidate({ ...base, type: "epic" }, new Set())).toBe(
      true,
    );
  });
  it("treats a childless story as dispatchable", () => {
    expect(isContainerCandidate({ ...base, type: "story" }, new Set())).toBe(
      false,
    );
  });
  it("treats a story WITH children as a container", () => {
    expect(
      isContainerCandidate({ ...base, id: "s", type: "story" }, new Set(["s"])),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- dispatch-container.helper`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/kanban/src/dispatch/dispatch-container.helper.ts
import type { WorkItemType } from "@nexus/kanban-contracts";
import { isDispatchable } from "../work-item/work-item-type.rules";
import type { WorkItemRecord } from "./dispatch-internal.types";

export function isContainerCandidate(
  item: WorkItemRecord,
  childrenParentIds: ReadonlySet<string>,
): boolean {
  return !isDispatchable(
    item.type as WorkItemType,
    childrenParentIds.has(item.id),
  );
}
```

Add `type: string;` and `parent_work_item_id: string | null;` to `WorkItemRecord` in `dispatch-internal.types.ts`.

In `dispatch-work-items.core.ts`:

- In `prepareDispatchContext`, after loading `projectItems`, build the index and add it to the returned context:

```ts
const childrenParentIds = new Set(
  projectItems
    .map((item) => item.parent_work_item_id)
    .filter((id): id is string => id != null),
);
```

Add `childrenParentIds: Set<string>;` to the `DispatchContext` interface and include it in the returned object.

- In `processCandidate`, insert the guard immediately after the `status !== "todo"` block (after line 184):

```ts
if (isContainerCandidate(item, ctx.childrenParentIds)) {
  ctx.result.skipped.push({
    workItemId: item.id,
    reason: "container_not_dispatchable",
    status: item.status,
  });
  return;
}
```

Add the import and extend the skip-reason union (`DispatchResult['skipped']` type in `dispatch.service.types.ts`) with `"container_not_dispatchable"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- dispatch-container.helper dispatch-work-items.core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/dispatch/dispatch-container.helper.ts apps/kanban/src/dispatch/dispatch-container.helper.spec.ts apps/kanban/src/dispatch/dispatch-internal.types.ts apps/kanban/src/dispatch/dispatch-work-items.core.ts apps/kanban/src/dispatch/dispatch.service.types.ts apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts
git commit -m "feat(kanban): skip containers (epics + items with children) in dispatch core"
```

---

### Task 9: Headline regression test — no container is ever dispatched

**Files:**

- Test: `apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts` (add regression block)

**Interfaces:**

- Consumes: dispatch core (Task 8). Uses the existing test harness/mocks in the core spec (mock `coreClient.requestWorkflowRun`).

- [ ] **Step 1: Write the failing/pinning test**

```ts
// excerpt — add to dispatch-work-items.core.spec.ts, reusing the file's existing deps/options factories
it("never dispatches an epic sitting in todo", async () => {
  const epic = makeWorkItem({ id: "e", status: "todo", type: "epic" });
  const deps = makeDeps({ projectItems: [epic] });
  const result = await dispatchWorkItems(deps, makeOptions());
  expect(result.dispatched).toHaveLength(0);
  expect(result.skipped).toContainEqual(
    expect.objectContaining({
      workItemId: "e",
      reason: "container_not_dispatchable",
    }),
  );
  expect(deps.coreClient.requestWorkflowRun).not.toHaveBeenCalled();
});

it("never dispatches a story that has children", async () => {
  const story = makeWorkItem({ id: "s", status: "todo", type: "story" });
  const child = makeWorkItem({
    id: "c",
    status: "todo",
    type: "task",
    parent_work_item_id: "s",
  });
  const deps = makeDeps({ projectItems: [story, child] });
  const result = await dispatchWorkItems(deps, makeOptions());
  expect(result.dispatched.map((d) => d.workItemId)).not.toContain("s");
});

it("dispatches a childless story", async () => {
  const story = makeWorkItem({ id: "s", status: "todo", type: "story" });
  const deps = makeDeps({ projectItems: [story] });
  const result = await dispatchWorkItems(deps, makeOptions());
  expect(result.dispatched.map((d) => d.workItemId)).toContain("s");
});
```

> Use the spec file's existing item/deps/options builders; add `type`/`parent_work_item_id` to whatever `makeWorkItem` helper it defines (default `type: "story"`, `parent_work_item_id: null`).

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace=apps/kanban -- dispatch-work-items.core`
Expected: PASS (guard from Task 8 makes them green; if the childless-story case fails, the guard is over-broad).

- [ ] **Step 3: (Refactor only if red)** adjust guard/helpers.

- [ ] **Step 4: Re-run**

Run: `npm run test --workspace=apps/kanban -- dispatch-work-items.core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts
git commit -m "test(kanban): regression — containers never dispatched, childless story does"
```

---

### Task 10: Apply the guard in the five "dispatchable todo" read predicates

**Files:**

- Modify: `apps/kanban/src/mcp/tools/read/todo-list.tool.ts`
- Modify: `apps/kanban/src/mcp/tools/read/project-state.tool.ts`
- Modify: `apps/kanban/src/orchestration/orchestration-cycle-decision-dispatch.helpers.ts`
- Modify: `apps/kanban/src/orchestration/orchestration-continuation.handler.ts`
- Modify: `apps/kanban/src/orchestration/orchestration-branch-blockers.ts`
- Create: `apps/kanban/src/work-item/work-item-dispatchable.helper.ts` (shared predicate over a records list)
- Test: `apps/kanban/src/work-item/work-item-dispatchable.helper.spec.ts`

**Interfaces:**

- Consumes: `isDispatchable` (Task 3).
- Produces: `filterDispatchableTodo(items: T[]): T[]` where `T` has `id`, `status`, `type`, `parent_work_item_id` — keeps only `status === "todo"` items that are dispatchable given the set of parent ids present in `items`. Every read predicate routes through this so the CEO's board view and dispatch loop agree.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item-dispatchable.helper.spec.ts
import { describe, expect, it } from "vitest";
import { filterDispatchableTodo } from "./work-item-dispatchable.helper";

const item = (o: Partial<Record<string, unknown>>) => ({
  id: "x",
  status: "todo",
  type: "story",
  parent_work_item_id: null,
  ...o,
});

describe("filterDispatchableTodo", () => {
  it("keeps childless todo stories, drops epics and parents", () => {
    const epic = item({ id: "e", type: "epic" });
    const parent = item({ id: "p", type: "story" });
    const child = item({ id: "c", type: "task", parent_work_item_id: "p" });
    const lone = item({ id: "l", type: "task" });
    const notTodo = item({ id: "n", type: "story", status: "in-progress" });

    const kept = filterDispatchableTodo([
      epic,
      parent,
      child,
      lone,
      notTodo,
    ]).map((i) => i.id);
    expect(kept.sort()).toEqual(["c", "l"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-dispatchable.helper`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/kanban/src/work-item/work-item-dispatchable.helper.ts
import type { WorkItemType } from "@nexus/kanban-contracts";
import { isDispatchable } from "./work-item-type.rules";

interface DispatchableCandidate {
  id: string;
  status: string;
  type: string;
  parent_work_item_id: string | null;
}

export function filterDispatchableTodo<T extends DispatchableCandidate>(
  items: T[],
): T[] {
  const parentIds = new Set(
    items
      .map((i) => i.parent_work_item_id)
      .filter((id): id is string => id != null),
  );
  return items.filter(
    (i) =>
      i.status === "todo" &&
      isDispatchable(i.type as WorkItemType, parentIds.has(i.id)),
  );
}
```

Then repoint each predicate:

- `todo-list.tool.ts` — replace `items.filter((item) => item.status === "todo")` with `filterDispatchableTodo(items)`.
- `project-state.tool.ts` — compute `dispatchableTodoItems` via `filterDispatchableTodo(items)` and make `isDispatchableTodoItem()` reuse the same rule (childless + non-epic + todo).
- `orchestration-cycle-decision-dispatch.helpers.ts` `hasDispatchableTodoWork()` — `return filterDispatchableTodo(items).length > 0`.
- `orchestration-continuation.handler.ts` `isDispatchableWorkItem()` — augment its existing `status === "todo"` check with `filterDispatchableTodo([item]).length === 1` (pass the sibling list where it already has one, so parent-of-children is detected; if only the single item is in scope, a parent with children still resolves via a `hasChildren` field if available — prefer passing the full project list).
- `orchestration-branch-blockers.ts` — apply `filterDispatchableTodo` wherever it enumerates todo candidates.

> Where a predicate only has a single item and not the sibling list, thread the already-loaded project items list through (these call sites already load it for other checks). Do not approximate with a metadata flag.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=apps/kanban -- work-item-dispatchable todo-list project-state orchestration-cycle-decision-dispatch orchestration-continuation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item-dispatchable.helper.ts apps/kanban/src/work-item/work-item-dispatchable.helper.spec.ts apps/kanban/src/mcp/tools/read/todo-list.tool.ts apps/kanban/src/mcp/tools/read/project-state.tool.ts apps/kanban/src/orchestration/orchestration-cycle-decision-dispatch.helpers.ts apps/kanban/src/orchestration/orchestration-continuation.handler.ts apps/kanban/src/orchestration/orchestration-branch-blockers.ts
git commit -m "feat(kanban): exclude containers from all dispatchable-todo read predicates"
```

---

### Task 11: Phase 1-3 integration gate — build, lint, boundary, full kanban suite

**Files:** none (verification task).

- [ ] **Step 1:** `npm run build --workspace=packages/kanban-contracts`
- [ ] **Step 2:** `npm run build:kanban` — Expected: clean (no `scope` references remain; fix any TS2339/TS2551).
- [ ] **Step 3:** `npm run lint:kanban && npm run lint:api` — Expected: clean; **`no-core-kanban-residue` green**. If API lint flags residue, the leak is in the run-request payload — remove any `scope` passthrough (see `dispatch-run-link.helper.ts` / `dispatch-work-item-trigger.ts`).
- [ ] **Step 4:** `npm run test:kanban` — Expected: all green. Fix any spec that still constructs items with `scope`.
- [ ] **Step 5: Commit** any residue fixes.

```bash
git add -A
git commit -m "chore(kanban): remove residual scope usage; green build/lint/tests"
```

---

# Phase 4 — Estimation & decomposition workflows

> Each task here is independently testable. If executing as a separate plan, this phase's precondition is Phases 1-3 merged.

### Task 12: `propose-work-items` tool persists typed children with parent links

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.spec.ts`

**Interfaces:**

- Consumes: `WorkItemService.createWorkItem` (Task 7), `WorkItemTypeSchema` (Task 1).
- Produces: tool input aligns to persisted set (`epic|story|task|bug|spike`, drop `subtask`/`ingestion`); on apply, each proposed child is created with `type`, `storyPoints`, and `parentWorkItemId` set to the epic/story being decomposed; returns created ids.

- [ ] **Step 1: Write the failing test**

```ts
it("persists decomposed children parented to the epic with types", async () => {
  const epic = await workItems.createWorkItem(projectId, {
    title: "Epic",
    type: "epic",
  });
  const res = await runProposeWorkItems({
    projectId,
    parentWorkItemId: epic.id,
    items: [
      { title: "Story A", type: "story", storyPoints: 5 },
      { title: "Bug B", type: "bug", storyPoints: 2 },
    ],
  });
  const children = await workItems.listWorkItems(projectId);
  const created = children.filter((c) => c.parentWorkItemId === epic.id);
  expect(created.map((c) => c.type).sort()).toEqual(["bug", "story"]);
});
```

- [ ] **Step 2: Run** `npm run test --workspace=apps/kanban -- propose-work-items` → FAIL.
- [ ] **Step 3: Implement** — change the tool's Zod `type` enum to `WorkItemTypeSchema`; add optional `parentWorkItemId` + `storyPoints`; in the handler loop, call `workItemService.createWorkItem(projectId, { title, type, storyPoints, parentWorkItemId })` and collect ids (replacing the transient `proposed_items` draft return).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(kanban): propose-work-items persists typed, parented children`.

---

### Task 13: Story-point estimation tool (CEO/agent + human override)

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/estimate-work-item.tool.ts`
- Register in the kanban MCP tool registry module (follow the pattern of an existing mutation tool).
- Test: `apps/kanban/src/mcp/tools/mutation/estimate-work-item.tool.spec.ts`

**Interfaces:**

- Consumes: `WorkItemService.updateWorkItem` (Task 7), `StoryPointsSchema` (Task 1).
- Produces: `kanban.estimate_work_item` tool — input `{ projectId, workItemId, storyPoints }`; rejects on epics (invariants throw) and non-Fibonacci; persists `storyPoints`.

- [ ] **Step 1:** failing test — estimating a task to 8 persists; estimating an epic throws.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement the tool delegating to `updateWorkItem({ storyPoints })`; the service invariants enforce the rules (no duplicate validation).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(kanban): add estimate_work_item tool`.

---

### Task 14: Refinement workflow assigns points; oversized (13) surfaces decompose/promote

**Files:**

- Modify: the refinement seed workflow YAML (`work_item_refinement_default`) and the split workflow (`work_item_split_default`) under the kanban seed workflow directory.
- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.ts` — drive off `parent_work_item_id` (Task 6 `findChildIds`) instead of `metadata.split.parentId`.
- Test: seed-validation + a workflow unit/integration test that a `refinement` entry produces a point estimate and a `13` item yields a CEO decision surface.

**Interfaces:**

- Consumes: `estimate_work_item` (Task 13), `propose-work-items` (Task 12), `findChildIds`/`computeRolledUpPoints` (Task 6).
- Produces: refinement estimation step; `work_item_split_default` trigger condition repointed from `scope == large` to "item has `story_points == 13` OR CEO-flagged"; rollup resolver uses real parent column.

- [ ] **Step 1:** failing seed/workflow test (assert the refinement workflow includes an estimation step and the split trigger condition references points, not `scope`).
- [ ] **Step 2:** run `npm run validate:seed-data` and the workflow test → FAIL.
- [ ] **Step 3:** edit YAML: add estimation step calling `kanban.estimate_work_item`; change split trigger `condition` to fire on the points signal; add a CEO decision branch (decompose-into-children via `propose-work-items` with same-type story children, OR promote-to-epic via `updateWorkItem({ type: "epic", parentWorkItemId: null })`). Update the umbrella resolver to `findChildIds`.
- [ ] **Step 4:** run `npm run validate:seed-data` + workflow test → PASS.
- [ ] **Step 5:** commit `feat(kanban): points-driven refinement/split + real-parent rollup`.

> Follow the `workflow-yaml-authoring` and `seed-workflow-patterns` skills for exact YAML shape and reseed lifecycle. Reseed locally after merge; the migration + reseed are deploy-time steps recorded in the PR description.

---

### Task 15: Promotion detach path (story → epic) is atomic

**Files:**

- Modify: `apps/kanban/src/work-item/work-item.service.ts` (updateWorkItem)
- Test: `apps/kanban/src/work-item/work-item.service.spec.ts`

**Interfaces:**

- Produces: updating an item to `type: "epic"` clears its `parent_work_item_id` in the same save (invariant #5), and re-validates children remain legal (children of a now-epic are fine; children of a story promoted to epic keep pointing at it).

- [ ] **Step 1:** failing test — promoting a parented story to epic leaves it parentless and does not throw; its existing children stay attached.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** in `updateWorkItem`, when `patch.type === "epic"` and the item currently has a parent, set `patch.parentWorkItemId = null` before `assertWorkItemInvariants` and `save`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(kanban): atomic parent-detach on story→epic promotion`.

---

# Phase 5 — Web UI

> Precondition: Phases 1-2 (contracts) merged so the web client types include `type`/`storyPoints`/`parentWorkItemId`/`hasChildren`/`rolledUpPoints`. Follow the **web quality gate**: components presentational, side effects in hooks/services.

### Task 16: Type badge + color on cards

**Files:**

- Create: `apps/web/src/features/kanban/work-item-type-badge.tsx`
- Create: `apps/web/src/features/kanban/work-item-type.constants.ts` (label + Tailwind color per type)
- Test: `apps/web/src/features/kanban/work-item-type-badge.spec.tsx`

**Interfaces:**

- Produces: `<WorkItemTypeBadge type={WorkItemType} />`; `WORK_ITEM_TYPE_META: Record<WorkItemType, { label: string; className: string }>`.

- [ ] **Step 1:** failing RTL test — renders "Epic" with the epic color class for `type="epic"`.
- [ ] **Step 2:** run `npm run test:unit:web -- work-item-type-badge` → FAIL.
- [ ] **Step 3:** implement badge + constants (import `WorkItemType` from `@nexus/kanban-contracts`).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(web): work item type badge`.

### Task 17: Story-point chip (view + Fibonacci edit; hidden for epics; rollup on containers)

**Files:**

- Create: `apps/web/src/features/kanban/story-point-chip.tsx`
- Create/modify: a mutation hook `use-update-work-item.ts` calling the update endpoint.
- Test: `apps/web/src/features/kanban/story-point-chip.spec.tsx`

**Interfaces:**

- Produces: `<StoryPointChip item={WorkItem} onChange={(points) => void} />` — renders nothing for `type==="epic"` except `rolledUpPoints`; renders a Fibonacci picker (`1,2,3,5,8,13`) for leaves/stories.

- [ ] **Step 1-5:** TDD: renders own points for a task; renders rollup (read-only) for an epic; picker restricted to Fibonacci; commit `feat(web): story point chip`.

### Task 18: Epic/story hierarchy expand + rollup total

**Files:**

- Modify: the board card/column components to group children under their parent and show an expand/collapse with `rolledUpPoints`.
- Create: `apps/web/src/features/kanban/use-work-item-hierarchy.ts` (derive parent→children from the loaded list).
- Test: hook spec + component spec.

- [ ] **Step 1-5:** TDD: hook groups children by `parentWorkItemId`; card shows rollup; collapse hides children. Commit `feat(web): work item hierarchy view with rollup`.

### Task 19: Filter by type + create/convert type in the item form

**Files:**

- Modify: board toolbar (add a type filter), work-item create/edit form (type select + parent picker + point field with client-side parent/points rules mirroring `work-item-type.rules`).
- Consider a tiny web-side mirror `apps/web/src/features/kanban/work-item-type-rules.ts` (client-only convenience; server remains source of truth) OR import predicates if the web build can resolve `@nexus/kanban-contracts` (it can) — prefer importing shared predicates to stay DRY. Since `work-item-type.rules.ts` lives in `apps/kanban`, extract the pure predicates into `packages/kanban-contracts` if the web app needs them; otherwise duplicate the tiny matrix with a test asserting parity.
- Test: filter spec + form-validation spec.

- [ ] **Step 1-5:** TDD: filter narrows to selected types; form rejects `epic` with points and illegal parent pairings client-side; commit `feat(web): work item type filter + typed create form`.

> **DRY note:** if Task 19 needs the parent/points rules on the web side, move `work-item-type.rules.ts` into `packages/kanban-contracts/src/` (it has no NestJS deps) during this task and re-point the kanban imports — one source of truth for both apps. Add a parity test.

### Task 20: Phase 5 gate

- [ ] `npm run test:unit:web` — all green.
- [ ] `npm run lint:web` — clean.
- [ ] `npm run build:web` — clean.
- [ ] Commit any fixes.

---

# Final verification (whole feature)

- [ ] `npm run build --workspace=packages/kanban-contracts && npm run build:kanban && npm run build:web`
- [ ] `npm run lint:kanban && npm run lint:api && npm run lint:web` — **`no-core-kanban-residue` green.**
- [ ] `npm run test:kanban && npm run test:unit:web`
- [ ] `npm run validate:seed-data`
- [ ] Manually verify against the spec's headline guarantees:
  1. an `epic` in `todo` is never dispatched;
  2. a `story` with children in `todo` is never dispatched;
  3. a childless `story` dispatches;
  4. points restricted to Fibonacci; epics reject points;
  5. rollup totals correct across `epic → story → leaf`.
- [ ] Update docs: add a "Work item types & story points" section to `docs/guide/` (kanban lifecycle guide) and the `kanban-work-item-lifecycle` skill (types, dispatch guard, points, hierarchy). Commit `docs: document work item types and story points`.
- [ ] Deploy-time runbook (PR description): run the migration, reseed workflows (`npm run validate:seed-data` then reseed), rebuild kanban + web images.
