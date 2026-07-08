# Phase B — Scope-node Lifecycle & Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add soft-archive lifecycle to `scope_nodes`, clean up ~20 phantom project nodes from the one-shot backfill migration, and expose admin maintenance endpoints — making the globe scope switcher show only real, active scopes.

**Architecture:** Two TypeORM migrations add the `archived_at` column and archive orphaned rows on deploy. Three new `ScopeService` methods (`archiveNode`, `restoreNode`, `findOrphanedProjectNodes`) manage the lifecycle. `ScopeService.getTree` is updated to filter archived nodes and filter by the caller's accessible scope IDs via `ScopeAccessService` (already exported from `AuthorizationModule`, which `ScopeModule` already imports). `ScopeController` gets three new endpoints and an updated `getTree` that passes the JWT `userId` to the service.

**Tech Stack:** NestJS, TypeORM (`Repository`, `IsNull`), Vitest, PostgreSQL. JWT payload shape: `{ userId: string; email: string; roles: string[] }` (from `apps/api/src/auth/jwt.strategy.ts`).

---

## File Map

| Action | File                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| create | `apps/api/src/database/migrations/20260611000000-add-scope-node-archived-at.ts` |
| create | `apps/api/src/database/migrations/20260611000001-archive-orphan-scope-nodes.ts` |
| edit   | `apps/api/src/scope/database/entities/scope-node.entity.ts`                     |
| edit   | `apps/api/src/scope/scope.service.ts`                                           |
| edit   | `apps/api/src/scope/scope.service.spec.ts`                                      |
| edit   | `apps/api/src/scope/scope.controller.ts`                                        |
| edit   | `apps/api/src/scope/scope.controller.spec.ts`                                   |

---

### Task 1: `archived_at` column — entity property + Migration A

Add `archivedAt` to `ScopeNode` and create the migration that adds the column.

**Files:**

- Edit: `apps/api/src/scope/database/entities/scope-node.entity.ts`
- Create: `apps/api/src/database/migrations/20260611000000-add-scope-node-archived-at.ts`

- [ ] **Step 1: Add `archivedAt` to the entity**

The full updated file `apps/api/src/scope/database/entities/scope-node.entity.ts`:

```typescript
import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import type { ScopeNodeType } from "../../scope.constants";

@Entity("scope_nodes")
@Index("idx_scope_nodes_parent", ["parentId"])
export class ScopeNode {
  @PrimaryColumn("uuid")
  id: string;

  @Column({ name: "parent_id", type: "uuid", nullable: true })
  parentId: string | null;

  @Column({ length: 32 })
  type: ScopeNodeType;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255 })
  slug: string;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt: Date | null;
}
```

- [ ] **Step 2: Create Migration A**

Create `apps/api/src/database/migrations/20260611000000-add-scope-node-archived-at.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddScopeNodeArchivedAt20260611000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE scope_nodes ADD COLUMN archived_at TIMESTAMPTZ NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scope_nodes DROP COLUMN archived_at;`);
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npm run build:api 2>&1 | tail -20
```

Expected: clean build, no errors on `ScopeNode` or the migration class.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/scope/database/entities/scope-node.entity.ts \
        apps/api/src/database/migrations/20260611000000-add-scope-node-archived-at.ts
git commit -m "feat(api): add archived_at column to scope_nodes entity and migration"
```

---

### Task 2: Migration B — archive orphaned project nodes

Create the one-time migration that archives all `project`-type nodes not referenced by any of the 8 scope-source tables.

**Files:**

- Create: `apps/api/src/database/migrations/20260611000001-archive-orphan-scope-nodes.ts`

- [ ] **Step 1: Create Migration B**

Create `apps/api/src/database/migrations/20260611000001-archive-orphan-scope-nodes.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

const ROOT = "00000000-0000-0000-0000-000000000000";

export class ArchiveOrphanScopeNodes20260611000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scope_nodes
       SET archived_at = now()
       WHERE type = 'project'
         AND id <> $1::uuid
         AND archived_at IS NULL
         AND id NOT IN (
           SELECT scope_id FROM workflows           WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM chat_sessions        WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM scheduled_jobs       WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM automation_hooks     WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM heartbeat_profiles   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM standing_orders      WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM workflow_run_todos   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM notifications        WHERE scope_id IS NOT NULL
         )`,
      [ROOT],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scope_nodes SET archived_at = NULL WHERE type = 'project'`,
    );
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run build:api 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/migrations/20260611000001-archive-orphan-scope-nodes.ts
git commit -m "feat(api): migration to archive orphaned project-type scope nodes"
```

---

### Task 3: ScopeService — `archiveNode` and `restoreNode` (TDD)

**Files:**

- Edit: `apps/api/src/scope/scope.service.spec.ts`
- Edit: `apps/api/src/scope/scope.service.ts`

- [ ] **Step 1: Write failing tests**

Add `BadRequestException` to the imports at the top of `apps/api/src/scope/scope.service.spec.ts` if not already present:

```typescript
import { BadRequestException } from "@nestjs/common";
```

Then **append** these two `describe` blocks at the end of the file:

```typescript
describe("ScopeService.archiveNode", () => {
  function makeService(
    nodeOverride?: Partial<{
      id: string;
      type: string;
      archivedAt: Date | null;
    }>,
  ) {
    const node = {
      id: "proj-1",
      type: "project",
      archivedAt: null,
      ...nodeOverride,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    return { service: new ScopeService(nodeRepo as any, {} as any), nodeRepo };
  }

  it("sets archivedAt to a Date on a project node", async () => {
    const { service, nodeRepo } = makeService();
    await service.archiveNode("proj-1");
    expect(nodeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
  });

  it("throws BadRequestException for the global platform root", async () => {
    const { service } = makeService({
      id: GLOBAL_SCOPE_NODE_ID,
      type: "platform",
    });
    await expect(service.archiveNode(GLOBAL_SCOPE_NODE_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException for a non-project type", async () => {
    const { service } = makeService({ id: "team-1", type: "team" });
    await expect(service.archiveNode("team-1")).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe("ScopeService.restoreNode", () => {
  function makeService(
    nodeOverride?: Partial<{
      id: string;
      type: string;
      archivedAt: Date | null;
    }>,
  ) {
    const node = {
      id: "proj-1",
      type: "project",
      archivedAt: new Date(),
      ...nodeOverride,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn().mockResolvedValue(node),
    };
    return { service: new ScopeService(nodeRepo as any, {} as any), nodeRepo };
  }

  it("clears archivedAt to null on a project node", async () => {
    const { service, nodeRepo } = makeService();
    await service.restoreNode("proj-1");
    expect(nodeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: null }),
    );
  });

  it("throws BadRequestException for the global platform root", async () => {
    const { service } = makeService({
      id: GLOBAL_SCOPE_NODE_ID,
      type: "platform",
    });
    await expect(service.restoreNode(GLOBAL_SCOPE_NODE_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException for a non-project type", async () => {
    const { service } = makeService({ id: "team-1", type: "team" });
    await expect(service.restoreNode("team-1")).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npm run test:api -- --run scope.service
```

Expected: 6 new tests fail with "service.archiveNode is not a function" (method does not exist yet).

- [ ] **Step 3: Add `archiveNode` and `restoreNode` to `ScopeService`**

In `apps/api/src/scope/scope.service.ts`, append both methods at the end of the class body (before the closing `}`):

```typescript
async archiveNode(id: string): Promise<void> {
  const node = await this.nodes.findOneBy({ id });
  if (!node) {
    throw new BadRequestException(`Scope node ${id} not found.`);
  }
  if (id === GLOBAL_SCOPE_NODE_ID) {
    throw new BadRequestException('Cannot archive the platform root node.');
  }
  if (node.type !== 'project') {
    throw new BadRequestException(
      `Only project-type nodes can be archived. Got: '${node.type}'.`,
    );
  }
  node.archivedAt = new Date();
  await this.nodes.save(node);
}

async restoreNode(id: string): Promise<void> {
  const node = await this.nodes.findOneBy({ id });
  if (!node) {
    throw new BadRequestException(`Scope node ${id} not found.`);
  }
  if (id === GLOBAL_SCOPE_NODE_ID) {
    throw new BadRequestException('Cannot restore the platform root node via this endpoint.');
  }
  if (node.type !== 'project') {
    throw new BadRequestException(
      `Only project-type nodes can be restored. Got: '${node.type}'.`,
    );
  }
  node.archivedAt = null;
  await this.nodes.save(node);
}
```

- [ ] **Step 4: Confirm tests PASS**

```bash
npm run test:api -- --run scope.service
```

Expected: all tests pass (6 new + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scope/scope.service.ts \
        apps/api/src/scope/scope.service.spec.ts
git commit -m "feat(api): add archiveNode and restoreNode to ScopeService"
```

---

### Task 4: ScopeService — `findOrphanedProjectNodes` (TDD)

**Files:**

- Edit: `apps/api/src/scope/scope.service.spec.ts`
- Edit: `apps/api/src/scope/scope.service.ts`

- [ ] **Step 1: Write failing tests**

**Append** to `apps/api/src/scope/scope.service.spec.ts`:

```typescript
describe("ScopeService.findOrphanedProjectNodes", () => {
  it("returns project nodes that are live and not in any source table", async () => {
    const orphan = {
      id: "orphan-1",
      type: "project",
      archivedAt: null,
      name: "Orphan",
      slug: "o1",
    };
    const nodeRepo = { query: vi.fn().mockResolvedValue([orphan]) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const result = await service.findOrphanedProjectNodes();

    expect(nodeRepo.query).toHaveBeenCalledWith(
      expect.stringContaining("archived_at IS NULL"),
      expect.any(Array),
    );
    expect(result).toEqual([orphan]);
  });

  it("returns an empty array when no orphans exist", async () => {
    const nodeRepo = { query: vi.fn().mockResolvedValue([]) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const result = await service.findOrphanedProjectNodes();

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npm run test:api -- --run scope.service
```

Expected: 2 new tests fail.

- [ ] **Step 3: Add `findOrphanedProjectNodes` to `ScopeService`**

Append to `apps/api/src/scope/scope.service.ts` (after `restoreNode`):

```typescript
async findOrphanedProjectNodes(): Promise<ScopeNode[]> {
  return this.nodes.query(
    `SELECT * FROM scope_nodes
     WHERE type = 'project'
       AND archived_at IS NULL
       AND id <> $1::uuid
       AND id NOT IN (
         SELECT scope_id FROM workflows           WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM chat_sessions        WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM scheduled_jobs       WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM automation_hooks     WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM heartbeat_profiles   WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM standing_orders      WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM workflow_run_todos   WHERE scope_id IS NOT NULL UNION
         SELECT scope_id FROM notifications        WHERE scope_id IS NOT NULL
       )`,
    [GLOBAL_SCOPE_NODE_ID],
  );
}
```

- [ ] **Step 4: Confirm tests PASS**

```bash
npm run test:api -- --run scope.service
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scope/scope.service.ts \
        apps/api/src/scope/scope.service.spec.ts
git commit -m "feat(api): add findOrphanedProjectNodes to ScopeService"
```

---

### Task 5: `ScopeService.getTree` — archive filter + membership filter (TDD)

Update `getTree` to: (a) exclude archived nodes via `IsNull()` filter, (b) return only the caller's accessible subtree via `ScopeAccessService`. Inject `ScopeAccessService` as an optional 4th constructor parameter (optional so existing tests with 2-arg construction still work).

**Background:** `ScopeAccessService` is already exported from `AuthorizationModule` (see `apps/api/src/auth/authorization/authorization.module.ts` line 39). `ScopeModule` already imports `AuthorizationModule` via `forwardRef`, so injection works. Admin detection is derived internally: if `getAccessibleScopeIds` returns a set containing `GLOBAL_SCOPE_NODE_ID`, the user has root-level access and receives the full tree.

**Files:**

- Edit: `apps/api/src/scope/scope.service.spec.ts`
- Edit: `apps/api/src/scope/scope.service.ts`

- [ ] **Step 1: Write failing tests**

**Replace** the existing `describe('ScopeService.getTree', ...)` block in `scope.service.spec.ts` with:

```typescript
describe("ScopeService.getTree", () => {
  function entity(overrides: Record<string, unknown>) {
    return {
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      archivedAt: null,
      ...overrides,
    };
  }

  it("returns full tree for a user with root-level access", async () => {
    const rows = [
      entity({
        id: "child",
        parentId: "p1",
        type: "team",
        name: "Eng",
        slug: "eng",
      }),
      entity({
        id: "p2",
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: "project",
        name: "Beta",
        slug: "beta",
      }),
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: "platform",
        name: "Platform",
        slug: "platform",
      }),
      entity({
        id: "p1",
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: "project",
        name: "Alpha",
        slug: "alpha",
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi
        .fn()
        .mockResolvedValue([GLOBAL_SCOPE_NODE_ID, "p1", "p2", "child"]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree("admin-user");

    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(["p1", "p2"]);
    const alpha = tree?.children.find((c) => c.id === "p1");
    expect(alpha?.children.map((c) => c.id)).toEqual(["child"]);
  });

  it("returns null when the global root is absent", async () => {
    const nodeRepo = { find: vi.fn().mockResolvedValue([]) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );
    expect(await service.getTree("admin-user")).toBeNull();
  });

  it("returns the full tree when ScopeAccessService is not injected (test/dev mode)", async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: "platform",
        name: "Platform",
        slug: "platform",
      }),
      entity({
        id: "p1",
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: "project",
        name: "Alpha",
        slug: "alpha",
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    const tree = await service.getTree("any-user");
    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(["p1"]);
  });

  it("returns only accessible subtree + ancestors for a scoped user", async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: "platform",
        name: "Platform",
        slug: "platform",
      }),
      entity({
        id: "p1",
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: "project",
        name: "Alpha",
        slug: "alpha",
      }),
      entity({
        id: "p2",
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: "project",
        name: "Beta",
        slug: "beta",
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue(["p1"]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    const tree = await service.getTree("scoped-user");

    expect(tree?.id).toBe(GLOBAL_SCOPE_NODE_ID);
    expect(tree?.children.map((c) => c.id)).toEqual(["p1"]);
  });

  it("returns null for a user with no accessible scopes", async () => {
    const rows = [
      entity({
        id: GLOBAL_SCOPE_NODE_ID,
        parentId: null,
        type: "platform",
        name: "Platform",
        slug: "platform",
      }),
    ];
    const nodeRepo = { find: vi.fn().mockResolvedValue(rows) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    expect(await service.getTree("nobody")).toBeNull();
  });

  it("calls find with an archived_at filter", async () => {
    const nodeRepo = { find: vi.fn().mockResolvedValue([]) };
    const scopeAccessSvc = {
      getAccessibleScopeIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ScopeService(
      nodeRepo as any,
      {} as any,
      undefined,
      scopeAccessSvc as any,
    );

    await service.getTree("user");

    expect(nodeRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: expect.anything() }),
      }),
    );
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npm run test:api -- --run scope.service
```

Expected: the 6 updated/new `getTree` tests fail (wrong number of args, missing membership logic).

- [ ] **Step 3: Update `ScopeService` — inject `ScopeAccessService`, update `getTree`**

**a) Update imports** in `apps/api/src/scope/scope.service.ts`:

```typescript
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, IsNull, Repository } from "typeorm";
import { ScopeNode } from "./database/entities/scope-node.entity";
import { SCOPE_NODE_TYPES, GLOBAL_SCOPE_NODE_ID } from "./scope.constants";
import type {
  CreateScopeNodeInput,
  ScopeTreeNode,
} from "./scope.service.types";
import { AuthorizationAuditService } from "../auth/authorization/authorization-audit.service";
import { ScopeAccessService } from "../auth/authorization/scope-access.service";
```

**b) Update the constructor** (add `scopeAccessService` as the optional 4th parameter):

```typescript
constructor(
  @InjectRepository(ScopeNode) private readonly nodes: Repository<ScopeNode>,
  private readonly dataSource: DataSource,
  @Optional() private readonly authzAudit?: AuthorizationAuditService,
  @Optional()
  @Inject(forwardRef(() => ScopeAccessService))
  private readonly scopeAccessService?: ScopeAccessService,
) {}
```

**c) Replace the existing `getTree()` method** with the updated version that accepts `userId`:

```typescript
async getTree(userId: string): Promise<ScopeTreeNode | null> {
  const nodes = await this.nodes.find({ where: { archivedAt: IsNull() } });
  const byId = new Map<string, ScopeTreeNode>();

  for (const node of nodes) {
    byId.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      name: node.name,
      slug: node.slug,
      metadata: node.metadata,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      children: [],
    });
  }

  for (const node of byId.values()) {
    if (node.parentId === null) continue;
    byId.get(node.parentId)?.children.push(node);
  }

  for (const node of byId.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!this.scopeAccessService) {
    return byId.get(GLOBAL_SCOPE_NODE_ID) ?? null;
  }

  const accessibleIds = new Set(
    await this.scopeAccessService.getAccessibleScopeIds(userId, 'scopes:read'),
  );

  if (accessibleIds.size === 0) return null;

  if (accessibleIds.has(GLOBAL_SCOPE_NODE_ID)) {
    return byId.get(GLOBAL_SCOPE_NODE_ID) ?? null;
  }

  const allowedIds = new Set<string>();
  const collectWithAncestors = (id: string): void => {
    if (allowedIds.has(id)) return;
    allowedIds.add(id);
    const node = byId.get(id);
    if (node?.parentId) collectWithAncestors(node.parentId);
  };

  for (const id of accessibleIds) {
    collectWithAncestors(id);
  }

  const prune = (node: ScopeTreeNode): ScopeTreeNode => ({
    ...node,
    children: node.children.filter((c) => allowedIds.has(c.id)).map(prune),
  });

  const root = byId.get(GLOBAL_SCOPE_NODE_ID);
  return root ? prune(root) : null;
}
```

- [ ] **Step 4: Confirm tests PASS**

```bash
npm run test:api -- --run scope.service
```

Expected: all tests pass (6 new/updated `getTree` tests + all prior tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scope/scope.service.ts \
        apps/api/src/scope/scope.service.spec.ts
git commit -m "feat(api): update getTree to filter archived nodes and membership-scope results"
```

---

### Task 6: `ScopeController` — update `getTree` + admin maintenance endpoints (TDD)

Update the `getTree` handler to pass `req.user.userId` to the service. Add `GET /scopes/maintenance/orphans`, `POST /scopes/:id/archive`, and `POST /scopes/:id/restore`.

Note: NestJS defaults POST handlers to HTTP 201. Archive/restore are mutations, not resource creations, so decorate them with `@HttpCode(HttpStatus.OK)` to return 200.

**Files:**

- Edit: `apps/api/src/scope/scope.controller.spec.ts`
- Edit: `apps/api/src/scope/scope.controller.ts`

- [ ] **Step 1: Write failing tests**

**Replace** the entire content of `apps/api/src/scope/scope.controller.spec.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ScopeController } from "./scope.controller";

const fakeReq = (userId = "user-1") => ({
  user: { userId, email: "u@example.com", roles: [] },
});

describe("ScopeController.create", () => {
  it("wraps createNode result in a success envelope", async () => {
    const service = {
      createNode: vi.fn().mockResolvedValue({ id: "n1" }),
    } as any;
    const controller = new ScopeController(service);
    const result = await controller.create({
      parentId: null,
      type: "org",
      name: "Acme",
      slug: "acme",
    });
    expect(service.createNode).toHaveBeenCalledWith({
      parentId: null,
      type: "org",
      name: "Acme",
      slug: "acme",
    });
    expect(result).toEqual({ success: true, data: { id: "n1" } });
  });
});

describe("ScopeController.ensure", () => {
  it("wraps ensureNode result in a success envelope", async () => {
    const existing = {
      id: "proj-uuid",
      type: "project",
      name: "Web App",
      slug: "web-app",
      parentId: null,
    };
    const service = { ensureNode: vi.fn().mockResolvedValue(existing) } as any;
    const controller = new ScopeController(service);
    const result = await controller.ensure({
      id: "proj-uuid",
      parentId: null,
      type: "project",
      name: "Web App",
      slug: "web-app",
    });
    expect(service.ensureNode).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: existing });
  });
});

describe("ScopeController.getTree", () => {
  it("passes req.user.userId to scopeService.getTree and wraps result", async () => {
    const tree = { id: "root", parentId: null, children: [] };
    const service = { getTree: vi.fn().mockResolvedValue(tree) } as any;
    const controller = new ScopeController(service);

    const result = await controller.getTree(fakeReq("user-42") as any);

    expect(service.getTree).toHaveBeenCalledWith("user-42");
    expect(result).toEqual({ success: true, data: tree });
  });
});

describe("ScopeController.moveNode", () => {
  it("delegates to scopeService.moveNode", async () => {
    const service = { moveNode: vi.fn().mockResolvedValue(undefined) } as any;
    const controller = new ScopeController(service);
    const result = await controller.moveNode("n1", { newParentId: "n2" });
    expect(service.moveNode).toHaveBeenCalledWith("n1", "n2");
    expect(result).toEqual({ success: true });
  });
});

describe("ScopeController.getOrphans", () => {
  it("returns orphan list in success envelope", async () => {
    const orphans = [{ id: "o1", type: "project" }];
    const service = {
      findOrphanedProjectNodes: vi.fn().mockResolvedValue(orphans),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.getOrphans();

    expect(service.findOrphanedProjectNodes).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: orphans });
  });
});

describe("ScopeController.archiveNode", () => {
  it("calls archiveNode on the service and returns success", async () => {
    const service = {
      archiveNode: vi.fn().mockResolvedValue(undefined),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.archiveNode("proj-1");

    expect(service.archiveNode).toHaveBeenCalledWith("proj-1");
    expect(result).toEqual({ success: true });
  });
});

describe("ScopeController.restoreNode", () => {
  it("calls restoreNode on the service and returns success", async () => {
    const service = {
      restoreNode: vi.fn().mockResolvedValue(undefined),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.restoreNode("proj-1");

    expect(service.restoreNode).toHaveBeenCalledWith("proj-1");
    expect(result).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Confirm tests FAIL**

```bash
npm run test:api -- --run scope.controller
```

Expected: `getTree` test fails (current implementation takes no `req` arg), and `getOrphans`, `archiveNode`, `restoreNode` tests fail ("not a function").

- [ ] **Step 3: Replace `ScopeController`**

Replace the entire content of `apps/api/src/scope/scope.controller.ts` with:

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../auth/authorization/permissions.guard";
import { RequirePermission } from "../auth/authorization/require-permission.decorator";
import { ScopeService } from "./scope.service";
import { CreateScopeNodeDto } from "./dto/create-scope-node.dto";
import { EnsureScopeNodeDto } from "./dto/ensure-scope-node.dto";
import { MoveScopeNodeDto } from "./dto/move-scope-node.dto";

interface JwtUser {
  userId: string;
  email: string;
  roles: string[];
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("scopes")
export class ScopeController {
  constructor(private readonly scopeService: ScopeService) {}

  @Post()
  @RequirePermission("scopes:create")
  async create(@Body() body: CreateScopeNodeDto) {
    return { success: true, data: await this.scopeService.createNode(body) };
  }

  @Post("ensure")
  @RequirePermission("scopes:create")
  async ensure(@Body() body: EnsureScopeNodeDto) {
    return { success: true, data: await this.scopeService.ensureNode(body) };
  }

  @Get("tree")
  @RequirePermission("scopes:read")
  async getTree(@Req() req: { user: JwtUser }) {
    return {
      success: true,
      data: await this.scopeService.getTree(req.user.userId),
    };
  }

  @Get("maintenance/orphans")
  @RequirePermission("scopes:manage")
  async getOrphans() {
    return {
      success: true,
      data: await this.scopeService.findOrphanedProjectNodes(),
    };
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("scopes:manage")
  async archiveNode(@Param("id") id: string) {
    await this.scopeService.archiveNode(id);
    return { success: true };
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("scopes:manage")
  async restoreNode(@Param("id") id: string) {
    await this.scopeService.restoreNode(id);
    return { success: true };
  }

  @Patch(":id/move")
  @RequirePermission("scopes:update")
  async moveNode(@Param("id") id: string, @Body() body: MoveScopeNodeDto) {
    await this.scopeService.moveNode(id, body.newParentId);
    return { success: true };
  }
}
```

- [ ] **Step 4: Confirm controller tests PASS**

```bash
npm run test:api -- --run scope.controller
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run the full API test suite**

```bash
npm run test:api -- --run
```

Expected: all tests pass. Fix any regressions before proceeding.

- [ ] **Step 6: Type-check**

```bash
npm run build:api 2>&1 | tail -20
```

Expected: clean build. If TypeScript reports an error about `archivedAt` not existing on the `ScopeNode` mock in tests, add `archivedAt: null` to the mock objects in the affected test files.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/scope/scope.controller.ts \
        apps/api/src/scope/scope.controller.spec.ts
git commit -m "feat(api): scope controller — membership-filtered getTree + admin maintenance endpoints"
```
