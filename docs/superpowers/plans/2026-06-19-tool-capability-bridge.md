# Tool Capability Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `TodoPromptContributor` with a generic, reusable `ToolCapabilityBridge` that discovers prompt-contributing tools from the existing `INTERNAL_TOOL_HANDLER` array and wires them into the system-prompt assembly seam, folding the todo contribution onto `GetTodoListTool` itself.

**Architecture:** A generic abstract `ToolCapabilityBridge<TCapability>` (Template Method) scans the already-aggregated tool array on `onModuleInit`, narrows each tool by a capability type guard, and wires matches into a target seam. A concrete `ToolPromptContributorBridge` supplies the guard (tool has a `contribute` method) and the wiring action (`SystemPromptAssemblyService.register`). `GetTodoListTool` additionally implements `ISystemPromptContributor`, so it is discovered automatically — no new collection token, no per-tool wiring.

**Tech Stack:** NestJS (`@Injectable`, `OnModuleInit`, `@Inject`), TypeScript, Vitest.

## Global Constraints

- `apps/api/src` must remain Kanban-neutral — no `kanban`, work-item, or project-domain identifiers anywhere (code, tests, comments).
- Never suppress lint (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`). Fix findings in code.
- Strictly typed — no `any`.
- Contributor `name` is exactly the string `'todo'`; contributor `priority` is exactly `50` (named constant `TODO_CONTRIBUTOR_PRIORITY`).
- Block `title` is exactly `'Todo List'`.
- The assembled prompt output must be byte-identical to today: same instructions text, same table formatting, same empty-state message, same status icons (✅ completed, 🔄 in-progress, ⬜ not-started).
- Test files use Vitest (`describe`, `it`, `expect`, `vi`, `beforeEach`).
- NestJS apps build with `nest build` via `npm run build:api` — not `tsc` directly.

---

### Task 1: Generic `ToolCapabilityBridge` abstract base

**Files:**

- Create: `apps/api/src/tool/tool-capability.bridge.ts`
- Create: `apps/api/src/tool/tool-capability.bridge.spec.ts`

**Interfaces:**

- Consumes:
  - `IInternalToolHandler` from `@nexus/core` (shape: `{ getName(): string; getDefinition(): RuntimeCapabilityDefinition; execute(...): Promise<...> }`)
  - `Injectable`, `OnModuleInit` from `@nestjs/common`
- Produces:
  - `ToolCapabilityBridge<TCapability>` — exported `abstract` class, `@Injectable()`, implements `OnModuleInit`
  - Protected constructor param `tools: IInternalToolHandler[]`
  - Abstract `supports(tool: IInternalToolHandler): tool is IInternalToolHandler & TCapability`
  - Abstract `wire(tool: IInternalToolHandler & TCapability): void`
  - Concrete `onModuleInit(): void` — calls `wire` for each tool where `supports` is true

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tool/tool-capability.bridge.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IInternalToolHandler } from "@nexus/core";
import { ToolCapabilityBridge } from "./tool-capability.bridge";

interface MarkerCapability {
  marker(): string;
}

const makeTool = (name: string): IInternalToolHandler =>
  ({
    getName: () => name,
    getDefinition: vi.fn(),
    execute: vi.fn(),
  }) as unknown as IInternalToolHandler;

const makeCapableTool = (
  name: string,
): IInternalToolHandler & MarkerCapability =>
  ({
    getName: () => name,
    getDefinition: vi.fn(),
    execute: vi.fn(),
    marker: () => name,
  }) as unknown as IInternalToolHandler & MarkerCapability;

class TestBridge extends ToolCapabilityBridge<MarkerCapability> {
  readonly wired: Array<IInternalToolHandler & MarkerCapability> = [];

  protected supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & MarkerCapability {
    return typeof (tool as Partial<MarkerCapability>).marker === "function";
  }

  protected wire(tool: IInternalToolHandler & MarkerCapability): void {
    this.wired.push(tool);
  }
}

describe("ToolCapabilityBridge", () => {
  let bridge: TestBridge;

  beforeEach(() => {
    bridge = new TestBridge([]);
  });

  it("wires only tools that support the capability", () => {
    const capable = makeCapableTool("capable");
    bridge = new TestBridge([makeTool("plain"), capable, makeTool("other")]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([capable]);
  });

  it("handles an empty tool array without error", () => {
    bridge = new TestBridge([]);
    expect(() => bridge.onModuleInit()).not.toThrow();
    expect(bridge.wired).toEqual([]);
  });

  it("wires nothing when no tool supports the capability", () => {
    bridge = new TestBridge([makeTool("a"), makeTool("b")]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([]);
  });

  it("wires every supporting tool when multiple match", () => {
    const a = makeCapableTool("a");
    const b = makeCapableTool("b");
    bridge = new TestBridge([a, makeTool("plain"), b]);
    bridge.onModuleInit();
    expect(bridge.wired).toEqual([a, b]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test --workspace=apps/api -- tool-capability.bridge`
Expected: FAIL — `ToolCapabilityBridge` does not exist yet.

- [ ] **Step 3: Implement the abstract base**

Create `apps/api/src/tool/tool-capability.bridge.ts`:

```typescript
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { IInternalToolHandler } from "@nexus/core";

/**
 * Generic bridge that discovers tools carrying a capability from the
 * aggregated tool array and wires each match into a target seam on init.
 *
 * Subclasses supply the two variable parts: the capability type guard
 * (`supports`) and the seam wiring action (`wire`).
 */
@Injectable()
export abstract class ToolCapabilityBridge<
  TCapability,
> implements OnModuleInit {
  constructor(protected readonly tools: IInternalToolHandler[]) {}

  /** Type guard: does this tool carry the capability? */
  protected abstract supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & TCapability;

  /** Wire a matching tool into its target seam. */
  protected abstract wire(tool: IInternalToolHandler & TCapability): void;

  onModuleInit(): void {
    for (const tool of this.tools) {
      if (this.supports(tool)) {
        this.wire(tool);
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test --workspace=apps/api -- tool-capability.bridge`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tool/tool-capability.bridge.ts \
        apps/api/src/tool/tool-capability.bridge.spec.ts
git commit -m "feat(tool): add generic ToolCapabilityBridge template-method base"
```

---

### Task 2: `GetTodoListTool` implements `ISystemPromptContributor`

**Files:**

- Modify: `apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.ts`
- Create: `apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.spec.ts`

**Interfaces:**

- Consumes:
  - `ISystemPromptContributor`, `PromptAssemblyContext`, `PromptContributionBlock` from `../../../../system-prompt/system-prompt-contributor.types`
  - `WorkflowRunTodoService.getTodoList(workflowRunId: string): Promise<WorkflowRunTodoResponse>` from `../../../workflow-run-operations/workflow-run-todo.service`
  - `WorkflowRunTodoRecord` from `../../../workflow-run-operations/workflow-run-todo.types` — fields used: `title: string`, `status: 'not-started' | 'in-progress' | 'completed'`
  - Existing: `TodoToolsHandler` (unchanged usage in `execute`)
- Produces:
  - `GetTodoListTool` now also implements `ISystemPromptContributor`: `readonly name = 'todo'`, `readonly priority = 50`, `contribute(ctx): Promise<PromptContributionBlock | null>`
  - The `contribute` method is the discovery surface the bridge in Task 3 detects via `typeof tool.contribute === 'function'`

**Context:** `GetTodoListTool` currently injects only `TodoToolsHandler` and delegates `execute` to it. This task adds a second constructor dependency, `WorkflowRunTodoService`, used solely by `contribute` (it needs the run-id primitive `getTodoList(workflowRunId)`, not the handler's context-based `getTodoList(params, context)`). `WorkflowRunTodoService` is already resolvable in this module's injector because the sibling `TodoToolsHandler` injects it today. The instructions text and table formatting are copied verbatim from the now-deleted `TodoPromptContributor` so the assembled output does not change.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetTodoListTool } from "./get-todo-list.tool";
import type { TodoToolsHandler } from "../../handlers/todo-tools.handler";
import type { WorkflowRunTodoService } from "../../../workflow-run-operations/workflow-run-todo.service";
import type { PromptAssemblyContext } from "../../../../system-prompt/system-prompt-contributor.types";
import type { WorkflowRunTodoResponse } from "../../../workflow-run-operations/workflow-run-todo.types";

const makeCtx = (
  overrides: Partial<PromptAssemblyContext> = {},
): PromptAssemblyContext => ({
  runType: "workflow",
  workflowRunId: "run-abc",
  baseLayers: [],
  ...overrides,
});

const makeTodoResponse = (
  todos: Array<{
    title: string;
    status: "not-started" | "in-progress" | "completed";
  }>,
): WorkflowRunTodoResponse => ({
  workflow_run_id: "run-abc",
  scope_id: null,
  context_id: null,
  todo_list: todos.map((t, i) => ({
    id: `todo-${i}`,
    title: t.title,
    status: t.status,
    order_index: i,
    source_kind: "manual" as const,
    source_context_item_id: null,
    updated_at: new Date().toISOString(),
  })),
  summary: {
    total_count: todos.length,
    completed_count: todos.filter((t) => t.status === "completed").length,
    in_progress_count: todos.filter((t) => t.status === "in-progress").length,
    not_started_count: todos.filter((t) => t.status === "not-started").length,
  },
  source: { mode: "manual", has_drift: false, stale_count: 0 },
  _markdown: "",
});

describe("GetTodoListTool", () => {
  let tool: GetTodoListTool;
  let todoTools: Pick<TodoToolsHandler, "getTodoList">;
  let todoService: Pick<WorkflowRunTodoService, "getTodoList">;

  beforeEach(() => {
    todoTools = { getTodoList: vi.fn() };
    todoService = { getTodoList: vi.fn() };
    tool = new GetTodoListTool(
      todoTools as TodoToolsHandler,
      todoService as WorkflowRunTodoService,
    );
  });

  it("exposes the get_todo_list tool name", () => {
    expect(tool.getName()).toBe("get_todo_list");
  });

  it('has contributor name "todo" and priority 50', () => {
    expect(tool.name).toBe("todo");
    expect(tool.priority).toBe(50);
  });

  it("returns null for chat context", async () => {
    const result = await tool.contribute(
      makeCtx({ runType: "chat", workflowRunId: undefined }),
    );
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it("returns null when workflowRunId is absent", async () => {
    const result = await tool.contribute(makeCtx({ workflowRunId: undefined }));
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it("calls getTodoList with the workflowRunId from context", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    await tool.contribute(makeCtx({ workflowRunId: "run-xyz" }));
    expect(todoService.getTodoList).toHaveBeenCalledWith("run-xyz");
  });

  it('returns block with title "Todo List" and priority 50', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await tool.contribute(makeCtx());
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Todo List");
    expect(result!.priority).toBe(50);
  });

  it("includes manage_todo_list instructions and empty-state when list is empty", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await tool.contribute(makeCtx());
    expect(result!.content).toContain("manage_todo_list");
    expect(result!.content).toContain("No todos yet");
  });

  it("includes a formatted table with status icons when todos are present", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([
        { title: "Set up schema", status: "completed" },
        { title: "Implement service", status: "in-progress" },
        { title: "Write tests", status: "not-started" },
      ]),
    );
    const result = await tool.contribute(makeCtx());
    expect(result!.content).toContain("✅");
    expect(result!.content).toContain("🔄");
    expect(result!.content).toContain("⬜");
    expect(result!.content).toContain("Set up schema");
    expect(result!.content).toContain("Implement service");
    expect(result!.content).toContain("Write tests");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test --workspace=apps/api -- get-todo-list.tool`
Expected: FAIL — `GetTodoListTool` constructor takes one argument / has no `contribute`, `name`, or `priority`.

- [ ] **Step 3: Implement the changes**

Replace the full contents of `apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.ts` with:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from "@nexus/core";
import { GET_TODO_LIST_RUNTIME_CAPABILITY } from "../../../workflow-runtime/workflow-runtime-capability.contracts";
import { getTodoListBodySchema } from "@nexus/core";
import { TodoToolsHandler } from "../../handlers/todo-tools.handler";
import { WorkflowRunTodoService } from "../../../workflow-run-operations/workflow-run-todo.service";
import type {
  WorkflowRunTodoRecord,
  WorkflowRunTodoResponse,
} from "../../../workflow-run-operations/workflow-run-todo.types";
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
} from "../../../../system-prompt/system-prompt-contributor.types";

interface GetTodoListParams {
  workflow_run_id?: string;
}

const TODO_CONTRIBUTOR_PRIORITY = 50;

const TODO_INSTRUCTIONS = `\
Use the \`manage_todo_list\` tool to plan and track your work throughout this task. \
Keeping your todo list current lets the orchestrator monitor progress and surfaces \
your current step to other tools.

**When to use:**
- At the start of any multi-step task: add each step with status \`not-started\`
- When you begin a step: update it to \`in-progress\`
- When a step is done: update it to \`completed\`

**Rules:**
- Only one item may be \`in-progress\` at a time
- Pass the **full** list on every call — it replaces the previous state entirely
- Use the \`id\` field on existing items to update them in place

**Tool signature:** \`manage_todo_list({ todo_list: [{ id?, title, status }] })\`
Status values: \`"not-started"\` | \`"in-progress"\` | \`"completed"\``;

@Injectable()
export class GetTodoListTool
  implements
    IInternalToolHandler<GetTodoListParams, WorkflowRunTodoResponse>,
    ISystemPromptContributor
{
  readonly name = "todo";
  readonly priority = TODO_CONTRIBUTOR_PRIORITY;

  constructor(
    private readonly todoTools: TodoToolsHandler,
    private readonly todoService: WorkflowRunTodoService,
  ) {}

  getName(): string {
    return "get_todo_list";
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      ...GET_TODO_LIST_RUNTIME_CAPABILITY,
      inputSchema: getTodoListBodySchema,
    };
  }

  execute(
    context: InternalToolExecutionContext,
    params: GetTodoListParams,
  ): Promise<WorkflowRunTodoResponse> {
    return this.todoTools.getTodoList(params, context);
  }

  async contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null> {
    if (ctx.runType !== "workflow" || !ctx.workflowRunId) {
      return null;
    }

    const response = await this.todoService.getTodoList(ctx.workflowRunId);
    const stateSection = this.formatTodoList(response.todo_list);

    return {
      title: "Todo List",
      content: `${TODO_INSTRUCTIONS}\n\n${stateSection}`,
      priority: TODO_CONTRIBUTOR_PRIORITY,
    };
  }

  private formatTodoList(todos: WorkflowRunTodoRecord[]): string {
    if (todos.length === 0) {
      return "*(No todos yet. Call `manage_todo_list` to add items.)*";
    }
    const rows = todos.map((todo) => {
      const icon =
        todo.status === "completed"
          ? "✅"
          : todo.status === "in-progress"
            ? "🔄"
            : "⬜";
      return `| ${icon} | ${todo.title} |`;
    });
    return `| Status | Task |\n|--------|------|\n${rows.join("\n")}`;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test --workspace=apps/api -- get-todo-list.tool`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.ts \
        apps/api/src/workflow/workflow-internal-tools/tools/todo/get-todo-list.tool.spec.ts
git commit -m "feat(todo): make GetTodoListTool a system-prompt contributor"
```

---

### Task 3: `ToolPromptContributorBridge` concrete subclass + module wiring

**Files:**

- Create: `apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.ts`
- Create: `apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.spec.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`

**Interfaces:**

- Consumes:
  - `ToolCapabilityBridge` from `../../tool/tool-capability.bridge` (Task 1)
  - `INTERNAL_TOOL_HANDLER` from `../../tool/internal-tool.tokens` (existing `Symbol`)
  - `IInternalToolHandler` from `@nexus/core`
  - `ISystemPromptContributor` from `../../system-prompt/system-prompt-contributor.types`
  - `SystemPromptAssemblyService.register(contributor: ISystemPromptContributor): void` from `../../system-prompt/system-prompt-assembly.service`
  - `Inject`, `Injectable` from `@nestjs/common`
- Produces:
  - `ToolPromptContributorBridge` — exported class, `@Injectable()`, extends `ToolCapabilityBridge<ISystemPromptContributor>`
  - Registered as an internal (non-exported) provider in `WorkflowInternalToolsModule`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IInternalToolHandler } from "@nexus/core";
import { ToolPromptContributorBridge } from "./tool-prompt-contributor.bridge";
import type { SystemPromptAssemblyService } from "../../system-prompt/system-prompt-assembly.service";

const makePlainTool = (name: string): IInternalToolHandler =>
  ({
    getName: () => name,
    getDefinition: vi.fn(),
    execute: vi.fn(),
  }) as unknown as IInternalToolHandler;

const makeContributingTool = (name: string): IInternalToolHandler =>
  ({
    getName: () => name,
    getDefinition: vi.fn(),
    execute: vi.fn(),
    name: "todo",
    contribute: vi.fn(),
  }) as unknown as IInternalToolHandler;

describe("ToolPromptContributorBridge", () => {
  let assembly: Pick<SystemPromptAssemblyService, "register">;

  beforeEach(() => {
    assembly = { register: vi.fn() };
  });

  it("registers tools exposing a contribute function with the assembly service", () => {
    const contributing = makeContributingTool("get_todo_list");
    const bridge = new ToolPromptContributorBridge(
      [makePlainTool("plain"), contributing],
      assembly as SystemPromptAssemblyService,
    );
    bridge.onModuleInit();
    expect(assembly.register).toHaveBeenCalledTimes(1);
    expect(assembly.register).toHaveBeenCalledWith(contributing);
  });

  it("registers nothing when no tool exposes contribute", () => {
    const bridge = new ToolPromptContributorBridge(
      [makePlainTool("a"), makePlainTool("b")],
      assembly as SystemPromptAssemblyService,
    );
    bridge.onModuleInit();
    expect(assembly.register).not.toHaveBeenCalled();
  });

  it("handles an empty tool array without error", () => {
    const bridge = new ToolPromptContributorBridge(
      [],
      assembly as SystemPromptAssemblyService,
    );
    expect(() => bridge.onModuleInit()).not.toThrow();
    expect(assembly.register).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test --workspace=apps/api -- tool-prompt-contributor.bridge`
Expected: FAIL — `ToolPromptContributorBridge` does not exist yet.

- [ ] **Step 3: Implement the concrete bridge**

Create `apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.ts`:

```typescript
import { Inject, Injectable } from "@nestjs/common";
import type { IInternalToolHandler } from "@nexus/core";
import { INTERNAL_TOOL_HANDLER } from "../../tool/internal-tool.tokens";
import { ToolCapabilityBridge } from "../../tool/tool-capability.bridge";
import { SystemPromptAssemblyService } from "../../system-prompt/system-prompt-assembly.service";
import type { ISystemPromptContributor } from "../../system-prompt/system-prompt-contributor.types";

/**
 * Discovers tools that also implement `ISystemPromptContributor` and
 * registers them with the system-prompt assembly seam on init.
 */
@Injectable()
export class ToolPromptContributorBridge extends ToolCapabilityBridge<ISystemPromptContributor> {
  constructor(
    @Inject(INTERNAL_TOOL_HANDLER) tools: IInternalToolHandler[],
    private readonly assembly: SystemPromptAssemblyService,
  ) {
    super(tools);
  }

  protected supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & ISystemPromptContributor {
    return (
      typeof (tool as Partial<ISystemPromptContributor>).contribute ===
      "function"
    );
  }

  protected wire(tool: IInternalToolHandler & ISystemPromptContributor): void {
    this.assembly.register(tool);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test --workspace=apps/api -- tool-prompt-contributor.bridge`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Wire the bridge into `WorkflowInternalToolsModule`**

In `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`, add the import near the other local imports (after line 51, with the existing tool imports):

```typescript
import { ToolPromptContributorBridge } from "./tool-prompt-contributor.bridge";
```

Add `ToolPromptContributorBridge` to the `providers` array (it is internal — do **not** add it to `exports`). Add it as the last entry before the `INTERNAL_TOOL_HANDLER` factory provider object:

```typescript
    GetAttachmentTool,
    ListAttachmentsTool,
    ToolPromptContributorBridge,
    {
      provide: INTERNAL_TOOL_HANDLER,
      // ...unchanged
    },
```

- [ ] **Step 6: Run the bridge and tool tests to confirm wiring did not break them**

Run: `npm run test --workspace=apps/api -- tool-prompt-contributor.bridge get-todo-list.tool`
Expected: PASS — 11 tests passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.ts \
        apps/api/src/workflow/workflow-internal-tools/tool-prompt-contributor.bridge.spec.ts \
        apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts
git commit -m "feat(tool): wire ToolPromptContributorBridge to discover prompt-contributing tools"
```

---

### Task 4: Delete `TodoPromptContributor` and unwire it

**Files:**

- Delete: `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts`
- Delete: `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts`

**Interfaces:**

- Consumes: nothing new
- Produces: nothing — this task removes the superseded contributor now that `GetTodoListTool` + the bridge cover its behaviour

**Context:** Per the aggressive-hygiene rule, the old contributor is deleted outright (no deprecation). Its behaviour is now provided by Task 2 (`GetTodoListTool.contribute`) and Task 3 (the bridge). The module currently lists `TodoPromptContributor` in `providers` (line 50) and imports it at the top of the file.

- [ ] **Step 1: Delete the contributor files**

```bash
git rm apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts \
       apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts
```

- [ ] **Step 2: Remove the import and provider entry from the module**

In `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts`:

1. Delete the import line:

```typescript
import { TodoPromptContributor } from "./todo-prompt.contributor";
```

2. Delete the `TodoPromptContributor,` entry from the `providers` array (it is the last entry, line 50, before the closing `]`). Ensure the now-last provider entry (`WorkflowRunWorkspaceService`) is followed by a valid trailing comma and the array closes cleanly.

- [ ] **Step 3: Verify no dangling references remain**

Run: `npm run test --workspace=apps/api -- todo-prompt.contributor`
Expected: No test files found (both spec files are deleted).

Then search for any remaining reference:

Run: `grep -rn "TodoPromptContributor" apps/api/src`
Expected: No matches.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts
git commit -m "refactor(system-prompt): remove superseded TodoPromptContributor"
```

---

### Task 5: Full verification — build, regression tests, lint

**Files:** none (verification only)

**Context:** Confirms the refactor compiles under `nest build`, introduces no test regressions, and passes lint. The pre-existing `provider-credential.service.ts` build errors and the flaky `import-boundary.spec.ts` timeout noted in prior work are NOT caused by this change — if they appear, confirm they exist on the branch base before this plan's first commit and report them as pre-existing rather than fixing them here.

- [ ] **Step 1: Typecheck via the NestJS build**

Run: `npm run build:api`
Expected: Exits 0 with no type errors in any file touched by this plan (`tool-capability.bridge.ts`, `tool-prompt-contributor.bridge.ts`, `get-todo-list.tool.ts`, the two modules). If `provider-credential.service.ts` errors appear, verify with `git stash && npm run build:api` they pre-date this work, then `git stash pop`.

- [ ] **Step 2: Run the full api test suite**

Run: `npm run test:api`
Expected: All tests pass (except any pre-existing flaky/heap-variance failures unrelated to this change, e.g. `import-boundary.spec.ts` timeouts).

- [ ] **Step 3: Lint the api workspace**

Run: `npm run lint:api`
Expected: No new lint errors in the files touched by this plan. No `eslint-disable`/`@ts-ignore`/`@ts-nocheck` introduced.

- [ ] **Step 4: Final commit (only if lint auto-fixed formatting)**

```bash
git add -A
git commit -m "chore(system-prompt): lint/format pass for tool capability bridge" || echo "Nothing to commit"
```
