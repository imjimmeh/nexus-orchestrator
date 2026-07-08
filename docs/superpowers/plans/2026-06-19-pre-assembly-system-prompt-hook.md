# Pre-Assembly System Prompt Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a harness-neutral, pre-assembly system-prompt seam that lets in-tree providers contribute additive context blocks and lets privileged providers transform/override the fully-assembled prompt, wired into both the workflow agent-run path (all harnesses) and chat sessions.

**Architecture:** A new `SystemPromptAssemblyService` owns a contributor registry and a three-phase pipeline (gather additive blocks → merge with engine-built base layers → chain transformers). Both `buildAgentSystemPrompt()` (workflow) and `ChatSessionContextService` (chat) consume it. Existing chat `IChatContextProvider` implementations are folded in through a thin adapter with no behavior change. Failures are fail-open everywhere.

**Tech Stack:** TypeScript, NestJS (DI, `@Global()` modules, `OnApplicationBootstrap`), Vitest + SWC, `@nexus/core` shared types.

## Global Constraints

- **Core/Kanban boundary:** API/core code stays Kanban-neutral. `PromptAssemblyContext` exposes only neutral `scopeId` / `contextId` / `contextType`. No kanban/work-item identifiers. No `eslint-disable`, allowlists, or `nexus-boundaries/no-core-kanban-residue` bypass. (CLAUDE.md "Core/Kanban Boundary")
- **No lint suppression:** Never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. (CLAUDE.md "Strict lint policy")
- **TDD:** Red → Green → Refactor for every task.
- **NestJS build:** Use `nest build`, not `tsc`. Tests rely on SWC decorator metadata.
- **Default contributor priority:** `100`. Higher priority = earlier in the additive block order and earlier in the transformer chain.
- **Default per-contributor timeout:** `3000` ms.
- **Fail-open:** A throwing or timed-out contributor/transformer is skipped and recorded; it never aborts assembly.
- **Empty-registry semantics:** Workflow path treats zero contributors as a valid no-op (base layers only). Chat path preserves its existing hard-fail (`ChatContextRegistryEmptyError`).
- **Test command (apps/api, single file):** `npm run test --workspace=apps/api -- <relative-path-from-apps/api>`

---

## File Structure

**New files**

- `apps/api/src/system-prompt/system-prompt-contributor.types.ts` — interfaces, types, constants for the seam.
- `apps/api/src/system-prompt/system-prompt-assembly.service.ts` — registry + pipeline service.
- `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts` — unit/contract tests.
- `apps/api/src/system-prompt/system-prompt-assembly.module.ts` — `@Global()` module providing/exporting the service.
- `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts` — adapts `IChatContextProvider` → `ISystemPromptContributor`.
- `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.spec.ts` — adapter tests.

**Modified files**

- `apps/api/src/session/chat-context-providers/chat-context.types.ts` — `ChatContextBlock` becomes an alias of `PromptContributionBlock`.
- `apps/api/src/session/chat-session-context.service.ts` — delegate registry + block-gather + transform to the assembly service; keep budget bounding + markdown framing.
- `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` — inject the assembly service; add `assembleAgentSystemPrompt(...)`.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` — `buildAgentSystemPrompt()` builds base layers, removes the `pi`/`claude-code` early return, delegates to the service.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts` — workflow-path tests.
- `apps/api/src/app.module.ts` — import `SystemPromptAssemblyModule`.
- `docs/architecture/memory-management.md` and `docs/guide/README.md` — document the seam.

---

## Task 1: Shared types + assembly-service registry

**Files:**

- Create: `apps/api/src/system-prompt/system-prompt-contributor.types.ts`
- Create: `apps/api/src/system-prompt/system-prompt-assembly.service.ts`
- Test: `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`

**Interfaces:**

- Produces:
  - `ISystemPromptContributor` (`name: string`, `priority?: number`, `timeoutMs?: number`, `contribute(ctx): Promise<PromptContributionBlock | null>`, `transform?(assembled, ctx): Promise<string | null>`)
  - `PromptContributionBlock` (`title: string`, `content: string`, `priority: number`, `metadata?: Record<string, unknown>`)
  - `PromptAssemblyContext`, `ChatPromptAssemblyContext` (see Task 7)
  - constants `DEFAULT_CONTRIBUTOR_PRIORITY = 100`, `DEFAULT_CONTRIBUTOR_TIMEOUT_MS = 3000`
  - `SystemPromptAssemblyService` with `register(c)`, `getRegisteredNames(): string[]`, `getRegisteredCount(): number`, `isRegistryEmpty(): boolean`, `clearForTesting(): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`:

```ts
import { SystemPromptAssemblyService } from "./system-prompt-assembly.service";
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
} from "./system-prompt-contributor.types";

const ctx: PromptAssemblyContext = {
  runType: "workflow",
  baseLayers: [{ id: "resolved", content: "You are an agent." }],
};

function stubContributor(
  name: string,
  block: string,
  priority?: number,
): ISystemPromptContributor {
  return {
    name,
    priority,
    contribute: () =>
      Promise.resolve({
        title: name,
        content: block,
        priority: priority ?? 100,
      }),
  };
}

describe("SystemPromptAssemblyService registry", () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it("registers contributors and reports names in insertion order", () => {
    service.register(stubContributor("a", "A"));
    service.register(stubContributor("b", "B"));
    expect(service.getRegisteredNames()).toEqual(["a", "b"]);
    expect(service.getRegisteredCount()).toBe(2);
    expect(service.isRegistryEmpty()).toBe(false);
  });

  it("overwrites a duplicate name without growing the registry", () => {
    service.register(stubContributor("a", "A"));
    service.register(stubContributor("a", "A2"));
    expect(service.getRegisteredCount()).toBe(1);
  });

  it("reports empty registry and clears for testing", () => {
    expect(service.isRegistryEmpty()).toBe(true);
    service.register(stubContributor("a", "A"));
    service.clearForTesting();
    expect(service.isRegistryEmpty()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: FAIL — cannot find module `./system-prompt-assembly.service`.

- [ ] **Step 3: Write the types file**

Create `apps/api/src/system-prompt/system-prompt-contributor.types.ts`:

```ts
import type { HarnessId } from "@nexus/core";

/** Default additive/transform ordering priority. Higher = earlier. */
export const DEFAULT_CONTRIBUTOR_PRIORITY = 100;

/** Default per-contributor execution budget in milliseconds. */
export const DEFAULT_CONTRIBUTOR_TIMEOUT_MS = 3000;

/** A formatted block appended to the assembled system prompt. */
export interface PromptContributionBlock {
  title: string;
  /** Markdown-formatted content. */
  content: string;
  /** Higher = earlier. Inherited from the contributor when omitted. */
  priority: number;
  metadata?: Record<string, unknown>;
}

/**
 * Neutral, harness-/run-type-agnostic context handed to every contributor.
 * Carries ONLY neutral identifiers — no kanban/work-item domain fields.
 */
export interface PromptAssemblyContext {
  runType: "workflow" | "chat";
  harnessId?: HarnessId;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  chatSessionId?: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
  agentProfileId?: string;
  model?: string;
  /** Structured view of the engine-built layers (workflow path populates this). */
  baseLayers: ReadonlyArray<{ id: string; content: string }>;
}

/** A contributor that can append context and/or transform the assembled prompt. */
export interface ISystemPromptContributor {
  readonly name: string;
  /** Higher = earlier. Default DEFAULT_CONTRIBUTOR_PRIORITY. */
  readonly priority?: number;
  /** Per-contributor execution budget. Default DEFAULT_CONTRIBUTOR_TIMEOUT_MS. */
  readonly timeoutMs?: number;

  /** Additive stage. Return a block to append, or null to skip. */
  contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null>;

  /**
   * Optional privileged override stage. Receives the assembled prompt and
   * returns a replacement, or null to pass through unchanged.
   */
  transform?(
    assembled: string,
    ctx: PromptAssemblyContext,
  ): Promise<string | null>;
}

/** Record of a contributor that failed or was skipped during assembly. */
export interface SkippedContributor {
  name: string;
  stage: "contribute" | "transform";
  reason: string;
}

/** Result of a full assembly pass. */
export interface SystemPromptAssemblyResult {
  prompt: string;
  blocks: PromptContributionBlock[];
  applied: string[];
  skipped: SkippedContributor[];
}
```

- [ ] **Step 4: Write the minimal service (registry only)**

Create `apps/api/src/system-prompt/system-prompt-assembly.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { ISystemPromptContributor } from "./system-prompt-contributor.types";

/**
 * Owns the system-prompt contributor registry and the assembly pipeline.
 * Consumed by the workflow agent-run path and by chat sessions.
 */
@Injectable()
export class SystemPromptAssemblyService {
  private readonly logger = new Logger(SystemPromptAssemblyService.name);
  private readonly contributors = new Map<string, ISystemPromptContributor>();

  register(contributor: ISystemPromptContributor): void {
    if (this.contributors.has(contributor.name)) {
      this.logger.warn(
        `Contributor "${contributor.name}" already registered, overwriting`,
      );
    }
    this.contributors.set(contributor.name, contributor);
  }

  getRegisteredNames(): string[] {
    return Array.from(this.contributors.keys());
  }

  getRegisteredCount(): number {
    return this.contributors.size;
  }

  isRegistryEmpty(): boolean {
    return this.contributors.size === 0;
  }

  /** Test-only: empty the registry. */
  clearForTesting(): void {
    this.contributors.clear();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-contributor.types.ts apps/api/src/system-prompt/system-prompt-assembly.service.ts apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts
git commit -m "feat(system-prompt): add contributor types and registry"
```

---

## Task 2: `gatherBlocks` — additive stage (ordering, fail-open, timeout)

**Files:**

- Modify: `apps/api/src/system-prompt/system-prompt-assembly.service.ts`
- Test: `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`

**Interfaces:**

- Consumes: `ISystemPromptContributor`, `PromptAssemblyContext`, `PromptContributionBlock`, `SkippedContributor` (Task 1).
- Produces: `gatherBlocks(ctx): Promise<{ blocks: PromptContributionBlock[]; applied: string[]; skipped: SkippedContributor[] }>` — runs all `contribute()` in parallel under a per-contributor timeout, drops null/throwing/timed-out, orders surviving blocks priority-descending (tie-broken by registration order).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`:

```ts
describe("SystemPromptAssemblyService.gatherBlocks", () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it("orders blocks by priority desc, tie-broken by registration order", async () => {
    service.register(stubContributor("low", "L", 50));
    service.register(stubContributor("high", "H", 200));
    service.register(stubContributor("mid-a", "A", 100));
    service.register(stubContributor("mid-b", "B", 100));
    const { blocks, applied } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual([
      "high",
      "mid-a",
      "mid-b",
      "low",
    ]);
    expect(applied).toEqual(["high", "mid-a", "mid-b", "low"]);
  });

  it("skips a contributor that returns null", async () => {
    service.register(stubContributor("keep", "K"));
    service.register({ name: "skip", contribute: () => Promise.resolve(null) });
    const { blocks, applied } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(["keep"]);
    expect(applied).toEqual(["keep"]);
  });

  it("is fail-open when a contributor throws", async () => {
    service.register(stubContributor("keep", "K"));
    service.register({
      name: "boom",
      contribute: () => Promise.reject(new Error("kaboom")),
    });
    const { blocks, skipped } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(["keep"]);
    expect(skipped).toEqual([
      { name: "boom", stage: "contribute", reason: "kaboom" },
    ]);
  });

  it("is fail-open when a contributor exceeds its timeout", async () => {
    service.register(stubContributor("keep", "K"));
    service.register({
      name: "slow",
      timeoutMs: 10,
      contribute: () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ title: "slow", content: "S", priority: 100 }),
            50,
          ),
        ),
    });
    const { blocks, skipped } = await service.gatherBlocks(ctx);
    expect(blocks.map((b) => b.title)).toEqual(["keep"]);
    expect(skipped[0]?.name).toBe("slow");
    expect(skipped[0]?.reason).toMatch(/timed out/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: FAIL — `service.gatherBlocks is not a function`.

- [ ] **Step 3: Implement `gatherBlocks` + the timeout helper**

In `apps/api/src/system-prompt/system-prompt-assembly.service.ts`, add the imports and methods:

```ts
import {
  DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
  type PromptAssemblyContext,
  type PromptContributionBlock,
  type SkippedContributor,
} from './system-prompt-contributor.types';

// ...inside the class:

async gatherBlocks(ctx: PromptAssemblyContext): Promise<{
  blocks: PromptContributionBlock[];
  applied: string[];
  skipped: SkippedContributor[];
}> {
  const ordered = Array.from(this.contributors.values());
  const skipped: SkippedContributor[] = [];

  const results = await Promise.all(
    ordered.map(async (contributor, index) => {
      try {
        const block = await this.withTimeout(
          contributor.contribute(ctx),
          contributor.timeoutMs ?? DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
        );
        if (block === null) {
          return null;
        }
        return { contributor, index, block };
      } catch (error) {
        skipped.push({
          name: contributor.name,
          stage: 'contribute',
          reason: (error as Error).message,
        });
        return null;
      }
    }),
  );

  const surviving = results.filter(
    (r): r is { contributor: { name: string }; index: number; block: PromptContributionBlock } =>
      r !== null,
  );

  surviving.sort((a, b) => {
    if (b.block.priority !== a.block.priority) {
      return b.block.priority - a.block.priority;
    }
    return a.index - b.index;
  });

  return {
    blocks: surviving.map((s) => s.block),
    applied: surviving.map((s) => s.contributor.name),
    skipped,
  };
}

private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`contributor timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: PASS (all `gatherBlocks` + registry tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-assembly.service.ts apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts
git commit -m "feat(system-prompt): gather additive blocks with ordering, timeout, fail-open"
```

---

## Task 3: `applyTransforms` — chained override stage

**Files:**

- Modify: `apps/api/src/system-prompt/system-prompt-assembly.service.ts`
- Test: `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`

**Interfaces:**

- Consumes: `ISystemPromptContributor`, `PromptAssemblyContext` (Task 1).
- Produces: `applyTransforms(assembled: string, ctx): Promise<{ prompt: string; skipped: SkippedContributor[] }>` — runs every contributor with a `transform` in priority order (desc, tie-broken by registration order); each receives the prior result; `null` = passthrough; throwing/timed-out transform is skipped (passthrough), never aborts.

- [ ] **Step 1: Write the failing test**

Append to the spec:

```ts
describe("SystemPromptAssemblyService.applyTransforms", () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it("chains transformers in priority order", async () => {
    service.register({
      name: "t-low",
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s} <low>`),
    });
    service.register({
      name: "t-high",
      priority: 90,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s} <high>`),
    });
    const { prompt } = await service.applyTransforms("BASE", ctx);
    expect(prompt).toBe("BASE <high> <low>");
  });

  it("passes through when a transform returns null", async () => {
    service.register({
      name: "noop",
      contribute: () => Promise.resolve(null),
      transform: () => Promise.resolve(null),
    });
    const { prompt } = await service.applyTransforms("BASE", ctx);
    expect(prompt).toBe("BASE");
  });

  it("supports full override and is fail-open on a throwing transform", async () => {
    service.register({
      name: "boom",
      priority: 90,
      contribute: () => Promise.resolve(null),
      transform: () => Promise.reject(new Error("bad transform")),
    });
    service.register({
      name: "replace",
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: () => Promise.resolve("REPLACED"),
    });
    const { prompt, skipped } = await service.applyTransforms("BASE", ctx);
    expect(prompt).toBe("REPLACED");
    expect(skipped).toEqual([
      { name: "boom", stage: "transform", reason: "bad transform" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: FAIL — `service.applyTransforms is not a function`.

- [ ] **Step 3: Implement `applyTransforms`**

Add to the service class:

```ts
async applyTransforms(
  assembled: string,
  ctx: PromptAssemblyContext,
): Promise<{ prompt: string; skipped: SkippedContributor[] }> {
  const transformers = Array.from(this.contributors.values())
    .map((contributor, index) => ({ contributor, index }))
    .filter((entry) => typeof entry.contributor.transform === 'function')
    .sort((a, b) => {
      const pa = a.contributor.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
      const pb = b.contributor.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
      if (pb !== pa) {
        return pb - pa;
      }
      return a.index - b.index;
    });

  const skipped: SkippedContributor[] = [];
  let prompt = assembled;

  for (const { contributor } of transformers) {
    try {
      const next = await this.withTimeout(
        // transform is guaranteed defined by the filter above
        contributor.transform!(prompt, ctx),
        contributor.timeoutMs ?? DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
      );
      if (typeof next === 'string') {
        prompt = next;
      }
    } catch (error) {
      skipped.push({
        name: contributor.name,
        stage: 'transform',
        reason: (error as Error).message,
      });
    }
  }

  return { prompt, skipped };
}
```

Add `DEFAULT_CONTRIBUTOR_PRIORITY` to the existing import from `./system-prompt-contributor.types`.

> Note on `contributor.transform!`: the non-null assertion is permitted here because the `.filter()` immediately above guarantees `transform` is defined; this is not a lint suppression. If the lint config rejects `!`, refactor to capture the function in the filtered entry (`{ contributor, transform: entry.contributor.transform }`) instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-assembly.service.ts apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts
git commit -m "feat(system-prompt): chained transform override stage, fail-open"
```

---

## Task 4: `assemble` — full workflow-path convenience

**Files:**

- Modify: `apps/api/src/system-prompt/system-prompt-assembly.service.ts`
- Test: `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`

**Interfaces:**

- Consumes: `gatherBlocks`, `applyTransforms` (Tasks 2–3), `SystemPromptAssemblyResult` (Task 1).
- Produces: `assemble(ctx): Promise<SystemPromptAssemblyResult>` — merges `ctx.baseLayers` + gathered blocks into one string (each block rendered as `## <title>\n\n<content>`, sections joined by a blank line, empty sections dropped), then runs `applyTransforms`. Returns `{ prompt, blocks, applied, skipped }` with `skipped` combining both stages.

- [ ] **Step 1: Write the failing test**

Append to the spec:

```ts
describe("SystemPromptAssemblyService.assemble", () => {
  let service: SystemPromptAssemblyService;
  beforeEach(() => {
    service = new SystemPromptAssemblyService();
  });

  it("merges base layers and contributed blocks, then transforms", async () => {
    service.register(stubContributor("extra", "Extra context.", 100));
    service.register({
      name: "wrap",
      priority: 10,
      contribute: () => Promise.resolve(null),
      transform: (s) => Promise.resolve(`${s}\n\n-- END --`),
    });
    const result = await service.assemble({
      runType: "workflow",
      harnessId: "pi",
      baseLayers: [
        { id: "runtime", content: "Runtime context." },
        { id: "resolved", content: "You are an agent." },
        { id: "empty", content: "   " },
      ],
    });
    expect(result.prompt).toBe(
      "Runtime context.\nYou are an agent.\n\n## extra\n\nExtra context.\n\n-- END --",
    );
    expect(result.applied).toEqual(["extra"]);
    expect(result.skipped).toEqual([]);
  });

  it("returns base layers only when the registry is empty (no-op)", async () => {
    const result = await service.assemble({
      runType: "workflow",
      baseLayers: [{ id: "resolved", content: "You are an agent." }],
    });
    expect(result.prompt).toBe("You are an agent.");
    expect(result.blocks).toEqual([]);
  });
});
```

> The base-layer join is `\n` (matching today's `buildAgentSystemPrompt` base join), and contributed blocks are appended with a `\n\n` separator as `## title\n\ncontent`. This keeps the workflow base-layer rendering byte-identical to the current behavior when no contributors are registered.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: FAIL — `service.assemble is not a function`.

- [ ] **Step 3: Implement `assemble`**

Add to the service (and add `SystemPromptAssemblyResult` to the type import):

```ts
async assemble(ctx: PromptAssemblyContext): Promise<SystemPromptAssemblyResult> {
  const { blocks, applied, skipped: gatherSkipped } =
    await this.gatherBlocks(ctx);

  const baseSection = ctx.baseLayers
    .map((layer) => layer.content)
    .filter((content) => content && content.trim().length > 0)
    .join('\n');

  const blockSections = blocks.map(
    (block) => `## ${block.title}\n\n${block.content}`,
  );

  const merged = [baseSection, ...blockSections]
    .filter((section) => section && section.trim().length > 0)
    .join('\n\n');

  const { prompt, skipped: transformSkipped } = await this.applyTransforms(
    merged,
    ctx,
  );

  return {
    prompt,
    blocks,
    applied,
    skipped: [...gatherSkipped, ...transformSkipped],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-assembly.service.ts apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts
git commit -m "feat(system-prompt): assemble() merges base layers, blocks, and transforms"
```

---

## Task 5: `SystemPromptAssemblyModule` + AppModule wiring

**Files:**

- Create: `apps/api/src/system-prompt/system-prompt-assembly.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/system-prompt/system-prompt-assembly.module.spec.ts`

**Interfaces:**

- Consumes: `SystemPromptAssemblyService` (Task 1).
- Produces: `SystemPromptAssemblyModule` (`@Global()`), exporting `SystemPromptAssemblyService` so both `StepSupportService` and `ChatSessionContextService` can inject it without an explicit module import.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/system-prompt/system-prompt-assembly.module.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { SystemPromptAssemblyModule } from "./system-prompt-assembly.module";
import { SystemPromptAssemblyService } from "./system-prompt-assembly.service";

describe("SystemPromptAssemblyModule", () => {
  it("provides SystemPromptAssemblyService", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SystemPromptAssemblyModule],
    }).compile();
    expect(moduleRef.get(SystemPromptAssemblyService)).toBeInstanceOf(
      SystemPromptAssemblyService,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.module.spec.ts`
Expected: FAIL — cannot find module `./system-prompt-assembly.module`.

- [ ] **Step 3: Create the module**

Create `apps/api/src/system-prompt/system-prompt-assembly.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { SystemPromptAssemblyService } from "./system-prompt-assembly.service";

/**
 * Provides the shared system-prompt assembly seam. Marked `@Global()` so both
 * the workflow agent-run path (StepSupportService) and chat sessions
 * (ChatSessionContextService) can inject the service without importing this
 * module directly. Imported once in AppModule.
 */
@Global()
@Module({
  providers: [SystemPromptAssemblyService],
  exports: [SystemPromptAssemblyService],
})
export class SystemPromptAssemblyModule {}
```

- [ ] **Step 4: Wire into AppModule**

In `apps/api/src/app.module.ts`, add the import near the other module imports and add `SystemPromptAssemblyModule` to the `imports` array (place it before `SessionModule` and `MemoryModule` so the service is available when their `OnApplicationBootstrap` hooks run):

```ts
import { SystemPromptAssemblyModule } from "./system-prompt/system-prompt-assembly.module";
```

```ts
// inside @Module({ imports: [ ... ] })
    SystemPromptAssemblyModule,
    SessionModule,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.module.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-assembly.module.ts apps/api/src/system-prompt/system-prompt-assembly.module.spec.ts apps/api/src/app.module.ts
git commit -m "feat(system-prompt): global assembly module wired into AppModule"
```

---

## Task 6: Workflow integration — base layers, remove harness early return

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-support.service.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts`
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`

**Interfaces:**

- Consumes: `SystemPromptAssemblyService.assemble(ctx)` (Task 4); existing `StepSupportService` helpers (`buildUpstreamContextForJob`, `buildRunningWorkflowsContext`, `buildPromotedLearningContext`).
- Produces: `StepSupportService.assembleAgentSystemPrompt(params): Promise<string>` delegating to the assembly service; the refactored free function `buildAgentSystemPrompt(...)` keeps the same call signature it has today at `step-agent-step-executor.helpers.ts:138`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts` a focused describe block. (Match the existing spec's import style and `buildStepRunnerConfigPayloadCore` test harness — reuse its existing `support`/`aiConfig`/`registry` mock factory. The two assertions that are new:)

```ts
describe("buildAgentSystemPrompt assembly integration", () => {
  it("runs the assembly pipeline for pi/claude-code harnesses (no early return)", async () => {
    // Arrange a support mock whose assembleAgentSystemPrompt records the
    // harnessId it was called with and returns a sentinel prompt.
    const assembleSpy = vi.fn().mockResolvedValue("ASSEMBLED");
    const support = makeSupportMock({ assembleAgentSystemPrompt: assembleSpy });
    const config = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({ support, harnessId: "pi" }),
    );
    expect(assembleSpy).toHaveBeenCalledTimes(1);
    expect(assembleSpy.mock.calls[0][0]).toMatchObject({ harnessId: "pi" });
    expect(config.prompt.systemPrompt).toContain("ASSEMBLED");
  });

  it("omits the skill section for harness agents but still assembles", async () => {
    const assembleSpy = vi.fn().mockResolvedValue("ASSEMBLED");
    const support = makeSupportMock({ assembleAgentSystemPrompt: assembleSpy });
    await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({ support, harnessId: "claude-code" }),
    );
    const baseLayers = assembleSpy.mock.calls[0][0].baseLayers as Array<{
      id: string;
    }>;
    expect(baseLayers.map((l) => l.id)).not.toContain("skill");
  });
});
```

> Use the spec file's existing mock helpers if present; if the spec lacks `makeSupportMock`/`makeCorePayloadParams`, add minimal local factories that satisfy the `buildStepRunnerConfigPayloadCore` param shape (see `step-agent-step-executor.helpers.ts:68-84`). Keep the existing passing tests in this file untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`
Expected: FAIL — `support.assembleAgentSystemPrompt is not a function` (and/or the early return still bypasses the spy).

- [ ] **Step 3: Add the delegating method to `StepSupportService`**

In `step-support.service.ts`, import the service and constants:

```ts
import { SystemPromptAssemblyService } from "../../system-prompt/system-prompt-assembly.service";
import type { PromptAssemblyContext } from "../../system-prompt/system-prompt-contributor.types";
```

Add `private readonly systemPromptAssembly: SystemPromptAssemblyService` to the constructor parameter list (append at the end to avoid reordering existing injection):

```ts
    private readonly memoryManager: MemoryManagerService,
    private readonly systemPromptAssembly: SystemPromptAssemblyService,
  ) {}
```

Add the method:

```ts
async assembleAgentSystemPrompt(
  ctx: PromptAssemblyContext,
): Promise<string> {
  const result = await this.systemPromptAssembly.assemble(ctx);
  if (result.skipped.length > 0) {
    this.logger.warn(
      `System prompt assembly skipped ${result.skipped.length} contributor(s): ` +
        result.skipped
          .map((s) => `${s.name}[${s.stage}]: ${s.reason}`)
          .join('; '),
    );
  }
  return result.prompt;
}
```

- [ ] **Step 4: Refactor `buildAgentSystemPrompt` to build base layers and delegate**

In `step-agent-step-executor.helpers.ts`, replace the body of `buildAgentSystemPrompt` (lines ~335-396) with base-layer construction + a single delegation. Keep the same param object shape so the call site at line 138 is unchanged:

```ts
async function buildAgentSystemPrompt(params: {
  support: StepSupportService;
  data: JobQueueData;
  step: IJobStep;
  stateVariables: Record<string, unknown>;
  resolvedSystemPrompt: string;
  assignedSkills?: SkillLibraryRecord[];
  availableCategories?: string[];
  skillDiscoveryMode?: SkillDiscoveryMode;
  harnessId?: HarnessId;
}): Promise<string> {
  const stepPrompt =
    typeof params.step.prompt === "string" ? params.step.prompt.trim() : "";
  const [upstreamContext, runningWorkflowsContext, promotedLearningContext] =
    await Promise.all([
      params.support.buildUpstreamContextForJob(
        params.data.workflowRunId,
        params.data.job,
      ),
      params.support.buildRunningWorkflowsContext({
        stateVariables: params.stateVariables,
        excludeRunId: params.data.workflowRunId,
      }),
      params.support.buildPromotedLearningContext({
        workflowRunId: params.data.workflowRunId,
        stateVariables: params.stateVariables,
        ...(stepPrompt ? { query: stepPrompt } : {}),
      }),
    ]);
  const runtimeContext = buildRuntimeContextSection({
    workflowRunId: params.data.workflowRunId,
    jobId: params.data.job.id,
    stepId: params.step.id,
    stateVariables: params.stateVariables,
  });

  const isHarnessAgent =
    params.harnessId === "pi" || params.harnessId === "claude-code";
  const skillSection = isHarnessAgent
    ? ""
    : renderSkillSection({
        mode: params.skillDiscoveryMode ?? DEFAULT_SKILL_DISCOVERY_MODE,
        assignedSkills: params.assignedSkills?.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
        })),
        availableCategories: params.availableCategories,
      });

  const baseLayers = [
    { id: "upstream", content: upstreamContext },
    { id: "runtime", content: runtimeContext },
    { id: "running-workflows", content: runningWorkflowsContext },
    { id: "promoted-learning", content: promotedLearningContext },
    { id: "resolved", content: params.resolvedSystemPrompt },
    { id: "skill", content: skillSection },
  ].filter((layer) => layer.content && layer.content.trim().length > 0);

  const trigger = asRecord(params.stateVariables.trigger);
  const triggerContext = asRecord(trigger?.context);

  return params.support.assembleAgentSystemPrompt({
    runType: "workflow",
    harnessId: params.harnessId,
    workflowRunId: params.data.workflowRunId,
    jobId: params.data.job.id,
    stepId: params.step.id,
    scopeId: readOptionalString(triggerContext?.scopeId),
    contextId: readOptionalString(triggerContext?.contextId),
    contextType: readOptionalString(triggerContext?.contextType),
    baseLayers,
  });
}
```

> This removes the `if (harnessId === 'pi' || 'claude-code') return baseSystemPrompt;` early return. The skill layer is still gated by harness (empty string for harness agents → filtered out), so harness-agent output is unchanged except that the assembly pipeline now runs for them. The previous base-join used `\n` between the five base layers and `\n\n` before the skill section; the assembly service joins base layers with `\n` and prepends block/skill-derived sections with `\n\n`, preserving the spacing for the non-contributor case because `skill` is now a base layer joined at `\n`. If a byte-identical skill separator is required, keep `skill` out of `baseLayers` and instead register the skill section as a contributor — note this only if the regression test in Task 9 shows a diff.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`
Expected: PASS (new assembly tests + existing tests in the file).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-support.service.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts
git commit -m "feat(system-prompt): assemble workflow prompts for all harnesses via the seam"
```

---

## Task 7: Chat context provider adapter + block-type unification

**Files:**

- Modify: `apps/api/src/session/chat-context-providers/chat-context.types.ts`
- Create: `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts`
- Test: `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.spec.ts`

**Interfaces:**

- Consumes: `ISystemPromptContributor`, `PromptContributionBlock`, `PromptAssemblyContext` (Task 1); `IChatContextProvider`, `ChatSession`.
- Produces:
  - `ChatContextBlock` re-typed as `= PromptContributionBlock` (structurally identical: `title`, `content`, `priority`, `metadata?`).
  - `ChatPromptAssemblyContext extends PromptAssemblyContext { runType: 'chat'; session: ChatSession }`.
  - `ChatContextProviderAdapter implements ISystemPromptContributor` wrapping an `IChatContextProvider`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.spec.ts`:

```ts
import { ChatContextProviderAdapter } from "./chat-context-provider.adapter";
import type { IChatContextProvider } from "./chat-context.provider.interface";
import type { ChatPromptAssemblyContext } from "./chat-context.types";
import type { ChatSession } from "../../chat/database/entities/chat-session.entity";

const session = { id: "sess-1" } as ChatSession;
const chatCtx: ChatPromptAssemblyContext = {
  runType: "chat",
  chatSessionId: "sess-1",
  baseLayers: [],
  session,
};

function makeProvider(
  over: Partial<IChatContextProvider> = {},
): IChatContextProvider {
  return {
    name: "p",
    priority: 200,
    canProvide: () => Promise.resolve(true),
    getContext: () =>
      Promise.resolve({ title: "P", content: "body", priority: 200 }),
    ...over,
  };
}

describe("ChatContextProviderAdapter", () => {
  it("mirrors name and priority from the wrapped provider", () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    expect(adapter.name).toBe("p");
    expect(adapter.priority).toBe(200);
  });

  it("returns null for non-chat contexts", async () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    const block = await adapter.contribute({
      runType: "workflow",
      baseLayers: [],
    });
    expect(block).toBeNull();
  });

  it("returns null when canProvide is false", async () => {
    const adapter = new ChatContextProviderAdapter(
      makeProvider({ canProvide: () => Promise.resolve(false) }),
    );
    expect(await adapter.contribute(chatCtx)).toBeNull();
  });

  it("delegates getContext for an applicable chat session", async () => {
    const adapter = new ChatContextProviderAdapter(makeProvider());
    const block = await adapter.contribute(chatCtx);
    expect(block).toEqual({ title: "P", content: "body", priority: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/session/chat-context-providers/chat-context-provider.adapter.spec.ts`
Expected: FAIL — cannot find module `./chat-context-provider.adapter`.

- [ ] **Step 3: Re-type `ChatContextBlock` and add the chat context type**

In `chat-context.types.ts`, replace the `ChatContextBlock` interface declaration with an alias and add the chat assembly context. Keep `IChatContextProvider` and `ChatContextMetadata` as-is:

```ts
import { ChatSession } from "../../chat/database/entities/chat-session.entity";
import type {
  PromptAssemblyContext,
  PromptContributionBlock,
} from "../../system-prompt/system-prompt-contributor.types";

// ... keep IChatContextProvider unchanged ...

/**
 * A formatted block of context for a chat session's system message.
 * Structurally identical to PromptContributionBlock — aliased so chat and
 * workflow share one block shape.
 */
export type ChatContextBlock = PromptContributionBlock;

/** Chat-scoped assembly context. Carries the loaded ChatSession for adapters. */
export interface ChatPromptAssemblyContext extends PromptAssemblyContext {
  runType: "chat";
  session: ChatSession;
}
```

> `IChatContextProvider.getContext` returns `Promise<ChatContextBlock>`, which is now `Promise<PromptContributionBlock>` — no call-site change because the shapes are identical.

- [ ] **Step 4: Create the adapter**

Create `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts`:

```ts
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
} from "../../system-prompt/system-prompt-contributor.types";
import type { IChatContextProvider } from "./chat-context.provider.interface";
import type { ChatPromptAssemblyContext } from "./chat-context.types";

/**
 * Adapts a chat-scoped {@link IChatContextProvider} to the harness-neutral
 * {@link ISystemPromptContributor} seam. Only fires for chat contexts; returns
 * null for any other run type.
 */
export class ChatContextProviderAdapter implements ISystemPromptContributor {
  constructor(private readonly provider: IChatContextProvider) {}

  get name(): string {
    return this.provider.name;
  }

  get priority(): number | undefined {
    return this.provider.priority;
  }

  async contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null> {
    if (ctx.runType !== "chat") {
      return null;
    }
    const { session } = ctx as ChatPromptAssemblyContext;
    if (!(await this.provider.canProvide(session))) {
      return null;
    }
    return this.provider.getContext(session);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- src/session/chat-context-providers/chat-context-provider.adapter.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/session/chat-context-providers/chat-context.types.ts apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts apps/api/src/session/chat-context-providers/chat-context-provider.adapter.spec.ts
git commit -m "feat(system-prompt): chat context provider adapter and shared block type"
```

---

## Task 8: `ChatSessionContextService` delegates to the assembly seam

**Files:**

- Modify: `apps/api/src/session/chat-session-context.service.ts`
- Test: `apps/api/src/session/chat-session-context.service.spec.ts`

**Interfaces:**

- Consumes: `SystemPromptAssemblyService` (`register`, `gatherBlocks`, `applyTransforms`, `getRegisteredNames`, `getRegisteredCount`, `isRegistryEmpty`) — Tasks 1–3; `ChatContextProviderAdapter` (Task 7).
- Produces: unchanged public API (`registerProvider`, `buildContextMessage`, `injectContextMessage`, `refreshContextMessage`, `getRegisteredProviderNames`, `getRegisteredProviderCount`, `isRegistryEmpty`, `isHealthy`, `assertRegistryNonEmpty`, `clearProvidersForTesting`). Internally it no longer owns the registry — it delegates to `SystemPromptAssemblyService`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/session/chat-session-context.service.spec.ts` (alongside existing tests; reuse the existing service-construction helper but pass a real `SystemPromptAssemblyService` so registration is observable):

```ts
import { SystemPromptAssemblyService } from "../system-prompt/system-prompt-assembly.service";

describe("ChatSessionContextService delegates to the assembly seam", () => {
  it("registers providers on the shared assembly service", () => {
    const assembly = new SystemPromptAssemblyService();
    const service = makeService({ assembly }); // existing helper, extended to inject assembly
    service.registerProvider("p", {
      name: "p",
      canProvide: () => Promise.resolve(true),
      getContext: () =>
        Promise.resolve({ title: "P", content: "b", priority: 100 }),
    });
    expect(assembly.getRegisteredNames()).toContain("p");
    expect(service.getRegisteredProviderNames()).toContain("p");
  });

  it("assertRegistryNonEmpty throws when the shared registry is empty", () => {
    const assembly = new SystemPromptAssemblyService();
    const service = makeService({ assembly });
    expect(() => service.assertRegistryNonEmpty("test")).toThrow(
      /registry is empty/i,
    );
  });
});
```

> Extend the spec's existing `makeService` (or inline construction) to pass a `SystemPromptAssemblyService` as the new constructor argument. Keep all existing chat-context tests in the file; they must continue to pass unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- src/session/chat-session-context.service.spec.ts`
Expected: FAIL — constructor arity mismatch / `assembly.getRegisteredNames` not populated.

- [ ] **Step 3: Refactor the service to delegate registry + gather + transform**

In `chat-session-context.service.ts`:

1. Add imports:

```ts
import { SystemPromptAssemblyService } from "../system-prompt/system-prompt-assembly.service";
import { ChatContextProviderAdapter } from "./chat-context-providers/chat-context-provider.adapter";
import type { ChatPromptAssemblyContext } from "./chat-context-providers/chat-context.types";
```

2. Add the new dependency to the constructor (append last):

```ts
    private readonly tokenCounter: TokenCounterService,
    private readonly systemPromptAssembly: SystemPromptAssemblyService,
  ) {}
```

3. Delete the private `providers: Map<...>` field and the local registry methods' bodies, delegating to the assembly service:

```ts
registerProvider(name: string, provider: IChatContextProvider): void {
  this.systemPromptAssembly.register(new ChatContextProviderAdapter(provider));
  this.logger.debug(`Registered context provider: ${name}`);
}

getRegisteredProviderNames(): string[] {
  return this.systemPromptAssembly.getRegisteredNames();
}

getRegisteredProviderCount(): number {
  return this.systemPromptAssembly.getRegisteredCount();
}

isRegistryEmpty(): boolean {
  return this.systemPromptAssembly.isRegistryEmpty();
}

clearProvidersForTesting(): void {
  this.systemPromptAssembly.clearForTesting();
}
```

(`isHealthy` and `assertRegistryNonEmpty` already build on `isRegistryEmpty`/`getRegisteredProviderCount`, so they keep working unchanged.)

4. Replace the per-provider gather loop in `getContextBlocks` (the `applicableProviders`/`activeProviders`/`safeGetContext` section) with a single delegated call, then keep the existing `boundBlocksByMemoryBudget` + cache logic verbatim:

```ts
private async getContextBlocks(
  session: ChatSession,
): Promise<ChatContextBlock[]> {
  const cacheKey = session.id;
  const cached = this.contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    this.logger.debug(`Context cache hit for session ${session.id}`);
    return cached.blocks;
  }

  const ctx: ChatPromptAssemblyContext = {
    runType: 'chat',
    chatSessionId: session.id,
    scopeId: session.scope_id ?? undefined,
    model: session.model ?? undefined,
    baseLayers: [],
    session,
  };
  const { blocks, skipped } = await this.systemPromptAssembly.gatherBlocks(ctx);
  if (skipped.length > 0) {
    this.logger.warn(
      `Chat context gather skipped ${skipped.length} provider(s) for session ${session.id}: ` +
        skipped.map((s) => `${s.name}: ${s.reason}`).join('; '),
    );
  }

  const boundedBlocks = await this.boundBlocksByMemoryBudget(session, blocks);
  const minTtl = Math.min(
    ...boundedBlocks
      .map((b) => (b.metadata?.cacheTtlSeconds as number | undefined) ?? 300)
      .filter((ttl) => ttl && ttl > 0),
    300,
  );
  this.contextCache.set(cacheKey, {
    blocks: boundedBlocks,
    expiresAt: Date.now() + minTtl * 1000,
  });
  return boundedBlocks;
}
```

5. Delete the now-unused `safeCanProvide` and `safeGetContext` private methods (fail-open is now owned by the assembly service). Confirm no other references remain (grep).

> `session.scope_id` / `session.model` are the neutral fields the providers already rely on; the adapter still hands the full `session` to each provider so existing provider logic (e.g. `BudgetContextProvider` using `session.id`) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- src/session/chat-session-context.service.spec.ts`
Expected: PASS (new delegation tests + all existing chat-context tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/session/chat-session-context.service.ts apps/api/src/session/chat-session-context.service.spec.ts
git commit -m "refactor(session): chat context service delegates to the shared assembly seam"
```

---

## Task 9: Cross-cutting regression — built-in providers + empty-registry semantics

**Files:**

- Test: `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts`
- Test: `apps/api/src/session/chat-memory-token-budget.integration.spec.ts`
- (Possibly) Modify: `apps/api/src/memory/built-in-context-providers/built-in-context-provider.registrar.ts`

**Interfaces:**

- Consumes: everything from Tasks 5–8.
- Produces: confidence that the five built-in providers register and produce identical chat output, and that empty-registry semantics differ correctly by run type.

- [ ] **Step 1: Run the existing contract + integration specs (regression baseline)**

Run:

```bash
npm run test --workspace=apps/api -- src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts
npm run test --workspace=apps/api -- src/session/chat-memory-token-budget.integration.spec.ts
```

Expected: PASS. If the load-order contract test fails because it inspected the old private registry, update it to assert against `ChatSessionContextService.getRegisteredProviderNames()` (which now delegates to the assembly service) — the order is still insertion order, so the asserted names/order are unchanged. The registrar itself (`built-in-context-provider.registrar.ts`) needs no change: it calls `chatSessionContextService.registerProvider(...)`, which now adapts + registers on the shared service.

- [ ] **Step 2: Write the empty-registry semantics test**

Add to `apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts`:

```ts
describe("empty-registry semantics", () => {
  it("workflow assemble is a no-op with zero contributors", async () => {
    const service = new SystemPromptAssemblyService();
    const result = await service.assemble({
      runType: "workflow",
      baseLayers: [{ id: "resolved", content: "Base only." }],
    });
    expect(result.prompt).toBe("Base only.");
    expect(service.isRegistryEmpty()).toBe(true);
  });
});
```

And confirm the chat hard-fail is covered by the Task 8 `assertRegistryNonEmpty` test (chat crashes when empty; workflow does not). No code change — this is a guard test pinning the documented divergence.

- [ ] **Step 3: Run the new test**

Run: `npm run test --workspace=apps/api -- src/system-prompt/system-prompt-assembly.service.spec.ts`
Expected: PASS.

- [ ] **Step 4: Full apps/api suite + lint**

Run:

```bash
npm run test --workspace=apps/api
npm run lint:api
```

Expected: PASS. Fix any failures in code (never suppress). Pay attention to the boundary lint rule `nexus-boundaries/no-core-kanban-residue`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/system-prompt/system-prompt-assembly.service.spec.ts apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts
git commit -m "test(system-prompt): regression for built-in providers and empty-registry semantics"
```

---

## Task 10: Documentation + final verification

**Files:**

- Modify: `docs/architecture/memory-management.md`
- Modify: `docs/guide/README.md`

**Interfaces:**

- Consumes: the implemented seam (Tasks 1–9).
- Produces: operator/developer documentation of the seam.

- [ ] **Step 1: Document the seam in the architecture doc**

In `docs/architecture/memory-management.md`, add a section titled **"System Prompt Assembly Seam"** describing:

- `ISystemPromptContributor` (`contribute` additive + optional `transform` override), `SystemPromptAssemblyService`, and the three phases (gather → merge base layers → chain transforms).
- That the workflow path (`buildAgentSystemPrompt`) runs the seam for **all** harnesses, and chat (`ChatSessionContextService`) delegates block-gathering to it while keeping its token-budget bounding and markdown framing.
- Fail-open behavior, default priority (100) and timeout (3000 ms).
- Empty-registry divergence: workflow no-op vs chat hard-fail.
- That the plugin-kernel bridge is a documented follow-up (not yet implemented).

- [ ] **Step 2: Cross-link from the unified guide**

In `docs/guide/README.md`, add a one-line pointer under the relevant runtime/extensibility section linking to the new architecture section, so the seam is discoverable from the primary entry point.

- [ ] **Step 3: Build the API to confirm decorator metadata + types compile**

Run:

```bash
npm run build --workspace=packages/core
npm run build:api
```

Expected: SUCCESS.

- [ ] **Step 4: Final full verification**

Run:

```bash
npm run test --workspace=apps/api
npm run lint:api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/memory-management.md docs/guide/README.md
git commit -m "docs: document the system prompt assembly seam"
```

---

## Self-Review

**Spec coverage:**

- §4 Core abstraction (`ISystemPromptContributor`, `PromptContributionBlock`, `PromptAssemblyContext`) → Task 1. ✓
- §5 Pipeline (gather/merge/transform, ordering, fail-open, timeout, emit) → Tasks 2–4 (+ logging of skipped in Tasks 6 & 8 satisfies "emit observability"). ✓
- §6.1 Workflow integration + remove early return → Task 6. ✓
- §6.2 Chat delegation, keep bounding/framing, adapter, unchanged providers → Tasks 7–8. ✓
- §6.3 Module placement (`@Global` shared module) → Task 5. ✓
- §7 Failure handling, timeout, boundary, empty-registry divergence → Tasks 2–4, 8, 9. ✓
- §8 Testing (ordering, fail-open, timeout, chaining, override, boundary, early-return removal, chat regression) → Tasks 2,3,4,6,8,9. ✓
- §9 Follow-ups documented, not implemented → Task 10 doc note. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The two spec-helper reuse notes (Tasks 6, 8) reference the _existing_ spec's mock factories and instruct how to extend them, with a fallback for constructing minimal factories — not a placeholder. ✓

**Type consistency:** `gatherBlocks` returns `{ blocks, applied, skipped }`; `applyTransforms` returns `{ prompt, skipped }`; `assemble` returns `SystemPromptAssemblyResult { prompt, blocks, applied, skipped }`. `ChatContextBlock = PromptContributionBlock`. `ChatPromptAssemblyContext extends PromptAssemblyContext`. `StepSupportService.assembleAgentSystemPrompt(ctx)` and the service's `assemble(ctx)` agree. Constants `DEFAULT_CONTRIBUTOR_PRIORITY`/`DEFAULT_CONTRIBUTOR_TIMEOUT_MS` used consistently. ✓
