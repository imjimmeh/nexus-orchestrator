# Charter Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the project charter from being silently destroyed, and move it out of the AI-memory store into its own durable, kanban-owned table.

**Architecture:** Three independent parts. **Part A (P0)** fixes two integration tests that `TRUNCATE` live tables when run against a dev machine — the actual cause of the data loss. **Part B (P2)** gives the charter its own `kanban_project_charter_items` table (kanban-owned), repointing the charter persistence methods while keeping every HTTP/MCP/web contract byte-identical (so only the storage layer changes). **Part C (P1)** is defense-in-depth: exempt project/charter rows from the memory reapers and verify the `CHARTER.md` git backup, so a charter is recoverable even if its row is lost.

**Tech Stack:** TypeScript, NestJS, TypeORM, PostgreSQL, Vitest. Two services: `apps/api` (owns `memory_segments` + reapers + the offending tests) and `apps/kanban` (owns the charter domain).

## Global Constraints

- **Core/Kanban boundary (CLAUDE.md):** `apps/api/src` and `packages/core/src` MUST stay Kanban-neutral. The new charter table, entity, repository, and migration MUST live in `apps/kanban`. Do NOT add project/charter domain concepts to `apps/api`.
- **Strict lint policy:** Never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **TDD:** Red → Green → Refactor for every task. Write the failing test first.
- **No contract churn:** The web charter tab (`apps/web`) and the two MCP tools must keep working unchanged. Preserve the `CharterMemoryRow` return shape and all controller/tool signatures.
- **NestJS build:** Use `nest build` via `npm run build:api` / `npm run build:kanban`, not raw `tsc`.
- **Commit cadence:** One commit per task (after its tests pass).
- **Branch:** Do all work on a feature branch (e.g. `fix/charter-durability`), not `main`. Verify `git branch --show-current` before each commit (concurrent agents move HEAD).

---

## Root Cause (for context — do not skip)

The charter (vision/requirements/constraints/etc.) is stored as rows in the **shared** `memory_segments` table with `entity_type='project'` and a `metadata_json->>'category'`. The file `apps/api/src/memory/memory-drift-detection.integration.spec.ts` connects to the **live dev DB** (`port 5433`, `database nexus_orchestrator` — its hardcoded defaults) whenever any of `DATABASE_URL`/`DB_HOST`/`DB_PORT`/`DB_DATABASE` is set (always true on a dev machine), and its `beforeEach` runs `TRUNCATE TABLE "memory_segments" RESTART IDENTITY CASCADE`. Running `npm run test:api` therefore wipes every project's charter. Goals survived the incident because they live in the separate `kanban_project_goals` table. The sibling `apps/api/src/gitops/reconciliation.integration.spec.ts` uses the same dangerous live-DB pattern.

---

# Part A — Stop the data loss (P0)

## Task A1: Gate the memory-drift integration test behind a dedicated test DB

**Files:**

- Modify: `apps/api/src/memory/memory-drift-detection.integration.spec.ts`

**Interfaces:**

- Produces: a reusable env contract — the destructive memory integration test runs **only** when `INTEGRATION_TEST_DATABASE_URL` is set, and **refuses** to truncate if connected to the application DB.

- [ ] **Step 1: Write the failing guard test**

Add this test to the spec file (outside the existing `describe.skipIf` block, so it always runs):

```typescript
describe("integration-test safety gate", () => {
  it("does not target the application database by default", () => {
    // The destructive suite must be gated on a DEDICATED throwaway DB,
    // never the everyday DB_HOST/DB_DATABASE the running app uses.
    const gatedOnDedicatedVar = Boolean(
      process.env["INTEGRATION_TEST_DATABASE_URL"],
    );
    const appDbVarsPresent = Boolean(
      process.env["DB_HOST"] ??
      process.env["DB_DATABASE"] ??
      process.env["DATABASE_URL"],
    );
    // If only app DB vars are present (the normal dev/CI case), the
    // destructive suite MUST be skipped.
    if (appDbVarsPresent && !gatedOnDedicatedVar) {
      expect(DB_AVAILABLE).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace=apps/api -- memory-drift-detection.integration`
Expected: FAIL — `DB_AVAILABLE` is currently `true` because it keys off `DB_HOST`.

- [ ] **Step 3: Replace the gate and the DB config**

Replace the `DB_AVAILABLE` block (currently lines ~126-131):

```typescript
// The destructive integration suite (it TRUNCATEs memory_segments)
// runs ONLY against a dedicated throwaway database, never the
// everyday application DB. Set INTEGRATION_TEST_DATABASE_URL to a
// disposable Postgres to enable it (CI provisions one). Absent that
// var the suite skips — so `npm run test:api` on a dev machine can
// never wipe live data.
const INTEGRATION_TEST_DATABASE_URL =
  process.env["INTEGRATION_TEST_DATABASE_URL"];
const DB_AVAILABLE = Boolean(INTEGRATION_TEST_DATABASE_URL);
```

Replace the `testDbConfig` object (currently lines ~153-173) so it is built from the dedicated URL only — drop the `DB_HOST`/`DB_DATABASE` fallbacks:

```typescript
const testDbConfig = {
  type: "postgres" as const,
  url: INTEGRATION_TEST_DATABASE_URL,
  entities: [MemorySegment],
  migrations: registeredMigrations,
  migrationsRun: true,
  migrationsTransactionMode: "none" as const,
  synchronize: false,
  logging: false,
};
```

- [ ] **Step 4: Add a runtime truncate-safety assertion**

Add this helper next to `truncateMemorySegments` and call it first inside that function:

```typescript
/**
 * Refuse to run the destructive TRUNCATE against the application
 * database, even if the connection string is misconfigured. The
 * application DB name comes from DB_DATABASE (default
 * `nexus_orchestrator`); the integration test must point at a
 * different, disposable database.
 */
async function assertNotApplicationDatabase(
  dataSource: DataSource,
): Promise<void> {
  const rows = await dataSource.query<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  const connected = rows[0]?.current_database;
  const appDb = process.env["DB_DATABASE"] ?? "nexus_orchestrator";
  if (connected === appDb) {
    throw new Error(
      `Refusing to TRUNCATE: integration test is connected to the application database "${connected}". ` +
        "Point INTEGRATION_TEST_DATABASE_URL at a dedicated throwaway database.",
    );
  }
}

async function truncateMemorySegments(dataSource: DataSource): Promise<void> {
  await assertNotApplicationDatabase(dataSource);
  await dataSource.query(
    'TRUNCATE TABLE "memory_segments" RESTART IDENTITY CASCADE;',
  );
}
```

- [ ] **Step 5: Run the guard test to verify it passes**

Run: `npm run test --workspace=apps/api -- memory-drift-detection.integration`
Expected: PASS. The destructive `describe.skipIf(!DB_AVAILABLE)` suite is now SKIPPED (no `INTEGRATION_TEST_DATABASE_URL` set), and the safety-gate test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory/memory-drift-detection.integration.spec.ts
git commit -m "fix(test): gate destructive memory integration test behind dedicated DB

The drift-detection integration test connected to the live dev DB
(port 5433/nexus_orchestrator) whenever DB_HOST was set and TRUNCATEd
memory_segments in beforeEach, silently destroying every project's
charter on each 'npm run test:api'. Gate it behind a dedicated
INTEGRATION_TEST_DATABASE_URL and refuse to truncate the app DB."
```

## Task A2: Apply the same gate to the gitops reconciliation integration test

**Files:**

- Modify: `apps/api/src/gitops/reconciliation.integration.spec.ts`

- [ ] **Step 1: Read the file** and locate its `DB_AVAILABLE`/`describe.skipIf` gate and any `TRUNCATE`/`DELETE`/destructive setup. It uses the same `DB_HOST`/`DB_DATABASE` pattern (the drift spec's docstring cites it as the source pattern).

- [ ] **Step 2: Write the failing guard test** — same shape as Task A1 Step 1 (assert the suite skips when only app DB vars are present).

- [ ] **Step 3: Run it** — Run: `npm run test --workspace=apps/api -- reconciliation.integration` — Expected: FAIL.

- [ ] **Step 4: Apply the identical fix** — gate on `INTEGRATION_TEST_DATABASE_URL`, build the datasource from that URL only, and add `assertNotApplicationDatabase(...)` before any destructive statement (TRUNCATE/DELETE) it runs.

- [ ] **Step 5: Run it** — Expected: PASS, destructive suite SKIPPED.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/gitops/reconciliation.integration.spec.ts
git commit -m "fix(test): gate gitops reconciliation integration test behind dedicated DB"
```

## Task A3: Document the dedicated-test-DB requirement

**Files:**

- Modify: `apps/api/README.md` (Testing section)

- [ ] **Step 1:** Add a short subsection stating that integration specs (`*.integration.spec.ts`) are destructive and run only when `INTEGRATION_TEST_DATABASE_URL` points at a disposable Postgres, never the dev/prod DB. Give the example: `INTEGRATION_TEST_DATABASE_URL=postgres://nexus:nexus_password@localhost:5433/nexus_orchestrator_it`.
- [ ] **Step 2: Commit**

```bash
git add apps/api/README.md
git commit -m "docs(api): document dedicated DB requirement for integration tests"
```

---

# Part B — Move the charter to its own table (P2)

**Design:** A new kanban-owned table `kanban_project_charter_items` holds charter items (the categorized vision/requirements/constraints/etc. that today are `memory_segments` rows with `entity_type='project'`). `ProjectMemorySummaryService`'s charter methods are repointed to a new repository, **returning the exact same `CharterMemoryRow` shape** so `CharterAggregateService`, `CharterDocRenderService`, `ProjectController`, the `record_project_memory` / `get_charter` MCP tools, and the web charter tab are all unchanged. Genuine AI project memory (`entity_type='kanban.project'`, used by `query_memory`) stays in `memory_segments` — untouched.

## Task B1: Create the charter-item entity

**Files:**

- Create: `apps/kanban/src/database/entities/kanban-project-charter-item.entity.ts`

**Interfaces:**

- Produces: `KanbanProjectCharterItemEntity` with fields `id: string`, `project_id: string`, `category: string`, `content: string`, `memory_type: string`, `source: string`, `version: number`, `created_at: Date`, `updated_at: Date`, table `kanban_project_charter_items`.

- [ ] **Step 1: Write the entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * A single charter item — one durable, human/agent-authored piece of
 * project intent (vision, requirement, constraint, decision, etc.).
 *
 * This is deliberately NOT stored in `memory_segments`: that table is
 * the AI runtime/learning memory store, swept by the decay and
 * eviction reapers and truncated by integration tests. The charter is
 * a source-of-truth document and must outlive all of that.
 */
@Entity("kanban_project_charter_items")
@Index("idx_kanban_project_charter_items_project", ["project_id"])
export class KanbanProjectCharterItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  project_id: string;

  /** Charter category, e.g. "vision" | "requirement" | "constraint". */
  @Column({ type: "varchar", length: 64 })
  category: string;

  @Column({ type: "text" })
  content: string;

  /** Mirrors the old memory_type ("fact" | "preference" | "history"). */
  @Column({ type: "varchar", length: 32, default: "fact" })
  memory_type: string;

  /** Provenance, e.g. "onboarding_chat" | "user_edit". */
  @Column({ type: "varchar", length: 64, default: "user_edit" })
  source: string;

  @Column({ type: "int", default: 1 })
  version: number;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;
}
```

- [ ] **Step 2: Commit** (entity-only; build verified in B3)

```bash
git add apps/kanban/src/database/entities/kanban-project-charter-item.entity.ts
git commit -m "feat(kanban): add project charter item entity"
```

## Task B2: Create the charter-item repository (TDD)

**Files:**

- Create: `apps/kanban/src/database/repositories/kanban-project-charter-item.repository.ts`
- Test: `apps/kanban/src/database/repositories/kanban-project-charter-item.repository.spec.ts`

**Interfaces:**

- Consumes: `KanbanProjectCharterItemEntity` (B1).
- Produces: `KanbanProjectCharterItemRepository` with:
  - `listByProject(projectId: string): Promise<KanbanProjectCharterItemEntity[]>` (ordered `created_at ASC`)
  - `create(input: { project_id: string; category: string; content: string; memory_type: string; source: string }): Promise<KanbanProjectCharterItemEntity>`
  - `updateContent(id: string, projectId: string, content: string): Promise<KanbanProjectCharterItemEntity | null>`
  - `deleteById(id: string, projectId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test** (mock the TypeORM `Repository`, follow `testing-unit-patterns`)

```typescript
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { KanbanProjectCharterItemEntity } from "../entities/kanban-project-charter-item.entity";
import { KanbanProjectCharterItemRepository } from "./kanban-project-charter-item.repository";

describe("KanbanProjectCharterItemRepository", () => {
  let repo: KanbanProjectCharterItemRepository;
  let typeorm: {
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    typeorm = {
      find: vi.fn(),
      save: vi.fn(),
      create: vi.fn((x) => x),
      findOne: vi.fn(),
      delete: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        KanbanProjectCharterItemRepository,
        {
          provide: getRepositoryToken(KanbanProjectCharterItemEntity),
          useValue: typeorm,
        },
      ],
    }).compile();
    repo = moduleRef.get(KanbanProjectCharterItemRepository);
  });

  it("lists items for a project ordered by created_at asc", async () => {
    typeorm.find.mockResolvedValue([{ id: "1" }]);
    const result = await repo.listByProject("p1");
    expect(typeorm.find).toHaveBeenCalledWith({
      where: { project_id: "p1" },
      order: { created_at: "ASC" },
    });
    expect(result).toEqual([{ id: "1" }]);
  });

  it("creates an item with version 1", async () => {
    typeorm.save.mockImplementation(async (x) => ({ id: "new", ...x }));
    const created = await repo.create({
      project_id: "p1",
      category: "vision",
      content: "c",
      memory_type: "fact",
      source: "user_edit",
    });
    expect(created.version).toBe(1);
    expect(created.category).toBe("vision");
  });

  it("returns null when updating a non-existent item", async () => {
    typeorm.findOne.mockResolvedValue(null);
    expect(await repo.updateContent("x", "p1", "new")).toBeNull();
  });

  it("reports false when deleting nothing", async () => {
    typeorm.delete.mockResolvedValue({ affected: 0 });
    expect(await repo.deleteById("x", "p1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — Run: `npm run test --workspace=apps/kanban -- kanban-project-charter-item.repository` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanProjectCharterItemEntity } from "../entities/kanban-project-charter-item.entity";

@Injectable()
export class KanbanProjectCharterItemRepository {
  constructor(
    @InjectRepository(KanbanProjectCharterItemEntity)
    private readonly repo: Repository<KanbanProjectCharterItemEntity>,
  ) {}

  listByProject(projectId: string): Promise<KanbanProjectCharterItemEntity[]> {
    return this.repo.find({
      where: { project_id: projectId },
      order: { created_at: "ASC" },
    });
  }

  create(input: {
    project_id: string;
    category: string;
    content: string;
    memory_type: string;
    source: string;
  }): Promise<KanbanProjectCharterItemEntity> {
    return this.repo.save(this.repo.create({ ...input, version: 1 }));
  }

  async updateContent(
    id: string,
    projectId: string,
    content: string,
  ): Promise<KanbanProjectCharterItemEntity | null> {
    const existing = await this.repo.findOne({
      where: { id, project_id: projectId },
    });
    if (!existing) return null;
    existing.content = content;
    return this.repo.save(existing);
  }

  async deleteById(id: string, projectId: string): Promise<boolean> {
    const result = await this.repo.delete({ id, project_id: projectId });
    return (result.affected ?? 0) > 0;
  }
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-project-charter-item.repository.ts apps/kanban/src/database/repositories/kanban-project-charter-item.repository.spec.ts
git commit -m "feat(kanban): add project charter item repository"
```

## Task B3: Register entity + repository + write the migration

**Files:**

- Create: `apps/kanban/src/database/migrations/20260624120000-create-kanban-project-charter-items.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanProjectCharterItems20260624120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_project_charter_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        category character varying(64) NOT NULL,
        content text NOT NULL,
        memory_type character varying(32) NOT NULL DEFAULT 'fact',
        source character varying(64) NOT NULL DEFAULT 'user_edit',
        version integer NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_project_charter_items_project
        ON kanban_project_charter_items(project_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_project_charter_items",
    );
  }
}
```

- [ ] **Step 2: Register in `database.module.ts`** — add the three imports near the other entity/repository/migration imports, then add to each array:

```typescript
// imports
import { KanbanProjectCharterItemEntity } from "./entities/kanban-project-charter-item.entity";
import { KanbanProjectCharterItemRepository } from "./repositories/kanban-project-charter-item.repository";
import { CreateKanbanProjectCharterItems20260624120000 } from "./migrations/20260624120000-create-kanban-project-charter-items";

// add to `entities` array:
  KanbanProjectCharterItemEntity,
// add to `repositories` array:
  KanbanProjectCharterItemRepository,
// add to `migrations` array (newest, append):
  CreateKanbanProjectCharterItems20260624120000,
```

- [ ] **Step 3: Build to verify wiring**

Run: `npm run build --workspace=packages/core && npm run build:kanban`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/migrations/20260624120000-create-kanban-project-charter-items.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): register charter item entity/repo and add migration"
```

## Task B4: Repoint `ProjectMemorySummaryService` charter methods (TDD)

**Files:**

- Modify: `apps/kanban/src/project/project-memory-summary.service.ts`
- Modify: `apps/kanban/src/project/project-memory-summary.service.spec.ts` (create if absent)
- Read first: `apps/kanban/src/project/project-memory-summary.service.types.ts` to confirm the exact `CharterMemoryRow` shape.

**Interfaces:**

- Consumes: `KanbanProjectCharterItemRepository` (B2).
- Produces: unchanged public method signatures — `getCharterMemories`, `createCharterMemory`, `createProjectMemory`, `updateCharterMemory`, `deleteCharterMemory` — all still returning `CharterMemoryRow` / `CharterMemoryRow[]` / `boolean`. Only the storage backend changes from `memory_segments` raw SQL to the repository.

**Note:** `getProjectMemorySummary` and `getProjectMemorySegments` (which query `entity_type='kanban.project'`) are genuine AI memory and MUST be left on `memory_segments` unchanged.

- [ ] **Step 1: Write failing tests** asserting charter CRUD goes through the new repository and preserves the `CharterMemoryRow` shape:

```typescript
// In project-memory-summary.service.spec.ts
it("getCharterMemories maps charter items to CharterMemoryRow shape", async () => {
  charterRepo.listByProject.mockResolvedValue([
    {
      id: "a",
      category: "vision",
      content: "V",
      memory_type: "fact",
      source: "onboarding_chat",
      version: 1,
      created_at: new Date("2026-01-01"),
      updated_at: new Date("2026-01-02"),
    },
  ]);
  const rows = await service.getCharterMemories("p1");
  expect(rows[0]).toMatchObject({
    id: "a",
    content: "V",
    memory_type: "fact",
    metadata: { category: "vision", source: "onboarding_chat" },
  });
  expect(charterRepo.listByProject).toHaveBeenCalledWith("p1");
});

it("createProjectMemory persists a charter item and enqueues regen", async () => {
  charterRepo.create.mockResolvedValue({
    id: "n",
    category: "requirement",
    content: "R",
    memory_type: "fact",
    source: "onboarding_chat",
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await service.createProjectMemory("p1", {
    category: "requirement",
    content: "R",
    source: "onboarding_chat",
  });
  expect(charterRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      project_id: "p1",
      category: "requirement",
      content: "R",
      source: "onboarding_chat",
    }),
  );
  expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
});
```

(Provide `charterRepo` and `charterRegen` as mocks in the testing module; mock `DataSource` for the untouched AI-memory methods.)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — inject the repository and rewrite the five charter methods. Add a private mapper and replace each method body:

```typescript
// constructor: add
constructor(
  private readonly dataSource: DataSource,
  private readonly charterRegen: CharterRegenEnqueuer,
  private readonly charterItems: KanbanProjectCharterItemRepository,
) {}

private toCharterRow(item: KanbanProjectCharterItemEntity): CharterMemoryRow {
  return {
    id: item.id,
    content: item.content,
    memory_type: item.memory_type,
    metadata: { category: item.category, source: item.source },
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

async getCharterMemories(projectId: string): Promise<CharterMemoryRow[]> {
  const items = await this.charterItems.listByProject(projectId);
  return items.map((i) => this.toCharterRow(i));
}

async createCharterMemory(
  projectId: string, category: string, content: string, memoryType: string,
): Promise<CharterMemoryRow> {
  const item = await this.charterItems.create({
    project_id: projectId, category, content, memory_type: memoryType, source: "user_edit",
  });
  await this.charterRegen.enqueue(projectId);
  return this.toCharterRow(item);
}

async createProjectMemory(
  projectId: string,
  input: { category: string; content: string; source: string; memoryType?: string; confidence?: number },
): Promise<CharterMemoryRow> {
  const memoryType = input.category === "preference" ? "preference" : (input.memoryType ?? "fact");
  const item = await this.charterItems.create({
    project_id: projectId, category: input.category, content: input.content,
    memory_type: memoryType, source: input.source,
  });
  await this.charterRegen.enqueue(projectId);
  return this.toCharterRow(item);
}

async updateCharterMemory(
  memoryId: string, projectId: string, content: string,
): Promise<CharterMemoryRow | null> {
  const item = await this.charterItems.updateContent(memoryId, projectId, content);
  await this.charterRegen.enqueue(projectId);
  return item ? this.toCharterRow(item) : null;
}

async deleteCharterMemory(memoryId: string, projectId: string): Promise<boolean> {
  const deleted = await this.charterItems.deleteById(memoryId, projectId);
  await this.charterRegen.enqueue(projectId);
  return deleted;
}
```

If `confidence` is part of `CharterMemoryRow`/contracts in practice, drop it — the charter table intentionally omits the AI-memory `confidence` field (it is not a decaying memory). Confirm no caller reads `metadata.confidence` for charter (the web tab reads only `category` and content).

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Build both affected services** — Run: `npm run build:kanban` — Expected: clean.
- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/project/project-memory-summary.service.ts apps/kanban/src/project/project-memory-summary.service.spec.ts
git commit -m "feat(kanban): persist charter to dedicated table instead of memory_segments"
```

## Task B5: Verify downstream consumers still pass (no contract change expected)

**Files (read/verify only, modify only if a test breaks):**

- `apps/kanban/src/project/charter-aggregate.service.ts`
- `apps/kanban/src/project/charter-doc-render.service.ts`
- `apps/kanban/src/project/project.controller.ts` (charter + charter-memories endpoints)
- `apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.ts`
- `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`

- [ ] **Step 1:** Run the full kanban suite — Run: `npm run test:kanban` — Expected: PASS. These all call the repointed service methods and consume `CharterMemoryRow`, which is unchanged, so they should need no edits.
- [ ] **Step 2:** If any test references `memory_segments` for charter specifically, update it to the new table/path. Otherwise no commit needed.
- [ ] **Step 3 (if edits were required): Commit**

```bash
git commit -am "test(kanban): align charter consumers with dedicated charter table"
```

## Task B6: Add a kanban-core deterministic E2E for charter persistence

**Files:**

- Create or extend a kanban E2E under the existing deterministic suite (see `npm run test:e2e:kanban:deterministic`).

- [ ] **Step 1: Write the failing E2E** — create a project, POST a charter memory via `/projects/:id/charter-memories`, GET `/projects/:id/charter`, assert the item appears under its category; then assert it does NOT appear in `memory_segments` (query the new table instead). This proves the storage moved and the contract held.
- [ ] **Step 2: Run** — Expected: FAIL before deploy/migration, PASS after.
- [ ] **Step 3: Commit**

```bash
git commit -am "test(kanban): e2e charter persists to dedicated table and round-trips via API"
```

---

# Part C — Durability & defense-in-depth (P1)

> With Part B done, the charter no longer lives in `memory_segments`, so the reapers can no longer reach it. Part C is belt-and-suspenders for the migration window plus the recoverable git backup.

## Task C1: Exempt project/charter rows from the eviction reaper

**Files:**

- Modify: `apps/api/src/memory/memory-eviction.constants.ts` (the `DEFAULT_PROTECTED_SOURCES` list)
- Test: `apps/api/src/memory/memory-eviction.reaper.spec.ts`

- [ ] **Step 1: Write a failing test** asserting a `memory_segments` row with `source IN ('onboarding_chat','user_edit')` is NOT selected as an eviction candidate. (Follow the reaper spec's existing candidate-selection test pattern.)
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** Add `'onboarding_chat'` and `'user_edit'` to `DEFAULT_PROTECTED_SOURCES`. Also update the live SystemSetting default note. (Operators can override `memory_segment_eviction_protected_sources`; document the new defaults.)
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/memory-eviction.constants.ts apps/api/src/memory/memory-eviction.reaper.spec.ts
git commit -m "fix(memory): protect charter-origin sources from eviction reaper"
```

## Task C2: Exempt project/charter rows from the decay reaper

**Files:**

- Modify: `apps/api/src/memory/memory-decay.constants.ts` (`MEMORY_DECAY_EXEMPT_SOURCES`)
- Test: `apps/api/src/memory/memory-decay.reaper.spec.ts`

- [ ] **Step 1: Write a failing test** — a row with `source IN ('onboarding_chat','user_edit')` is not a decay candidate.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3:** Add the two sources to `MEMORY_DECAY_EXEMPT_SOURCES`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/memory-decay.constants.ts apps/api/src/memory/memory-decay.reaper.spec.ts
git commit -m "fix(memory): exempt charter-origin sources from decay reaper"
```

## Task C3: Verify the CHARTER.md git backup actually fires

**Files (investigate first):**

- `apps/kanban/src/project/charter-regen.processor.ts`
- `apps/kanban/src/project/charter-regen.enqueuer.ts`
- `apps/kanban/src/project/charter-regen-reconciliation.service.ts`

Context: project `458935f0` had charter rows but **no `CHARTER.md` was ever committed** to its clone (`/data/nexus-workspaces/clones/458935f0-.../docs/project-context/`). The regen→`core.writeRepoFile(push:true)` path either never ran (worker not consuming the `charter-regen` queue) or failed silently.

- [ ] **Step 1: Reproduce** — use `superpowers:systematic-debugging`. After deploying Parts A/B, create a charter item on a test project and check whether `charter-regen` job runs and whether `CHARTER.md` lands + commits in the clone. Capture the processor logs (`charter-regen skipped`/`charter-regen failed` warnings).
- [ ] **Step 2: Write a failing test** for the specific defect found (e.g. enqueue not wired on the new charter path, or `writeRepoFile` error swallowed). Do NOT write speculative code before the defect is identified.
- [ ] **Step 3: Fix the root cause** and make the test pass.
- [ ] **Step 4: Add a recovery path** — confirm `CharterRegenReconciliationService` sweep (15-min interval) rebuilds `CHARTER.md` for projects whose charter exists in DB but is missing on disk, so the file is a reliable backup.
- [ ] **Step 5: Commit** with a message describing the identified root cause.

---

# Deploy & Verify (after all parts merged)

- [ ] `npm run build --workspace=packages/core && npm run build:api && npm run build:kanban` — all clean.
- [ ] `npm run lint:api && npm run lint:kanban` — clean (no suppressions).
- [ ] `npm run test:api && npm run test:kanban` — green, and confirm the destructive integration suites are SKIPPED (no `INTEGRATION_TEST_DATABASE_URL`).
- [ ] Rebuild + redeploy `nexus-kanban` (runs the new migration on boot via `migrationsRun`) and `nexus-api`.
- [ ] Recreate the charter for project `458935f0` via the create-charter workflow (per user: prior content is not recoverable from the wiped table).
- [ ] Confirm in the charter tab that items persist, and confirm `CHARTER.md` now appears + commits in the project clone.
- [ ] Re-run `npm run test:api` against the live stack and confirm the charter survives (the regression that started this).

---

## Self-Review Notes

- **Spec coverage:** P0 (A1-A2, +A3 docs), P1 (C1-C2 reapers, C3 git backup), P2 (B1-B6 new table + repoint + e2e). All three approved scopes covered.
- **Contract stability:** `CharterMemoryRow` shape preserved in B4 → web/tools/aggregate/render unchanged (B5 verifies).
- **Boundary:** new table/entity/repo/migration all under `apps/kanban`; api changes (A1-A2, C1-C2) are memory/test-infra only, Kanban-neutral.
- **Type consistency:** repository method names (`listByProject`/`create`/`updateContent`/`deleteById`) used identically in B2 and B4.
- **Known investigation task:** C3 intentionally defers code to post-reproduction (systematic-debugging) rather than guessing — flagged explicitly, not a placeholder for routine code.
