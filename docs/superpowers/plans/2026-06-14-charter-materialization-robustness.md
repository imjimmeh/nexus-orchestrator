# Charter Materialization Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee an agent can always obtain current project-charter content, and make the committed `docs/project-context/CHARTER.md` artifact self-heal after transient failures.

**Architecture:** Three cooperating projections over the single deterministic renderer `CharterDocRenderService.render(projectId)` (renders from kanban goals + charter memories): (A) a race-free `kanban.get_charter` MCP tool, (B) run-start materialization driven by the existing kanban lifecycle-event consumer, (C) a hardened `charter-regen` queue plus a startup/periodic reconciliation sweep. All logic stays in `apps/kanban` to respect the core/kanban boundary.

**Tech Stack:** NestJS, BullMQ, TypeORM, Zod, Vitest (kanban app uses SWC decorator metadata).

**Spec:** `docs/superpowers/specs/2026-06-14-charter-materialization-robustness-design.md`
**Issues:** kanban-pcld (primary), kanban-bf21 (charter tool denials, separate).

---

## File Structure

| File                                                                   | Responsibility                                    | Action |
| ---------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`                   | Mechanism A — render charter on demand            | Create |
| `apps/kanban/src/mcp/tools/read/get-charter.tool.spec.ts`              | Unit test for the tool                            | Create |
| `apps/kanban/src/mcp/tools/read/index.ts`                              | Read-tool barrel (auto-discovery)                 | Modify |
| `apps/kanban/src/project/charter-regen.enqueuer.ts`                    | Mechanism C1 — durable enqueue (attempts+backoff) | Modify |
| `apps/kanban/src/project/charter-regen.enqueuer.spec.ts`               | Enqueue options test                              | Modify |
| `apps/kanban/src/project/charter-regen.processor.ts`                   | Mechanism C2 — non-silent failure logging         | Modify |
| `apps/kanban/src/project/charter-regen.processor.spec.ts`              | Processor logging/skip test                       | Create |
| `apps/kanban/src/project/charter-regen-reconciliation.service.ts`      | Mechanism C3 — startup + periodic sweep           | Create |
| `apps/kanban/src/project/charter-regen-reconciliation.service.spec.ts` | Reconciliation test                               | Create |
| `apps/kanban/src/project/project.module.ts`                            | Register reconciliation service                   | Modify |
| `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`               | Mechanism B — enqueue regen on run start          | Modify |
| `apps/kanban/src/core/core-integration.module.ts`                      | Import ProjectModule for the enqueuer             | Modify |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` | Prefer `get_charter`                              | Modify |
| (other charter-consuming prompts)                                      | Prefer `get_charter`                              | Modify |
| kanban tool manifest + charter-consuming agent profiles                | Allow `kanban.get_charter`                        | Modify |

> **Note on the trigger set (spec C.4):** the charter renders purely from goals + charter memories, and both `ProjectGoalsService` and `ProjectMemorySummaryService` already call `charterRegen.enqueue(projectId)` on every write. The real charter inputs are therefore already wired. `update_charter` would be a redundant extra trigger and is blocked by kanban-bf21; it is intentionally **not** a task here.

---

## Task 1: `kanban.get_charter` MCP tool (Mechanism A)

**Files:**

- Create: `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`
- Test: `apps/kanban/src/mcp/tools/read/get-charter.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/read/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/read/get-charter.tool.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { GetCharterTool } from "./get-charter.tool";
import type { CharterDocRenderService } from "../../../project/charter-doc-render.service";

function makeContext(scopeId?: string): InternalToolExecutionContext {
  return { scopeId } as unknown as InternalToolExecutionContext;
}

describe("GetCharterTool", () => {
  it("exposes the kanban.get_charter definition", () => {
    const render = { render: vi.fn() } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    expect(tool.getName()).toBe("kanban.get_charter");
    const definition = tool.getDefinition();
    expect(definition.name).toBe("kanban.get_charter");
    expect(definition.transport).toBe("runner_local");
    expect(definition.runtimeOwner).toBe("runner");
  });

  it("renders the charter for the project resolved from params", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    const result = await tool.execute(makeContext(), {
      project_id: "project-1",
    });

    expect(render.render).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({ charter: "# Project Charter\n" });
  });

  it("falls back to the context scopeId when project_id is omitted", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    await tool.execute(makeContext("scope-9"), {});

    expect(render.render).toHaveBeenCalledWith("scope-9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- get-charter.tool`
Expected: FAIL — `Cannot find module './get-charter.tool'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { CharterDocRenderService } from "../../../project/charter-doc-render.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type GetCharterParams = z.infer<typeof ContextualProjectIdSchema>;

interface GetCharterResult {
  charter: string;
}

const GET_CHARTER_TOOL_NAME = "kanban.get_charter";

@Injectable()
export class GetCharterTool implements IInternalToolHandler<
  GetCharterParams,
  GetCharterResult
> {
  constructor(private readonly charter: CharterDocRenderService) {}

  getName(): string {
    return GET_CHARTER_TOOL_NAME;
  }

  getDefinition() {
    return {
      name: GET_CHARTER_TOOL_NAME,
      description:
        "Render the current project charter (vision, goals, and charter memories) as markdown, sourced live from the kanban database. Use this as the authoritative charter source.",
      inputSchema: ContextualProjectIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: GetCharterParams,
  ): Promise<GetCharterResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const charter = await this.charter.render(projectId);
    return { charter };
  }
}
```

- [ ] **Step 4: Register the tool in the read-tool barrel**

In `apps/kanban/src/mcp/tools/read/index.ts`, add as the final export line:

```typescript
export * from "./get-charter.tool";
```

(The `kanban-mcp.module.ts` discovers all read tools via `Object.values(ReadTools)`, so no further registration is needed.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- get-charter.tool`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/read/get-charter.tool.ts \
  apps/kanban/src/mcp/tools/read/get-charter.tool.spec.ts \
  apps/kanban/src/mcp/tools/read/index.ts
git commit -m "feat(kanban): add kanban.get_charter MCP tool (kanban-pcld)"
```

---

## Task 2: Durable `charter-regen` enqueue (Mechanism C1)

**Files:**

- Modify: `apps/kanban/src/project/charter-regen.enqueuer.ts`
- Modify: `apps/kanban/src/project/charter-regen.enqueuer.spec.ts`

- [ ] **Step 1: Write the failing test**

Replace the body of `apps/kanban/src/project/charter-regen.enqueuer.spec.ts` with:

```typescript
import { describe, expect, it, vi } from "vitest";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

describe("CharterRegenEnqueuer", () => {
  it("enqueues a debounced, retrying regen job per project", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const enqueuer = new CharterRegenEnqueuer({ add } as never);

    await enqueuer.enqueue("proj-1");

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0];
    expect(name).toBe("regen");
    expect(data).toEqual({ projectId: "proj-1" });
    expect(opts).toMatchObject({
      jobId: "charter-regen:proj-1",
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  });

  it("swallows queue errors so the caller is never broken", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));
    const enqueuer = new CharterRegenEnqueuer({ add } as never);

    await expect(enqueuer.enqueue("proj-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- charter-regen.enqueuer`
Expected: FAIL — the `attempts`/`backoff` assertion fails (current opts lack them).

- [ ] **Step 3: Write minimal implementation**

In `apps/kanban/src/project/charter-regen.enqueuer.ts`, replace the `queue.add(...)` call inside `enqueue` with:

```typescript
await this.queue.add(
  "regen",
  { projectId },
  {
    jobId: `charter-regen:${projectId}`,
    delay: DEBOUNCE_MS,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- charter-regen.enqueuer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/project/charter-regen.enqueuer.ts \
  apps/kanban/src/project/charter-regen.enqueuer.spec.ts
git commit -m "feat(kanban): retry charter-regen jobs with exponential backoff (kanban-pcld)"
```

---

## Task 3: Non-silent regen failures (Mechanism C2)

**Files:**

- Modify: `apps/kanban/src/project/charter-regen.processor.ts`
- Create: `apps/kanban/src/project/charter-regen.processor.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/project/charter-regen.processor.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { CharterRegenProcessor } from "./charter-regen.processor";
import type { CharterDocRenderService } from "./charter-doc-render.service";
import type { ProjectService } from "./project.service";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";

function makeJob(projectId: string): Job {
  return { data: { projectId } } as unknown as Job;
}

describe("CharterRegenProcessor", () => {
  it("renders and writes the charter to the project base path", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: "/clone/p1" }),
    } as unknown as ProjectService;
    const writeRepoFile = vi.fn().mockResolvedValue({ committed: true });
    const core = { writeRepoFile } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);
    await processor.process(makeJob("p1"));

    expect(writeRepoFile).toHaveBeenCalledWith({
      repoPath: "/clone/p1",
      filePath: "docs/project-context/CHARTER.md",
      content: "# Project Charter\n",
      message: "docs(charter): regenerate from project intent",
      push: true,
    });
  });

  it("re-throws so BullMQ retries when the git write fails", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: "/clone/p1" }),
    } as unknown as ProjectService;
    const core = {
      writeRepoFile: vi.fn().mockRejectedValue(new Error("push rejected")),
    } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);

    await expect(processor.process(makeJob("p1"))).rejects.toThrow(
      "push rejected",
    );
  });

  it("skips (no throw) when the project has no base path", async () => {
    const render = { render: vi.fn() } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: null }),
    } as unknown as ProjectService;
    const core = {
      writeRepoFile: vi.fn(),
    } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);
    await expect(processor.process(makeJob("p1"))).resolves.toBeUndefined();
    expect(core.writeRepoFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- charter-regen.processor`
Expected: FAIL — current `process` swallows the `writeRepoFile` rejection only if wrapped; the "re-throws" test confirms the desired contract. (If it already throws, the failing test is the logging assertion added in Step 3; run after Step 3 to confirm.)

- [ ] **Step 3: Write minimal implementation**

Replace `apps/kanban/src/project/charter-regen.processor.ts` with:

```typescript
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectService } from "./project.service";
import { CharterDocRenderService } from "./charter-doc-render.service";
import {
  CHARTER_REGEN_QUEUE,
  type CharterRegenJob,
} from "./charter-regen.queue";

const CHARTER_PATH = "docs/project-context/CHARTER.md";
const CHARTER_COMMIT_MESSAGE = "docs(charter): regenerate from project intent";

@Processor(CHARTER_REGEN_QUEUE)
export class CharterRegenProcessor extends WorkerHost {
  private readonly logger = new Logger(CharterRegenProcessor.name);
  constructor(
    private readonly render: CharterDocRenderService,
    private readonly projects: ProjectService,
    private readonly core: CoreWorkflowClientService,
  ) {
    super();
  }

  async process(job: Job<CharterRegenJob>): Promise<void> {
    const { projectId } = job.data;
    const project = await this.projects.get(projectId).catch(() => null);
    if (!project?.basePath) {
      this.logger.warn(`charter-regen skipped: no basePath for ${projectId}`);
      return;
    }

    try {
      const content = await this.render.render(projectId);
      await this.core.writeRepoFile({
        repoPath: project.basePath,
        filePath: CHARTER_PATH,
        content,
        message: CHARTER_COMMIT_MESSAGE,
        push: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`charter-regen failed for ${projectId}: ${reason}`);
      throw error instanceof Error ? error : new Error(reason);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- charter-regen.processor`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/project/charter-regen.processor.ts \
  apps/kanban/src/project/charter-regen.processor.spec.ts
git commit -m "feat(kanban): surface charter-regen failures and let BullMQ retry (kanban-pcld)"
```

---

## Task 4: Reconciliation sweep (Mechanism C3)

**Files:**

- Create: `apps/kanban/src/project/charter-regen-reconciliation.service.ts`
- Create: `apps/kanban/src/project/charter-regen-reconciliation.service.spec.ts`
- Modify: `apps/kanban/src/project/project.module.ts`

The sweep relies on git idempotency: the regen processor writes identical bytes when nothing changed, so `commitPaths` produces no commit (status `clean`). Reconciliation therefore just enqueues regen for every project that has a `basePath`; missing files get created and committed, unchanged files are no-ops.

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/project/charter-regen-reconciliation.service.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { CharterRegenReconciliationService } from "./charter-regen-reconciliation.service";
import type { ProjectService } from "./project.service";
import type { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

describe("CharterRegenReconciliationService", () => {
  it("enqueues regen for every project that has a base path", async () => {
    const projects = {
      list: vi.fn().mockResolvedValue([
        { id: "p1", basePath: "/clone/p1" },
        { id: "p2", basePath: null },
        { id: "p3", basePath: "/clone/p3" },
      ]),
    } as unknown as ProjectService;
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const enqueuer = { enqueue } as unknown as CharterRegenEnqueuer;

    const service = new CharterRegenReconciliationService(projects, enqueuer);
    const count = await service.reconcileAll();

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledWith("p1");
    expect(enqueue).toHaveBeenCalledWith("p3");
    expect(enqueue).not.toHaveBeenCalledWith("p2");
  });

  it("continues past a project that fails to enqueue", async () => {
    const projects = {
      list: vi.fn().mockResolvedValue([
        { id: "p1", basePath: "/clone/p1" },
        { id: "p2", basePath: "/clone/p2" },
      ]),
    } as unknown as ProjectService;
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const enqueuer = { enqueue } as unknown as CharterRegenEnqueuer;

    const service = new CharterRegenReconciliationService(projects, enqueuer);
    const count = await service.reconcileAll();

    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- charter-regen-reconciliation`
Expected: FAIL — `Cannot find module './charter-regen-reconciliation.service'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/kanban/src/project/charter-regen-reconciliation.service.ts`:

```typescript
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ProjectService } from "./project.service";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

const DEFAULT_SWEEP_INTERVAL_MS = 900_000; // 15 minutes

function readSweepIntervalMs(): number {
  const value = Number(process.env.KANBAN_CHARTER_RECONCILE_INTERVAL_MS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_SWEEP_INTERVAL_MS;
}

@Injectable()
export class CharterRegenReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CharterRegenReconciliationService.name);
  private readonly intervalMs = readSweepIntervalMs();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly projects: ProjectService,
    private readonly enqueuer: CharterRegenEnqueuer,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sweepOnce();
    this.timer = setInterval(() => void this.sweepOnce(), this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sweepOnce(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const enqueued = await this.reconcileAll();
      this.logger.log(`charter reconciliation enqueued ${enqueued} project(s)`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`charter reconciliation sweep failed: ${reason}`);
    } finally {
      this.inFlight = false;
    }
  }

  async reconcileAll(): Promise<number> {
    const projects = await this.projects.list();
    let enqueued = 0;
    for (const project of projects) {
      if (!project.basePath) {
        continue;
      }
      try {
        await this.enqueuer.enqueue(project.id);
        enqueued += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `charter reconciliation failed for ${project.id}: ${reason}`,
        );
      }
    }
    return enqueued;
  }
}
```

- [ ] **Step 4: Register the service in `ProjectModule`**

In `apps/kanban/src/project/project.module.ts`:

- Add the import after the other charter imports:
  ```typescript
  import { CharterRegenReconciliationService } from "./charter-regen-reconciliation.service";
  ```
- Add `CharterRegenReconciliationService,` to the `providers` array (after `CharterRegenEnqueuer,`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- charter-regen-reconciliation`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/project/charter-regen-reconciliation.service.ts \
  apps/kanban/src/project/charter-regen-reconciliation.service.spec.ts \
  apps/kanban/src/project/project.module.ts
git commit -m "feat(kanban): self-healing charter reconciliation sweep on startup + interval (kanban-pcld)"
```

---

## Task 5: Run-start materialization (Mechanism B)

Enqueue a charter regen when a workflow run starts (RUNNING) for a project scope, so the committed file is refreshed in the managed clone before the agent reads it. Hooked into the existing lifecycle consumer's non-terminal RUNNING path.

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`
- Modify: `apps/kanban/src/core/core-integration.module.ts`

- [ ] **Step 1: Wire the enqueuer dependency into the module**

In `apps/kanban/src/core/core-integration.module.ts`:

- Import at top:
  ```typescript
  import { ProjectModule } from "../project/project.module";
  import { forwardRef } from "@nestjs/common";
  ```
  (If `forwardRef` is already imported, do not duplicate it.)
- Add `forwardRef(() => ProjectModule)` to the module `imports` array.

In `apps/kanban/src/project/project.module.ts`, confirm `CharterRegenEnqueuer` is already in `exports` (it is). No change needed.

- [ ] **Step 2: Write the failing test**

Add to `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts` (create the file if it does not exist; if it exists, add this `describe` block and reuse its construction helper). Use a minimal direct-construction test of the new private behavior via a small public seam:

```typescript
import { describe, expect, it, vi } from "vitest";
import { CoreLifecycleStreamConsumerService } from "./core-lifecycle-stream.consumer";
import type { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";

describe("CoreLifecycleStreamConsumerService — charter materialization", () => {
  it("enqueues charter regen when a run goes RUNNING for a project scope", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const charterRegen = { enqueue } as unknown as CharterRegenEnqueuer;

    // Construct with only the collaborators this behavior needs; others unused.
    const service = new CoreLifecycleStreamConsumerService(
      {} as never, // redis
      {} as never, // projectionService
      {} as never, // cursors
      {} as never, // deadLetters
      {} as never, // orchestrationService
      {} as never, // workItems
      {} as never, // repairLane
      {} as never, // wakeupService
      {} as never, // leaseService
      charterRegen,
    );

    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.updated",
      payload: {
        run_id: "run-1",
        status: "RUNNING",
        context: { scopeId: "project-1" },
      },
    } as never);

    expect(enqueue).toHaveBeenCalledWith("project-1");
  });

  it("does not enqueue for terminal runs or missing scope", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const charterRegen = { enqueue } as unknown as CharterRegenEnqueuer;
    const service = new CoreLifecycleStreamConsumerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      charterRegen,
    );

    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.updated",
      payload: { run_id: "r", status: "COMPLETED", context: { scopeId: "p" } },
    } as never);
    await service.maybeMaterializeCharterOnRunStart({
      event_type: "core.workflow.run.updated",
      payload: { run_id: "r", status: "RUNNING", context: {} },
    } as never);

    expect(enqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: FAIL — constructor arity mismatch and `maybeMaterializeCharterOnRunStart` undefined.

- [ ] **Step 4: Write minimal implementation**

In `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`:

- Add the import:
  ```typescript
  import { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";
  ```
- Add the constructor parameter as the **last** parameter (after `leaseService`):
  ```typescript
      private readonly leaseService: OrchestrationLeaseService,
      private readonly charterRegen: CharterRegenEnqueuer,
  ```
- In `linkWorkItemRunFromLifecycleEvent`, after the existing `await this.maybeHeartbeatCycleLease(envelope);` line, add:
  ```typescript
  await this.maybeMaterializeCharterOnRunStart(envelope);
  ```
- Add the new method (place it next to `maybeHeartbeatCycleLease`):

  ```typescript
    async maybeMaterializeCharterOnRunStart(
      envelope: CoreWorkflowEventEnvelopeV1Shape,
    ): Promise<void> {
      if (
        !envelope.event_type.startsWith("core.workflow.run.") ||
        this.toTerminalWorkflowStatus(envelope.payload.status)
      ) {
        return;
      }
      const context = envelope.payload.context;
      const projectId = context?.scopeId ?? context?.contextId;
      if (!projectId) {
        return;
      }
      try {
        await this.charterRegen.enqueue(projectId);
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue charter regen on run start for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  ```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: PASS.

- [ ] **Step 6: Run the full kanban unit suite to catch constructor-injection regressions**

Run: `npm run test --workspace=apps/kanban`
Expected: PASS (any other spec that constructs the consumer must already pass the new arg — fix those constructions if present).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts \
  apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts \
  apps/kanban/src/core/core-integration.module.ts
git commit -m "feat(kanban): materialize charter on workflow run start (kanban-pcld)"
```

---

## Task 6: Expose and prefer `get_charter` in prompts/manifest (Mechanism A consumption)

**Files:**

- Modify: kanban tool manifest (the seeded list that registers kanban tool names)
- Modify: charter-consuming agent profiles' allowed tools
- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` and the other charter-consuming prompts

- [ ] **Step 1: Locate the tool manifest and allowed-tools sites**

Run:

```bash
grep -rn "kanban.project_state" seed/ apps/kanban/src | grep -iv spec
grep -rln "kanban.orchestration_timeline" seed/
```

These show every manifest/allow-list that grants `kanban.project_state` to CEO/discovery/charter/roadmap agents. `kanban.get_charter` must appear in the **same** lists (it is a read tool with the same tier).

- [ ] **Step 2: Add `kanban.get_charter` to each manifest/allow-list found**

For every file from Step 1 where `"kanban.project_state"` (or `kanban.orchestration_timeline`) is listed for a charter-consuming profile/workflow step, add the sibling entry `"kanban.get_charter"`. Keep list ordering/formatting identical to the surrounding entries.

- [ ] **Step 3: Update the CEO strategize prompt to prefer the tool**

In `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md`, replace the "### 1.2 Charter and memory" paragraph that begins "Read `docs/project-context/CHARTER.md` using the `read` tool with `missing_ok: true`." with:

```markdown
Call `get_charter` (kanban) to obtain the authoritative project charter,
rendered live from the project's goals and charter memories. Use it to
calibrate grooming decisions and initiative alignment. If the tool is
unavailable, fall back to reading `docs/project-context/CHARTER.md` with
`missing_ok: true`.
```

- [ ] **Step 4: Update the remaining charter-consuming prompts**

Run:

```bash
grep -rln "project-context/CHARTER.md" seed/workflows/prompts/
```

For each prompt that instructs reading `docs/project-context/CHARTER.md` as a strategic input (discovery `discovery.md`/`kickoff.md`, charter `refine.md`, roadmap `plan-roadmap.md`), add a leading sentence directing the agent to prefer `get_charter` and keep the file read as fallback, e.g.:

```markdown
Prefer `get_charter` (kanban) for the authoritative charter; fall back to
reading `docs/project-context/CHARTER.md` if the tool is unavailable.
```

Do **not** change `seed/workflows/prompts/project-charter-ceo/*` authoring instructions that describe how the charter is _written_ — only the _reading_ instructions.

- [ ] **Step 5: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS (no schema/contract violations from the manifest additions).

- [ ] **Step 6: Commit**

```bash
git add seed/
git commit -m "feat(seed): grant and prefer kanban.get_charter in charter-consuming prompts (kanban-pcld)"
```

---

## Task 7: Build, lint, and live verification

- [ ] **Step 1: Build the affected workspaces**

Run:

```bash
npm run build --workspace=packages/core
npm run build:kanban
```

Expected: both succeed (kanban uses `nest build`).

- [ ] **Step 2: Lint**

Run: `npm run lint:kanban`
Expected: clean (no `eslint-disable`, no warnings — strict policy).

- [ ] **Step 3: Run the full kanban unit suite**

Run: `npm run test --workspace=apps/kanban`
Expected: PASS.

- [ ] **Step 4: Live verification against the local stack**

Rebuild and restart the kanban service so the new code and startup reconciliation run:

```bash
docker compose up -d --build kanban
```

Then confirm the charter materializes for the previously-broken project `458935f0`:

```bash
docker exec nexus-api sh -lc "cd /data/nexus-workspaces/clones/458935f0-213e-4bbe-89d1-8883e0efa9ad && git log --oneline -5 | grep -i charter; ls -la docs/project-context/CHARTER.md"
```

Expected: a `docs(charter): regenerate from project intent` commit and a present `CHARTER.md`.

Also confirm the tool renders:

```bash
docker logs nexus-kanban 2>&1 | grep -i "charter reconciliation enqueued"
```

Expected: a startup log line reporting ≥1 project enqueued.

- [ ] **Step 5: Update documentation**

In `docs/guide/` (charter/orchestration section), document that `CHARTER.md` is a projection of the kanban DB, materialized via three mechanisms (on-demand `get_charter` tool, run-start refresh, reconciliation sweep), and is self-healing. Keep it concise.

```bash
git add docs/guide/
git commit -m "docs(guide): document charter materialization and self-healing (kanban-pcld)"
```

- [ ] **Step 6: Close the issue**

```bash
bd close kanban-pcld --reason="Charter now materialized via get_charter tool + run-start refresh + reconciliation sweep; verified live for project 458935f0."
```

---

## Self-Review

- **Spec coverage:** A → Tasks 1 & 6; B → Task 5; C1 → Task 2; C2 → Task 3; C3 → Task 4; C4 → intentionally omitted (goals/memories already enqueue; `update_charter` blocked by kanban-bf21, documented in File Structure note). Build/lint/test/verify → Task 7.
- **Type consistency:** `CharterRegenEnqueuer.enqueue(projectId)`, `ProjectService.list()`/`.get()` returning records with `basePath`/`id`, `CharterDocRenderService.render(projectId): Promise<string>`, and `CoreWorkflowClientService.writeRepoFile({repoPath, filePath, content, message, push})` match the real signatures verified in the codebase.
- **No placeholders:** every code step contains complete code; locator `grep` commands are paired with the exact literal token to add.
- **Boundary:** all new code lives in `apps/kanban`; no charter identifiers added to API/core.
