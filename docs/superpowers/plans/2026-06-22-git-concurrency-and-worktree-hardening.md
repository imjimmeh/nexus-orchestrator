# Git Concurrency & Worktree Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared per-repository git clone safe under concurrency and across process restarts/replicas, isolate the integration merge and each subagent from the shared working tree, and proactively reap orphaned worktrees.

**Architecture:** Four independently-shippable phases against the existing shared-clone + ephemeral-worktree model in `apps/api/src/common/git`. Phase 1 replaces the in-memory per-repo lock with a Redis-backed mutex (cross-process, restart-safe) and brings the integration merge under that lock. Phase 2 moves the integration merge out of the shared clone's working tree into a dedicated integration worktree. Phase 3 gives every subagent its own worktree branched off the parent, merged back on success. Phase 4 adds a scheduled reaper for orphaned worktrees.

**Tech Stack:** NestJS 10, TypeScript (strict), Vitest + SWC, `ioredis` (already transitively present via BullMQ), native `git` CLI via `GitCommandService`.

## Global Constraints

- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code (`.github/instructions/lint-warning-policy.instructions.md`).
- **Core/Kanban boundary** — all code here is API-side `apps/api/src/common/git` and `apps/api/src/workflow`; introduce **no** kanban/work-item/project-domain identifiers. Use neutral `scopeId`/`contextId` only.
- **NestJS build** — verify with `npm run build:api` (uses `nest build`, never raw `tsc`).
- **TDD** — every task is Red → Green → Refactor. Write the failing test first, watch it fail, implement the minimum, watch it pass, commit.
- **One type per file** — new interfaces/enums/tokens get their own file under the owning module's directory.
- **Strong typing** — no `any`. Shared cross-package types go in `@nexus/core`; these are API-internal so they stay in `apps/api/src/common/git`.
- **Targeted tests** — iterate with `npm run test --workspace=apps/api -- <path>`; run the full `npm run test:api` before declaring a phase done.
- **Branch** — do this work on `feat/git-concurrency-worktree-hardening`. Commit per task.

---

## File Structure

| File                                                                                          | Responsibility                                                                      | Phase |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| `apps/api/src/common/git/locking/git-lock-redis.token.ts` (Create)                            | DI token + minimal `GitLockRedis` interface for the lock backend                    | 1     |
| `apps/api/src/common/git/locking/repository-lock.service.ts` (Modify)                         | In-process chain + Redis mutex with TTL renewal; transparent fallback when no Redis | 1     |
| `apps/api/src/common/git/locking/repository-lock.service.spec.ts` (Create)                    | Unit tests: mutual exclusion, renewal, release, fallback                            | 1     |
| `apps/api/src/common/git/git-worktree.module.ts` (Modify)                                     | Provide `GIT_LOCK_REDIS` from env-configured `ioredis` client                       | 1     |
| `apps/api/src/common/git/git-merge.service.ts` (Modify)                                       | Wrap integrate under repo lock; integrate in dedicated worktree                     | 1, 2  |
| `apps/api/src/common/git/integration-worktree.service.ts` (Create)                            | Provision/reuse the per-scope `__integration` worktree                              | 2     |
| `apps/api/src/common/git/integration-worktree.service.spec.ts` (Create)                       | Unit tests for integration-worktree provisioning                                    | 2     |
| `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts` (Create)              | Provision per-subagent worktree off parent branch; merge child branch back          | 3     |
| `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts` (Create)         | Unit tests for subagent worktree lifecycle                                          | 3     |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts` (Modify) | Use per-subagent worktree instead of shared parent worktree                         | 3     |
| `apps/api/src/common/git/reaper/worktree-reaper.service.ts` (Create)                          | Scheduled sweep of orphaned worktrees                                               | 4     |
| `apps/api/src/common/git/reaper/worktree-reaper.service.spec.ts` (Create)                     | Unit tests for reap predicate + sweep                                               | 4     |
| `apps/api/src/operations/checks/git-worktree-integrity.check.ts` (Modify)                     | Surface reaped-orphan count alongside removal failures                              | 4     |
| `docs/guide/*` / `docs/architecture/*` (Modify)                                               | Document the new lock, integration worktree, subagent isolation, reaper             | all   |

---

## Phase 1 — Restart-safe, cross-process repository lock

**Why:** `RepositoryLockService` is an in-memory `Map<string, Promise>` (single process only). Two API replicas — or a restart mid-operation — let concurrent `git worktree add/remove` and integration merges hit the same shared clone and corrupt it. Additionally, the integration merge (`GitMergeService.executeMergePhase`) currently runs under **no** lock at all. This phase makes the lock cross-process and brings merges under it.

**Design:** Keep the in-process promise chain (preserves ordering and avoids Redis churn for same-process callers) and nest a Redis `SET NX PX` mutex inside it, with a renewal timer for long ops and a Lua compare-and-delete release. When no Redis client is provided (tests, single-node dev with the feature disabled) it degrades to in-memory-only behaviour identical to today.

### Task 1.1: Lock backend token + interface

**Files:**

- Create: `apps/api/src/common/git/locking/git-lock-redis.token.ts`

**Interfaces:**

- Produces: `GIT_LOCK_REDIS` (injection token) and `GitLockRedis` interface with `set(key, value, 'PX', ttl, 'NX')`, `eval(script, numKeys, ...args)`, `pexpire(key, ttl)` — the minimal `ioredis` surface the lock uses. `ioredis`'s `Redis` class structurally satisfies this.

- [ ] **Step 1: Create the token + interface file**

```typescript
// apps/api/src/common/git/locking/git-lock-redis.token.ts
export const GIT_LOCK_REDIS = Symbol("GIT_LOCK_REDIS");

/** Minimal ioredis surface used by RepositoryLockService for distributed locking. */
export interface GitLockRedis {
  set(
    key: string,
    value: string,
    mode: "PX",
    ttlMs: number,
    nx: "NX",
  ): Promise<"OK" | null>;
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  pexpire(key: string, ttlMs: number): Promise<number>;
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `npm run build:api`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/git/locking/git-lock-redis.token.ts
git commit -m "feat(api): add GitLockRedis token for distributed repo locking"
```

### Task 1.2: Redis-backed mutual exclusion in RepositoryLockService

**Files:**

- Modify: `apps/api/src/common/git/locking/repository-lock.service.ts`
- Create: `apps/api/src/common/git/locking/repository-lock.service.spec.ts`

**Interfaces:**

- Consumes: `GIT_LOCK_REDIS`, `GitLockRedis` (Task 1.1).
- Produces: unchanged public method `runRepoExclusive<T>(repoPath: string, task: () => Promise<T>): Promise<T>` — call sites in `GitWorktreeService` need no change.

- [ ] **Step 1: Write the failing test (mutual exclusion via fake Redis)**

```typescript
// apps/api/src/common/git/locking/repository-lock.service.spec.ts
import { describe, it, expect } from "vitest";
import { RepositoryLockService } from "./repository-lock.service";
import type { GitLockRedis } from "./git-lock-redis.token";

/** In-memory fake honouring SET NX PX + Lua compare-and-del + pexpire. */
function createFakeRedis(): GitLockRedis {
  const store = new Map<string, string>();
  return {
    async set(key, value, _mode, _ttl, _nx) {
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async eval(_script, _numKeys, key, value) {
      if (store.get(key as string) === value) {
        store.delete(key as string);
        return 1;
      }
      return 0;
    },
    async pexpire() {
      return 1;
    },
  };
}

describe("RepositoryLockService (redis)", () => {
  it("serializes concurrent tasks on the same repo path", async () => {
    const service = new RepositoryLockService(createFakeRedis());
    const order: string[] = [];
    const run = (id: string) =>
      service.runRepoExclusive("/repo/a", async () => {
        order.push(`${id}:start`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`${id}:end`);
      });

    await Promise.all([run("1"), run("2")]);

    // No interleaving: each task fully completes before the next starts.
    expect(order).toEqual(["1:start", "1:end", "2:start", "2:end"]);
  });

  it("falls back to in-process serialization when no redis client is provided", async () => {
    const service = new RepositoryLockService(null);
    const order: string[] = [];
    const run = (id: string) =>
      service.runRepoExclusive("/repo/b", async () => {
        order.push(`${id}:start`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`${id}:end`);
      });
    await Promise.all([run("1"), run("2")]);
    expect(order).toEqual(["1:start", "1:end", "2:start", "2:end"]);
  });

  it("releases the lock so a later acquire on the same key succeeds", async () => {
    const redis = createFakeRedis();
    const service = new RepositoryLockService(redis);
    await service.runRepoExclusive("/repo/c", async () => undefined);
    // If release worked, this resolves; if not, acquire would spin to timeout.
    await expect(
      service.runRepoExclusive("/repo/c", async () => "ok"),
    ).resolves.toBe("ok");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- repository-lock.service.spec`
Expected: FAIL — current constructor takes no args; `new RepositoryLockService(...)` is a type error / the redis path does not exist.

- [ ] **Step 3: Implement the Redis-backed lock**

```typescript
// apps/api/src/common/git/locking/repository-lock.service.ts
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GIT_LOCK_REDIS, type GitLockRedis } from "./git-lock-redis.token";

const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

@Injectable()
export class RepositoryLockService {
  private readonly logger = new Logger(RepositoryLockService.name);
  private readonly repoLocks = new Map<string, Promise<unknown>>();
  private readonly ttlMs = Number(process.env.NEXUS_GIT_LOCK_TTL_MS ?? 120_000);
  private readonly acquireTimeoutMs = Number(
    process.env.NEXUS_GIT_LOCK_ACQUIRE_TIMEOUT_MS ?? 600_000,
  );
  private readonly pollIntervalMs = Number(
    process.env.NEXUS_GIT_LOCK_POLL_INTERVAL_MS ?? 150,
  );

  constructor(
    @Optional()
    @Inject(GIT_LOCK_REDIS)
    private readonly redis: GitLockRedis | null = null,
  ) {}

  async runRepoExclusive<T>(
    repoPath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.repoLocks.get(repoPath) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.runWithDistributedLock(repoPath, task));
    this.repoLocks.set(
      repoPath,
      next.then(() => undefined).catch(() => undefined),
    );
    return next;
  }

  private async runWithDistributedLock<T>(
    repoPath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis) {
      return task();
    }
    const key = `nexus:gitlock:${repoPath}`;
    const token = `${process.pid}:${randomUUID()}`;
    await this.acquire(key, token);
    const renewEvery = Math.max(1_000, Math.floor(this.ttlMs / 3));
    const renew = setInterval(() => {
      this.redis?.pexpire(key, this.ttlMs).catch((error: unknown) => {
        this.logger.warn(
          `Failed to renew git lock ${key}: ${(error as Error).message}`,
        );
      });
    }, renewEvery);
    renew.unref?.();
    try {
      return await task();
    } finally {
      clearInterval(renew);
      await this.release(key, token);
    }
  }

  private async acquire(key: string, token: string): Promise<void> {
    const deadline = Date.now() + this.acquireTimeoutMs;
    for (;;) {
      const acquired = await this.redis!.set(
        key,
        token,
        "PX",
        this.ttlMs,
        "NX",
      );
      if (acquired === "OK") {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out acquiring git lock ${key} after ${this.acquireTimeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis!.eval(RELEASE_SCRIPT, 1, key, token);
    } catch (error) {
      this.logger.warn(
        `Failed to release git lock ${key}: ${(error as Error).message}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- repository-lock.service.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/git/locking/repository-lock.service.ts apps/api/src/common/git/locking/repository-lock.service.spec.ts
git commit -m "feat(api): Redis-backed cross-process repository lock with TTL renewal"
```

### Task 1.3: Wire the Redis client provider into the git module

**Files:**

- Modify: `apps/api/src/common/git/git-worktree.module.ts`

**Interfaces:**

- Consumes: `GIT_LOCK_REDIS` token (Task 1.1), `RepositoryLockService` (Task 1.2).
- Produces: a provider for `GIT_LOCK_REDIS` built from env config.

- [ ] **Step 1: Confirm `ioredis` is resolvable and find existing Redis env vars**

Run: `npm ls ioredis -w apps/api` and `git grep -n "REDIS_HOST\|new Redis\|BullModule.forRoot" apps/api/src`
Expected: `ioredis` is present (BullMQ depends on it). Note the exact env var names BullMQ uses for host/port. If `ioredis` is **not** a direct dependency, add it: `npm install ioredis -w apps/api`. **Align the factory below with the env var names you found** (this plan assumes `REDIS_HOST` / `REDIS_PORT`).

- [ ] **Step 2: Add the provider**

Add to the `providers` array in `git-worktree.module.ts` (keep `RepositoryLockService` exported as today):

```typescript
import Redis from 'ioredis';
import { GIT_LOCK_REDIS, type GitLockRedis } from './locking/git-lock-redis.token';

// ...inside @Module({ providers: [...] })
{
  provide: GIT_LOCK_REDIS,
  useFactory: (): GitLockRedis | null => {
    if (process.env.NEXUS_GIT_LOCK_DISABLED === 'true') {
      return null;
    }
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    return new Redis({ host, port, maxRetriesPerRequest: null, lazyConnect: false });
  },
},
```

- [ ] **Step 3: Build to confirm wiring**

Run: `npm run build:api`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/common/git/git-worktree.module.ts package-lock.json apps/api/package.json
git commit -m "feat(api): provide env-configured Redis client for git locking"
```

### Task 1.4: Bring the integration merge under the repository lock

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.ts`

**Interfaces:**

- Consumes: `RepositoryLockService.runRepoExclusive` (Task 1.2).
- Produces: `integrateAndPush` and `mergeWithConflictDetection` now hold the per-repo lock for the duration of the clone-mutating integration.

- [ ] **Step 1: Write the failing test**

```typescript
// add to apps/api/src/common/git/git-merge.service.spec.ts (create if absent)
import { describe, it, expect, vi } from "vitest";
import { GitMergeService } from "./git-merge.service";

describe("GitMergeService locking", () => {
  it("runs integrateAndPush inside runRepoExclusive", async () => {
    const calls: string[] = [];
    const lock = {
      runRepoExclusive: vi.fn(
        async (_repo: string, task: () => Promise<unknown>) => {
          calls.push("lock:enter");
          const result = await task();
          calls.push("lock:exit");
          return result;
        },
      ),
    };
    // Minimal stubs for eventLedger + authEnvResolver; spy resolveGitRepoPath to a temp git repo path.
    const service = new GitMergeService(
      { emitBestEffort: vi.fn() } as never,
      { resolve: vi.fn().mockResolvedValue({}) } as never,
      lock as never,
    );
    vi.spyOn(service, "resolveGitRepoPath" as never).mockResolvedValue(
      "/clone/x" as never,
    );
    vi.spyOn(service as never, "executeMergePhase").mockResolvedValue({
      outcome: "succeeded",
    } as never);

    await service.integrateAndPush("scope-1", "feature/a", "main");

    expect(lock.runRepoExclusive).toHaveBeenCalledWith(
      "/clone/x",
      expect.any(Function),
    );
    expect(calls).toEqual(["lock:enter", "lock:exit"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: FAIL — constructor has 2 args; no lock involvement.

- [ ] **Step 3: Inject the lock and wrap the clone-mutating phases**

In `git-merge.service.ts`, add `private readonly repositoryLock: RepositoryLockService` to the constructor (import from `./locking/repository-lock.service`). Wrap the lock around the clone-root work in both `integrateAndPush` and `mergeWithConflictDetection`. Example for `integrateAndPush`:

```typescript
async integrateAndPush(
  scopeId: string,
  sourceBranch: string,
  destinationBranch: string,
): Promise<MergeResult> {
  const cloneRoot = await this.resolveGitRepoPath(scopeId);
  if (!cloneRoot) {
    return failedResult(sourceBranch, destinationBranch, `Repository path is not a git repository: ${scopeId}`);
  }
  return this.repositoryLock.runRepoExclusive(cloneRoot, () =>
    this.executeMergePhase(scopeId, sourceBranch, destinationBranch, (authEnv) =>
      integrateIntoBase(this, cloneRoot, sourceBranch, destinationBranch, authEnv),
    ),
  );
}
```

Apply the same `runRepoExclusive(cloneRoot, ...)` wrap around the integrate branch of `mergeWithConflictDetection`. **Do not** lock `prepareMergeInWorktree` — it only touches the per-context worktree, not the shared clone.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: PASS.

- [ ] **Step 5: Run the git module + merge suites and build**

Run: `npm run test --workspace=apps/api -- git-merge && npm run build:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "feat(api): serialize integration merge under the repository lock"
```

---

## Phase 2 — Integration merge in a dedicated worktree (stop mutating the shared clone's checkout)

**Why:** `integrateIntoBase` runs `checkout -f` → `reset --hard origin/<base>` → `merge --no-ff` → `push` in the **clone root working tree**. Every worktree shares that clone's `.git`, and `DefaultBranchSyncService` also fast-forwards the clone's default branch there. The lock (Phase 1) makes this safe but it's a sharp edge: any future reader of the clone's checkout can be surprised by a transient branch/HEAD. This phase points the integration at a dedicated, reusable per-scope worktree (`__integration`) so no operation ever depends on the clone's primary checkout state.

**Design:** A small `IntegrationWorktreeService` provisions (lazily) and reuses a worktree at `getWorktreePath(scopeId, '__integration')` checked out on the base branch. `GitMergeService` resolves this path **under the same repo lock** and passes it to `integrateIntoBase` in place of `cloneRoot`. `integrateIntoBase` already force-checks-out and resets the destination branch, so it behaves identically — just in an isolated tree. The `__integration` worktree is reserved (excluded from the Phase 4 reaper).

### Task 2.1: IntegrationWorktreeService

**Files:**

- Create: `apps/api/src/common/git/integration-worktree.service.ts`
- Create: `apps/api/src/common/git/integration-worktree.service.spec.ts`
- Modify: `apps/api/src/common/git/git-worktree.module.ts` (register + export)

**Interfaces:**

- Consumes: `GitPathService.getWorktreePath`, `WorktreeOperationsService` (list/add), `GitCommandService`, `buildGitRepositoryPathCandidates`/`resolveGitRepositoryPath`.
- Produces: `INTEGRATION_WORKTREE_CONTEXT_ID = '__integration'` (exported const) and `provisionIntegrationWorktree(scopeId: string, baseBranch: string): Promise<string>` returning the worktree path.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/common/git/integration-worktree.service.spec.ts
import { describe, it, expect, vi } from "vitest";
import {
  IntegrationWorktreeService,
  INTEGRATION_WORKTREE_CONTEXT_ID,
} from "./integration-worktree.service";

describe("IntegrationWorktreeService", () => {
  it("uses the reserved __integration context id for the worktree path", () => {
    expect(INTEGRATION_WORKTREE_CONTEXT_ID).toBe("__integration");
  });

  it("creates the worktree when absent and returns its path", async () => {
    const pathService = {
      getWorktreePath: vi.fn().mockReturnValue("/wt/scope/__integration"),
    };
    const worktreeOps = {
      listWorktrees: vi.fn().mockResolvedValue([]),
      addWorktree: vi.fn().mockResolvedValue(undefined),
    };
    const gitCommand = { exec: vi.fn().mockResolvedValue("") };
    const service = new IntegrationWorktreeService(
      pathService as never,
      worktreeOps as never,
      gitCommand as never,
    );
    vi.spyOn(service, "resolveRepoPath" as never).mockResolvedValue(
      "/clone/scope" as never,
    );

    const result = await service.provisionIntegrationWorktree("scope", "main");

    expect(result).toBe("/wt/scope/__integration");
    expect(worktreeOps.addWorktree).toHaveBeenCalled();
  });

  it("reuses the worktree when it already exists", async () => {
    const pathService = {
      getWorktreePath: vi.fn().mockReturnValue("/wt/scope/__integration"),
    };
    const worktreeOps = {
      listWorktrees: vi
        .fn()
        .mockResolvedValue([
          { path: "/wt/scope/__integration", branch: "main" },
        ]),
      addWorktree: vi.fn(),
    };
    const gitCommand = { exec: vi.fn().mockResolvedValue("") };
    const service = new IntegrationWorktreeService(
      pathService as never,
      worktreeOps as never,
      gitCommand as never,
    );
    vi.spyOn(service, "resolveRepoPath" as never).mockResolvedValue(
      "/clone/scope" as never,
    );

    await service.provisionIntegrationWorktree("scope", "main");

    expect(worktreeOps.addWorktree).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- integration-worktree.service.spec`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/common/git/integration-worktree.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { GitPathService } from "./path/git-path.service";
import { WorktreeOperationsService } from "./worktree/worktree-operations.service";
import { GitCommandService } from "./git-command/git-command.service";
import { resolveGitRepositoryPath } from "./git-repository-path-candidates.util";

export const INTEGRATION_WORKTREE_CONTEXT_ID = "__integration";

@Injectable()
export class IntegrationWorktreeService {
  private readonly logger = new Logger(IntegrationWorktreeService.name);

  constructor(
    private readonly pathService: GitPathService,
    private readonly worktreeOps: WorktreeOperationsService,
    private readonly gitCommand: GitCommandService,
  ) {}

  /** Caller MUST hold the repository lock for this scope. */
  async provisionIntegrationWorktree(
    scopeId: string,
    baseBranch: string,
  ): Promise<string> {
    const repoPath = await this.resolveRepoPath(scopeId);
    const worktreePath = this.pathService.getWorktreePath(
      scopeId,
      INTEGRATION_WORKTREE_CONTEXT_ID,
    );
    const existing = await this.worktreeOps.listWorktrees(repoPath);
    const already = existing.find((entry) => entry.path === worktreePath);
    if (already) {
      return worktreePath;
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await this.gitCommand
      .exec(repoPath, ["fetch", "origin"])
      .catch(() => undefined);
    // -f tolerates a leftover directory; checkout to base happens inside integrateIntoBase.
    await this.worktreeOps.addWorktree(repoPath, worktreePath, baseBranch);
    return worktreePath;
  }

  private async resolveRepoPath(scopeId: string): Promise<string> {
    const repoPath = await resolveGitRepositoryPath(scopeId);
    if (!repoPath) {
      throw new Error(`Repository path is not a git repository: ${scopeId}`);
    }
    return repoPath;
  }
}
```

> If `WorktreeOperationsService` does not expose `addWorktree(repoPath, worktreePath, branch)`, use the lower-level `gitCommand.exec(repoPath, ['worktree', 'add', '-f', worktreePath, baseBranch])` and adjust the test's mock accordingly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- integration-worktree.service.spec`
Expected: PASS.

- [ ] **Step 5: Register + export in the module, then build**

Add `IntegrationWorktreeService` to `providers` and `exports` of `git-worktree.module.ts`.
Run: `npm run build:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/git/integration-worktree.service.ts apps/api/src/common/git/integration-worktree.service.spec.ts apps/api/src/common/git/git-worktree.module.ts
git commit -m "feat(api): dedicated per-scope integration worktree provisioning"
```

### Task 2.2: Point GitMergeService integration at the integration worktree

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.ts`

**Interfaces:**

- Consumes: `IntegrationWorktreeService.provisionIntegrationWorktree` (Task 2.1), `RepositoryLockService` (Phase 1).
- Produces: integration now runs in the `__integration` worktree, not the clone root.

- [ ] **Step 1: Write the failing test**

```typescript
// add to git-merge.service.spec.ts
it("integrates inside the dedicated integration worktree, not the clone root", async () => {
  const integrationWorktree = {
    provisionIntegrationWorktree: vi
      .fn()
      .mockResolvedValue("/wt/scope/__integration"),
  };
  const lock = {
    runRepoExclusive: vi.fn((_r, t: () => Promise<unknown>) => t()),
  };
  const service = new GitMergeService(
    { emitBestEffort: vi.fn() } as never,
    { resolve: vi.fn().mockResolvedValue({}) } as never,
    lock as never,
    integrationWorktree as never,
  );
  vi.spyOn(service, "resolveGitRepoPath" as never).mockResolvedValue(
    "/clone/scope" as never,
  );
  const integrateSpy = vi
    .spyOn(service as never, "runIntegratePhase")
    .mockResolvedValue({ outcome: "succeeded" } as never);

  await service.integrateAndPush("scope", "feature/a", "main");

  expect(integrationWorktree.provisionIntegrationWorktree).toHaveBeenCalledWith(
    "scope",
    "main",
  );
  // The path handed to the integrate phase is the worktree, never the clone root.
  expect(integrateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ repoPath: "/wt/scope/__integration" }),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: FAIL — constructor has 3 args; integration still uses `cloneRoot`.

- [ ] **Step 3: Implement**

Add `private readonly integrationWorktree: IntegrationWorktreeService` to the constructor. Extract a small private `runIntegratePhase({ repoPath, scopeId, sourceBranch, destinationBranch })` that calls `executeMergePhase(... integrateIntoBase(this, repoPath, ...))`. In `integrateAndPush` and the integrate branch of `mergeWithConflictDetection`, after acquiring the lock and resolving `cloneRoot`, resolve the integration worktree and pass it as `repoPath`:

```typescript
return this.repositoryLock.runRepoExclusive(cloneRoot, async () => {
  const integrationPath =
    await this.integrationWorktree.provisionIntegrationWorktree(
      scopeId,
      destinationBranch,
    );
  return this.runIntegratePhase({
    repoPath: integrationPath,
    scopeId,
    sourceBranch,
    destinationBranch,
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: PASS.

- [ ] **Step 5: Full merge suite + build**

Run: `npm run test --workspace=apps/api -- git-merge && npm run build:api`
Expected: PASS. Update any existing merge spec that asserted integration ran in the clone root.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "feat(api): run integration merge in dedicated worktree, not shared clone root"
```

---

## Phase 3 — Per-subagent worktree isolation with merge-back

**Why:** `resolveWorkspaceMountPath` (subagent spawn) returns the **parent's** worktree path, so up to `max_concurrent_subagents_per_workflow` subagents mount the same `/workspace` read-write, deduped only by `role`. Concurrent writers race with no protection. This phase gives each subagent its own worktree branched off the parent's branch HEAD, and merges the child branch back into the parent branch (under the repo lock) when the subagent completes successfully. Read-only subagents produce an empty diff → merge-back is a no-op fast-forward, so the contract is uniform and safe.

**Design:** New `SubagentWorktreeService` with two operations: `provisionForSubagent(scopeId, parentWorktreePath, executionId)` (creates `worktrees/<scopeId>/<parentContextId>__sub_<executionId>` on branch `<parentBranch>__sub_<executionId>` based at the parent branch HEAD) and `mergeBack(scopeId, executionId)` (merges the child branch into the parent branch in the parent worktree, under the repo lock; on conflict, leaves the child branch and surfaces a conflict outcome). `provisionSubagentContainer` calls `provisionForSubagent` instead of sharing the parent path; the subagent terminal-success handler calls `mergeBack`.

### Task 3.1: SubagentWorktreeService — provisioning

**Files:**

- Create: `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts`
- Create: `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/workflow-subagents.module.ts` (register + export)

**Interfaces:**

- Consumes: `GitWorktreeService` (provision/remove + branch helpers), `GitCommandService`, `RepositoryLockService`.
- Produces: `provisionForSubagent(params: { scopeId: string; parentWorktreePath: string; executionId: string }): Promise<{ worktreePath: string; childBranch: string }>` and `mergeBack(params: { scopeId: string; executionId: string; parentWorktreePath: string; childBranch: string }): Promise<'merged' | 'noop' | 'conflict'>`.

- [ ] **Step 1: Write the failing test (provisioning derives child branch + path from parent)**

```typescript
// apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts
import { describe, it, expect, vi } from "vitest";
import { SubagentWorktreeService } from "./subagent-worktree.service";

describe("SubagentWorktreeService.provisionForSubagent", () => {
  it("branches a child worktree off the parent branch HEAD", async () => {
    const git = {
      exec: vi
        .fn()
        .mockImplementation(async (_repo: string, args: string[]) => {
          if (args[0] === "rev-parse" && args.includes("--abbrev-ref"))
            return "feature/wi-1\n";
          return "";
        }),
    };
    const lock = {
      runRepoExclusive: vi.fn((_r, t: () => Promise<unknown>) => t()),
    };
    const worktree = {
      getWorktreePath: vi.fn().mockReturnValue("/wt/scope/wi-1__sub_exec-9"),
      provisionWorktree: vi
        .fn()
        .mockResolvedValue("/wt/scope/wi-1__sub_exec-9"),
    };
    const service = new SubagentWorktreeService(
      worktree as never,
      git as never,
      lock as never,
    );
    vi.spyOn(service, "resolveScopeRepoPath" as never).mockResolvedValue(
      "/clone/scope" as never,
    );

    const result = await service.provisionForSubagent({
      scopeId: "scope",
      parentWorktreePath: "/wt/scope/wi-1",
      executionId: "exec-9",
    });

    expect(result.childBranch).toBe("feature/wi-1__sub_exec-9");
    expect(result.worktreePath).toBe("/wt/scope/wi-1__sub_exec-9");
    expect(worktree.provisionWorktree).toHaveBeenCalledWith(
      "scope",
      "wi-1__sub_exec-9",
      "feature/wi-1",
      "feature/wi-1__sub_exec-9",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-worktree.service.spec`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement provisioning (derive parent branch via `git rev-parse --abbrev-ref HEAD` in the parent worktree, derive child context id from the parent worktree dir name)**

```typescript
// apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts
import { Injectable, Logger } from "@nestjs/common";
import * as path from "node:path";
import { GitWorktreeService } from "../../common/git/git-worktree.service";
import { GitCommandService } from "../../common/git/git-command/git-command.service";
import { RepositoryLockService } from "../../common/git/locking/repository-lock.service";

@Injectable()
export class SubagentWorktreeService {
  private readonly logger = new Logger(SubagentWorktreeService.name);

  constructor(
    private readonly gitWorktree: GitWorktreeService,
    private readonly gitCommand: GitCommandService,
    private readonly repositoryLock: RepositoryLockService,
  ) {}

  async provisionForSubagent(params: {
    scopeId: string;
    parentWorktreePath: string;
    executionId: string;
  }): Promise<{ worktreePath: string; childBranch: string }> {
    const parentBranch = await this.currentBranch(params.parentWorktreePath);
    const parentContextId = path.basename(params.parentWorktreePath);
    const childContextId = `${parentContextId}__sub_${params.executionId}`;
    const childBranch = `${parentBranch}__sub_${params.executionId}`;
    const worktreePath = await this.gitWorktree.provisionWorktree(
      params.scopeId,
      childContextId,
      parentBranch,
      childBranch,
    );
    return { worktreePath, childBranch };
  }

  private async currentBranch(worktreePath: string): Promise<string> {
    const out = await this.gitCommand.exec(worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    return out.trim();
  }
}
```

> `provisionWorktree(scopeId, contextId, baseBranch, targetBranch)` already exists (`git-worktree.service.ts:54`). Passing `parentBranch` as both the base and the basis means the child starts at the parent branch HEAD.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- subagent-worktree.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts
git commit -m "feat(api): per-subagent worktree provisioning off parent branch"
```

### Task 3.2: SubagentWorktreeService — merge-back

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts`

**Interfaces:**

- Produces: `mergeBack(...)` returning `'merged' | 'noop' | 'conflict'`.

- [ ] **Step 1: Write the failing test**

```typescript
// add to subagent-worktree.service.spec.ts
describe("SubagentWorktreeService.mergeBack", () => {
  it("returns noop when the child branch has no commits beyond the parent", async () => {
    const git = {
      exec: vi
        .fn()
        .mockImplementation(async (_repo: string, args: string[]) => {
          if (args[0] === "rev-list" && args.includes("--count")) return "0\n";
          return "";
        }),
    };
    const lock = {
      runRepoExclusive: vi.fn((_r, t: () => Promise<unknown>) => t()),
    };
    const worktree = { removeWorktree: vi.fn().mockResolvedValue(undefined) };
    const service = new SubagentWorktreeService(
      worktree as never,
      git as never,
      lock as never,
    );
    vi.spyOn(service, "resolveScopeRepoPath" as never).mockResolvedValue(
      "/clone/scope" as never,
    );

    const result = await service.mergeBack({
      scopeId: "scope",
      executionId: "exec-9",
      parentWorktreePath: "/wt/scope/wi-1",
      childBranch: "feature/wi-1__sub_exec-9",
    });

    expect(result).toBe("noop");
  });

  it("returns conflict and leaves the child branch when merge fails", async () => {
    const git = {
      exec: vi
        .fn()
        .mockImplementation(async (_repo: string, args: string[]) => {
          if (args[0] === "rev-list" && args.includes("--count")) return "2\n";
          if (args[0] === "merge")
            throw new Error("CONFLICT (content): Merge conflict in a.ts");
          return "";
        }),
    };
    const lock = {
      runRepoExclusive: vi.fn((_r, t: () => Promise<unknown>) => t()),
    };
    const worktree = { removeWorktree: vi.fn() };
    const service = new SubagentWorktreeService(
      worktree as never,
      git as never,
      lock as never,
    );
    vi.spyOn(service, "resolveScopeRepoPath" as never).mockResolvedValue(
      "/clone/scope" as never,
    );

    const result = await service.mergeBack({
      scopeId: "scope",
      executionId: "exec-9",
      parentWorktreePath: "/wt/scope/wi-1",
      childBranch: "feature/wi-1__sub_exec-9",
    });

    expect(result).toBe("conflict");
    expect(worktree.removeWorktree).not.toHaveBeenCalled(); // child preserved for inspection
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-worktree.service.spec`
Expected: FAIL — `mergeBack` not implemented.

- [ ] **Step 3: Implement merge-back (in the parent worktree, under the repo lock)**

```typescript
async mergeBack(params: {
  scopeId: string;
  executionId: string;
  parentWorktreePath: string;
  childBranch: string;
}): Promise<'merged' | 'noop' | 'conflict'> {
  const repoPath = await this.resolveScopeRepoPath(params.scopeId);
  return this.repositoryLock.runRepoExclusive(repoPath, async () => {
    const parentBranch = await this.currentBranch(params.parentWorktreePath);
    const ahead = (
      await this.gitCommand.exec(params.parentWorktreePath, [
        'rev-list',
        '--count',
        `${parentBranch}..${params.childBranch}`,
      ])
    ).trim();
    if (ahead === '0') {
      await this.cleanupChild(params);
      return 'noop';
    }
    try {
      await this.gitCommand.exec(params.parentWorktreePath, [
        'merge',
        '--no-ff',
        '--no-edit',
        params.childBranch,
      ]);
    } catch (error) {
      this.logger.warn(
        `Subagent merge-back conflict for ${params.childBranch}: ${(error as Error).message}`,
      );
      await this.gitCommand
        .exec(params.parentWorktreePath, ['merge', '--abort'])
        .catch(() => undefined);
      return 'conflict'; // leave child branch + worktree for inspection
    }
    await this.cleanupChild(params);
    return 'merged';
  });
}

private async cleanupChild(params: {
  scopeId: string;
  executionId: string;
  parentWorktreePath: string;
  childBranch: string;
}): Promise<void> {
  const parentContextId = path.basename(params.parentWorktreePath);
  const childContextId = `${parentContextId}__sub_${params.executionId}`;
  await this.gitWorktree
    .removeWorktree(params.scopeId, childContextId, params.childBranch)
    .catch((error) =>
      this.logger.warn(
        `Failed to remove subagent worktree ${childContextId}: ${(error as Error).message}`,
      ),
    );
}

// add resolveScopeRepoPath using resolveGitRepositoryPath, mirroring IntegrationWorktreeService
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- subagent-worktree.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-worktree.service.ts apps/api/src/workflow/workflow-subagents/subagent-worktree.service.spec.ts
git commit -m "feat(api): merge subagent child branch back into parent under repo lock"
```

### Task 3.3: Use per-subagent worktrees in spawn + merge-back on completion

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts`
- Modify: the subagent terminal-completion handler (find via `git grep -n "completeExecutionAndEmitEvent\|execution.*succeeded\|terminal" apps/api/src/workflow/workflow-subagents`)
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.types.ts` (add `SubagentWorktreeService` to `SubagentSpawnOperationsContext`)

**Interfaces:**

- Consumes: `SubagentWorktreeService` (Tasks 3.1–3.2).

- [ ] **Step 1: Write the failing test**

```typescript
// in the spawn operations spec (find existing spec alongside the operations file)
it("provisions a per-subagent worktree instead of sharing the parent worktree", async () => {
  // Arrange a run whose state has a parent worktree path and a fake SubagentWorktreeService.
  // Assert provisionSubagentContainer calls context.subagentWorktree.provisionForSubagent(...)
  // and passes the returned child worktreePath to containerOrchestrator.provisionContainer.
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.spawn`
Expected: FAIL — spawn still calls `resolveWorkspaceMountPath` (parent share).

- [ ] **Step 3: Replace the shared-mount resolution in `provisionSubagentContainer`**

In `provisionSubagentContainer` (line ~323), replace `const worktreePath = await resolveWorkspaceMountPath(context, run);` with provisioning a child worktree when a parent worktree exists:

```typescript
const parentWorktreePath = resolveWorktreePathFromRun(run);
let worktreePath: string | undefined;
if (parentWorktreePath && scopeId) {
  const provisioned = await context.subagentWorktree.provisionForSubagent({
    scopeId,
    parentWorktreePath,
    executionId: params.execution.id,
  });
  worktreePath = provisioned.worktreePath;
} else {
  worktreePath = await resolveWorkspaceMountPath(context, run); // fallback: scope clone base
}
```

Add `subagentWorktree: SubagentWorktreeService` to `SubagentSpawnOperationsContext` and wire it through the orchestrator that builds the context.

- [ ] **Step 4: Add merge-back on terminal success**

In the terminal-success path of the subagent lifecycle handler, after the execution is marked succeeded, call `subagentWorktree.mergeBack({ scopeId, executionId, parentWorktreePath, childBranch })`. Persist `childBranch` + `parentWorktreePath` on the execution record (or recompute deterministically from `parentWorktreePath` + `executionId`) so the handler can reconstruct them. On `'conflict'`, emit a `subagent.merge_back.conflict` event so it is visible (do **not** silently drop).

- [ ] **Step 5: Run the tests + build**

Run: `npm run test --workspace=apps/api -- subagent && npm run build:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/
git commit -m "feat(api): isolate each subagent in its own worktree with merge-back"
```

---

## Phase 4 — Proactive orphaned-worktree reaper

**Why:** Worktree cleanup is reactive (the `remove_worktree` step or the doctor check, which only watches `git.worktree.remove.failed`). A crashed run leaves an orphaned worktree that nothing reaps; disk grows and stale registrations accumulate. This phase adds a scheduled sweep that removes managed worktrees not referenced by any active run and older than a TTL, and surfaces the count in the doctor check.

**Design:** `WorktreeReaperService` runs on an interval (mirroring `DefaultBranchSyncService`). Each pass: (1) build the set of in-use worktree paths from all non-terminal workflow runs' `_internal.workspace_worktree_path`; (2) enumerate managed worktrees per scope (scopes = clone dirs under the clones base); (3) remove any managed worktree whose path is not in-use, is older than `NEXUS_WORKTREE_REAP_TTL_MS`, and is **not** a reserved worktree (`__integration`); (4) emit `git.worktree.reaped`. Reserved subagent worktrees of active parents are protected because the parent run is non-terminal and its child paths share the `__sub_` prefix under an in-use parent — extend the in-use set to include any path whose parent context is in use.

### Task 4.1: Reap predicate (pure function)

**Files:**

- Create: `apps/api/src/common/git/reaper/worktree-reaper.service.ts` (predicate first; service skeleton)
- Create: `apps/api/src/common/git/reaper/worktree-reaper.service.spec.ts`

**Interfaces:**

- Produces: exported pure `isReapable(params: { worktreePath: string; lastModifiedMs: number; nowMs: number; ttlMs: number; inUsePaths: Set<string>; reservedContextIds: ReadonlySet<string> }): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/common/git/reaper/worktree-reaper.service.spec.ts
import { describe, it, expect } from "vitest";
import { isReapable } from "./worktree-reaper.service";

const base = {
  nowMs: 1_000_000,
  ttlMs: 86_400_000, // 24h
  inUsePaths: new Set<string>(),
  reservedContextIds: new Set<string>(["__integration"]),
};

describe("isReapable", () => {
  it("reaps an old, unreferenced worktree", () => {
    expect(
      isReapable({ ...base, worktreePath: "/wt/s/wi-1", lastModifiedMs: 0 }),
    ).toBe(true);
  });
  it("keeps a worktree still referenced by an active run", () => {
    expect(
      isReapable({
        ...base,
        worktreePath: "/wt/s/wi-1",
        lastModifiedMs: 0,
        inUsePaths: new Set(["/wt/s/wi-1"]),
      }),
    ).toBe(false);
  });
  it("keeps a worktree younger than the TTL", () => {
    expect(
      isReapable({
        ...base,
        worktreePath: "/wt/s/wi-1",
        lastModifiedMs: 999_000,
      }),
    ).toBe(false);
  });
  it("never reaps the reserved integration worktree", () => {
    expect(
      isReapable({
        ...base,
        worktreePath: "/wt/s/__integration",
        lastModifiedMs: 0,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- worktree-reaper.service.spec`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the predicate (and a service skeleton)**

```typescript
// apps/api/src/common/git/reaper/worktree-reaper.service.ts
import * as path from "node:path";

export function isReapable(params: {
  worktreePath: string;
  lastModifiedMs: number;
  nowMs: number;
  ttlMs: number;
  inUsePaths: Set<string>;
  reservedContextIds: ReadonlySet<string>;
}): boolean {
  const contextId = path.basename(params.worktreePath);
  if (params.reservedContextIds.has(contextId)) return false;
  if (params.inUsePaths.has(params.worktreePath)) return false;
  return params.nowMs - params.lastModifiedMs >= params.ttlMs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- worktree-reaper.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/git/reaper/worktree-reaper.service.ts apps/api/src/common/git/reaper/worktree-reaper.service.spec.ts
git commit -m "feat(api): add orphaned-worktree reap predicate"
```

### Task 4.2: Reaper service sweep + scheduling

**Files:**

- Modify: `apps/api/src/common/git/reaper/worktree-reaper.service.ts`
- Modify: `apps/api/src/common/git/reaper/worktree-reaper.service.spec.ts`
- Modify: the git module (register the service; `onModuleInit` interval like `DefaultBranchSyncService`)

**Interfaces:**

- Consumes: `GitWorktreeService.listManagedWorktrees`/`removeWorktree`, `GitPathService.getClonesBasePath`, the workflow run repository (active runs + `_internal.workspace_worktree_path`), `EventLedgerService`, `RepositoryLockService`.
- Produces: `reapAll(reason: 'startup' | 'interval'): Promise<{ reaped: number }>`.

- [ ] **Step 1: Write the failing test (sweep removes only reapable worktrees)**

```typescript
// add to worktree-reaper.service.spec.ts
it("removes only worktrees that pass isReapable", async () => {
  const now = 10_000_000;
  const worktrees = [
    { path: "/wt/s/wi-old", branch: "feature/wi-old" }, // old, unreferenced -> reap
    { path: "/wt/s/wi-active", branch: "feature/wi-active" }, // referenced -> keep
    { path: "/wt/s/__integration", branch: "main" }, // reserved -> keep
  ];
  const gitWorktree = {
    listManagedWorktrees: vi.fn().mockResolvedValue(worktrees),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  };
  // stub: scopes=['s']; active in-use paths=['/wt/s/wi-active']; mtimes old except wi-active
  const service = makeReaper({ gitWorktree, now, inUse: ["/wt/s/wi-active"] });

  const result = await service.reapAll("interval");

  expect(result.reaped).toBe(1);
  expect(gitWorktree.removeWorktree).toHaveBeenCalledTimes(1);
  expect(gitWorktree.removeWorktree).toHaveBeenCalledWith(
    "s",
    "wi-old",
    "feature/wi-old",
  );
});
```

> `makeReaper` is a small test helper that constructs the service with mocked scope enumeration, mocked `stat` mtimes (old for everything except `wi-active`), and the in-use set. Build it inline in the spec.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- worktree-reaper.service.spec`
Expected: FAIL — `reapAll` not implemented.

- [ ] **Step 3: Implement `reapAll` + interval scheduling**

Implement: enumerate scope dirs under `getClonesBasePath()`; build the in-use set by querying non-terminal runs and reading `_internal.workspace_worktree_path` (include the parent path so `__sub_` children of active parents are protected — add their derived child paths or protect by parent-prefix); for each managed worktree, `stat` its mtime and apply `isReapable`; call `removeWorktree(scopeId, basename(path), branch)` for reapable ones; emit `git.worktree.reaped` with the count. Add `onModuleInit` that runs `reapAll('startup')` then `setInterval(() => reapAll('interval'), NEXUS_WORKTREE_REAP_INTERVAL_MS ?? 3_600_000)` with `.unref()`, mirroring `default-branch-sync.service.ts:15-129`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- worktree-reaper.service.spec`
Expected: PASS.

- [ ] **Step 5: Register in the git module + build**

Run: `npm run build:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/git/reaper/ apps/api/src/common/git/git-worktree.module.ts
git commit -m "feat(api): scheduled orphaned-worktree reaper"
```

### Task 4.3: Surface reaped orphans in the doctor check

**Files:**

- Modify: `apps/api/src/operations/checks/git-worktree-integrity.check.ts`
- Modify: its spec (find via `git grep -l git-worktree-integrity apps/api/src`)

**Interfaces:**

- Consumes: `git.worktree.reaped` events (Task 4.2).

- [ ] **Step 1: Write the failing test**

```typescript
it("reports reaped orphan count in evidence details", async () => {
  // eventLedger.query stubbed: remove.failed -> [], git.worktree.reaped -> [{...},{...}]
  // expect result.evidence.details.reaped_orphans_7d === 2
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- git-worktree-integrity`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a second `eventLedger.query({ domain: 'git', event_name: 'git.worktree.reaped', occurred_after: sevenDaysAgo, limit: 1000 })`, add `reaped_orphans_7d` to `evidence.details`, and extend `buildSummary` to mention reaped orphans. Keep `status`/`repair_action_id` driven by removal failures as today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- git-worktree-integrity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/operations/checks/git-worktree-integrity.check.ts
git commit -m "feat(api): surface reaped orphan worktrees in doctor check"
```

---

## Phase 5: Documentation + full verification (every phase contributes)

- [ ] **Step 1: Update architecture docs**

Document the Redis-backed repo lock, the dedicated integration worktree, per-subagent worktree isolation + merge-back, and the reaper in `docs/guide/README.md` (git/worktree section) and the relevant `docs/architecture/*.md`. Add the new env vars (`NEXUS_GIT_LOCK_TTL_MS`, `NEXUS_GIT_LOCK_ACQUIRE_TIMEOUT_MS`, `NEXUS_GIT_LOCK_POLL_INTERVAL_MS`, `NEXUS_GIT_LOCK_DISABLED`, `NEXUS_WORKTREE_REAP_TTL_MS`, `NEXUS_WORKTREE_REAP_INTERVAL_MS`) to the operations runbook and `README.md`.

- [ ] **Step 2: Full API test suite + lint + build**

Run: `npm run test:api && npm run lint:api && npm run build:api`
Expected: PASS. Fix any fallout (especially merge specs that assumed clone-root integration or 2-arg `GitMergeService`).

- [ ] **Step 3: Commit docs**

```bash
git add docs/ README.md
git commit -m "docs: git concurrency, integration worktree, subagent isolation, reaper"
```

---

## Self-Review Checklist (run before handing off)

1. **Spec coverage:** Recommendation 1 → Phase 1 (Redis lock) + Task 1.4 (merges under lock). Recommendation 2 → Phase 2 (integration worktree; bare-clone conversion explicitly deferred — see note). Recommendation 3 → Phase 3 (per-subagent worktree + merge-back). Recommendation 4 → Phase 4 (reaper + doctor surfacing).
2. **Deferred-by-design:** Full **bare-clone conversion** is intentionally out of scope — it requires migrating already-deployed non-bare clones and reworking `buildGitRepositoryPathCandidates` (which keys on a `.git` subdir). Phase 2 achieves the same safety goal (no operation depends on the clone's primary checkout) without that migration. Capture bare conversion as a follow-up if multi-writer pressure on the clone's own checkout reappears.
3. **Type consistency:** `runRepoExclusive`, `provisionIntegrationWorktree`, `provisionForSubagent`/`mergeBack`, `isReapable`/`reapAll` names are used identically across tasks.
4. **Discovery steps are real, not placeholders:** Task 1.3 (Redis env vars), Task 3.3 (terminal-completion handler location), Task 4.3 (doctor spec location) require a `git grep` to confirm exact symbols before editing — each names the search and the expected target.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-git-concurrency-and-worktree-hardening.md`. Phases are independently shippable; land them in order (1 → 2 → 3 → 4) because 2–4 rely on the Phase 1 lock. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.
