# Configurable Orchestration — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, scoped (global + per-project) typed variable store whose resolved values are injected into the workflow Handlebars context under a `vars` namespace, then refactor the CEO cycle's hardcoded gate thresholds and backlog toggles to read from it — with seeded defaults that preserve today's exact behavior.

**Architecture:** A new Kanban-neutral `variables` module in `apps/api` owns a `scoped_variables` table, a `VariableResolverService` (global + scope-ancestry overlay, leaf-wins, typed coercion, dotted-key expansion), and a REST CRUD surface. At workflow-run launch the engine snapshots the effective `vars` for `trigger.scopeId` into `state_variables.vars` once, so every template render in that run sees a consistent policy. Default orchestration values live in repo-root seed **data** (not source), keeping project-domain key names out of `apps/api` source per the core/kanban boundary.

**Tech Stack:** NestJS, TypeORM (PostgreSQL, `jsonb`), Handlebars templating, Zod DTO validation, Vitest (SWC).

## Global Constraints

- **TDD (Red-Green-Refactor):** every task writes a failing test first, then minimal code. Copied verbatim from project CLAUDE.md.
- **Strict lint policy:** never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **Core/kanban boundary:** `apps/api` and `packages/core` must stay Kanban-neutral. No `kanban`, work-item, or project-domain identifiers in API/core **source**, tests, migrations, or fixtures. Orchestration key names (`gates.*`, `backlog.*`, `autonomy.*`, `promotion.*`) live ONLY in repo-root `seed/` data files and in the CEO workflow YAML (also seed data). The seeder code that loads them is domain-agnostic. Enforced by lint rule `nexus-boundaries/no-core-kanban-residue`.
- **Strong typing:** no `any`; shared interfaces go in `packages/core` where cross-package.
- **NestJS build:** use `nest build` (not `tsc`) for the API; tests rely on SWC decorator metadata.
- **Entities/repositories live domain-local** under the owning module (here: `apps/api/src/variables/database/...`).
- **Net behavior change for Phase 1 is ZERO** until someone edits a variable. The CEO refactor (Task 7) must evaluate identically to the pre-refactor literals given the seeded defaults — proven by a regression test.
- **Typecheck + targeted tests must pass** before each commit. Run targeted tests, not the whole suite, while iterating.

## Naming contract (used across tasks)

- DB table: `scoped_variables`. Global rows have `scope_node_id IS NULL`.
- Entity: `ScopedVariable` — `apps/api/src/variables/database/entities/scoped-variable.entity.ts`.
- Value-type enum values: `'string' | 'number' | 'boolean' | 'json'` (type alias `ScopedVariableValueType` in `packages/core`).
- Repository: `ScopedVariableRepository` with methods `findGlobals()`, `findByScopeIds(scopeIds: string[])`, `findOneByKeyAndScope(key, scopeNodeId)`, `upsert(input)`, `deleteByKeyAndScope(key, scopeNodeId)`, `listForScope(scopeNodeId | null)`.
- Resolver: `VariableResolverService` with `resolveEffective(scopeNodeId: string | null): Promise<ResolvedVariable[]>` and `resolveContext(scopeNodeId: string | null): Promise<Record<string, unknown>>`.
- Types (`packages/core`): `ResolvedVariable = { key: string; value: unknown; type: ScopedVariableValueType; layer: 'global' | string }`.
- Util: `expandDottedKeys(flat: Record<string, unknown>): Record<string, unknown>` — `apps/api/src/variables/dotted-keys.util.ts`.
- Util: `coerceVariableValue(value: unknown, type: ScopedVariableValueType): unknown` — `apps/api/src/variables/coerce-variable.util.ts`.
- Controller route base: `/variables`.
- Seeder: `ScopedVariableSeedService` — `apps/api/src/database/seeds/variables/scoped-variables.seed.ts`; env override `NEXUS_VARIABLES_SEED_PATH`; default dir `seed/variables`.
- Seed data file: `seed/variables/orchestration-defaults.json`.

---

## File Structure

| File                                                                         | Responsibility                                                                | Task |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| `packages/core/src/variables/scoped-variable.types.ts`                       | Shared types: `ScopedVariableValueType`, `ResolvedVariable`, request DTatypes | 1    |
| `apps/api/src/variables/database/entities/scoped-variable.entity.ts`         | TypeORM entity                                                                | 1    |
| `apps/api/src/variables/database/repositories/scoped-variable.repository.ts` | Persistence                                                                   | 1    |
| `apps/api/src/database/migrations/20260619120000-create-scoped-variables.ts` | Table + indexes                                                               | 1    |
| `apps/api/src/variables/coerce-variable.util.ts`                             | Typed coercion                                                                | 2    |
| `apps/api/src/variables/dotted-keys.util.ts`                                 | Dotted-key → nested object                                                    | 2    |
| `apps/api/src/variables/variable-resolver.service.ts`                        | Global + ancestry overlay, leaf-wins, context build                           | 3    |
| `apps/api/src/variables/variables.controller.ts`                             | REST CRUD + effective resolution                                              | 4    |
| `apps/api/src/variables/variables.module.ts`                                 | Wires controller + resolver + repository + seeder                             | 4    |
| `apps/api/src/workflow/workflow-engine.service.ts` (modify)                  | Snapshot `vars` into `state_variables` at launch                              | 5    |
| `apps/api/src/database/seeds/variables/scoped-variables.seed.ts`             | Generic seeder loading `seed/variables/*.json`                                | 6    |
| `apps/api/src/setup/setup.service.ts` (modify)                               | Invoke the variable seeder at startup                                         | 6    |
| `seed/variables/orchestration-defaults.json`                                 | Default global orchestration values (domain key names live here)              | 6    |
| `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` (modify)      | Gate thresholds + backlog toggles read `{{ vars.* }}`                         | 7    |

---

## Task 1: `scoped_variables` entity, repository, migration

**Files:**

- Create: `packages/core/src/variables/scoped-variable.types.ts`
- Create: `apps/api/src/variables/database/entities/scoped-variable.entity.ts`
- Create: `apps/api/src/variables/database/repositories/scoped-variable.repository.ts`
- Create: `apps/api/src/database/migrations/20260619120000-create-scoped-variables.ts`
- Test: `apps/api/src/variables/database/repositories/scoped-variable.repository.spec.ts`

**Interfaces:**

- Produces: `ScopedVariable` entity; `ScopedVariableRepository` with the methods listed in the Naming contract; `ScopedVariableValueType`, `ResolvedVariable` types in `@nexus/core`.

- [ ] **Step 1: Add shared types to core**

Create `packages/core/src/variables/scoped-variable.types.ts`:

```typescript
export type ScopedVariableValueType = "string" | "number" | "boolean" | "json";

export type ScopedVariableSource = "seeded" | "admin";

export interface ResolvedVariable {
  key: string;
  value: unknown;
  type: ScopedVariableValueType;
  /** 'global' for the NULL-scope layer, otherwise the scope_node_id that provided the value. */
  layer: "global" | string;
}

export interface UpsertScopedVariableRequest {
  scopeNodeId: string | null;
  key: string;
  value: unknown;
  valueType: ScopedVariableValueType;
  description?: string | null;
}
```

Export it from the core barrel (add `export * from './variables/scoped-variable.types';` to `packages/core/src/index.ts`, matching the existing export style).

- [ ] **Step 2: Write the failing repository test**

Create `apps/api/src/variables/database/repositories/scoped-variable.repository.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScopedVariableRepository } from "./scoped-variable.repository";
import { ScopedVariable } from "../entities/scoped-variable.entity";
import { IsNull, type Repository } from "typeorm";

function makeTypeormRepoMock() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((x) => x),
    save: vi.fn((x) => Promise.resolve({ id: "generated-id", ...x })),
    delete: vi.fn(),
  } as unknown as Repository<ScopedVariable>;
}

describe("ScopedVariableRepository", () => {
  let typeorm: Repository<ScopedVariable>;
  let repo: ScopedVariableRepository;

  beforeEach(() => {
    typeorm = makeTypeormRepoMock();
    repo = new ScopedVariableRepository(typeorm);
  });

  it("findGlobals queries rows with NULL scope", async () => {
    await repo.findGlobals();
    expect(typeorm.find).toHaveBeenCalledWith({
      where: { scope_node_id: IsNull() },
    });
  });

  it("findByScopeIds returns empty without a DB call when no ids", async () => {
    const result = await repo.findByScopeIds([]);
    expect(result).toEqual([]);
    expect(typeorm.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/variables/database/repositories/scoped-variable.repository.spec.ts`
Expected: FAIL — cannot find module `./scoped-variable.repository` / `../entities/scoped-variable.entity`.

- [ ] **Step 4: Create the entity**

Create `apps/api/src/variables/database/entities/scoped-variable.entity.ts`:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type {
  ScopedVariableValueType,
  ScopedVariableSource,
} from "@nexus/core";

@Index("UQ_scoped_variable_key_scope", ["key", "scope_node_id"], {
  unique: true,
})
@Entity("scoped_variables")
export class ScopedVariable {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({
    name: "scope_node_id",
    type: "uuid",
    nullable: true,
    default: null,
  })
  scope_node_id: string | null;

  @Column({ type: "varchar", length: 128 })
  key: string;

  @Column({ type: "jsonb" })
  value: unknown;

  @Column({ type: "varchar", length: 16 })
  value_type: ScopedVariableValueType;

  @Column({ type: "varchar", length: 16, default: "admin" })
  source: ScopedVariableSource;

  @Column({ type: "text", nullable: true, default: null })
  description: string | null;

  @Column({ type: "varchar", nullable: true, default: null })
  created_by: string | null;

  @Column({ type: "varchar", nullable: true, default: null })
  updated_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 5: Create the repository**

Create `apps/api/src/variables/database/repositories/scoped-variable.repository.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";
import { ScopedVariable } from "../entities/scoped-variable.entity";
import type { UpsertScopedVariableRequest } from "@nexus/core";

@Injectable()
export class ScopedVariableRepository {
  constructor(
    @InjectRepository(ScopedVariable)
    private readonly repository: Repository<ScopedVariable>,
  ) {}

  findGlobals(): Promise<ScopedVariable[]> {
    return this.repository.find({ where: { scope_node_id: IsNull() } });
  }

  async findByScopeIds(scopeIds: string[]): Promise<ScopedVariable[]> {
    if (scopeIds.length === 0) {
      return [];
    }
    return this.repository.find({ where: { scope_node_id: In(scopeIds) } });
  }

  findOneByKeyAndScope(
    key: string,
    scopeNodeId: string | null,
  ): Promise<ScopedVariable | null> {
    return this.repository.findOne({
      where: { key, scope_node_id: scopeNodeId ?? IsNull() },
    });
  }

  listForScope(scopeNodeId: string | null): Promise<ScopedVariable[]> {
    return this.repository.find({
      where: { scope_node_id: scopeNodeId ?? IsNull() },
      order: { key: "ASC" },
    });
  }

  async upsert(input: UpsertScopedVariableRequest): Promise<ScopedVariable> {
    const existing = await this.findOneByKeyAndScope(
      input.key,
      input.scopeNodeId,
    );
    const entity = this.repository.create({
      ...(existing ?? {}),
      scope_node_id: input.scopeNodeId,
      key: input.key,
      value: input.value,
      value_type: input.valueType,
      description: input.description ?? null,
    });
    return this.repository.save(entity);
  }

  async deleteByKeyAndScope(
    key: string,
    scopeNodeId: string | null,
  ): Promise<void> {
    await this.repository.delete({
      key,
      scope_node_id: scopeNodeId ?? IsNull(),
    });
  }
}
```

- [ ] **Step 6: Create the migration**

Create `apps/api/src/database/migrations/20260619120000-create-scoped-variables.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScopedVariables20260619120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scoped_variables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_node_id UUID,
        key character varying(128) NOT NULL,
        value jsonb NOT NULL,
        value_type character varying(16) NOT NULL,
        source character varying(16) NOT NULL DEFAULT 'admin',
        description text,
        created_by character varying,
        updated_by character varying,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS UQ_scoped_variable_key_scope
        ON scoped_variables(key, scope_node_id);
    `);

    // Enforce a single global row per key (scope_node_id IS NULL is not
    // deduplicated by the composite unique index above on most engines).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS UQ_scoped_variable_key_global
        ON scoped_variables(key) WHERE scope_node_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS scoped_variables;");
  }
}
```

- [ ] **Step 7: Register entity + repository in DatabaseModule**

In `apps/api/src/database/database.module.ts`, add imports near the other entity/repository imports and register them:

- Add `import { ScopedVariable } from '../variables/database/entities/scoped-variable.entity';`
- Add `import { ScopedVariableRepository } from '../variables/database/repositories/scoped-variable.repository';`
- Add `ScopedVariable` to the `TypeOrmModule.forFeature([...])` entities array.
- Add `ScopedVariableRepository` to both the module `providers` and `exports` arrays (match how `AgentProfileRepository` is registered).

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/variables/database/repositories/scoped-variable.repository.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck + commit**

Run: `npm run build --workspace=packages/core && npm run build:api`
Expected: builds succeed.

```bash
git add packages/core/src/variables packages/core/src/index.ts apps/api/src/variables apps/api/src/database/migrations/20260619120000-create-scoped-variables.ts apps/api/src/database/database.module.ts
git commit -m "feat(variables): add scoped_variables entity, repository, migration"
```

---

## Task 2: Coercion + dotted-key expansion utilities

**Files:**

- Create: `apps/api/src/variables/coerce-variable.util.ts`
- Create: `apps/api/src/variables/dotted-keys.util.ts`
- Test: `apps/api/src/variables/coerce-variable.util.spec.ts`
- Test: `apps/api/src/variables/dotted-keys.util.spec.ts`

**Interfaces:**

- Produces: `coerceVariableValue(value, type)` and `expandDottedKeys(flat)` — both pure functions consumed by Task 3.

- [ ] **Step 1: Write the failing coercion test**

Create `apps/api/src/variables/coerce-variable.util.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { coerceVariableValue } from "./coerce-variable.util";

describe("coerceVariableValue", () => {
  it("coerces numeric strings to numbers", () => {
    expect(coerceVariableValue("10", "number")).toBe(10);
  });
  it("passes through real numbers", () => {
    expect(coerceVariableValue(10, "number")).toBe(10);
  });
  it('coerces "true"/"false" strings to booleans', () => {
    expect(coerceVariableValue("true", "boolean")).toBe(true);
    expect(coerceVariableValue("false", "boolean")).toBe(false);
  });
  it("passes through real booleans", () => {
    expect(coerceVariableValue(true, "boolean")).toBe(true);
  });
  it("returns strings unchanged for string type", () => {
    expect(coerceVariableValue("auto", "string")).toBe("auto");
  });
  it("returns json values unchanged", () => {
    const obj = { a: 1 };
    expect(coerceVariableValue(obj, "json")).toBe(obj);
  });
});
```

- [ ] **Step 2: Write the failing dotted-keys test**

Create `apps/api/src/variables/dotted-keys.util.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { expandDottedKeys } from "./dotted-keys.util";

describe("expandDottedKeys", () => {
  it("expands dotted keys into nested objects", () => {
    const result = expandDottedKeys({
      "gates.rediscovery_merge_threshold": 10,
      "backlog.ideation_enabled": true,
      "autonomy.dispatch": "auto",
    });
    expect(result).toEqual({
      gates: { rediscovery_merge_threshold: 10 },
      backlog: { ideation_enabled: true },
      autonomy: { dispatch: "auto" },
    });
  });

  it("keeps flat keys flat", () => {
    expect(expandDottedKeys({ flat: 1 })).toEqual({ flat: 1 });
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npm run test --workspace=apps/api -- run src/variables/coerce-variable.util.spec.ts src/variables/dotted-keys.util.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement coercion**

Create `apps/api/src/variables/coerce-variable.util.ts`:

```typescript
import type { ScopedVariableValueType } from "@nexus/core";

export function coerceVariableValue(
  value: unknown,
  type: ScopedVariableValueType,
): unknown {
  switch (type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
      if (typeof value === "boolean") {
        return value;
      }
      return value === "true" || value === true;
    case "string":
      return typeof value === "string" ? value : String(value);
    case "json":
    default:
      return value;
  }
}
```

- [ ] **Step 5: Implement dotted-key expansion**

Create `apps/api/src/variables/dotted-keys.util.ts`:

```typescript
export function expandDottedKeys(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [dottedKey, value] of Object.entries(flat)) {
    const segments = dottedKey.split(".");
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const next = cursor[segment];
      if (!next || typeof next !== "object") {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = value;
  }
  return root;
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npm run test --workspace=apps/api -- run src/variables/coerce-variable.util.spec.ts src/variables/dotted-keys.util.spec.ts`
Expected: PASS (8 tests total).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/variables/coerce-variable.util.ts apps/api/src/variables/coerce-variable.util.spec.ts apps/api/src/variables/dotted-keys.util.ts apps/api/src/variables/dotted-keys.util.spec.ts
git commit -m "feat(variables): add value coercion and dotted-key expansion utils"
```

---

## Task 3: VariableResolverService (global + ancestry overlay)

**Files:**

- Create: `apps/api/src/variables/variable-resolver.service.ts`
- Test: `apps/api/src/variables/variable-resolver.service.spec.ts`

**Interfaces:**

- Consumes: `ScopedVariableRepository` (Task 1); `ScopeService.getAncestorIds(nodeId)` (existing, `apps/api/src/scope/scope.service.ts`, returns ancestor ids root-first including the node itself); `coerceVariableValue`, `expandDottedKeys` (Task 2).
- Produces: `VariableResolverService.resolveEffective(scopeNodeId)` → `ResolvedVariable[]`; `resolveContext(scopeNodeId)` → nested `Record<string, unknown>` for template injection (Task 5).

- [ ] **Step 1: Write the failing resolver test**

Create `apps/api/src/variables/variable-resolver.service.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VariableResolverService } from "./variable-resolver.service";
import type { ScopedVariableRepository } from "./database/repositories/scoped-variable.repository";
import type { ScopeService } from "../scope/scope.service";

function row(partial: Record<string, unknown>) {
  return {
    id: "x",
    value_type: "number",
    source: "seeded",
    description: null,
    ...partial,
  };
}

describe("VariableResolverService", () => {
  let repo: ScopedVariableRepository;
  let scope: ScopeService;
  let service: VariableResolverService;

  beforeEach(() => {
    repo = {
      findGlobals: vi.fn().mockResolvedValue([]),
      findByScopeIds: vi.fn().mockResolvedValue([]),
    } as unknown as ScopedVariableRepository;
    scope = {
      getAncestorIds: vi.fn().mockResolvedValue([]),
    } as unknown as ScopeService;
    service = new VariableResolverService(repo, scope);
  });

  it("returns only global vars when scopeNodeId is null", async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: "gates.threshold", value: 10, scope_node_id: null }),
    ]);
    const result = await service.resolveEffective(null);
    expect(result).toEqual([
      { key: "gates.threshold", value: 10, type: "number", layer: "global" },
    ]);
    expect(scope.getAncestorIds).not.toHaveBeenCalled();
  });

  it("overlays project value over global (leaf wins)", async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: "gates.threshold", value: 10, scope_node_id: null }),
    ]);
    (scope.getAncestorIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      "root",
      "project-1",
    ]);
    (repo.findByScopeIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: "gates.threshold", value: 5, scope_node_id: "project-1" }),
    ]);
    const result = await service.resolveEffective("project-1");
    expect(result).toEqual([
      { key: "gates.threshold", value: 5, type: "number", layer: "project-1" },
    ]);
  });

  it("coerces values by value_type", async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        key: "backlog.ideation_enabled",
        value: "true",
        value_type: "boolean",
        scope_node_id: null,
      }),
    ]);
    const result = await service.resolveEffective(null);
    expect(result[0].value).toBe(true);
  });

  it("resolveContext expands dotted keys into nested objects", async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: "gates.threshold", value: 10, scope_node_id: null }),
      row({
        key: "autonomy.dispatch",
        value: "auto",
        value_type: "string",
        scope_node_id: null,
      }),
    ]);
    const ctx = await service.resolveContext(null);
    expect(ctx).toEqual({
      gates: { threshold: 10 },
      autonomy: { dispatch: "auto" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/variables/variable-resolver.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `apps/api/src/variables/variable-resolver.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type { ResolvedVariable } from "@nexus/core";
import { ScopedVariableRepository } from "./database/repositories/scoped-variable.repository";
import { ScopeService } from "../scope/scope.service";
import { ScopedVariable } from "./database/entities/scoped-variable.entity";
import { coerceVariableValue } from "./coerce-variable.util";
import { expandDottedKeys } from "./dotted-keys.util";

@Injectable()
export class VariableResolverService {
  constructor(
    private readonly repository: ScopedVariableRepository,
    private readonly scopeService: ScopeService,
  ) {}

  /**
   * Resolve the effective variables for a scope: the global layer (NULL scope)
   * overlaid by each ancestor scope root->leaf. The leaf-most layer wins.
   */
  async resolveEffective(
    scopeNodeId: string | null,
  ): Promise<ResolvedVariable[]> {
    const globals = await this.repository.findGlobals();

    // key -> { row, layer }. Seed with the global layer first.
    const merged = new Map<string, { row: ScopedVariable; layer: string }>();
    for (const row of globals) {
      merged.set(row.key, { row, layer: "global" });
    }

    if (scopeNodeId) {
      // root-first, including the node itself; leaf overlays last.
      const ancestry = await this.scopeService.getAncestorIds(scopeNodeId);
      const scopeRows = await this.repository.findByScopeIds(ancestry);
      const orderIndex = new Map(ancestry.map((id, index) => [id, index]));
      const sorted = [...scopeRows].sort(
        (a, b) =>
          (orderIndex.get(a.scope_node_id ?? "") ?? 0) -
          (orderIndex.get(b.scope_node_id ?? "") ?? 0),
      );
      for (const row of sorted) {
        merged.set(row.key, {
          row,
          layer: row.scope_node_id ?? "global",
        });
      }
    }

    return [...merged.values()].map(({ row, layer }) => ({
      key: row.key,
      value: coerceVariableValue(row.value, row.value_type),
      type: row.value_type,
      layer,
    }));
  }

  /**
   * Effective variables expanded into a nested object suitable for injection
   * into the Handlebars template context under the `vars` namespace.
   */
  async resolveContext(
    scopeNodeId: string | null,
  ): Promise<Record<string, unknown>> {
    const effective = await this.resolveEffective(scopeNodeId);
    const flat: Record<string, unknown> = {};
    for (const entry of effective) {
      flat[entry.key] = entry.value;
    }
    return expandDottedKeys(flat);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/variables/variable-resolver.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/variables/variable-resolver.service.ts apps/api/src/variables/variable-resolver.service.spec.ts
git commit -m "feat(variables): resolve effective vars across global + scope ancestry"
```

---

## Task 4: REST CRUD surface (controller + module)

**Files:**

- Create: `apps/api/src/variables/variables.controller.ts`
- Create: `apps/api/src/variables/variables.module.ts`
- Test: `apps/api/src/variables/variables.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `VariablesModule`)

**Interfaces:**

- Consumes: `ScopedVariableRepository`, `VariableResolverService`.
- Produces: HTTP surface `GET/POST/DELETE /variables`, `GET /variables/effective`.

- [ ] **Step 1: Write the failing controller test**

Create `apps/api/src/variables/variables.controller.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VariablesController } from "./variables.controller";
import type { ScopedVariableRepository } from "./database/repositories/scoped-variable.repository";
import type { VariableResolverService } from "./variable-resolver.service";

describe("VariablesController", () => {
  let repo: ScopedVariableRepository;
  let resolver: VariableResolverService;
  let controller: VariablesController;

  beforeEach(() => {
    repo = {
      listForScope: vi.fn().mockResolvedValue([]),
      upsert: vi
        .fn()
        .mockImplementation((x) => Promise.resolve({ id: "1", ...x })),
      deleteByKeyAndScope: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScopedVariableRepository;
    resolver = {
      resolveEffective: vi.fn().mockResolvedValue([]),
    } as unknown as VariableResolverService;
    controller = new VariablesController(repo, resolver);
  });

  it("lists global vars when no scopeId given", async () => {
    await controller.list(undefined);
    expect(repo.listForScope).toHaveBeenCalledWith(null);
  });

  it("upserts a variable from a validated body", async () => {
    const dto = {
      scopeNodeId: null,
      key: "gates.threshold",
      value: 10,
      valueType: "number" as const,
    };
    const result = await controller.upsert(dto);
    expect(repo.upsert).toHaveBeenCalledWith(dto);
    expect(result.success).toBe(true);
  });

  it("resolves effective vars for a scope", async () => {
    await controller.effective("project-1");
    expect(resolver.resolveEffective).toHaveBeenCalledWith("project-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/variables/variables.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the Zod DTO schema to core**

Append to `packages/core/src/variables/scoped-variable.types.ts`:

```typescript
import { z } from "zod";

export const UpsertScopedVariableSchema = z.object({
  scopeNodeId: z.string().uuid().nullable(),
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/, "invalid variable key format"),
  value: z.unknown(),
  valueType: z.enum(["string", "number", "boolean", "json"]),
  description: z.string().max(2000).nullable().optional(),
});
```

(`zod` is already a dependency of `@nexus/core`; match the existing schema files' import style.)

- [ ] **Step 4: Implement the controller**

Create `apps/api/src/variables/variables.controller.ts`:

```typescript
import {
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  UpsertScopedVariableSchema,
  type UpsertScopedVariableRequest,
} from "@nexus/core";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodBody } from "../common/decorators/zod-body.decorator";
import { ScopedVariableRepository } from "./database/repositories/scoped-variable.repository";
import { VariableResolverService } from "./variable-resolver.service";

@ApiTags("variables")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("variables")
export class VariablesController {
  constructor(
    private readonly repository: ScopedVariableRepository,
    private readonly resolver: VariableResolverService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List variables for a scope (or global)" })
  async list(@Query("scopeId") scopeId?: string) {
    const rows = await this.repository.listForScope(scopeId ?? null);
    return { success: true, data: rows };
  }

  @Get("effective")
  @ApiOperation({ summary: "Resolve effective variables for a scope" })
  async effective(@Query("scopeId") scopeId?: string) {
    const data = await this.resolver.resolveEffective(scopeId ?? null);
    return { success: true, data };
  }

  @Post()
  @ApiOperation({ summary: "Create or update a variable" })
  async upsert(@ZodBody(UpsertScopedVariableSchema) dto: unknown) {
    const input = dto as UpsertScopedVariableRequest;
    const data = await this.repository.upsert(input);
    return { success: true, data };
  }

  @Delete()
  @ApiOperation({ summary: "Delete a variable by key + scope" })
  async remove(@Query("key") key: string, @Query("scopeId") scopeId?: string) {
    await this.repository.deleteByKeyAndScope(key, scopeId ?? null);
    return { success: true };
  }
}
```

- [ ] **Step 5: Create the module**

Create `apps/api/src/variables/variables.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ScopeModule } from "../scope/scope.module";
import { VariablesController } from "./variables.controller";
import { VariableResolverService } from "./variable-resolver.service";

@Module({
  imports: [DatabaseModule, ScopeModule],
  controllers: [VariablesController],
  providers: [VariableResolverService],
  exports: [VariableResolverService],
})
export class VariablesModule {}
```

(If `ScopeService` is not exported by a `ScopeModule`, import whichever module provides it — mirror how other modules consume `ScopeService`. Confirm the exact module name with a quick grep for `class ScopeModule` / `exports: [ScopeService]`.)

- [ ] **Step 6: Register the module**

In `apps/api/src/app.module.ts`, add `import { VariablesModule } from './variables/variables.module';` and add `VariablesModule` to the `imports` array (match existing feature-module registration).

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/variables/variables.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck + commit**

Run: `npm run build --workspace=packages/core && npm run build:api`
Expected: builds succeed.

```bash
git add packages/core/src/variables apps/api/src/variables/variables.controller.ts apps/api/src/variables/variables.controller.spec.ts apps/api/src/variables/variables.module.ts apps/api/src/app.module.ts
git commit -m "feat(variables): REST CRUD + effective-resolution endpoints"
```

---

## Task 5: Inject `vars` snapshot into state at run launch

**Files:**

- Modify: `apps/api/src/workflow/workflow-engine.service.ts` (method `createAndStartRun`, ~lines 331-347)
- Test: `apps/api/src/workflow/workflow-engine.vars-snapshot.spec.ts`

**Interfaces:**

- Consumes: `VariableResolverService.resolveContext(scopeNodeId)` (Task 3); `getScopeId`/trigger resolution already used in the workflow module.
- Produces: `state_variables.vars` populated at run creation, available to all subsequent `{{ vars.* }}` template renders for that run.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-engine.vars-snapshot.spec.ts`. This test targets a small extracted helper so it can be unit-tested without standing up the whole engine:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildInitialStateVariables } from "./workflow-initial-state.util";
import type { VariableResolverService } from "../variables/variable-resolver.service";

describe("buildInitialStateVariables", () => {
  it("snapshots resolved vars under the vars namespace", async () => {
    const resolver = {
      resolveContext: vi
        .fn()
        .mockResolvedValue({ gates: { rediscovery_merge_threshold: 10 } }),
    } as unknown as VariableResolverService;

    const state = await buildInitialStateVariables(
      { scopeId: "project-1", foo: "bar" },
      resolver,
    );

    expect(resolver.resolveContext).toHaveBeenCalledWith("project-1");
    expect(state).toEqual({
      trigger: { scopeId: "project-1", foo: "bar" },
      vars: { gates: { rediscovery_merge_threshold: 10 } },
    });
  });

  it("resolves only global vars when trigger has no scopeId", async () => {
    const resolver = {
      resolveContext: vi.fn().mockResolvedValue({}),
    } as unknown as VariableResolverService;

    const state = await buildInitialStateVariables({ foo: "bar" }, resolver);

    expect(resolver.resolveContext).toHaveBeenCalledWith(null);
    expect(state.vars).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-engine.vars-snapshot.spec.ts`
Expected: FAIL — `./workflow-initial-state.util` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/workflow/workflow-initial-state.util.ts`:

```typescript
import type { VariableResolverService } from "../variables/variable-resolver.service";

/**
 * Build the initial state_variables for a new workflow run, snapshotting the
 * effective variables for the trigger scope under `vars`. The snapshot is taken
 * once at launch so a running workflow sees a consistent policy even if a
 * variable is edited mid-run; new values apply to the next run.
 */
export async function buildInitialStateVariables(
  triggerData: Record<string, unknown>,
  resolver: VariableResolverService,
): Promise<Record<string, unknown>> {
  const scopeId =
    typeof triggerData.scopeId === "string" && triggerData.scopeId.trim()
      ? triggerData.scopeId.trim()
      : null;
  const vars = await resolver.resolveContext(scopeId);
  return { trigger: triggerData, vars };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-engine.vars-snapshot.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the helper into the engine**

In `apps/api/src/workflow/workflow-engine.service.ts`:

- Inject `VariableResolverService` via the constructor (add to params; the engine's module must import `VariablesModule` — add `VariablesModule` to that module's `imports` if not already reachable).
- Add `import { buildInitialStateVariables } from './workflow-initial-state.util';`.
- In `createAndStartRun`, replace `state_variables: { trigger: triggerData },` with a pre-computed value:

```typescript
const initialState = await buildInitialStateVariables(
  triggerData,
  this.variableResolver,
);
// ...
run = await this.persistence.createRun({
  workflow_id: workflowId,
  status: WorkflowStatus.RUNNING,
  state_variables: initialState,
  ...(concurrencyScope ? { concurrency_scope: concurrencyScope } : {}),
  ...(launchDedupeKey ? { launch_dedupe_key: launchDedupeKey } : {}),
});
```

- [ ] **Step 6: Run the engine's existing tests to confirm no regression**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-engine`
Expected: PASS (existing engine specs still green; update any spec that constructs `WorkflowEngineService` directly to pass a stub `VariableResolverService` with `resolveContext: async () => ({})`).

- [ ] **Step 7: Typecheck + commit**

Run: `npm run build:api`
Expected: build succeeds.

```bash
git add apps/api/src/workflow/workflow-initial-state.util.ts apps/api/src/workflow/workflow-engine.vars-snapshot.spec.ts apps/api/src/workflow/workflow-engine.service.ts
git commit -m "feat(workflow): snapshot scoped vars into state_variables at run launch"
```

---

## Task 6: Seed default global orchestration variables

**Files:**

- Create: `seed/variables/orchestration-defaults.json`
- Create: `apps/api/src/database/seeds/variables/scoped-variables.seed.ts`
- Create: `apps/api/src/database/seeds/variables/scoped-variables.seed.spec.ts`
- Modify: `apps/api/src/setup/setup.service.ts` (invoke the seeder)
- Modify: `apps/api/src/database/database.module.ts` or the seeds module that provides seed services (register `ScopedVariableSeedService`)

**Interfaces:**

- Consumes: `ScopedVariableRepository`.
- Produces: idempotent seeding of global default rows for the orchestration keys; `ScopedVariableSeedService.seed()`.

- [ ] **Step 1: Create the seed data file**

Create `seed/variables/orchestration-defaults.json` (key names live HERE in seed data, not in `apps/api` source — preserves the boundary):

```json
{
  "variables": [
    { "key": "autonomy.dispatch", "value": "auto", "valueType": "string" },
    {
      "key": "autonomy.backlog_promotion",
      "value": "auto",
      "valueType": "string"
    },
    { "key": "autonomy.merge", "value": "ask", "valueType": "string" },
    {
      "key": "backlog.bootstrap_enabled",
      "value": true,
      "valueType": "boolean"
    },
    {
      "key": "backlog.ideation_enabled",
      "value": true,
      "valueType": "boolean"
    },
    {
      "key": "gates.rediscovery_merge_threshold",
      "value": 10,
      "valueType": "number"
    },
    {
      "key": "gates.roadmap_when_no_active_initiative",
      "value": true,
      "valueType": "boolean"
    },
    {
      "key": "gates.ideation_starvation_cycles",
      "value": 2,
      "valueType": "number"
    },
    {
      "key": "promotion.max_items_per_cycle",
      "value": -1,
      "valueType": "number"
    }
  ]
}
```

- [ ] **Step 2: Write the failing seeder test**

Create `apps/api/src/database/seeds/variables/scoped-variables.seed.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScopedVariableSeedService } from "./scoped-variables.seed";
import type { ScopedVariableRepository } from "../../../variables/database/repositories/scoped-variable.repository";

describe("ScopedVariableSeedService", () => {
  let seedRoot: string;
  let repo: ScopedVariableRepository;

  beforeEach(() => {
    seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vars-seed-"));
    const dir = path.join(seedRoot, "seed", "variables");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "orchestration-defaults.json"),
      JSON.stringify({
        variables: [
          {
            key: "gates.rediscovery_merge_threshold",
            value: 10,
            valueType: "number",
          },
        ],
      }),
    );
    process.env.NEXUS_VARIABLES_SEED_PATH = dir;
    repo = {
      findOneByKeyAndScope: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScopedVariableRepository;
  });

  afterEach(() => {
    delete process.env.NEXUS_VARIABLES_SEED_PATH;
    fs.rmSync(seedRoot, { recursive: true, force: true });
  });

  it("inserts global defaults that do not yet exist", async () => {
    const service = new ScopedVariableSeedService(repo);
    await service.seed();
    expect(repo.upsert).toHaveBeenCalledWith({
      scopeNodeId: null,
      key: "gates.rediscovery_merge_threshold",
      value: 10,
      valueType: "number",
      description: null,
    });
  });

  it("does not overwrite an existing global default", async () => {
    (repo.findOneByKeyAndScope as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "gates.rediscovery_merge_threshold",
    });
    const service = new ScopedVariableSeedService(repo);
    await service.seed();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/database/seeds/variables/scoped-variables.seed.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the seeder**

Create `apps/api/src/database/seeds/variables/scoped-variables.seed.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopedVariableValueType } from "@nexus/core";
import { ScopedVariableRepository } from "../../../variables/database/repositories/scoped-variable.repository";

interface SeedVariable {
  key: string;
  value: unknown;
  valueType: ScopedVariableValueType;
  description?: string | null;
}

/**
 * Seed default GLOBAL variables from seed/variables/*.json. The seeder is
 * domain-agnostic: orchestration key names live in the seed data files, not in
 * this source, preserving the core/kanban boundary. Existing rows are never
 * overwritten (defaults only fill gaps).
 */
@Injectable()
export class ScopedVariableSeedService {
  private readonly logger = new Logger(ScopedVariableSeedService.name);

  private readonly candidateSeedDirs = [
    process.env.NEXUS_VARIABLES_SEED_PATH?.trim(),
    path.join(process.cwd(), "seed", "variables"),
    path.join(process.cwd(), "..", "seed", "variables"),
    path.join(process.cwd(), "..", "..", "seed", "variables"),
    path.resolve(__dirname, "../../../../../../seed/variables"),
  ].filter((dir): dir is string => Boolean(dir));

  constructor(private readonly repository: ScopedVariableRepository) {}

  async seed(): Promise<void> {
    const dir = this.candidateSeedDirs.find(
      (candidate) =>
        fs.existsSync(candidate) && this.listFiles(candidate).length > 0,
    );
    if (!dir) {
      this.logger.log(
        `No variable seed files found. Checked: ${this.candidateSeedDirs.join(", ")}`,
      );
      return;
    }

    let seeded = 0;
    for (const file of this.listFiles(dir)) {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf8"),
      ) as { variables?: SeedVariable[] };
      for (const variable of parsed.variables ?? []) {
        const existing = await this.repository.findOneByKeyAndScope(
          variable.key,
          null,
        );
        if (existing) {
          continue;
        }
        await this.repository.upsert({
          scopeNodeId: null,
          key: variable.key,
          value: variable.value,
          valueType: variable.valueType,
          description: variable.description ?? null,
        });
        seeded++;
      }
    }
    this.logger.log(`Seeded ${seeded} default global variable(s)`);
  }

  private listFiles(directory: string): string[] {
    return fs.readdirSync(directory).filter((file) => file.endsWith(".json"));
  }
}
```

- [ ] **Step 5: Register the seeder + invoke at startup**

- Register `ScopedVariableSeedService` as a provider in the module that provides the other seed services (where `WorkflowSeedService` is provided). Grep for `providers:` containing `WorkflowSeedService` to find it.
- In `apps/api/src/setup/setup.service.ts`: inject `ScopedVariableSeedService` (constructor param near `workflowSeedService`, line ~35) and call `await this.scopedVariableSeedService.seed();` immediately before `await this.workflowSeedService.seed();` (line ~409), so defaults exist before workflows that reference them are validated.
- Update `apps/api/src/setup/setup.service.spec.ts`: add a `scopedVariableSeedService = { seed: vi.fn().mockResolvedValue(undefined) }` stub and pass it into the constructed `SetupService` (mirror the existing `workflowSeedService` stub at lines ~67-100).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- run src/database/seeds/variables/scoped-variables.seed.spec.ts src/setup/setup.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Validate seed data shape**

Run: `npm run validate:seed-data`
Expected: passes (no schema errors introduced).

- [ ] **Step 8: Commit**

```bash
git add seed/variables/orchestration-defaults.json apps/api/src/database/seeds/variables apps/api/src/setup/setup.service.ts apps/api/src/setup/setup.service.spec.ts
git commit -m "feat(variables): seed default global orchestration variables"
```

---

## Task 7: Refactor CEO workflow gates + backlog toggles to `{{ vars.* }}`

**Files:**

- Modify: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` (lines 150-181 gates; add toggle conditions)
- Test: `apps/api/src/database/seeds/workflow/orchestration-cycle-vars.contract.spec.ts`

**Interfaces:**

- Consumes: `state_variables.vars` snapshot (Task 5) with `vars.gates.*`, `vars.backlog.*` populated from seeded defaults (Task 6).
- Produces: identical gate behavior to the pre-refactor literals when defaults are in force (regression-locked).

- [ ] **Step 1: Write the failing regression contract test**

Create `apps/api/src/database/seeds/workflow/orchestration-cycle-vars.contract.spec.ts`. It loads the CEO workflow YAML and asserts the gate conditions reference `vars.*` (not literals), and that rendering each condition with the seeded defaults yields the SAME boolean as the old literal thresholds across a matrix of staleness inputs:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { StateManagerService } from "../../../workflow/state-manager.service";

const SEED_PATH = resolve(
  __dirname,
  "../../../../../../seed/workflows/project-orchestration-cycle-ceo.workflow.yaml",
);

interface Job {
  id: string;
  condition?: string;
}

function jobsById(): Record<string, Job> {
  const def = load(readFileSync(SEED_PATH, "utf8")) as { jobs: Job[] };
  return Object.fromEntries(def.jobs.map((j) => [j.id, j]));
}

// Minimal renderer: StateManagerService.substituteTemplate is pure w.r.t the
// run repo for condition rendering, so we can construct it with a no-op repo.
function render(
  condition: string,
  variables: Record<string, unknown>,
): boolean {
  const svc = new StateManagerService({} as never);
  return svc.substituteTemplate(condition, variables).trim() === "true";
}

const DEFAULT_VARS = {
  vars: {
    gates: {
      rediscovery_merge_threshold: 10,
      ideation_starvation_cycles: 2,
      roadmap_when_no_active_initiative: true,
    },
    backlog: { ideation_enabled: true, bootstrap_enabled: true },
  },
};

function staleness(partial: Record<string, number>) {
  return {
    ...DEFAULT_VARS,
    jobs: {
      load_state: {
        output: {
          result: { strategic: { staleness: partial } },
        },
      },
    },
  };
}

describe("CEO cycle gate conditions read from vars", () => {
  it("rediscovery gate references vars, not a literal", () => {
    const cond = jobsById().rediscovery_gate.condition ?? "";
    expect(cond).toContain("vars.gates.rediscovery_merge_threshold");
    expect(cond).not.toMatch(/mergesSinceDiscovery 10\)/);
  });

  it("rediscovery gate behaves identically to the old >=10 literal", () => {
    const cond = jobsById().rediscovery_gate.condition ?? "";
    for (const merges of [0, 9, 10, 11, 50]) {
      const expected = merges >= 10;
      expect(render(cond, staleness({ mergesSinceDiscovery: merges }))).toBe(
        expected,
      );
    }
  });

  it("ideation gate behaves identically to the old (burn==0 OR forecast<=2) literal", () => {
    const cond = jobsById().ideation_gate.condition ?? "";
    const cases = [
      {
        recentBurnRatePerCycle: 0,
        starvationForecastCycles: 99,
        expected: true,
      },
      {
        recentBurnRatePerCycle: 5,
        starvationForecastCycles: 2,
        expected: true,
      },
      {
        recentBurnRatePerCycle: 5,
        starvationForecastCycles: 3,
        expected: false,
      },
    ];
    for (const c of cases) {
      expect(render(cond, staleness(c))).toBe(c.expected);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/database/seeds/workflow/orchestration-cycle-vars.contract.spec.ts`
Expected: FAIL — conditions still contain the literals `10` / `2`.

- [ ] **Step 3: Refactor the gate conditions**

In `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`, edit the three gate conditions (lines 151-181):

`rediscovery_gate` condition →

```yaml
condition: "{{#if (gte jobs.load_state.output.result.strategic.staleness.mergesSinceDiscovery vars.gates.rediscovery_merge_threshold)}}true{{else}}false{{/if}}"
```

`roadmap_planning_gate` condition (gate it behind the new toggle while preserving the no-active-initiative check) →

```yaml
condition: "{{#if (and vars.gates.roadmap_when_no_active_initiative (eq jobs.load_state.output.result.strategic.staleness.activeNowInitiativeCount 0))}}true{{else}}false{{/if}}"
```

`ideation_gate` condition (add the `backlog.ideation_enabled` toggle AND the configurable starvation threshold) →

```yaml
condition: "{{#if (and vars.backlog.ideation_enabled (or (eq jobs.load_state.output.result.strategic.staleness.recentBurnRatePerCycle 0) (lte jobs.load_state.output.result.strategic.staleness.starvationForecastCycles vars.gates.ideation_starvation_cycles)))}}true{{else}}false{{/if}}"
```

Update the threshold comments at lines 150 and 171 to note the value now comes from `vars.gates.*` (seeded default mirrors the prior literal).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/database/seeds/workflow/orchestration-cycle-vars.contract.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing CEO workflow contract specs**

Run: `npm run test --workspace=apps/api -- run src/database/seeds/workflow`
Expected: PASS — existing CEO/seed contract specs still green (the YAML still parses and validates; behavior unchanged under defaults).

- [ ] **Step 6: Validate seed data**

Run: `npm run validate:seed-data`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add seed/workflows/project-orchestration-cycle-ceo.workflow.yaml apps/api/src/database/seeds/workflow/orchestration-cycle-vars.contract.spec.ts
git commit -m "feat(orchestration): CEO gates + ideation toggle read from scoped vars"
```

---

## Final verification

- [ ] **Run the variables module test suite**

Run: `npm run test --workspace=apps/api -- run src/variables src/database/seeds/variables src/workflow/workflow-initial-state`
Expected: all PASS.

- [ ] **Lint the touched workspaces**

Run: `npm run lint:api`
Expected: no errors, no warnings (strict policy — zero suppressions).

- [ ] **Typecheck/build**

Run: `npm run build --workspace=packages/core && npm run build:api`
Expected: both succeed.

- [ ] **Manual smoke (live stack, optional but recommended)**

After `docker compose up -d --build`, confirm:

1. `GET /variables/effective?scopeId=<project>` returns the 9 seeded keys with `layer: 'global'`.
2. `POST /variables` with `{ scopeNodeId: '<project>', key: 'gates.rediscovery_merge_threshold', value: 5, valueType: 'number' }` then re-`GET /variables/effective?scopeId=<project>` shows `value: 5, layer: '<project>'`.
3. Trigger a CEO cycle for that project; confirm the rediscovery gate now fires at 5 merges (inspect the run's `state_variables.vars` snapshot via the run detail / event ledger).

---

## Self-Review notes (addressed)

- **Spec coverage:** Phase 1 scope items from the spec §10 are all covered — store/entity/migration (Task 1), resolver with overlay + coercion + layer trace (Tasks 2-3), engine snapshot injection (Task 5), REST CRUD + effective endpoint (Task 4), seeded defaults (Task 6), CEO YAML refactor preserving behavior (Task 7). Curated `kanban-contracts` registry, per-phase autonomy enforcement, and the Web UI are explicitly **Phase 2** and out of scope here.
- **Boundary:** orchestration key names appear only in `seed/` data and the CEO YAML (both seed data), never in `apps/api`/`packages/core` source — seeder and resolver are domain-agnostic.
- **Type consistency:** `resolveContext`/`resolveEffective`, `ScopedVariableValueType`, `ResolvedVariable`, repository method names, and `buildInitialStateVariables` are used identically across tasks.
- **Open follow-ups for the executor to confirm with a quick grep (not blocking):** exact `ScopeModule`/`ScopeService` export module name (Task 4 Step 5); the seeds-providing module for registering `ScopedVariableSeedService` (Task 6 Step 5); the `StateManagerService` constructor arity for the contract test stub (Task 7 Step 1 — if it requires a non-trivial repo, render via a tiny Handlebars harness instead).
