# Work Items Page UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side search, column sorting, attribute filtering, recency-first ordering, and classic pagination to the Global Work Items page, plus a client-side search/filter toolbar on the Kanban board — without breaking drag-drop.

**Architecture:** One shared `WorkItemQuery` Zod contract drives both views. The kanban list endpoints gain query-param parsing and return a `PaginatedWorkItems` envelope. The global page consumes it via the existing `DataTable` (server mode) with URL-synced state. The board reuses the same filter-option definitions but filters its already-fetched set in-memory.

**Tech Stack:** NestJS + TypeORM + Zod (apps/kanban, packages/kanban-contracts); React + React Query + Tailwind + Vitest (apps/web).

---

## Background facts (verified against the codebase)

- `api.get<T>(url)` returns `response.data.data` — it unwraps the `{ success, data }` controller envelope. So a controller returning `{ success: true, data: { items, total, limit, offset } }` makes `api.getAllWorkItems()` resolve to `{ items, total, limit, offset }`.
- `toWorkItemRecord` (apps/kanban/.../work-item.service.helpers.ts) serializes timestamps as **camelCase** `createdAt` / `updatedAt`. The frontend `WorkItem` type nominally declares `created_at`/`updated_at`, but at runtime the global list receives `createdAt`/`updatedAt`. The "Updated" column and default sort must read `updatedAt`.
- The shared `DataTable` (apps/web/src/components/ui/data-table/) already renders a search box, single-select filter dropdowns, sortable headers, and pagination. Its `fetchFn` receives `{ page, limit, search?, sortBy?, sortDir?, ...filterValues }` and must return `{ data: T[]; meta: { pagination: { total, page, limit, totalPages } } }`.
- `DataTable` filters are **single-select** (`FilterDef.type: "select"`). We use single-value filters; the backend contract still accepts arrays (one element) for future-proofing.
- Repository sorting today is hard-coded `created_at ASC`. Internal callers (`getActiveAutomationStatuses`, dispatch helpers) use `findByproject_id`/`findAll` and must keep working — add new query methods rather than changing these.
- Strict lint policy: no `eslint-disable`, `@ts-ignore`, `as any`. Boundary: all backend work stays in `apps/kanban` + `packages/kanban-contracts`.

## File Structure

**packages/kanban-contracts/src/**

- Create `work-item-query.schema.ts` — `WorkItemQuerySchema`, `PaginatedWorkItemsSchema`, `WORK_ITEM_SORT_FIELDS`, types.
- Modify `index.ts` — export the new module.

**apps/kanban/src/**

- Modify `database/repositories/kanban-work-item.repository.ts` — add `queryWorkItems(params)` returning `{ items, total }`.
- Create `work-item/work-item-query.ts` — `parseWorkItemQuery(raw)` controller-side parser (string→array/number coercion via the schema).
- Modify `work-item/work-item.service.ts` — add `queryWorkItems` / `queryAllWorkItems` returning the paginated envelope.
- Modify `work-item/work-item.controller.ts` — `list()` parses query, returns envelope.
- Modify `work-item/work-item-global.controller.ts` — `listAll()` parses query, returns envelope.
- Create migration under `database/migrations/` — indexes on `(updated_at)` and `(project_id, updated_at)`.

**apps/web/src/**

- Create `lib/work-items/work-item-filter-options.ts` — shared status/priority/scope option lists + label helpers.
- Modify `lib/api/types.ts` — add `PaginatedWorkItems` / `WorkItemQuery` types (re-export from contracts).
- Modify `lib/api/client.projects.ts` + `client.projects.types.ts` — `getAllWorkItems(query)` / `getProjectWorkItems(projectId, query)` accept an optional query and return the envelope.
- Modify `components/ui/data-table/useDataTable.ts` + `data-table.types.ts` + `DataTable.tsx` — opt-in URL persistence via a `urlKey` prop.
- Modify `pages/work-items/GlobalWorkItemsPage.tsx` — replace static table with `DataTable` server mode.
- Create `pages/kanban/WorkItemFilterToolbar.tsx` + `useWorkItemFilters.ts` — board client-side filter/search.
- Modify `pages/kanban/KanbanBoard.tsx` — mount the toolbar, filter items before grouping.

---

## Task 1: Shared query contract

**Files:**

- Create: `packages/kanban-contracts/src/work-item-query.schema.ts`
- Test: `packages/kanban-contracts/src/work-item-query.schema.spec.ts`
- Modify: `packages/kanban-contracts/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kanban-contracts/src/work-item-query.schema.spec.ts
import { describe, expect, it } from "vitest";
import {
  WorkItemQuerySchema,
  PaginatedWorkItemsSchema,
} from "./work-item-query.schema";

describe("WorkItemQuerySchema", () => {
  it("applies defaults", () => {
    const parsed = WorkItemQuerySchema.parse({});
    expect(parsed).toMatchObject({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
  });

  it("coerces comma-separated filters into arrays", () => {
    const parsed = WorkItemQuerySchema.parse({ status: "todo,blocked" });
    expect(parsed.status).toEqual(["todo", "blocked"]);
  });

  it("coerces numeric strings and clamps limit to 200", () => {
    const parsed = WorkItemQuerySchema.parse({ limit: "999", offset: "20" });
    expect(parsed.limit).toBe(200);
    expect(parsed.offset).toBe(20);
  });

  it("rejects an unknown sort field", () => {
    expect(() => WorkItemQuerySchema.parse({ sortBy: "secret" })).toThrow();
  });

  it("validates the paginated envelope shape", () => {
    const ok = PaginatedWorkItemsSchema.safeParse({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- work-item-query`
Expected: FAIL — cannot find module `./work-item-query.schema`.

- [ ] **Step 3: Write the schema**

```ts
// packages/kanban-contracts/src/work-item-query.schema.ts
import { z } from "zod";
import {
  WorkItemSchema,
  WorkItemStatusSchema,
  WorkItemScopeSchema,
} from "./work-item.schema";

export const WORK_ITEM_SORT_FIELDS = [
  "updated_at",
  "created_at",
  "title",
  "status",
  "priority",
] as const;

export const WorkItemSortFieldSchema = z.enum(WORK_ITEM_SORT_FIELDS);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Accepts a string ("a,b"), a real array, or undefined and yields a string[] or undefined. */
function csvArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parts = Array.isArray(value) ? value : value.split(",");
      return parts.map((p) => p.trim()).filter((p) => p.length > 0);
    })
    .pipe(z.array(item).optional());
}

export const WorkItemQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: csvArray(WorkItemStatusSchema),
  priority: csvArray(z.string().min(1)),
  scope: csvArray(WorkItemScopeSchema),
  projectId: z.string().min(1).optional(),
  sortBy: WorkItemSortFieldSchema.default("updated_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMIT)
    .transform((v) => Math.min(v, MAX_LIMIT)),
  offset: z.coerce.number().int().min(0).default(0),
});

export type WorkItemQuery = z.infer<typeof WorkItemQuerySchema>;

export const PaginatedWorkItemsSchema = z.object({
  items: z.array(WorkItemSchema),
  total: z.number().int().min(0),
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
});

export type PaginatedWorkItems = z.infer<typeof PaginatedWorkItemsSchema>;
```

- [ ] **Step 4: Export from the package index**

Add to `packages/kanban-contracts/src/index.ts` (alongside the existing `work-item.schema` export):

```ts
export * from "./work-item-query.schema";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=packages/kanban-contracts -- work-item-query`
Expected: PASS (5 tests).

- [ ] **Step 6: Build the contracts package (apps depend on dist)**

Run: `npm run build --workspace=packages/kanban-contracts`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/kanban-contracts/src/work-item-query.schema.ts packages/kanban-contracts/src/work-item-query.schema.spec.ts packages/kanban-contracts/src/index.ts
git commit -m "feat(kanban-contracts): add work-item query + paginated envelope schema"
```

---

## Task 2: Repository query method

**Files:**

- Modify: `apps/kanban/src/database/repositories/kanban-work-item.repository.ts`
- Test: `apps/kanban/src/database/repositories/kanban-work-item.repository.query.spec.ts`

The new method builds a `QueryBuilder` so we get filtering, validated ORDER BY, pagination, and a total count in one place.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/database/repositories/kanban-work-item.repository.query.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { KanbanWorkItemRepository } from "./kanban-work-item.repository";

function makeQbMock() {
  const qb: Record<string, unknown> = {};
  for (const m of ["andWhere", "orderBy", "skip", "take"]) {
    qb[m] = vi.fn(() => qb);
  }
  qb.getManyAndCount = vi.fn(async () => [[{ id: "wi-1" }], 1]);
  return qb as {
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
    take: ReturnType<typeof vi.fn>;
    getManyAndCount: ReturnType<typeof vi.fn>;
  };
}

describe("KanbanWorkItemRepository.queryWorkItems", () => {
  let qb: ReturnType<typeof makeQbMock>;
  let repo: KanbanWorkItemRepository;

  beforeEach(() => {
    qb = makeQbMock();
    const ormRepo = { createQueryBuilder: vi.fn(() => qb) };
    repo = new KanbanWorkItemRepository(
      ormRepo as never,
      {} as never,
      {} as never,
    );
  });

  it("returns items and total", async () => {
    const result = await repo.queryWorkItems({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
    expect(result).toEqual({ items: [{ id: "wi-1" }], total: 1 });
  });

  it("applies status, project, search filters and validated ordering", async () => {
    await repo.queryWorkItems({
      projectId: "p1",
      status: ["todo"],
      search: "login",
      sortBy: "title",
      sortDir: "asc",
      limit: 10,
      offset: 5,
    });
    expect(qb.andWhere).toHaveBeenCalledWith("item.project_id = :projectId", {
      projectId: "p1",
    });
    expect(qb.andWhere).toHaveBeenCalledWith("item.status IN (:...status)", {
      status: ["todo"],
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(item.title ILIKE :search OR item.description ILIKE :search)",
      { search: "%login%" },
    );
    expect(qb.orderBy).toHaveBeenCalledWith("item.title", "ASC");
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(qb.take).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:kanban -- kanban-work-item.repository.query`
Expected: FAIL — `repo.queryWorkItems is not a function`.

- [ ] **Step 3: Add the method**

Add this interface + method to `KanbanWorkItemRepository` (after `findAll`). The `SORT_COLUMNS` map is the ORDER BY whitelist — never interpolate a raw sort string into SQL.

```ts
// near the top of the file, after imports
const SORT_COLUMNS = {
  updated_at: "item.updated_at",
  created_at: "item.created_at",
  title: "item.title",
  status: "item.status",
  priority: "item.priority",
} as const;

export interface WorkItemQueryParams {
  search?: string;
  status?: string[];
  priority?: string[];
  scope?: string[];
  projectId?: string;
  sortBy: keyof typeof SORT_COLUMNS;
  sortDir: "asc" | "desc";
  limit: number;
  offset: number;
}
```

```ts
// method inside the class
async queryWorkItems(
  params: WorkItemQueryParams,
): Promise<{ items: KanbanWorkItemEntity[]; total: number }> {
  const qb = this.repository.createQueryBuilder("item");

  if (params.projectId) {
    qb.andWhere("item.project_id = :projectId", {
      projectId: params.projectId,
    });
  }
  if (params.status && params.status.length > 0) {
    qb.andWhere("item.status IN (:...status)", { status: params.status });
  }
  if (params.priority && params.priority.length > 0) {
    qb.andWhere("item.priority IN (:...priority)", {
      priority: params.priority,
    });
  }
  if (params.scope && params.scope.length > 0) {
    qb.andWhere("item.scope IN (:...scope)", { scope: params.scope });
  }
  if (params.search) {
    qb.andWhere(
      "(item.title ILIKE :search OR item.description ILIKE :search)",
      { search: `%${params.search}%` },
    );
  }

  const column = SORT_COLUMNS[params.sortBy];
  qb.orderBy(column, params.sortDir === "asc" ? "ASC" : "DESC");
  qb.skip(params.offset);
  qb.take(params.limit);

  const [items, total] = await qb.getManyAndCount();
  return { items, total };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:kanban -- kanban-work-item.repository.query`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-work-item.repository.ts apps/kanban/src/database/repositories/kanban-work-item.repository.query.spec.ts
git commit -m "feat(kanban): add queryWorkItems repository method with filter/sort/pagination"
```

---

## Task 3: Service-layer paginated query

**Files:**

- Modify: `apps/kanban/src/work-item/work-item.service.ts`
- Test: `apps/kanban/src/work-item/work-item.service.query.spec.ts`

Returns the envelope `{ items: WorkItemRecord[]; total; limit; offset }`, mapping the page slice through the existing `toRecordsWithDependencies`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item.service.query.spec.ts
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "./work-item.service";

function buildService(queryResult: { items: unknown[]; total: number }) {
  const repo = {
    queryWorkItems: vi.fn(async () => queryResult),
    findDependenciesByWorkItemIds: vi.fn(async () => []),
    findSubtasksByWorkItemIds: vi.fn(async () => []),
  };
  const service = new WorkItemService(
    {} as never, // coreClient
    {} as never, // requestContext
    repo as never, // workItems
    {} as never, // lifecycleEventPublisher
    {} as never, // projects
    {} as never, // realtimePublisher
    {} as never, // realtimeGateway
  );
  return { service, repo };
}

describe("WorkItemService paginated queries", () => {
  const baseQuery = {
    sortBy: "updated_at" as const,
    sortDir: "desc" as const,
    limit: 50,
    offset: 0,
  };

  it("queryAllWorkItems returns an envelope", async () => {
    const entity = {
      id: "wi-1",
      project_id: "p1",
      title: "T",
      description: null,
      status: "todo",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      current_execution_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: null,
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    };
    const { service, repo } = buildService({ items: [entity], total: 1 });

    const result = await service.queryAllWorkItems(baseQuery);

    expect(repo.queryWorkItems).toHaveBeenCalledWith(baseQuery);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.items[0].id).toBe("wi-1");
    expect(result.items[0].updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("queryWorkItems forces the projectId filter", async () => {
    const { service, repo } = buildService({ items: [], total: 0 });
    await service.queryWorkItems("p1", baseQuery);
    expect(repo.queryWorkItems).toHaveBeenCalledWith({
      ...baseQuery,
      projectId: "p1",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:kanban -- work-item.service.query`
Expected: FAIL — `service.queryAllWorkItems is not a function`.

- [ ] **Step 3: Add the service methods**

Import the param + envelope types at the top of `work-item.service.ts`:

```ts
import type { WorkItemQueryParams } from "../database/repositories/kanban-work-item.repository";
```

Add these methods (after `listAllWorkItems`):

```ts
async queryAllWorkItems(params: WorkItemQueryParams): Promise<{
  items: WorkItemRecord[];
  total: number;
  limit: number;
  offset: number;
}> {
  const { items, total } = await this.workItems.queryWorkItems(params);
  const records = await toRecordsWithDependencies(items, this.workItems);
  return { items: records, total, limit: params.limit, offset: params.offset };
}

async queryWorkItems(
  project_id: string,
  params: WorkItemQueryParams,
): Promise<{
  items: WorkItemRecord[];
  total: number;
  limit: number;
  offset: number;
}> {
  return this.queryAllWorkItems({ ...params, projectId: project_id });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:kanban -- work-item.service.query`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item.service.ts apps/kanban/src/work-item/work-item.service.query.spec.ts
git commit -m "feat(kanban): add paginated work-item query service methods"
```

---

## Task 4: Controller query parsing + envelope

**Files:**

- Create: `apps/kanban/src/work-item/work-item-query.ts`
- Modify: `apps/kanban/src/work-item/work-item.controller.ts`
- Modify: `apps/kanban/src/work-item/work-item-global.controller.ts`
- Test: `apps/kanban/src/work-item/work-item-query.spec.ts`

The parser turns raw Express query objects (all string-valued) into `WorkItemQueryParams`, throwing `BadRequestException` on invalid input. `projectId` is stripped here (the controllers set it explicitly) to prevent a project-scoped caller overriding it via query string.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item-query.spec.ts
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { parseWorkItemQuery } from "./work-item-query";

describe("parseWorkItemQuery", () => {
  it("applies defaults for an empty query", () => {
    expect(parseWorkItemQuery({})).toEqual({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
  });

  it("parses filters and pagination", () => {
    const parsed = parseWorkItemQuery({
      search: "auth",
      status: "todo,blocked",
      limit: "10",
      offset: "20",
      sortBy: "title",
      sortDir: "asc",
    });
    expect(parsed).toMatchObject({
      search: "auth",
      status: ["todo", "blocked"],
      limit: 10,
      offset: 20,
      sortBy: "title",
      sortDir: "asc",
    });
  });

  it("ignores a caller-supplied projectId", () => {
    const parsed = parseWorkItemQuery({ projectId: "p1" });
    expect("projectId" in parsed).toBe(false);
  });

  it("throws BadRequestException on an invalid sort field", () => {
    expect(() => parseWorkItemQuery({ sortBy: "evil" })).toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:kanban -- work-item-query`
Expected: FAIL — cannot find module `./work-item-query`.

- [ ] **Step 3: Write the parser**

```ts
// apps/kanban/src/work-item/work-item-query.ts
import { BadRequestException } from "@nestjs/common";
import { WorkItemQuerySchema } from "@nexus/kanban-contracts";
import type { WorkItemQueryParams } from "../database/repositories/kanban-work-item.repository";

export function parseWorkItemQuery(
  raw: Record<string, unknown>,
): WorkItemQueryParams {
  const result = WorkItemQuerySchema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid work item query: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { projectId: _ignored, ...rest } = result.data;
  return rest;
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run: `npm run test:kanban -- work-item-query`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the global controller**

Replace `work-item-global.controller.ts` with:

```ts
import { Controller, Get, Query } from "@nestjs/common";
import { WorkItemService } from "./work-item.service";
import { parseWorkItemQuery } from "./work-item-query";

@Controller("work-items")
export class WorkItemGlobalController {
  constructor(private readonly workItems: WorkItemService) {}

  @Get()
  async listAll(@Query() query: Record<string, unknown>) {
    const params = parseWorkItemQuery(query);
    const data = await this.workItems.queryAllWorkItems(params);
    return { success: true, data };
  }
}
```

- [ ] **Step 6: Wire the project controller**

In `work-item.controller.ts`, add `Query` to the `@nestjs/common` imports and the parser import:

```ts
import { parseWorkItemQuery } from "./work-item-query";
```

Replace the `list` handler:

```ts
@Get()
@RequirePermission("work_items:read")
async list(
  @Param("project_id") project_id: string,
  @Query() query: Record<string, unknown>,
) {
  const params = parseWorkItemQuery(query);
  const data = await this.workItems.queryWorkItems(project_id, params);
  return { success: true, data };
}
```

- [ ] **Step 7: Update existing controller specs for the envelope**

The project/global list now returns `{ items, total, limit, offset }` instead of a bare array. Find and update any controller spec asserting the old shape:

Run: `npm run test:kanban -- work-item.controller`
Fix assertions that expect `data` to be an array so they expect `data.items`. (If a spec mocks the service `listAllWorkItems`/`listWorkItems`, switch the mock to `queryAllWorkItems`/`queryWorkItems` returning an envelope.)

- [ ] **Step 8: Build the kanban app to confirm Nest/TypeORM reflection compiles**

Run: `npm run build:kanban`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/kanban/src/work-item/work-item-query.ts apps/kanban/src/work-item/work-item-query.spec.ts apps/kanban/src/work-item/work-item.controller.ts apps/kanban/src/work-item/work-item-global.controller.ts apps/kanban/src/work-item/*.spec.ts
git commit -m "feat(kanban): paginated work-item list endpoints with query params"
```

---

## Task 5: Index migration

**Files:**

- Create: `apps/kanban/src/database/migrations/<timestamp>-AddWorkItemListIndexes.ts`

Use the **adding-entity-migration** skill for the project's migration conventions (timestamp prefix, class name, naming). The migration adds two indexes used by the default recency sort and project-scoped listing.

- [ ] **Step 1: Author the migration**

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemListIndexes1718000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kanban_work_items_updated_at" ON "kanban_work_items" ("updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kanban_work_items_project_updated" ON "kanban_work_items" ("project_id", "updated_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_kanban_work_items_project_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_kanban_work_items_updated_at"`,
    );
  }
}
```

> Replace the timestamp in the class name/filename with a real one generated per the skill. Verify it is registered the same way as sibling migrations (migrations glob or explicit list).

- [ ] **Step 2: Build to confirm it compiles and is discovered**

Run: `npm run build:kanban`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/kanban/src/database/migrations/
git commit -m "feat(kanban): index work items by updated_at for list ordering"
```

---

## Task 6: Shared frontend filter options

**Files:**

- Create: `apps/web/src/lib/work-items/work-item-filter-options.ts`
- Test: `apps/web/src/lib/work-items/work-item-filter-options.spec.ts`

Single source of truth for the status/priority/scope choices both toolbars render. Status values come straight from `WorkItemStatusSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/work-items/work-item-filter-options.spec.ts
import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUS_OPTIONS,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SCOPE_OPTIONS,
} from "./work-item-filter-options";

describe("work item filter options", () => {
  it("exposes every status as a value/label pair", () => {
    expect(WORK_ITEM_STATUS_OPTIONS).toContainEqual({
      value: "in-progress",
      label: "In progress",
    });
    expect(WORK_ITEM_STATUS_OPTIONS.length).toBe(8);
  });

  it("exposes priority and scope options", () => {
    expect(WORK_ITEM_PRIORITY_OPTIONS.map((o) => o.value)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(WORK_ITEM_SCOPE_OPTIONS.map((o) => o.value)).toEqual([
      "standard",
      "large",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit:web -- work-item-filter-options`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/work-items/work-item-filter-options.ts
import { WorkItemStatusSchema } from "@nexus/kanban-contracts";

export interface FilterOption {
  value: string;
  label: string;
}

function humanize(value: string): string {
  const spaced = value.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const WORK_ITEM_STATUS_OPTIONS: FilterOption[] =
  WorkItemStatusSchema.options.map((status) => ({
    value: status,
    label: humanize(status),
  }));

export const WORK_ITEM_PRIORITY_OPTIONS: FilterOption[] = [
  { value: "p1", label: "P1" },
  { value: "p2", label: "P2" },
  { value: "p3", label: "P3" },
];

export const WORK_ITEM_SCOPE_OPTIONS: FilterOption[] = [
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit:web -- work-item-filter-options`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/work-items/work-item-filter-options.ts apps/web/src/lib/work-items/work-item-filter-options.spec.ts
git commit -m "feat(web): shared work-item filter option definitions"
```

---

## Task 7: API client — paginated work-item fetch

**Files:**

- Modify: `apps/web/src/lib/api/types.ts`
- Modify: `apps/web/src/lib/api/client.projects.types.ts`
- Modify: `apps/web/src/lib/api/client.projects.ts`
- Test: `apps/web/src/lib/api/client.projects.work-items.spec.ts`

`getAllWorkItems` / `getProjectWorkItems` gain an optional `WorkItemListQuery` and return the `PaginatedWorkItems` envelope. Existing callers that pass no query still work (board fetches all with a high limit).

- [ ] **Step 1: Add types**

In `apps/web/src/lib/api/types.ts`, add re-exports:

```ts
export type {
  PaginatedWorkItems,
  WorkItemQuery,
} from "@nexus/kanban-contracts";
```

Add a request-side query type (camelCase, frontend-facing) in `client.projects.types.ts`:

```ts
export interface WorkItemListQuery {
  search?: string;
  status?: string;
  priority?: string;
  scope?: string;
  sortBy?: "updated_at" | "created_at" | "title" | "status" | "priority";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
```

Update the `ApiClientProjectMethods` interface signatures in `client.projects.types.ts`:

```ts
getAllWorkItems(query?: WorkItemListQuery): Promise<PaginatedWorkItems>;
getProjectWorkItems(
  projectId: string,
  query?: WorkItemListQuery,
): Promise<PaginatedWorkItems>;
```

(Import `PaginatedWorkItems` and `WorkItemListQuery` into that file as needed.)

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/src/lib/api/client.projects.work-items.spec.ts
import { describe, expect, it, vi } from "vitest";
import { projectApiMethods } from "./client.projects";

function bindGet() {
  const get = vi.fn(async () => ({
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
  }));
  const ctx = { get } as unknown as typeof projectApiMethods;
  return { get, ctx };
}

describe("paginated work item client methods", () => {
  it("builds a querystring for getAllWorkItems", async () => {
    const { get, ctx } = bindGet();
    await projectApiMethods.getAllWorkItems.call(ctx, {
      search: "auth",
      status: "todo",
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
    const url = get.mock.calls[0][0] as string;
    expect(url.startsWith("/work-items?")).toBe(true);
    expect(url).toContain("search=auth");
    expect(url).toContain("status=todo");
    expect(url).toContain("sortBy=updated_at");
  });

  it("omits the querystring when no query is given", async () => {
    const { get, ctx } = bindGet();
    await projectApiMethods.getProjectWorkItems.call(ctx, "p1");
    expect(get.mock.calls[0][0]).toBe("/projects/p1/work-items");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit:web -- client.projects.work-items`
Expected: FAIL — current methods ignore the query / return arrays.

- [ ] **Step 4: Implement**

Add a private helper near the top of `client.projects.ts`:

```ts
function buildWorkItemQuery(query?: WorkItemListQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "" || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
```

Replace the two methods:

```ts
async getProjectWorkItems(projectId, query) {
  return this.get<PaginatedWorkItems>(
    `/projects/${projectId}/work-items${buildWorkItemQuery(query)}`,
  );
},

async getAllWorkItems(query) {
  return this.get<PaginatedWorkItems>(
    `/work-items${buildWorkItemQuery(query)}`,
  );
},
```

Import `PaginatedWorkItems` and `WorkItemListQuery` at the top of `client.projects.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit:web -- client.projects.work-items`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/types.ts apps/web/src/lib/api/client.projects.types.ts apps/web/src/lib/api/client.projects.ts apps/web/src/lib/api/client.projects.work-items.spec.ts
git commit -m "feat(web): paginated work-item API client methods"
```

---

## Task 8: DataTable URL persistence (opt-in)

**Files:**

- Modify: `apps/web/src/components/ui/data-table/data-table.types.ts`
- Modify: `apps/web/src/components/ui/data-table/useDataTable.ts`
- Modify: `apps/web/src/components/ui/data-table/DataTable.tsx`
- Test: `apps/web/src/components/ui/data-table/useDataTable.url.spec.tsx`

Add an optional `urlKey` prop. When set, initial state reads from `URLSearchParams` and changes write back via `react-router-dom`'s `useSearchParams`. Backward compatible: omitting `urlKey` keeps today's in-memory behaviour. Params are namespaced (`<urlKey>_q`, `<urlKey>_page`, etc.) so multiple tables can coexist.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/ui/data-table/useDataTable.url.spec.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useDataTable } from "./useDataTable";

function wrapper(initialPath: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );
}

describe("useDataTable url persistence", () => {
  it("hydrates initial state from the URL when urlKey is set", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/?wi_q=auth&wi_sort=title&wi_dir=asc&wi_page=2") },
    );

    expect(result.current.searchInput).toBe("auth");
    expect(result.current.sortBy).toBe("title");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.meta.page).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit:web -- useDataTable.url`
Expected: FAIL — `urlKey` not supported / state not hydrated.

- [ ] **Step 3: Implement**

In `data-table.types.ts` add `urlKey?: string;` to both `DataTableProps<T>` and the internal options interface in `useDataTable.ts` (`UseDataTableOptions<T>`).

In `useDataTable.ts`:

- Import `useSearchParams` from `react-router-dom`.
- When `urlKey` is provided, seed `useDataTableState` initial values from the current search params (`<key>_q`, `<key>_sort`, `<key>_dir`, `<key>_page`, plus filter keys `<key>_f_<filterKey>`), and in an effect write state changes back into the params (replace, not push). When `urlKey` is undefined, behave exactly as before.
- Initialize `searchInput` and `search` from the URL `q` value so the toolbar shows the active term.

Implementation sketch (add inside `useDataTable`, before returning):

```ts
const [searchParams, setSearchParams] = useSearchParams();

// Hydrate once from URL when urlKey is set (handled by passing initial
// values into useDataTableState — see below).

useEffect(() => {
  if (!options.urlKey) return;
  const key = options.urlKey;
  const next = new URLSearchParams(searchParams);
  const set = (name: string, value: string | undefined) => {
    if (value && value.length > 0) next.set(name, value);
    else next.delete(name);
  };
  set(`${key}_q`, search || undefined);
  set(`${key}_sort`, sortBy);
  set(`${key}_dir`, sortBy ? sortDir : undefined);
  set(`${key}_page`, page > 1 ? String(page) : undefined);
  for (const [fk, fv] of Object.entries(filterValues)) {
    set(`${key}_f_${fk}`, fv);
  }
  setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [options.urlKey, search, sortBy, sortDir, page, filterValues]);
```

> NOTE: the lint policy forbids `eslint-disable`. Instead of disabling, include `searchParams` and `setSearchParams` in deps and guard with a stable serialization, OR factor the URL-write into a `useCallback` that the effect calls with a complete dep list. Implement it dependency-complete — do not ship the disable comment. (See receiving-code-review if unsure.)

To hydrate initial state, change `useDataTableState` to accept optional initial overrides and compute them from `searchParams` when `urlKey` is set:

```ts
function readInitialState(urlKey: string | undefined, params: URLSearchParams) {
  if (!urlKey) return undefined;
  return {
    search: params.get(`${urlKey}_q`) ?? "",
    sortBy: params.get(`${urlKey}_sort`) ?? undefined,
    sortDir: (params.get(`${urlKey}_dir`) as "asc" | "desc") ?? undefined,
    page: Number(params.get(`${urlKey}_page`) ?? "1") || 1,
    filterValues: Object.fromEntries(
      [...params.entries()]
        .filter(([k]) => k.startsWith(`${urlKey}_f_`))
        .map(([k, v]) => [k.replace(`${urlKey}_f_`, ""), v]),
    ),
  };
}
```

Thread that initial object into the `useState` initializers in `useDataTableState`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit:web -- useDataTable.url`
Expected: PASS.

- [ ] **Step 5: Run the full data-table suite to confirm no regression**

Run: `npm run test:unit:web -- data-table`
Expected: existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/data-table/
git commit -m "feat(web): opt-in URL persistence for DataTable state"
```

---

## Task 9: Rebuild the Global Work Items page on DataTable

**Files:**

- Modify: `apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx`
- Test: `apps/web/src/pages/work-items/GlobalWorkItemsPage.spec.tsx`

Replace the static `<table>` and the unbounded `getAllWorkItems()` query with `DataTable` in server mode. Keep the existing cells (title link, project link, status/live/priority/scope badges, dependency text, plan badge, delete action) as `render` functions. Add an "Updated" column (reads `updatedAt`) as the default sort. Keep the delete dialog + mutation.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/work-items/GlobalWorkItemsPage.spec.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { GlobalWorkItemsPage } from "./GlobalWorkItemsPage";
import { api } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({
  api: {
    getAllWorkItems: vi.fn(),
    deleteWorkItem: vi.fn(),
  },
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjectList: () => ({ data: [{ id: "p1", name: "Proj One" }] }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GlobalWorkItemsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GlobalWorkItemsPage", () => {
  beforeEach(() => {
    vi.mocked(api.getAllWorkItems).mockResolvedValue({
      items: [
        {
          id: "wi-1",
          project_id: "p1",
          title: "Build login",
          status: "todo",
          scope: "standard",
          priority: "p2",
          dependsOn: [],
          blockers: [],
          updatedAt: "2026-01-02T00:00:00.000Z",
        } as never,
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("requests page data with the recency default sort", async () => {
    renderPage();
    await screen.findByText("Build login");
    const query = vi.mocked(api.getAllWorkItems).mock.calls[0][0];
    expect(query).toMatchObject({ sortBy: "updated_at", sortDir: "desc" });
  });

  it("renders the project name for a work item", async () => {
    renderPage();
    expect(await screen.findByText("Proj One")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit:web -- GlobalWorkItemsPage`
Expected: FAIL — page still calls `getAllWorkItems()` with no query / no DataTable.

- [ ] **Step 3: Implement the page**

Rewrite `GlobalWorkItemsPage` to:

- Build a `fetchFn` that maps DataTable's `{ page, limit, search, sortBy, sortDir, status, priority, scope, project }` query to a `WorkItemListQuery` (`offset = (page-1)*limit`), calls `api.getAllWorkItems(query)`, and returns `{ data: items, meta: { pagination: { total, page, limit, totalPages: Math.ceil(total/limit) || 1 } } }`.
- Define `columns: ColumnDef<WorkItem>[]` reusing the existing cell renderers (move `WorkItemRow`'s JSX into per-column `render` functions). Mark title/status/priority/updated sortable.
- Add the "Updated" column: `render: (item) => formatRelative(item.updatedAt)` (reuse an existing date util if present in `apps/web/src/lib`; otherwise render the ISO date with `new Date(item.updatedAt).toLocaleString()`).
- Define `filters: FilterDef[]` for project (from `useProjectList`), status (`WORK_ITEM_STATUS_OPTIONS`), priority, scope. The project filter key is `projectId`.
- Render `<DataTable mode="server" urlKey="wi" queryKey={[WORK_ITEMS_QUERY_KEY]} fetchFn={fetchFn} columns={columns} filters={filters} defaultSort="updated_at" defaultSortDir="desc" defaultLimit={50} emptyMessage="No work items found." />`.
- Keep `useGlobalWorkItemDeletion`, the delete dialog, and wire delete via a column action that calls `openDeleteDialog`. After a successful delete, invalidate `[WORK_ITEMS_QUERY_KEY]` (already done) — DataTable's `queryKey` includes the live query object, so invalidation refetches the current page.

Key wiring snippet:

```tsx
const fetchFn = useCallback(
  async (
    q: ListQuery & Record<string, unknown>,
  ): Promise<ListResponse<WorkItem>> => {
    const limit = q.limit;
    const { items, total } = await api.getAllWorkItems({
      search: typeof q.search === "string" ? q.search : undefined,
      status: typeof q.status === "string" ? q.status : undefined,
      priority: typeof q.priority === "string" ? q.priority : undefined,
      scope: typeof q.scope === "string" ? q.scope : undefined,
      sortBy: q.sortBy as WorkItemListQuery["sortBy"],
      sortDir: q.sortDir,
      limit,
      offset: (q.page - 1) * limit,
    });
    return {
      data: items,
      meta: {
        pagination: {
          total,
          page: q.page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    };
  },
  [],
);
```

> The project filter uses key `projectId`; in `fetchFn` forward `q.projectId` into the query string by extending the `WorkItemListQuery` mapping (add `projectId: typeof q.projectId === "string" ? q.projectId : undefined` and include it in `buildWorkItemQuery` — it is already a passthrough of all defined keys, and the global endpoint's `parseWorkItemQuery` strips it... so for project filtering on the GLOBAL page, pass it as a real filter the backend honors). To support project filtering on the global endpoint, allow `projectId` through: in `parseWorkItemQuery` keep stripping it ONLY for the project-scoped controller. Adjust: have the global controller pass `query.projectId` explicitly into `queryAllWorkItems` params. Implement by reading `projectId` in the global controller from the raw query and merging it into params after `parseWorkItemQuery`.

- [ ] **Step 4: Adjust the global controller to honor a projectId filter**

Update `work-item-global.controller.ts` `listAll` to accept an optional project filter:

```ts
@Get()
async listAll(@Query() query: Record<string, unknown>) {
  const params = parseWorkItemQuery(query);
  const projectId =
    typeof query.projectId === "string" && query.projectId.length > 0
      ? query.projectId
      : undefined;
  const data = await this.workItems.queryAllWorkItems({ ...params, projectId });
  return { success: true, data };
}
```

Add a unit test asserting a `projectId` query param reaches `queryAllWorkItems` (extend `work-item-query`/global controller spec). Run: `npm run test:kanban -- work-item-global` — expected PASS.

- [ ] **Step 5: Run the page tests to verify they pass**

Run: `npm run test:unit:web -- GlobalWorkItemsPage`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + lint the web app**

Run: `npm run lint:web`
Expected: exits 0 (no disables introduced).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx apps/web/src/pages/work-items/GlobalWorkItemsPage.spec.tsx apps/kanban/src/work-item/work-item-global.controller.ts apps/kanban/src/work-item/*.spec.ts
git commit -m "feat(web): server-side sortable/filterable/paginated global work items table"
```

---

## Task 10: Kanban board filter toolbar (client-side)

**Files:**

- Create: `apps/web/src/pages/kanban/useWorkItemFilters.ts`
- Create: `apps/web/src/pages/kanban/WorkItemFilterToolbar.tsx`
- Modify: `apps/web/src/pages/kanban/KanbanBoard.tsx`
- Test: `apps/web/src/pages/kanban/useWorkItemFilters.spec.ts`

The board keeps fetching its full set (drag-drop + WIP counts need it). The toolbar narrows what renders via an in-memory filter applied before `groupWorkItemsByStatus`. State syncs to URL params (`board_q`, `board_priority`, `board_scope`).

- [ ] **Step 1: Write the failing test for the filter hook**

```ts
// apps/web/src/pages/kanban/useWorkItemFilters.spec.ts
import { describe, expect, it } from "vitest";
import { filterWorkItems } from "./useWorkItemFilters";
import type { WorkItem } from "@/lib/api/types";

const items = [
  { id: "1", title: "Build login", priority: "p1", scope: "standard" },
  { id: "2", title: "Fix logout", priority: "p2", scope: "large" },
] as unknown as WorkItem[];

describe("filterWorkItems", () => {
  it("returns all items when no filter is active", () => {
    expect(filterWorkItems(items, {})).toHaveLength(2);
  });

  it("filters by case-insensitive title search", () => {
    const result = filterWorkItems(items, { search: "LOGIN" });
    expect(result.map((i) => i.id)).toEqual(["1"]);
  });

  it("filters by priority and scope", () => {
    expect(filterWorkItems(items, { priority: "p2" }).map((i) => i.id)).toEqual(
      ["2"],
    );
    expect(
      filterWorkItems(items, { scope: "standard" }).map((i) => i.id),
    ).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit:web -- useWorkItemFilters`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the hook + pure filter**

```ts
// apps/web/src/pages/kanban/useWorkItemFilters.ts
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { WorkItem } from "@/lib/api/types";

export interface WorkItemFilterState {
  search?: string;
  priority?: string;
  scope?: string;
}

export function filterWorkItems(
  items: WorkItem[],
  filters: WorkItemFilterState,
): WorkItem[] {
  return items.filter((item) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const haystack = `${item.title} ${item.description ?? ""}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.scope && item.scope !== filters.scope) return false;
    return true;
  });
}

export function useWorkItemFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: WorkItemFilterState = useMemo(
    () => ({
      search: searchParams.get("board_q") ?? undefined,
      priority: searchParams.get("board_priority") ?? undefined,
      scope: searchParams.get("board_scope") ?? undefined,
    }),
    [searchParams],
  );

  const setFilter = (key: keyof WorkItemFilterState, value: string) => {
    const next = new URLSearchParams(searchParams);
    const param = `board_${key === "search" ? "q" : key}`;
    if (value) next.set(param, value);
    else next.delete(param);
    setSearchParams(next, { replace: true });
  };

  return { filters, setFilter };
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `npm run test:unit:web -- useWorkItemFilters`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the toolbar component**

```tsx
// apps/web/src/pages/kanban/WorkItemFilterToolbar.tsx
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_SCOPE_OPTIONS,
} from "@/lib/work-items/work-item-filter-options";
import type { WorkItemFilterState } from "./useWorkItemFilters";

const ALL = "__all__";

export function WorkItemFilterToolbar({
  filters,
  onChange,
}: Readonly<{
  filters: WorkItemFilterState;
  onChange: (key: keyof WorkItemFilterState, value: string) => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search work items..."
        value={filters.search ?? ""}
        onChange={(e) => onChange("search", e.target.value)}
        className="h-8 w-56"
        aria-label="Search work items"
      />
      <Select
        value={filters.priority ?? ALL}
        onValueChange={(v) => onChange("priority", v === ALL ? "" : v)}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Filter by priority">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All priorities</SelectItem>
          {WORK_ITEM_PRIORITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.scope ?? ALL}
        onValueChange={(v) => onChange("scope", v === ALL ? "" : v)}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Filter by scope">
          <SelectValue placeholder="Scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All scopes</SelectItem>
          {WORK_ITEM_SCOPE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 6: Mount in KanbanBoard**

In `KanbanBoard.tsx`:

- Import `useWorkItemFilters`, `filterWorkItems`, `WorkItemFilterToolbar`.
- Call `const { filters, setFilter } = useWorkItemFilters();`.
- Apply `const visibleItems = useMemo(() => filterWorkItems(workItems, filters), [workItems, filters]);` where `workItems` is the fetched array, and feed `visibleItems` into the existing `groupWorkItemsByStatus` / readiness grouping instead of the raw array.
- Render `<WorkItemFilterToolbar filters={filters} onChange={setFilter} />` next to the existing readiness filter bar.
- Leave drag-drop handlers untouched — they operate on item ids, which still resolve against the full fetched set.

- [ ] **Step 7: Run the web unit suite for the board area + typecheck**

Run: `npm run test:unit:web -- kanban`
Then: `npm run lint:web`
Expected: PASS / exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/kanban/useWorkItemFilters.ts apps/web/src/pages/kanban/useWorkItemFilters.spec.ts apps/web/src/pages/kanban/WorkItemFilterToolbar.tsx apps/web/src/pages/kanban/KanbanBoard.tsx
git commit -m "feat(web): client-side search + filter toolbar on the kanban board"
```

---

## Task 11: Reconcile board data consumers with the new envelope

**Files:**

- Modify: `apps/web/src/pages/kanban/useKanbanBoardData.ts`
- Modify: any caller of `getProjectWorkItems` / `getAllWorkItems` expecting an array.
- Test: existing `useKanbanBoardData` / kanban tests.

`getProjectWorkItems` / `getAllWorkItems` now return `{ items, ... }`. The board and any other consumer must read `.items`.

- [ ] **Step 1: Find every consumer**

Run: `npm run test:unit:web -- kanban` and grep for `getProjectWorkItems(` / `getAllWorkItems(` usages.

Search: `getProjectWorkItems\(|getAllWorkItems\(` across `apps/web/src`.

- [ ] **Step 2: Update consumers**

In `useKanbanBoardData.ts` (and the deletion mutation cache writes in `GlobalWorkItemsPage` if they referenced raw arrays), change `queryFn: () => api.getProjectWorkItems(projectId)` to map to items, e.g.:

```ts
queryFn: async () => (await api.getProjectWorkItems(projectId, { limit: 200 })).items,
```

Keep the React Query data type as `WorkItem[]` so the rest of the board is unchanged. Use `limit: 200` (contract max) so the board still receives the full working set.

> If a project legitimately exceeds 200 work items on the board, that's a separate follow-up (board pagination is explicitly out of scope per the spec). Add a `log`/console note is unnecessary — just ensure the limit is the contract max.

- [ ] **Step 3: Run the kanban web tests**

Run: `npm run test:unit:web -- kanban`
Expected: PASS (fix any test that mocked the array return to return `{ items: [...] , total, limit, offset }`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/kanban/useKanbanBoardData.ts apps/web/src/pages/kanban/*.spec.*
git commit -m "fix(web): consume paginated work-item envelope on the kanban board"
```

---

## Task 12: E2E + full verification

**Files:**

- Modify: any E2E asserting the old list shape (`packages/e2e-tests`, `apps/web` Playwright, kanban deterministic E2E).

- [ ] **Step 1: Find E2E that hits the work-items endpoints**

Search `packages/e2e-tests` and `apps/web` Playwright specs for `/work-items` and `getAllWorkItems`. Update any assertion expecting a bare array to read `data.items`.

- [ ] **Step 2: Run the kanban unit + integration suites**

Run: `npm run test:kanban`
Run: `npm run test:integration:kanban-core`
Expected: PASS.

- [ ] **Step 3: Run the web unit suite**

Run: `npm run test:unit:web`
Expected: PASS.

- [ ] **Step 4: Build everything touched**

Run:

```bash
npm run build --workspace=packages/kanban-contracts
npm run build:kanban
npm run build:web
```

Expected: all exit 0.

- [ ] **Step 5: Lint summary**

Run: `npm run lint:summary`
Expected: no errors in apps/web, apps/kanban, packages/kanban-contracts.

- [ ] **Step 6: Commit any E2E fixups**

```bash
git add packages/e2e-tests apps/web
git commit -m "test: update work-item E2E for paginated list envelope"
```

---

## Task 13: Documentation

**Files:**

- Modify: `docs/guide/README.md` (or the relevant work-items/kanban deep-dive section).
- Modify: `apps/kanban/README.md` — document the new query params on the list endpoints.

- [ ] **Step 1: Document the list endpoint query params**

In `apps/kanban/README.md`, document `GET /work-items` and `GET /projects/:project_id/work-items` accepting `search`, `status`, `priority`, `scope`, `projectId` (global only), `sortBy`, `sortDir`, `limit` (≤200, default 50), `offset`, and returning `{ items, total, limit, offset }`.

- [ ] **Step 2: Note the UX capabilities in the guide**

Add a short paragraph to the work-items section of `docs/guide/README.md` describing the global page's search/sort/filter/pagination and the board's filter toolbar, including URL-state persistence.

- [ ] **Step 3: Commit**

```bash
git add docs/guide/README.md apps/kanban/README.md
git commit -m "docs: document work-item list query params and page UX"
```

---

## Self-Review notes (for the implementer)

- **Snake vs camel timestamps:** the list endpoint returns `updatedAt`/`createdAt` (camelCase, from `toWorkItemRecord`). The "Updated" column and `sortBy=updated_at` (a _query_ field name mapped to the DB column) are correct; do not try to read `item.updated_at` on the frontend for the global list.
- **No lint disables:** Task 8's URL-write effect must ship with a complete dependency list, not an `eslint-disable`. The sketch's disable comment is illustrative only — remove it.
- **`projectId` handling:** the project-scoped controller strips a query `projectId` (Task 4) and sets it from the path; the global controller honors it as a filter (Task 9 Step 4). These are intentionally different — keep both.
- **Board still fetches all (capped at 200):** pagination on the board is out of scope; the in-memory toolbar only hides cards.
- **Boundary:** all new backend code lives in `apps/kanban` + `packages/kanban-contracts`. No kanban identifiers added to `apps/api`/`packages/core`.
