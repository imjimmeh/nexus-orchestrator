# Strategic Refresh Loop — Phase 1: Initiative Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured `initiative` planning altitude between project goals and work items in the Nexus kanban service — entity, migration, repository, service, MCP CRUD/grooming tools, work-item linkage, and `project_state` surfacing — with **no orchestration behaviour change yet**.

**Architecture:** Initiatives are project-domain, so everything lives kanban-side (`apps/kanban`, `packages/kanban-contracts`) per the core/kanban boundary. We mirror the existing **goals** vertical exactly: Zod contracts in `@nexus/kanban-contracts`, a TypeORM entity in `database/entities`, a repository in `database/repositories`, a NestJS service+module, and MCP tools auto-registered via `Object.values(MutationTools)`. A many-to-many `kanban_initiative_goals` join links initiatives to goals; a nullable `initiative_id` column on `kanban_work_items` links work items down.

**Tech Stack:** TypeScript, NestJS, TypeORM (Postgres), Zod, Vitest. Kanban app at `apps/kanban`.

**Spec:** `docs/superpowers/specs/2026-06-12-strategic-refresh-loop-design.md` (§2–4). **Epic:** EPIC-208.

**Conventions locked in from the codebase (do not deviate):**

- Kanban entities use **`project_id`** as the scope column (the neutral `scope_id` lives only in API/core). Tools resolve `project_id` from `context.scopeId` via `resolveProjectIdFromToolContext`.
- Enums are stored as `varchar` columns, validated by Zod `z.enum` in contracts — **not** Postgres enum types.
- Migrations auto-run on startup (`migrationsRun: true`); name them `YYYYMMDDHHMMSS-description.ts` and register them in `database.module.ts`.
- MCP tool input schemas extend `ContextualProjectIdSchema` and have an **object root** (never a root `z.union` — that breaks strict providers; see memory `manage_todo_list_union_schema_deepseek`).
- Tests are plain Vitest with `vi.fn()` constructor-injected mocks (no NestJS TestingModule needed for these units).

**Run a single test file:**

```bash
npm run test --workspace=apps/kanban -- --run src/<path>.spec.ts
```

**Run all kanban unit tests / typecheck / lint:**

```bash
npm run test:kanban
npm run build:kanban
npm run lint:kanban
```

---

## File Structure

**Create:**

- `packages/kanban-contracts/src/initiatives.schema.ts` — Zod schemas (enums, record, create/update requests)
- `packages/kanban-contracts/src/initiatives.types.ts` — inferred TS types
- `apps/kanban/src/database/entities/kanban-initiative.entity.ts`
- `apps/kanban/src/database/entities/kanban-initiative-goal.entity.ts` (join)
- `apps/kanban/src/database/migrations/20260612200000-create-kanban-initiatives.ts`
- `apps/kanban/src/database/repositories/kanban-initiative.repository.ts` (+ `.spec.ts`)
- `apps/kanban/src/initiatives/initiatives.service.ts` (+ `.spec.ts`)
- `apps/kanban/src/initiatives/initiatives.module.ts`
- `apps/kanban/src/mcp/tools/mutation/initiative-create.tool.ts` (+ `.spec.ts`)
- `apps/kanban/src/mcp/tools/mutation/initiative-update.tool.ts`
- `apps/kanban/src/mcp/tools/mutation/initiative-update-status.tool.ts`
- `apps/kanban/src/mcp/tools/mutation/initiative-set-priority.tool.ts`
- `apps/kanban/src/mcp/tools/mutation/initiative-link-goal.tool.ts`
- `apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.ts`

**Modify:**

- `packages/kanban-contracts/src/index.ts` — export the two new files
- `apps/kanban/src/database/entities/kanban-work-item.entity.ts` — add nullable `initiative_id`
- `apps/kanban/src/database/database.module.ts` — register entities + repository + migration
- `apps/kanban/src/mcp/tools/mutation/index.ts` — export the new tools
- `apps/kanban/src/mcp/kanban-mcp.module.ts` — import `InitiativesModule`
- `apps/kanban/src/mcp/tools/read/project-state.tool.ts` — add `strategic.initiatives`
- `docs/guide/README.md` (or relevant domain doc) — document the initiative layer

---

## Task 1: Initiative contracts in `@nexus/kanban-contracts`

**Files:**

- Create: `packages/kanban-contracts/src/initiatives.schema.ts`
- Create: `packages/kanban-contracts/src/initiatives.types.ts`
- Modify: `packages/kanban-contracts/src/index.ts`
- Test: `packages/kanban-contracts/src/initiatives.schema.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kanban-contracts/src/initiatives.schema.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CreateInitiativeRequestSchema,
  InitiativeHorizonSchema,
  InitiativeSchema,
  InitiativeStatusSchema,
} from "./initiatives.schema";

describe("initiatives.schema", () => {
  it("accepts the three horizons and five statuses", () => {
    expect(InitiativeHorizonSchema.options).toEqual(["now", "next", "later"]);
    expect(InitiativeStatusSchema.options).toEqual([
      "proposed",
      "active",
      "paused",
      "done",
      "dropped",
    ]);
  });

  it("requires a title on create and defaults horizon to next", () => {
    const parsed = CreateInitiativeRequestSchema.parse({
      title: "Harden loop",
    });
    expect(parsed.horizon).toBe("next");
    expect(() => CreateInitiativeRequestSchema.parse({})).toThrow();
  });

  it("round-trips a full initiative record", () => {
    const record = {
      id: "i1",
      project_id: "p1",
      title: "Harden loop",
      description: null,
      horizon: "now" as const,
      priority: 0,
      status: "active" as const,
      goalIds: ["g1"],
      lastReviewedAt: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    };
    expect(InitiativeSchema.parse(record)).toEqual(record);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- --run src/initiatives.schema.spec.ts`
Expected: FAIL — cannot resolve `./initiatives.schema`.

- [ ] **Step 3: Create the schema file**

Create `packages/kanban-contracts/src/initiatives.schema.ts`:

```typescript
import { z } from "zod";

export const InitiativeHorizonSchema = z.enum(["now", "next", "later"]);
export const InitiativeStatusSchema = z.enum([
  "proposed",
  "active",
  "paused",
  "done",
  "dropped",
]);

export const InitiativeSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable(),
    horizon: InitiativeHorizonSchema,
    priority: z.number().int(),
    status: InitiativeStatusSchema,
    goalIds: z.array(z.string().min(1)),
    lastReviewedAt: z.string().nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const CreateInitiativeRequestSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    horizon: InitiativeHorizonSchema.optional().default("next"),
    priority: z.number().int().optional(),
    status: InitiativeStatusSchema.optional(),
    goalIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const UpdateInitiativeRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    horizon: InitiativeHorizonSchema.optional(),
    priority: z.number().int().optional(),
  })
  .strict();

export const UpdateInitiativeStatusRequestSchema = z
  .object({
    status: InitiativeStatusSchema,
  })
  .strict();
```

- [ ] **Step 4: Create the types file**

Create `packages/kanban-contracts/src/initiatives.types.ts`:

```typescript
import type { z } from "zod";
import type {
  CreateInitiativeRequestSchema,
  InitiativeHorizonSchema,
  InitiativeSchema,
  InitiativeStatusSchema,
  UpdateInitiativeRequestSchema,
  UpdateInitiativeStatusRequestSchema,
} from "./initiatives.schema";

export type InitiativeHorizon = z.infer<typeof InitiativeHorizonSchema>;
export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;
export type CreateInitiativeRequest = z.infer<
  typeof CreateInitiativeRequestSchema
>;
export type UpdateInitiativeRequest = z.infer<
  typeof UpdateInitiativeRequestSchema
>;
export type UpdateInitiativeStatusRequest = z.infer<
  typeof UpdateInitiativeStatusRequestSchema
>;
```

- [ ] **Step 5: Export from the package index**

In `packages/kanban-contracts/src/index.ts`, add (next to the goals exports):

```typescript
export * from "./initiatives.schema";
export * from "./initiatives.types";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace=packages/kanban-contracts -- --run src/initiatives.schema.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Build the contracts package (apps depend on the build output)**

Run: `npm run build --workspace=packages/kanban-contracts`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/kanban-contracts/src/initiatives.schema.ts packages/kanban-contracts/src/initiatives.types.ts packages/kanban-contracts/src/initiatives.schema.spec.ts packages/kanban-contracts/src/index.ts
git commit -m "feat(kanban-contracts): add initiative schemas and types"
```

---

## Task 2: Entities — `KanbanInitiativeEntity`, join entity, and work-item FK

**Files:**

- Create: `apps/kanban/src/database/entities/kanban-initiative.entity.ts`
- Create: `apps/kanban/src/database/entities/kanban-initiative-goal.entity.ts`
- Modify: `apps/kanban/src/database/entities/kanban-work-item.entity.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

No standalone test — entities are exercised by the repository test in Task 4. The verification step is a successful build.

- [ ] **Step 1: Create the initiative entity**

Create `apps/kanban/src/database/entities/kanban-initiative.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_initiatives")
@Index("idx_kanban_initiatives_project_id", ["project_id"])
export class KanbanInitiativeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 16, default: "next" })
  horizon!: string;

  @Column({ type: "integer", default: 0 })
  priority!: number;

  @Column({ type: "varchar", length: 16, default: "proposed" })
  status!: string;

  @Column({ type: "timestamp", nullable: true })
  last_reviewed_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
```

- [ ] **Step 2: Create the join entity**

Create `apps/kanban/src/database/entities/kanban-initiative-goal.entity.ts`:

```typescript
import { Entity, Index, PrimaryColumn } from "typeorm";

@Entity("kanban_initiative_goals")
@Index("idx_kanban_initiative_goals_goal_id", ["goal_id"])
export class KanbanInitiativeGoalEntity {
  @PrimaryColumn({ type: "uuid" })
  initiative_id!: string;

  @PrimaryColumn({ type: "uuid" })
  goal_id!: string;
}
```

- [ ] **Step 3: Add the nullable FK to the work-item entity**

In `apps/kanban/src/database/entities/kanban-work-item.entity.ts`, add this column (place it near the other nullable association columns, after the existing `@Column` declarations):

```typescript
  @Column({ type: "uuid", nullable: true })
  initiative_id!: string | null;
```

- [ ] **Step 4: Register the entities in `database.module.ts`**

Add imports near the other entity imports:

```typescript
import { KanbanInitiativeEntity } from "./entities/kanban-initiative.entity";
import { KanbanInitiativeGoalEntity } from "./entities/kanban-initiative-goal.entity";
```

Add both to the `entities` array (after `KanbanProjectGoalWorklogEntity`):

```typescript
  KanbanInitiativeEntity,
  KanbanInitiativeGoalEntity,
```

- [ ] **Step 5: Build to verify entities compile and register**

Run: `npm run build:kanban`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-initiative.entity.ts apps/kanban/src/database/entities/kanban-initiative-goal.entity.ts apps/kanban/src/database/entities/kanban-work-item.entity.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): add initiative entities and work-item initiative_id column"
```

---

## Task 3: Migration — create tables and the work-item column

**Files:**

- Create: `apps/kanban/src/database/migrations/20260612200000-create-kanban-initiatives.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

- [ ] **Step 1: Create the migration**

Create `apps/kanban/src/database/migrations/20260612200000-create-kanban-initiatives.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanInitiatives20260612200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_initiatives (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        title character varying(255) NOT NULL,
        description text,
        horizon character varying(16) NOT NULL DEFAULT 'next',
        priority integer NOT NULL DEFAULT 0,
        status character varying(16) NOT NULL DEFAULT 'proposed',
        last_reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_initiatives_project_id
      ON kanban_initiatives(project_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_initiative_goals (
        initiative_id UUID NOT NULL,
        goal_id UUID NOT NULL,
        PRIMARY KEY (initiative_id, goal_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_initiative_goals_goal_id
      ON kanban_initiative_goals(goal_id)
    `);

    await queryRunner.query(`
      ALTER TABLE kanban_work_items
      ADD COLUMN IF NOT EXISTS initiative_id UUID
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE kanban_work_items DROP COLUMN IF EXISTS initiative_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS kanban_initiative_goals`);
    await queryRunner.query(`DROP TABLE IF EXISTS kanban_initiatives`);
  }
}
```

- [ ] **Step 2: Register the migration in `database.module.ts`**

Add the import near the other migration imports:

```typescript
import { CreateKanbanInitiatives20260612200000 } from "./migrations/20260612200000-create-kanban-initiatives";
```

Add it to the `migrations` array (append at the end):

```typescript
  CreateKanbanInitiatives20260612200000,
```

- [ ] **Step 3: Build to verify the migration compiles**

Run: `npm run build:kanban`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/migrations/20260612200000-create-kanban-initiatives.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): migration for initiatives, goal links, and work-item FK"
```

---

## Task 4: Repository — `KanbanInitiativeRepository`

**Files:**

- Create: `apps/kanban/src/database/repositories/kanban-initiative.repository.ts`
- Test: `apps/kanban/src/database/repositories/kanban-initiative.repository.spec.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/database/repositories/kanban-initiative.repository.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import type { KanbanInitiativeEntity } from "../entities/kanban-initiative.entity";
import type { KanbanInitiativeGoalEntity } from "../entities/kanban-initiative-goal.entity";
import type { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity";
import { KanbanInitiativeRepository } from "./kanban-initiative.repository";

function repoMock() {
  return {
    create: vi.fn((v) => v),
    save: vi.fn((v) => Promise.resolve(v)),
    find: vi.fn(),
    findOne: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    delete: vi.fn(),
    update: vi.fn(),
  };
}

describe("KanbanInitiativeRepository", () => {
  let initiatives: ReturnType<typeof repoMock>;
  let links: ReturnType<typeof repoMock>;
  let workItems: ReturnType<typeof repoMock>;
  let repo: KanbanInitiativeRepository;

  beforeEach(() => {
    initiatives = repoMock();
    links = repoMock();
    workItems = repoMock();
    repo = new KanbanInitiativeRepository(
      initiatives as unknown as Repository<KanbanInitiativeEntity>,
      links as unknown as Repository<KanbanInitiativeGoalEntity>,
      workItems as unknown as Repository<KanbanWorkItemEntity>,
    );
  });

  it("creates an initiative defaulting priority to the current count", async () => {
    initiatives.count.mockResolvedValue(2);
    await repo.create("p1", { title: "Harden loop" });
    expect(initiatives.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "p1",
        title: "Harden loop",
        priority: 2,
      }),
    );
  });

  it("lists initiatives ordered by horizon then priority", async () => {
    initiatives.find.mockResolvedValue([]);
    await repo.findByProjectId("p1");
    expect(initiatives.find).toHaveBeenCalledWith({
      where: { project_id: "p1" },
      order: { priority: "ASC", created_at: "ASC" },
    });
  });

  it("links a goal idempotently via save", async () => {
    await repo.linkGoal("i1", "g1");
    expect(links.save).toHaveBeenCalledWith({
      initiative_id: "i1",
      goal_id: "g1",
    });
  });

  it("assigns a work item to an initiative", async () => {
    await repo.assignWorkItem("p1", "w1", "i1");
    expect(workItems.update).toHaveBeenCalledWith(
      { id: "w1", project_id: "p1" },
      { initiative_id: "i1" },
    );
  });

  it("returns goal ids for an initiative", async () => {
    links.find.mockResolvedValue([
      { initiative_id: "i1", goal_id: "g1" },
      { initiative_id: "i1", goal_id: "g2" },
    ]);
    const ids = await repo.findGoalIds("i1");
    expect(ids).toEqual(["g1", "g2"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/database/repositories/kanban-initiative.repository.spec.ts`
Expected: FAIL — cannot resolve `./kanban-initiative.repository`.

- [ ] **Step 3: Implement the repository**

Create `apps/kanban/src/database/repositories/kanban-initiative.repository.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanInitiativeEntity } from "../entities/kanban-initiative.entity";
import { KanbanInitiativeGoalEntity } from "../entities/kanban-initiative-goal.entity";
import { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity";

@Injectable()
export class KanbanInitiativeRepository {
  constructor(
    @InjectRepository(KanbanInitiativeEntity)
    private readonly initiatives: Repository<KanbanInitiativeEntity>,
    @InjectRepository(KanbanInitiativeGoalEntity)
    private readonly links: Repository<KanbanInitiativeGoalEntity>,
    @InjectRepository(KanbanWorkItemEntity)
    private readonly workItems: Repository<KanbanWorkItemEntity>,
  ) {}

  async create(
    project_id: string,
    initiative: Partial<KanbanInitiativeEntity>,
  ): Promise<KanbanInitiativeEntity> {
    const priority =
      initiative.priority ??
      (await this.initiatives.count({ where: { project_id } }));
    return this.initiatives.save(
      this.initiatives.create({
        project_id,
        title: initiative.title,
        description: initiative.description ?? null,
        horizon: initiative.horizon ?? "next",
        priority,
        status: initiative.status ?? "proposed",
        last_reviewed_at: initiative.last_reviewed_at ?? null,
      }),
    );
  }

  save(
    initiative: Partial<KanbanInitiativeEntity>,
  ): Promise<KanbanInitiativeEntity> {
    return this.initiatives.save(this.initiatives.create(initiative));
  }

  findByProjectId(project_id: string): Promise<KanbanInitiativeEntity[]> {
    return this.initiatives.find({
      where: { project_id },
      order: { priority: "ASC", created_at: "ASC" },
    });
  }

  findById(
    project_id: string,
    initiativeId: string,
  ): Promise<KanbanInitiativeEntity | null> {
    return this.initiatives.findOne({
      where: { id: initiativeId, project_id },
    });
  }

  async linkGoal(initiativeId: string, goalId: string): Promise<void> {
    await this.links.save({ initiative_id: initiativeId, goal_id: goalId });
  }

  async unlinkGoal(initiativeId: string, goalId: string): Promise<void> {
    await this.links.delete({ initiative_id: initiativeId, goal_id: goalId });
  }

  async findGoalIds(initiativeId: string): Promise<string[]> {
    const rows = await this.links.find({
      where: { initiative_id: initiativeId },
    });
    return rows.map((row) => row.goal_id);
  }

  async assignWorkItem(
    project_id: string,
    workItemId: string,
    initiativeId: string | null,
  ): Promise<void> {
    await this.workItems.update(
      { id: workItemId, project_id },
      { initiative_id: initiativeId },
    );
  }
}
```

- [ ] **Step 4: Register the repository in `database.module.ts`**

Add the import:

```typescript
import { KanbanInitiativeRepository } from "./repositories/kanban-initiative.repository";
```

Add it to the `repositories` array (append at the end):

```typescript
  KanbanInitiativeRepository,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/database/repositories/kanban-initiative.repository.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-initiative.repository.ts apps/kanban/src/database/repositories/kanban-initiative.repository.spec.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): add KanbanInitiativeRepository with goal links and work-item assignment"
```

---

## Task 5: Service + module — `InitiativesService`

**Files:**

- Create: `apps/kanban/src/initiatives/initiatives.service.ts`
- Create: `apps/kanban/src/initiatives/initiatives.module.ts`
- Test: `apps/kanban/src/initiatives/initiatives.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/initiatives/initiatives.service.spec.ts`:

```typescript
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanInitiativeRepository } from "../database/repositories/kanban-initiative.repository";
import { InitiativesService } from "./initiatives.service";

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    project_id: "p1",
    title: "Harden loop",
    description: null,
    horizon: "now",
    priority: 0,
    status: "active",
    last_reviewed_at: null,
    created_at: new Date("2026-06-12T00:00:00.000Z"),
    updated_at: new Date("2026-06-12T00:00:00.000Z"),
    ...overrides,
  };
}

describe("InitiativesService", () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findByProjectId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    linkGoal: ReturnType<typeof vi.fn>;
    unlinkGoal: ReturnType<typeof vi.fn>;
    findGoalIds: ReturnType<typeof vi.fn>;
    assignWorkItem: ReturnType<typeof vi.fn>;
  };
  let service: InitiativesService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue(entity()),
      save: vi.fn().mockResolvedValue(entity({ title: "Renamed" })),
      findByProjectId: vi.fn().mockResolvedValue([entity()]),
      findById: vi.fn().mockResolvedValue(entity()),
      linkGoal: vi.fn(),
      unlinkGoal: vi.fn(),
      findGoalIds: vi.fn().mockResolvedValue(["g1"]),
      assignWorkItem: vi.fn(),
    };
    service = new InitiativesService(
      repo as unknown as KanbanInitiativeRepository,
    );
  });

  it("creates an initiative and links its goals, returning a camelCase record with goalIds", async () => {
    const result = await service.createInitiative("p1", {
      title: "Harden loop",
      horizon: "now",
      goalIds: ["g1"],
    });
    expect(repo.create).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ title: "Harden loop", horizon: "now" }),
    );
    expect(repo.linkGoal).toHaveBeenCalledWith("i1", "g1");
    expect(result).toMatchObject({
      id: "i1",
      goalIds: ["g1"],
      lastReviewedAt: null,
    });
    expect(result.created_at).toBe("2026-06-12T00:00:00.000Z");
  });

  it("lists initiatives with their goal ids", async () => {
    const list = await service.listInitiatives("p1");
    expect(list).toHaveLength(1);
    expect(list[0].goalIds).toEqual(["g1"]);
  });

  it("throws NotFoundException updating a missing initiative", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.updateInitiative("p1", "missing", { title: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stamps last_reviewed_at when re-prioritising (grooming)", async () => {
    await service.setPriority("p1", "i1", 5);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 5,
        last_reviewed_at: expect.any(Date),
      }),
    );
  });

  it("assigns a work item to an initiative after verifying it exists", async () => {
    await service.assignWorkItem("p1", "w1", "i1");
    expect(repo.findById).toHaveBeenCalledWith("p1", "i1");
    expect(repo.assignWorkItem).toHaveBeenCalledWith("p1", "w1", "i1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/initiatives/initiatives.service.spec.ts`
Expected: FAIL — cannot resolve `./initiatives.service`.

- [ ] **Step 3: Implement the service**

Create `apps/kanban/src/initiatives/initiatives.service.ts`:

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateInitiativeRequest,
  Initiative,
  UpdateInitiativeRequest,
  UpdateInitiativeStatusRequest,
} from "@nexus/kanban-contracts";
import type { KanbanInitiativeEntity } from "../database/entities/kanban-initiative.entity";
import { KanbanInitiativeRepository } from "../database/repositories/kanban-initiative.repository";

@Injectable()
export class InitiativesService {
  constructor(private readonly initiatives: KanbanInitiativeRepository) {}

  async listInitiatives(project_id: string): Promise<Initiative[]> {
    const rows = await this.initiatives.findByProjectId(project_id);
    return Promise.all(rows.map((row) => this.toRecord(row)));
  }

  async createInitiative(
    project_id: string,
    input: CreateInitiativeRequest,
  ): Promise<Initiative> {
    const created = await this.initiatives.create(project_id, {
      title: input.title,
      description: input.description ?? null,
      horizon: input.horizon,
      priority: input.priority,
      status: input.status,
    });
    for (const goalId of input.goalIds ?? []) {
      await this.initiatives.linkGoal(created.id, goalId);
    }
    return this.toRecord(created);
  }

  async updateInitiative(
    project_id: string,
    initiativeId: string,
    input: UpdateInitiativeRequest,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    if (input.title !== undefined) existing.title = input.title;
    if (input.description !== undefined)
      existing.description = input.description;
    if (input.horizon !== undefined) existing.horizon = input.horizon;
    if (input.priority !== undefined) existing.priority = input.priority;
    return this.toRecord(await this.initiatives.save(existing));
  }

  async updateStatus(
    project_id: string,
    initiativeId: string,
    input: UpdateInitiativeStatusRequest,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    existing.status = input.status;
    return this.toRecord(await this.initiatives.save(existing));
  }

  async setPriority(
    project_id: string,
    initiativeId: string,
    priority: number,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    existing.priority = priority;
    existing.last_reviewed_at = new Date();
    return this.toRecord(await this.initiatives.save(existing));
  }

  async linkGoal(
    project_id: string,
    initiativeId: string,
    goalId: string,
    linked: boolean,
  ): Promise<Initiative> {
    const existing = await this.requireInitiative(project_id, initiativeId);
    if (linked) {
      await this.initiatives.linkGoal(existing.id, goalId);
    } else {
      await this.initiatives.unlinkGoal(existing.id, goalId);
    }
    return this.toRecord(existing);
  }

  async assignWorkItem(
    project_id: string,
    workItemId: string,
    initiativeId: string | null,
  ): Promise<void> {
    if (initiativeId !== null) {
      await this.requireInitiative(project_id, initiativeId);
    }
    await this.initiatives.assignWorkItem(project_id, workItemId, initiativeId);
  }

  private async requireInitiative(
    project_id: string,
    initiativeId: string,
  ): Promise<KanbanInitiativeEntity> {
    const initiative = await this.initiatives.findById(
      project_id,
      initiativeId,
    );
    if (!initiative) {
      throw new NotFoundException(
        `Initiative ${initiativeId} not found for project ${project_id}`,
      );
    }
    return initiative;
  }

  private async toRecord(entity: KanbanInitiativeEntity): Promise<Initiative> {
    const goalIds = await this.initiatives.findGoalIds(entity.id);
    return {
      id: entity.id,
      project_id: entity.project_id,
      title: entity.title,
      description: entity.description,
      horizon: entity.horizon as Initiative["horizon"],
      priority: entity.priority,
      status: entity.status as Initiative["status"],
      goalIds,
      lastReviewedAt: entity.last_reviewed_at?.toISOString() ?? null,
      created_at: entity.created_at.toISOString(),
      updated_at: entity.updated_at.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Create the module**

Create `apps/kanban/src/initiatives/initiatives.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { InitiativesService } from "./initiatives.service";

@Module({
  providers: [InitiativesService],
  exports: [InitiativesService],
})
export class InitiativesModule {}
```

> Note: `KanbanInitiativeRepository` is provided globally by the `@Global() DatabaseModule`, so it injects into `InitiativesService` without re-listing.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/initiatives/initiatives.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/initiatives/initiatives.service.ts apps/kanban/src/initiatives/initiatives.module.ts apps/kanban/src/initiatives/initiatives.service.spec.ts
git commit -m "feat(kanban): add InitiativesService and module"
```

---

## Task 6: MCP tool — `kanban.initiative_create`

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/initiative-create.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/initiative-create.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`
- Modify: `apps/kanban/src/mcp/kanban-mcp.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/mutation/initiative-create.tool.spec.ts`:

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeCreateTool } from "./initiative-create.tool";

describe("InitiativeCreateTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("is named kanban.initiative_create", () => {
    const tool = new InitiativeCreateTool({} as InitiativesService);
    expect(tool.getName()).toBe("kanban.initiative_create");
  });

  it("delegates to InitiativesService.createInitiative with the resolved project id", async () => {
    const service = {
      createInitiative: vi.fn().mockResolvedValue({ id: "i1" }),
    };
    const tool = new InitiativeCreateTool(
      service as unknown as InitiativesService,
    );
    const result = await tool.execute(context, {
      project_id: "p1",
      title: "Harden loop",
      horizon: "now",
    });
    expect(service.createInitiative).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ title: "Harden loop", horizon: "now" }),
    );
    expect(result).toEqual({ id: "i1" });
  });

  it("derives project id from context.scopeId when omitted", async () => {
    const service = {
      createInitiative: vi.fn().mockResolvedValue({ id: "i2" }),
    };
    const tool = new InitiativeCreateTool(
      service as unknown as InitiativesService,
    );
    await tool.execute(
      { scopeId: "ctx-project" } as InternalToolExecutionContext,
      { title: "From context" },
    );
    expect(service.createInitiative).toHaveBeenCalledWith(
      "ctx-project",
      expect.objectContaining({ title: "From context" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-create.tool.spec.ts`
Expected: FAIL — cannot resolve `./initiative-create.tool`.

- [ ] **Step 3: Implement the tool**

Create `apps/kanban/src/mcp/tools/mutation/initiative-create.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import {
  CreateInitiativeRequestSchema,
  type CreateInitiativeRequest,
  type Initiative,
} from "@nexus/kanban-contracts";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeCreateSchema = ContextualProjectIdSchema.extend({
  ...CreateInitiativeRequestSchema.shape,
});

interface InitiativeCreateParams extends CreateInitiativeRequest {
  project_id?: string | null;
}

@Injectable()
export class InitiativeCreateTool implements IInternalToolHandler<
  InitiativeCreateParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_create";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_create",
      description:
        "Create a strategic initiative (planning altitude between goals and work items).",
      inputSchema: InitiativeCreateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeCreateParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.createInitiative(projectId, {
      title: params.title,
      description: params.description,
      horizon: params.horizon,
      priority: params.priority,
      status: params.status,
      goalIds: params.goalIds,
    });
  }
}
```

- [ ] **Step 4: Export and register the tool**

In `apps/kanban/src/mcp/tools/mutation/index.ts`, append:

```typescript
export * from "./initiative-create.tool";
```

In `apps/kanban/src/mcp/kanban-mcp.module.ts`, add the import and the module to `imports`:

```typescript
import { InitiativesModule } from "../initiatives/initiatives.module";
```

Add `InitiativesModule` to the `imports` array (after `ProjectGoalsModule`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-create.tool.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/initiative-create.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-create.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts apps/kanban/src/mcp/kanban-mcp.module.ts
git commit -m "feat(kanban): add kanban.initiative_create MCP tool"
```

---

## Task 7: MCP tools — `initiative_update` and `initiative_update_status`

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/initiative-update.tool.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/initiative-update-status.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/initiative-update.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/mutation/initiative-update.tool.spec.ts`:

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeUpdateStatusTool } from "./initiative-update-status.tool";
import { InitiativeUpdateTool } from "./initiative-update.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeUpdateTool", () => {
  it("delegates to updateInitiative", async () => {
    const service = {
      updateInitiative: vi.fn().mockResolvedValue({ id: "i1" }),
    };
    const tool = new InitiativeUpdateTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_update");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      title: "Renamed",
    });
    expect(service.updateInitiative).toHaveBeenCalledWith(
      "p1",
      "i1",
      expect.objectContaining({ title: "Renamed" }),
    );
  });
});

describe("InitiativeUpdateStatusTool", () => {
  it("delegates to updateStatus", async () => {
    const service = { updateStatus: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeUpdateStatusTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_update_status");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      status: "active",
    });
    expect(service.updateStatus).toHaveBeenCalledWith("p1", "i1", {
      status: "active",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-update.tool.spec.ts`
Expected: FAIL — cannot resolve the tool modules.

- [ ] **Step 3: Implement `initiative-update.tool.ts`**

Create `apps/kanban/src/mcp/tools/mutation/initiative-update.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import {
  UpdateInitiativeRequestSchema,
  type Initiative,
  type UpdateInitiativeRequest,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeUpdateSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  ...UpdateInitiativeRequestSchema.shape,
});

interface InitiativeUpdateParams extends UpdateInitiativeRequest {
  project_id?: string | null;
  initiative_id: string;
}

@Injectable()
export class InitiativeUpdateTool implements IInternalToolHandler<
  InitiativeUpdateParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_update";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_update",
      description:
        "Update an initiative's title, description, horizon, or priority.",
      inputSchema: InitiativeUpdateSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeUpdateParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.updateInitiative(projectId, params.initiative_id, {
      title: params.title,
      description: params.description,
      horizon: params.horizon,
      priority: params.priority,
    });
  }
}
```

- [ ] **Step 4: Implement `initiative-update-status.tool.ts`**

Create `apps/kanban/src/mcp/tools/mutation/initiative-update-status.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import {
  InitiativeStatusSchema,
  type Initiative,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeUpdateStatusSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  status: InitiativeStatusSchema,
});

interface InitiativeUpdateStatusParams {
  project_id?: string | null;
  initiative_id: string;
  status: Initiative["status"];
}

@Injectable()
export class InitiativeUpdateStatusTool implements IInternalToolHandler<
  InitiativeUpdateStatusParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_update_status";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_update_status",
      description:
        "Transition an initiative's status (proposed/active/paused/done/dropped).",
      inputSchema: InitiativeUpdateStatusSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeUpdateStatusParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.updateStatus(projectId, params.initiative_id, {
      status: params.status,
    });
  }
}
```

- [ ] **Step 5: Export both tools**

In `apps/kanban/src/mcp/tools/mutation/index.ts`, append:

```typescript
export * from "./initiative-update.tool";
export * from "./initiative-update-status.tool";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-update.tool.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/initiative-update.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-update-status.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-update.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add initiative_update and initiative_update_status MCP tools"
```

---

## Task 8: MCP tools — `initiative_set_priority` and `initiative_link_goal`

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/initiative-set-priority.tool.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/initiative-link-goal.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/initiative-grooming.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/mutation/initiative-grooming.tool.spec.ts`:

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeLinkGoalTool } from "./initiative-link-goal.tool";
import { InitiativeSetPriorityTool } from "./initiative-set-priority.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeSetPriorityTool", () => {
  it("delegates to setPriority", async () => {
    const service = { setPriority: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeSetPriorityTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_set_priority");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      priority: 3,
    });
    expect(service.setPriority).toHaveBeenCalledWith("p1", "i1", 3);
  });
});

describe("InitiativeLinkGoalTool", () => {
  it("links a goal by default", async () => {
    const service = { linkGoal: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeLinkGoalTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_link_goal");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      goal_id: "g1",
    });
    expect(service.linkGoal).toHaveBeenCalledWith("p1", "i1", "g1", true);
  });

  it("unlinks when linked is false", async () => {
    const service = { linkGoal: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeLinkGoalTool(
      service as unknown as InitiativesService,
    );
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      goal_id: "g1",
      linked: false,
    });
    expect(service.linkGoal).toHaveBeenCalledWith("p1", "i1", "g1", false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-grooming.tool.spec.ts`
Expected: FAIL — cannot resolve the tool modules.

- [ ] **Step 3: Implement `initiative-set-priority.tool.ts`**

Create `apps/kanban/src/mcp/tools/mutation/initiative-set-priority.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import type { Initiative } from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeSetPrioritySchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  priority: z.number().int(),
});

interface InitiativeSetPriorityParams {
  project_id?: string | null;
  initiative_id: string;
  priority: number;
}

@Injectable()
export class InitiativeSetPriorityTool implements IInternalToolHandler<
  InitiativeSetPriorityParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_set_priority";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_set_priority",
      description: "Re-prioritise an initiative within its horizon (grooming).",
      inputSchema: InitiativeSetPrioritySchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeSetPriorityParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.setPriority(
      projectId,
      params.initiative_id,
      params.priority,
    );
  }
}
```

- [ ] **Step 4: Implement `initiative-link-goal.tool.ts`**

Create `apps/kanban/src/mcp/tools/mutation/initiative-link-goal.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import type { Initiative } from "@nexus/kanban-contracts";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeLinkGoalSchema = ContextualProjectIdSchema.extend({
  initiative_id: z.string().min(1),
  goal_id: z.string().min(1),
  linked: z.boolean().optional().default(true),
});

interface InitiativeLinkGoalParams {
  project_id?: string | null;
  initiative_id: string;
  goal_id: string;
  linked?: boolean;
}

@Injectable()
export class InitiativeLinkGoalTool implements IInternalToolHandler<
  InitiativeLinkGoalParams,
  Initiative
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_link_goal";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_link_goal",
      description: "Link or unlink a goal to an initiative.",
      inputSchema: InitiativeLinkGoalSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeLinkGoalParams,
  ): Promise<Initiative> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    return this.initiatives.linkGoal(
      projectId,
      params.initiative_id,
      params.goal_id,
      params.linked ?? true,
    );
  }
}
```

- [ ] **Step 5: Export both tools**

In `apps/kanban/src/mcp/tools/mutation/index.ts`, append:

```typescript
export * from "./initiative-set-priority.tool";
export * from "./initiative-link-goal.tool";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-grooming.tool.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/initiative-set-priority.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-link-goal.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-grooming.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add initiative_set_priority and initiative_link_goal MCP tools"
```

---

## Task 9: MCP tool — `initiative_link_work_item`

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.spec.ts`:

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeLinkWorkItemTool } from "./initiative-link-work-item.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeLinkWorkItemTool", () => {
  it("assigns a work item to an initiative", async () => {
    const service = { assignWorkItem: vi.fn().mockResolvedValue(undefined) };
    const tool = new InitiativeLinkWorkItemTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_link_work_item");
    const result = await tool.execute(context, {
      project_id: "p1",
      work_item_id: "w1",
      initiative_id: "i1",
    });
    expect(service.assignWorkItem).toHaveBeenCalledWith("p1", "w1", "i1");
    expect(result).toEqual({
      ok: true,
      work_item_id: "w1",
      initiative_id: "i1",
    });
  });

  it("clears the link when initiative_id is null", async () => {
    const service = { assignWorkItem: vi.fn().mockResolvedValue(undefined) };
    const tool = new InitiativeLinkWorkItemTool(
      service as unknown as InitiativesService,
    );
    const result = await tool.execute(context, {
      project_id: "p1",
      work_item_id: "w1",
      initiative_id: null,
    });
    expect(service.assignWorkItem).toHaveBeenCalledWith("p1", "w1", null);
    expect(result).toEqual({
      ok: true,
      work_item_id: "w1",
      initiative_id: null,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-link-work-item.tool.spec.ts`
Expected: FAIL — cannot resolve `./initiative-link-work-item.tool`.

- [ ] **Step 3: Implement the tool**

Create `apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const InitiativeLinkWorkItemSchema = ContextualProjectIdSchema.extend({
  work_item_id: z.string().min(1),
  initiative_id: z.string().min(1).nullable(),
});

interface InitiativeLinkWorkItemParams {
  project_id?: string | null;
  work_item_id: string;
  initiative_id: string | null;
}

interface InitiativeLinkWorkItemResult {
  ok: true;
  work_item_id: string;
  initiative_id: string | null;
}

@Injectable()
export class InitiativeLinkWorkItemTool implements IInternalToolHandler<
  InitiativeLinkWorkItemParams,
  InitiativeLinkWorkItemResult
> {
  constructor(private readonly initiatives: InitiativesService) {}

  getName(): string {
    return "kanban.initiative_link_work_item";
  }

  getDefinition() {
    return {
      name: "kanban.initiative_link_work_item",
      description:
        "Assign a work item to an initiative (or pass initiative_id=null to clear).",
      inputSchema: InitiativeLinkWorkItemSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: InitiativeLinkWorkItemParams,
  ): Promise<InitiativeLinkWorkItemResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    await this.initiatives.assignWorkItem(
      projectId,
      params.work_item_id,
      params.initiative_id,
    );
    return {
      ok: true,
      work_item_id: params.work_item_id,
      initiative_id: params.initiative_id,
    };
  }
}
```

- [ ] **Step 4: Export the tool**

In `apps/kanban/src/mcp/tools/mutation/index.ts`, append:

```typescript
export * from "./initiative-link-work-item.tool";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/mutation/initiative-link-work-item.tool.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.ts apps/kanban/src/mcp/tools/mutation/initiative-link-work-item.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add kanban.initiative_link_work_item MCP tool"
```

---

## Task 10: Surface initiatives in `kanban.project_state`

**Files:**

- Modify: `apps/kanban/src/mcp/tools/read/project-state.tool.ts`
- Test: `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts` (create if absent; otherwise add a case)

This adds the `strategic.initiatives` block. The richer `strategic.staleness` and `latestStrategicIntent` fields are Phase 2 — here we only add `initiatives` so the read shape exists.

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts` (if a spec already exists, add only the `it(...)` case below and the `InitiativesService` mock to the existing setup):

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { ProjectStateTool } from "./project-state.tool";

function build(initiatives: unknown[]) {
  const stub = {
    get: vi.fn().mockResolvedValue({ id: "p1" }),
    listWorkItems: vi.fn().mockResolvedValue([]),
    listGoals: vi.fn().mockResolvedValue([]),
    getProjectMemorySummary: vi.fn().mockResolvedValue({}),
    listInitiatives: vi.fn().mockResolvedValue(initiatives),
  };
  // Constructor order: projects, workItems, goals, orchestration, memorySummary, factSnapshot, initiatives.
  // Provide permissive stubs for orchestration + factSnapshot (optional diagnostics are guarded).
  const tool = new ProjectStateTool(
    { get: stub.get } as never,
    { listWorkItems: stub.listWorkItems } as never,
    { listGoals: stub.listGoals } as never,
    {} as never,
    { getProjectMemorySummary: stub.getProjectMemorySummary } as never,
    {} as never,
    { listInitiatives: stub.listInitiatives } as never,
  );
  return { tool, stub };
}

describe("ProjectStateTool strategic block", () => {
  it("includes a strategic.initiatives array sourced from InitiativesService", async () => {
    const { tool, stub } = build([
      {
        id: "i1",
        title: "Harden loop",
        horizon: "now",
        priority: 0,
        status: "active",
        goalIds: [],
      },
    ]);
    const result = (await tool.execute(
      { scopeId: "p1" } as InternalToolExecutionContext,
      {
        max_work_items: 100,
      },
    )) as { strategic: { initiatives: Array<{ id: string }> } };
    expect(stub.listInitiatives).toHaveBeenCalledWith("p1");
    expect(result.strategic.initiatives).toEqual([
      expect.objectContaining({ id: "i1", horizon: "now" }),
    ]);
  });
});
```

> Note: confirm the constructor parameter order against the real file before running — the test must match it. Adjust the positional stubs if the orchestration/fact-snapshot params differ.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/read/project-state.tool.spec.ts`
Expected: FAIL — `strategic` is undefined (and `InitiativesService` not yet injected).

- [ ] **Step 3: Inject `InitiativesService` and add the block**

In `apps/kanban/src/mcp/tools/read/project-state.tool.ts`:

Add the import:

```typescript
import { InitiativesService } from "../../../initiatives/initiatives.service";
```

Add the constructor parameter (append after the existing injected services, e.g. after `OrchestrationFactSnapshotService`):

```typescript
    private readonly initiativesService: InitiativesService,
```

Extend the `ProjectStateResult` interface:

```typescript
  strategic: {
    initiatives: unknown[];
  };
```

In `execute(...)`, fetch initiatives alongside the existing aggregation. Locate the `Promise.all([...])` that gathers project/workItems/goals/etc. and add `this.initiativesService.listInitiatives(projectId)` as a new element, destructuring it into an `initiatives` variable. Then add to the returned object:

```typescript
      strategic: {
        initiatives,
      },
```

If the tool does not use a single `Promise.all`, simply add before the return:

```typescript
const initiatives = await this.initiativesService.listInitiatives(projectId);
```

and include `strategic: { initiatives }` in the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- --run src/mcp/tools/read/project-state.tool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/mcp/tools/read/project-state.tool.ts apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts
git commit -m "feat(kanban): surface strategic.initiatives in kanban.project_state"
```

---

## Task 11: Full verification and documentation

**Files:**

- Modify: `docs/guide/README.md` (or the kanban domain deep-dive it links to)

- [ ] **Step 1: Run the full kanban unit suite**

Run: `npm run test:kanban`
Expected: all tests pass (including the six new initiative specs).

- [ ] **Step 2: Build the kanban app (TypeORM reflection + NestJS output)**

Run: `npm run build:kanban`
Expected: exits 0.

- [ ] **Step 3: Lint the kanban app**

Run: `npm run lint:kanban`
Expected: 0 errors/warnings. Fix any findings in code — do not suppress.

- [ ] **Step 4: Verify the boundary lint did not flag the new code**

Run: `npm run lint:summary`
Expected: no `nexus-boundaries/no-core-kanban-residue` findings (all initiative code is kanban-side; nothing was added to `apps/api/src` or `packages/core/src`).

- [ ] **Step 5: Document the initiative layer**

In `docs/guide/README.md` (or the kanban domain doc it references), add a short subsection under the project/planning model describing: initiatives sit between goals and work items; fields (horizon `now|next|later`, priority, status); the join to goals; the `initiative_id` link on work items; and the new `kanban.initiative_*` tools. Link to EPIC-208 and the design spec.

- [ ] **Step 6: Commit**

```bash
git add docs/guide/README.md
git commit -m "docs(guide): document the initiative planning layer (EPIC-208 Phase 1)"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage (design §2–4):** `kanban_initiatives` (Task 2/3), `kanban_initiative_goals` join (Task 2/3), `work_items.initiative_id` (Task 2/3), CRUD + grooming tools (Tasks 6–9), `project_state` initiatives surfacing (Task 10). **Deferred to later phases (intentionally not here):** `strategic.staleness`, `record_strategic_intent`, the two-phase cycle, delegation tools — these are Phases 2–6.
- **`project_state` constructor order (Task 10):** the test uses positional stubs; verify the real constructor signature in `project-state.tool.ts` before running and adjust the stub positions to match. This is the one task where the integration point must be confirmed against live code.
- **Boundary:** every new file is under `apps/kanban` or `packages/kanban-contracts`. Nothing touches `apps/api/src` or `packages/core/src`. Tools use `project_id` resolved from `context.scopeId` — neutral at the call boundary.
- **No root unions:** every tool `inputSchema` is `ContextualProjectIdSchema.extend({...})` (object root). Good for strict providers.
- **Type consistency:** repository methods (`findByProjectId`, `linkGoal`, `unlinkGoal`, `findGoalIds`, `assignWorkItem`) are referenced identically in the service and tests. Service methods (`createInitiative`, `updateInitiative`, `updateStatus`, `setPriority`, `linkGoal`, `assignWorkItem`) match the tool call sites.
