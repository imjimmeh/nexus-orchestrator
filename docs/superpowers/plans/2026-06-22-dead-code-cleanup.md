# Dead Code & Pagination-Duplication Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove three confirmed dead-code artifacts and eliminate pagination/search duplication by adopting the existing (but unused) `query-helpers`, while correcting two stale analysis claims.

**Architecture:** Pure subtractive cleanup plus a DRY refactor. No new runtime behaviour except one intentional, tested bug-fix: paginated repository queries will clamp their page size to ≤100 (today they clamp the `skip` offset but pass an unclamped `take`). Each task is independently committable and verifiable.

**Tech Stack:** NestJS, TypeORM, Vitest, TypeScript (apps/api). Package manager: npm workspaces.

## Global Constraints

- Tests run with Vitest: from repo root use `npm exec --workspace=apps/api -- vitest run --project unit <specPath>`.
- Typecheck the API with `npm run build --workspace=apps/api` (NestJS `tsc` build).
- Circular-dependency ratchet: `npm exec --workspace=apps/api -- npm run madge:ci` must stay green.
- Follow Red→Green→Refactor. Behaviour-preserving refactors get a characterization test first; the one behaviour change (take-clamping) gets a failing test first.
- Conventional commit messages, scoped `(api)`. Commit after each task.
- Aggressive hygiene: delete dead code outright — no `@deprecated` left behind, no re-exports.
- All work happens on the current worktree branch (`worktree-api-forwardref-refactor`). No new branch needed.

## Verification context (already confirmed during planning)

- `pauseContainer` (`container-orchestrator.service.ts:332`) — `@deprecated`, **zero production callers**; only a leftover test mock at `session-hydration.service.spec.ts:40`. **`resumeContainer` is live** (called by `startup-resume.coordinator.ts:67`, part of the `ContainerResumer` interface) — DO NOT touch it.
- `PluginEventDeliveryObservabilityService` — provided + exported by `PluginKernelModule` (lines 22, 70, 133) but **zero injectors, zero callers** of all 6 methods. Its `.types.ts` is referenced only by the service. Whole service is dead.
- `query-helpers.ts` — `applyPagination`/`applySort`/`applySearch` have **zero callers**; `buildPaginatedMeta`/`buildPaginatedResponse` (same file) ARE used (`ai-config-admin.service.ts:137,232`) — keep those.
- `BoardStateService.getBoardStateSummary` — analysis claim of "hardcoded zeros" is **STALE/false**; current code aggregates real data and has a passing spec. Docs-only correction.
- `StepJobData` — deprecated but still load-bearing (backward-compat union + live conversion in `step-execution.consumer.ts`). **Deferred** — see end of plan.

## File Structure

| File                                                                                          | Action | Responsibility                                                       |
| --------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `apps/api/src/docker/container-orchestrator.service.ts`                                       | Modify | Remove dead `pauseContainer`                                         |
| `apps/api/src/session/session-hydration.service.spec.ts`                                      | Modify | Drop obsolete `pauseContainer` mock entry                            |
| `docs/architecture/container-orchestration.md`                                                | Modify | Remove `pauseContainer` from documented API                          |
| `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.ts`            | Delete | Dead service                                                         |
| `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.spec.ts`       | Delete | Spec for dead service                                                |
| `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.types.ts`              | Delete | Types used only by dead service                                      |
| `apps/api/src/plugin-kernel/plugin-kernel.module.ts`                                          | Modify | Remove provider/export/import of dead service                        |
| `apps/api/src/common/utils/query-helpers.spec.ts`                                             | Modify | Replace literal-arithmetic tests with real helper unit tests         |
| `apps/api/src/ai-config/database/repositories/llm-provider.repository.ts`                     | Modify | Adopt `applyPagination`/`applySort`/`applySearch`                    |
| `apps/api/src/ai-config/database/repositories/llm-provider.repository.spec.ts`                | Modify | Add `findAllPaginated` tests (clamp + clause)                        |
| `apps/api/src/ai-config/database/repositories/llm-model.repository.ts`                        | Modify | Adopt the three helpers                                              |
| `apps/api/src/ai-config/database/repositories/llm-model.repository.spec.ts`                   | Create | New spec for `findAllPaginated`                                      |
| `apps/api/src/chat/database/repositories/chat-session.repository.ts`                          | Modify | Adopt `applySearch` in `findAll` + `count` (offset pagination stays) |
| `apps/api/src/chat/database/repositories/chat-session.repository.spec.ts`                     | Modify | Add `findAll`/`count` search-clause tests                            |
| `docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md`                                 | Modify | Mark stale claims resolved/corrected                                 |
| `docs/work-items-backup-2026-06-12T23-09-38-269Z/WI-2026-063-fix-board-state-summary-stub.md` | Modify | Close as not-a-bug                                                   |

---

### Task 1: Delete dead `pauseContainer`

**Files:**

- Modify: `apps/api/src/docker/container-orchestrator.service.ts:328-336`
- Modify: `apps/api/src/session/session-hydration.service.spec.ts:40`
- Modify: `docs/architecture/container-orchestration.md:48`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing — this is a pure deletion. `resumeContainer`, `freezeContainer`, `getContainerRuntimeState` remain unchanged.

- [ ] **Step 1: Confirm there are no remaining production callers**

Run: `npm exec --workspace=apps/api -- vitest --version >/dev/null; grep -rn "pauseContainer" apps/ packages/ --include=*.ts`
Expected: only the definition (`container-orchestrator.service.ts:332`) and the mock (`session-hydration.service.spec.ts:40`). No other `.ts` references.

- [ ] **Step 2: Delete the method**

In `apps/api/src/docker/container-orchestrator.service.ts`, remove these lines exactly (the JSDoc + method, lines 328-336), leaving `freezeContainer` immediately after the host-mount helper:

```typescript
  /**
   * @deprecated Use TelemetryGateway.sendDehydrateCommand() instead.
   * Kept temporarily for backward compatibility during migration.
   */
  async pauseContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.kill({ signal: 'SIGUSR1' });
    this.logger.log(`Sent SIGUSR1 to container ${containerId}`);
  }

```

- [ ] **Step 3: Remove the obsolete mock entry**

In `apps/api/src/session/session-hydration.service.spec.ts`, delete line 40:

```typescript
      pauseContainer: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 4: Update the architecture doc**

In `docs/architecture/container-orchestration.md`, delete the bullet at line 48:

```markdown
- `pauseContainer(containerId)` - Send SIGUSR1 for graceful pause
```

Then in the same file, remove the now-orphaned "Lifecycle Signal: SIGUSR1" section (lines ~55-60) that documents only `pauseContainer`. Leave `resumeContainer` documented.

- [ ] **Step 5: Run the affected specs**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/session/session-hydration.service.spec.ts src/docker`
Expected: PASS (no reference to `pauseContainer` remains).

- [ ] **Step 6: Typecheck**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/docker/container-orchestrator.service.ts apps/api/src/session/session-hydration.service.spec.ts docs/architecture/container-orchestration.md
git commit -m "refactor(api): delete dead pauseContainer (SIGUSR1 path superseded by dehydrate)"
```

---

### Task 2: Delete dead `PluginEventDeliveryObservabilityService`

**Files:**

- Delete: `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.ts`
- Delete: `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.spec.ts`
- Delete: `apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.types.ts`
- Modify: `apps/api/src/plugin-kernel/plugin-kernel.module.ts:22,70,133`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing. The repository (`PluginEventDeliveryRepository`) and its DTOs are untouched.

- [ ] **Step 1: Re-confirm zero consumers**

Run: `grep -rn "PluginEventDeliveryObservabilityService" apps/ packages/ --include=*.ts`
Expected: matches only in `plugin-kernel.module.ts` (lines 22, 70, 133), the service file, and its spec. No injector, no controller.

- [ ] **Step 2: Delete the three files**

```bash
git rm apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.ts \
       apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.service.spec.ts \
       apps/api/src/plugin-kernel/events/plugin-event-delivery-observability.types.ts
```

- [ ] **Step 3: Remove the import (module line 22)**

In `apps/api/src/plugin-kernel/plugin-kernel.module.ts`, delete:

```typescript
import { PluginEventDeliveryObservabilityService } from "./events/plugin-event-delivery-observability.service";
```

- [ ] **Step 4: Remove the provider entry (module line 70)**

Delete this line from the `providers` array:

```typescript
    PluginEventDeliveryObservabilityService,
```

- [ ] **Step 5: Remove the export entry (module line 133)**

Delete this line from the `exports` array:

```typescript
    PluginEventDeliveryObservabilityService,
```

- [ ] **Step 6: Typecheck (proves nothing else imported it)**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds with no "cannot find name" / unresolved-import errors.

- [ ] **Step 7: Boot/module smoke test**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/plugin-kernel`
Expected: PASS (no test referenced the deleted service except its own now-deleted spec).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/plugin-kernel/plugin-kernel.module.ts
git commit -m "refactor(api): delete unused PluginEventDeliveryObservabilityService

Provided/exported by PluginKernelModule but never injected or called.
Removes the service, its types, spec, and module wiring."
```

> **Noted follow-up (not in this task):** `PluginEventDeliveryRepository.findRecentDeliveries`/`findDeadLetters` are now only used by the repository's own spec. Leaving them is harmless; a future pass may prune them and their DTOs. Keep this task scoped to the service so the deletion stays atomic and reviewable.

---

### Task 3: Give `query-helpers` real unit tests

The existing `query-helpers.spec.ts` only asserts literal arithmetic (`expect((2 - 1) * 20).toBe(20)`), never calling the functions. Replace it with tests that exercise the real helpers against a mock query builder. The helpers already exist and are correct, so this is a characterization step that locks their contract before adoption (Tasks 4–6 depend on it).

**Files:**

- Modify: `apps/api/src/common/utils/query-helpers.spec.ts`

**Interfaces:**

- Consumes: `applyPagination(qb, page, limit)`, `applySort(qb, sortBy, sortDir, allowedColumns, defaultSort?, defaultDir?, entityAlias?)`, `applySearch(qb, search, searchableColumns, entityAlias?)`, `buildPaginatedMeta(total, page, limit)` from `./query-helpers`.
- Produces: confirmed behaviour later tasks rely on — `applyPagination` clamps `take` to `[1,100]`; `applySort` falls back to `created_at`/`desc`; `applySearch` emits `(<alias>.<col> ILIKE :searchTerm OR ...)` with `{ searchTerm: '%<term>%' }` and is a no-op for empty input.

- [ ] **Step 1: Replace the spec body**

Overwrite `apps/api/src/common/utils/query-helpers.spec.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";
import {
  applyPagination,
  applySearch,
  applySort,
  buildPaginatedMeta,
} from "./query-helpers";

function createMockQb(alias = "e") {
  const qb = {
    alias,
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
  };
  return qb as typeof qb & SelectQueryBuilder<ObjectLiteral>;
}

describe("query-helpers", () => {
  describe("applyPagination", () => {
    it("clamps limit to a max of 100 and computes skip from the clamped limit", () => {
      const qb = createMockQb();
      applyPagination(qb, 2, 500);
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(100);
    });

    it("clamps limit and page to a min of 1", () => {
      const qb = createMockQb();
      applyPagination(qb, 0, -5);
      expect(qb.take).toHaveBeenCalledWith(1);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });
  });

  describe("applySort", () => {
    it("uses the requested column when allowed", () => {
      const qb = createMockQb("provider");
      applySort(qb, "name", "asc", ["name", "created_at"]);
      expect(qb.orderBy).toHaveBeenCalledWith("provider.name", "ASC");
    });

    it("falls back to created_at desc when the column is not allowed", () => {
      const qb = createMockQb("provider");
      applySort(qb, "evil_column", undefined, ["name", "created_at"]);
      expect(qb.orderBy).toHaveBeenCalledWith("provider.created_at", "DESC");
    });
  });

  describe("applySearch", () => {
    it("builds an OR-ed ILIKE clause across the searchable columns", () => {
      const qb = createMockQb("cs");
      applySearch(qb, "hello", ["display_name", "initial_message"]);
      expect(qb.andWhere).toHaveBeenCalledWith(
        "(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)",
        { searchTerm: "%hello%" },
      );
    });

    it("is a no-op when search is empty", () => {
      const qb = createMockQb("cs");
      applySearch(qb, "", ["display_name"]);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  describe("buildPaginatedMeta", () => {
    it("computes totalPages correctly", () => {
      const meta = buildPaginatedMeta(150, 2, 20);
      expect(meta.pagination.totalPages).toBe(8);
      expect(meta.pagination.total).toBe(150);
      expect(meta.pagination.page).toBe(2);
      expect(meta.pagination.limit).toBe(20);
    });

    it("handles zero total", () => {
      expect(buildPaginatedMeta(0, 1, 20).pagination.totalPages).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/common/utils/query-helpers.spec.ts`
Expected: PASS (helpers already implement this behaviour).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/utils/query-helpers.spec.ts
git commit -m "test(api): exercise query-helpers functions directly instead of literal arithmetic"
```

---

### Task 4: Adopt query-helpers in `LlmProviderRepository`

Behaviour change: today `findAllPaginated` calls `.take(params.limit)` **unclamped** while clamping only the `skip` factor. Adopting `applyPagination` clamps `take` to ≤100 — a latent fix. Write the failing test first.

**Files:**

- Modify: `apps/api/src/ai-config/database/repositories/llm-provider.repository.ts:1-8,57-102`
- Modify: `apps/api/src/ai-config/database/repositories/llm-provider.repository.spec.ts`

**Interfaces:**

- Consumes: helpers from Task 3 (`../../../common/utils/query-helpers`).
- Produces: `findAllPaginated` return shape unchanged (`{ data: LlmProvider[]; total: number }`); page size now clamped to ≤100.

- [ ] **Step 1: Add the failing test**

In `apps/api/src/ai-config/database/repositories/llm-provider.repository.spec.ts`, add `createQueryBuilder` to the `typeormRepo` mock in `beforeEach` (add this line inside the object literal at lines 44-51):

```typescript
      createQueryBuilder: vi.fn(),
```

Update the `typeormRepo` type (lines 10-17) to include it:

```typescript
createQueryBuilder: ReturnType<typeof vi.fn>;
```

Then add this describe block before the closing `});` of the top-level describe:

```typescript
describe("findAllPaginated", () => {
  function mockQb(rows: LlmProvider[], total: number) {
    const qb = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(total),
      getMany: vi.fn().mockResolvedValue(rows),
    };
    typeormRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  it("clamps page size to a max of 100", async () => {
    const qb = mockQb([buildProvider()], 1);

    await repository.findAllPaginated({ page: 1, limit: 500 });

    expect(qb.take).toHaveBeenCalledWith(100);
    expect(qb.skip).toHaveBeenCalledWith(0);
  });

  it("emits the shared search clause and default sort", async () => {
    const qb = mockQb([], 0);

    await repository.findAllPaginated({ page: 1, limit: 20, search: "gpt" });

    expect(qb.andWhere).toHaveBeenCalledWith(
      "(provider.name ILIKE :searchTerm OR provider.auth_type ILIKE :searchTerm)",
      { searchTerm: "%gpt%" },
    );
    expect(qb.orderBy).toHaveBeenCalledWith("provider.created_at", "DESC");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/ai-config/database/repositories/llm-provider.repository.spec.ts`
Expected: FAIL — current code calls `take(500)` (not 100) and emits `:search` (not `:searchTerm`).

- [ ] **Step 3: Refactor the repository to use the helpers**

In `apps/api/src/ai-config/database/repositories/llm-provider.repository.ts`, add the import after line 6:

```typescript
import {
  applyPagination,
  applySearch,
  applySort,
} from "../../../common/utils/query-helpers";
```

Replace the body of `findAllPaginated` (lines 66-101, from `const qb =` through `return { data, total };`) with:

```typescript
const qb = this.repository.createQueryBuilder("provider");

applySearch(qb, params.search, ["name", "auth_type"]);

if (params.isActive !== undefined) {
  qb.andWhere("provider.is_active = :isActive", {
    isActive: params.isActive,
  });
}
if (params.authType) {
  qb.andWhere("provider.auth_type = :authType", {
    authType: params.authType,
  });
}

const total = await qb.getCount();

applySort(qb, params.sortBy, params.sortDir, PROVIDER_ALLOWED_SORTS);
applyPagination(qb, params.page, params.limit);

const data = await qb.getMany();
return { data, total };
```

- [ ] **Step 4: Run the spec to confirm it passes**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/ai-config/database/repositories/llm-provider.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/database/repositories/llm-provider.repository.ts apps/api/src/ai-config/database/repositories/llm-provider.repository.spec.ts
git commit -m "refactor(api): adopt query-helpers in LlmProviderRepository

Replaces inline pagination/sort/search with the shared helpers and
fixes an unclamped take() that allowed page sizes above 100."
```

---

### Task 5: Adopt query-helpers in `LlmModelRepository`

Same pattern as Task 4. This repository has no existing spec; create one.

**Files:**

- Modify: `apps/api/src/ai-config/database/repositories/llm-model.repository.ts:1-15,89-133`
- Create: `apps/api/src/ai-config/database/repositories/llm-model.repository.spec.ts`

**Interfaces:**

- Consumes: helpers from Task 3.
- Produces: `findAllPaginated` shape unchanged (`{ data: LlmModel[]; total: number }`); page size clamped to ≤100.

- [ ] **Step 1: Create the failing spec**

Create `apps/api/src/ai-config/database/repositories/llm-model.repository.spec.ts`:

```typescript
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { vi } from "vitest";
import { LlmModel } from "../entities/llm-model.entity";
import { LlmModelRepository } from "./llm-model.repository";

describe("LlmModelRepository", () => {
  let repository: LlmModelRepository;
  let typeormRepo: { createQueryBuilder: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    typeormRepo = { createQueryBuilder: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        LlmModelRepository,
        { provide: getRepositoryToken(LlmModel), useValue: typeormRepo },
      ],
    }).compile();

    repository = module.get(LlmModelRepository);
  });

  afterEach(() => vi.clearAllMocks());

  describe("findAllPaginated", () => {
    function mockQb(rows: LlmModel[], total: number) {
      const qb = {
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(total),
        getMany: vi.fn().mockResolvedValue(rows),
      };
      typeormRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it("clamps page size to a max of 100", async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({ page: 3, limit: 500 });

      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(200);
    });

    it("emits the shared search clause and default sort", async () => {
      const qb = mockQb([], 0);

      await repository.findAllPaginated({ page: 1, limit: 20, search: "opus" });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "(model.name ILIKE :searchTerm OR model.provider_name ILIKE :searchTerm)",
        { searchTerm: "%opus%" },
      );
      expect(qb.orderBy).toHaveBeenCalledWith("model.created_at", "DESC");
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/ai-config/database/repositories/llm-model.repository.spec.ts`
Expected: FAIL — current code uses unclamped `take(500)` and `:search`.

- [ ] **Step 3: Refactor the repository**

In `apps/api/src/ai-config/database/repositories/llm-model.repository.ts`, add the import after line 8:

```typescript
import {
  applyPagination,
  applySearch,
  applySort,
} from "../../../common/utils/query-helpers";
```

Replace the body of `findAllPaginated` (lines 98-132, from `const qb =` through `return { data, total };`) with:

```typescript
const qb = this.repository.createQueryBuilder("model");

applySearch(qb, params.search, ["name", "provider_name"]);

if (params.isActive !== undefined) {
  qb.andWhere("model.is_active = :isActive", { isActive: params.isActive });
}
if (params.providerName) {
  qb.andWhere("model.provider_name = :providerName", {
    providerName: params.providerName,
  });
}

const total = await qb.getCount();

applySort(qb, params.sortBy, params.sortDir, MODEL_ALLOWED_SORTS);
applyPagination(qb, params.page, params.limit);

const data = await qb.getMany();
return { data, total };
```

- [ ] **Step 4: Run the spec to confirm it passes**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/ai-config/database/repositories/llm-model.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/database/repositories/llm-model.repository.ts apps/api/src/ai-config/database/repositories/llm-model.repository.spec.ts
git commit -m "refactor(api): adopt query-helpers in LlmModelRepository

Shared pagination/sort/search; adds first findAllPaginated spec and
clamps page size to 100."
```

---

### Task 6: Adopt `applySearch` in `ChatSessionRepository`

`findAll` uses **offset-based** pagination (`.limit()/.offset()`), so `applyPagination` (page-based `.skip()/.take()`) does NOT fit and must not be forced. The genuine duplication here is the ILIKE search clause copied verbatim between `findAll` (lines 70-75) and `count` (lines 106-111). Adopt `applySearch` in both; leave pagination untouched.

**Files:**

- Modify: `apps/api/src/chat/database/repositories/chat-session.repository.ts:1-6,70-75,106-111`
- Modify: `apps/api/src/chat/database/repositories/chat-session.repository.spec.ts`

**Interfaces:**

- Consumes: `applySearch` from Task 3.
- Produces: `findAll`/`count` behaviour unchanged except the search clause now binds `:searchTerm` instead of `:search` (identical SQL semantics).

- [ ] **Step 1: Add failing characterization tests**

In `apps/api/src/chat/database/repositories/chat-session.repository.spec.ts`, extend the shared `queryBuilder` mock (lines 15-28) so it also supports `findAll`/`count`. Replace the `queryBuilder` declaration and its `beforeEach` initialization with:

```typescript
let queryBuilder: {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  queryBuilder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue([]),
    getCount: vi.fn().mockResolvedValue(0),
  };

  typeormRepo = {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
  };

  repo = new ChatSessionRepository(typeormRepo as Repository<ChatSession>);
});
```

Then add this describe block before the closing `});` of the top-level describe:

```typescript
describe("search clause", () => {
  it("findAll emits the shared ILIKE clause via applySearch", async () => {
    await repo.findAll({ search: "deploy", limit: 10, offset: 0 });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)",
      { searchTerm: "%deploy%" },
    );
  });

  it("count emits the shared ILIKE clause via applySearch", async () => {
    await repo.count({ search: "deploy" });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "(cs.display_name ILIKE :searchTerm OR cs.initial_message ILIKE :searchTerm)",
      { searchTerm: "%deploy%" },
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/chat/database/repositories/chat-session.repository.spec.ts`
Expected: FAIL — current code binds `:search` with key `search`, not `:searchTerm`.

- [ ] **Step 3: Refactor the repository**

In `apps/api/src/chat/database/repositories/chat-session.repository.ts`, add the import after line 6:

```typescript
import { applySearch } from "../../../common/utils/query-helpers";
```

In `findAll`, replace lines 70-75:

```typescript
if (filters.search) {
  qb.andWhere(
    "(cs.display_name ILIKE :search OR cs.initial_message ILIKE :search)",
    { search: `%${filters.search}%` },
  );
}
```

with:

```typescript
applySearch(qb, filters.search, ["display_name", "initial_message"]);
```

In `count`, replace lines 106-111 (the identical block) with the same single line:

```typescript
applySearch(qb, filters.search, ["display_name", "initial_message"]);
```

Leave the `orderBy/limit/offset` chain in `findAll` (lines 77-79) and the rest of both methods unchanged.

- [ ] **Step 4: Run the spec to confirm it passes**

Run: `npm exec --workspace=apps/api -- vitest run --project unit src/chat/database/repositories/chat-session.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chat/database/repositories/chat-session.repository.ts apps/api/src/chat/database/repositories/chat-session.repository.spec.ts
git commit -m "refactor(api): dedupe ChatSessionRepository search via applySearch

findAll and count shared an identical ILIKE clause; route both through
the shared helper. Offset pagination is intentionally left as-is."
```

---

### Task 7: Correct the two stale analysis claims (docs only)

`getBoardStateSummary` does not return hardcoded zeros — it aggregates real data and has a passing spec at `apps/kanban/src/services/__tests__/board-state.service.spec.ts`. Correct the analysis doc and close the stale work item. No code change.

**Files:**

- Modify: `docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md:345,348`
- Modify: `docs/work-items-backup-2026-06-12T23-09-38-269Z/WI-2026-063-fix-board-state-summary-stub.md`

**Interfaces:** none.

- [ ] **Step 1: Correct the Section 10 dead-code table**

In `docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md`, update the row at line 345 to reflect that only `pauseContainer` is dead:

```markdown
| `container-orchestrator.service.ts:332` | `pauseContainer` — `@deprecated`, zero production callers (DELETED 2026-06-22). `resumeContainer` is live (used by startup-resume coordinator) — NOT dead. |
```

And update the row at line 348:

```markdown
| `kanban/services/board-state.service.ts` | `getBoardStateSummary` — **CLAIM RETRACTED 2026-06-22**: implementation aggregates real work-item counts and is covered by a passing spec. Not a bug; likely fixed or misdiagnosed after the 2026-06-08 probe. |
```

- [ ] **Step 2: Close the stale work item**

At the top of `docs/work-items-backup-2026-06-12T23-09-38-269Z/WI-2026-063-fix-board-state-summary-stub.md`, add a status banner immediately under the title:

```markdown
> **STATUS: CLOSED — NOT A BUG (2026-06-22).** Verified `getBoardStateSummary`
> queries `workItems.findByproject_id` and returns real per-status counts;
> `board-state.service.spec.ts` asserts the aggregation. The "hardcoded zeros"
> finding from the 2026-06-08 analysis no longer reproduces.
```

- [ ] **Step 3: Commit**

```bash
git add docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md "docs/work-items-backup-2026-06-12T23-09-38-269Z/WI-2026-063-fix-board-state-summary-stub.md"
git commit -m "docs: retract stale board-state 'hardcoded zeros' claim; scope pauseContainer dead-code note"
```

---

### Task 8: Full-suite + ratchet verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full API unit suite**

Run: `npm run test --workspace=apps/api`
Expected: PASS (no regressions from Tasks 1–6).

- [ ] **Step 2: Run the circular-dependency ratchet**

Run: `npm exec --workspace=apps/api -- npm run madge:ci`
Expected: PASS (deletions only reduce edges; the adoption imports `common/utils`, a leaf with no cycle risk).

- [ ] **Step 3: Lint the touched files**

Run: `npm exec --workspace=apps/api -- eslint "src/ai-config/database/repositories/*.ts" "src/chat/database/repositories/chat-session.repository.ts" "src/common/utils/query-helpers.spec.ts" "src/docker/container-orchestrator.service.ts" "src/plugin-kernel/plugin-kernel.module.ts"`
Expected: no errors.

- [ ] **Step 4: Final typecheck**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

---

## Deferred Work (tracked, NOT implemented in this plan)

**`StepJobData` deprecated type migration** — `apps/api/src/workflow/job-execution.types.ts:36`. The type is `@deprecated` in favour of `JobQueueData`, but `step-execution.consumer.ts` still accepts it as a backward-compat union (`Job<JobQueueData | StepJobData>`) and contains live conversion logic (`'stepId' in data && !('jobId' in data)`). The two types diverge structurally (`step: unknown` vs `job: IJob`; `stepId` vs `jobId`). A safe removal requires first auditing and eliminating every **producer** that still enqueues the legacy shape, then deleting the union, the conversion branch, and the runtime property checks. This is medium–high effort and risk — out of scope for a dead-code pass. File as a separate tracked issue.

---

## Self-Review

**1. Spec coverage:** Every actionable Section-10 candidate is addressed — `pauseContainer` (Task 1), plugin observability service (Task 2), query-helpers + 4-repo duplication (Tasks 3–6; `budget-usage-event` excluded with rationale — it has no combined paginate method), board-state false claim (Task 7), `StepJobData` (Deferred). The "5 dead-code rows" map to Tasks 1, 4–6, 2, 7, Deferred respectively.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows the literal code; every run step shows the command and expected result.

**3. Type consistency:** Helper signatures used in Tasks 4–6 match Task 3's Interfaces block and the real `query-helpers.ts` (`applySearch(qb, search, columns)`, `applySort(qb, sortBy, sortDir, allowedColumns)`, `applyPagination(qb, page, limit)`). Param binding `:searchTerm` is used consistently in helper, repos, and all assertions. Return shapes (`{ data, total }` for the LLM repos; `ChatSession[]` for `findAll`) are unchanged. The `resumeContainer`/`freezeContainer`/`getContainerRuntimeState` survivors are explicitly preserved.

**Note on intentional behaviour change:** Tasks 4–5 clamp page size to ≤100 (previously unclamped `take`). This is asserted by a failing-first test in each task and called out in commit messages, so it is a deliberate, reviewable fix rather than a silent change.
