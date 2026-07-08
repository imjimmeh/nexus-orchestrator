# Todo System Prompt Contributor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the todo tool self-documenting — inject usage instructions and the agent's live todo list into every workflow system prompt via the `ISystemPromptContributor` seam.

**Architecture:** A new `TodoPromptContributor` service implements `ISystemPromptContributor` and `OnModuleInit`. On init it self-registers with `SystemPromptAssemblyService`. On each prompt assembly it returns a single block containing (a) static usage instructions and (b) the live todo list fetched from `WorkflowRunTodoService`. Returns `null` for chat contexts and for workflow contexts that lack a `workflowRunId`.

**Tech Stack:** NestJS (Injectable, OnModuleInit), TypeScript, Vitest.

## Global Constraints

- `apps/api/src` must remain Kanban-neutral — no kanban, work-item, or project-domain identifiers.
- Never suppress lint (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`). Fix findings in code.
- Strictly typed — no `any`.
- Contributor priority is `50` — below the default of `100` so the todo block appends after other contributors.
- Contributor name is the string `'todo'` — must match exactly.
- Test file must use Vitest (`describe`, `it`, `expect`, `vi`, `beforeEach`).
- Run tests with: `npm run test --workspace=apps/api -- --testPathPattern=todo-prompt.contributor`

---

### Task 1: TodoPromptContributor

**Files:**

- Create: `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts`
- Create: `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts`

**Interfaces:**

- Consumes:
  - `ISystemPromptContributor`, `PromptAssemblyContext`, `PromptContributionBlock` from `../../system-prompt/system-prompt-contributor.types`
  - `SystemPromptAssemblyService` from `../../system-prompt/system-prompt-assembly.service`
  - `WorkflowRunTodoService.getTodoList(workflowRunId: string): Promise<WorkflowRunTodoResponse>` from `./workflow-run-todo.service`
  - `WorkflowRunTodoRecord` from `./workflow-run-todo.types` — fields used: `title: string`, `status: 'not-started' | 'in-progress' | 'completed'`
- Produces:
  - `TodoPromptContributor` — exported class, `@Injectable()`, implements `ISystemPromptContributor` & `OnModuleInit`
  - `contribute(ctx: PromptAssemblyContext): Promise<PromptContributionBlock | null>` — returns `null` for chat/missing-runId; otherwise a block with `title: 'Todo List'`, `priority: 50`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TodoPromptContributor } from "./todo-prompt.contributor";
import type { WorkflowRunTodoService } from "./workflow-run-todo.service";
import type { SystemPromptAssemblyService } from "../../system-prompt/system-prompt-assembly.service";
import type { PromptAssemblyContext } from "../../system-prompt/system-prompt-contributor.types";
import type { WorkflowRunTodoResponse } from "./workflow-run-todo.types";

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

describe("TodoPromptContributor", () => {
  let contributor: TodoPromptContributor;
  let todoService: Pick<WorkflowRunTodoService, "getTodoList">;
  let assemblyService: Pick<SystemPromptAssemblyService, "register">;

  beforeEach(() => {
    todoService = { getTodoList: vi.fn() };
    assemblyService = { register: vi.fn() };
    contributor = new TodoPromptContributor(
      todoService as WorkflowRunTodoService,
      assemblyService as SystemPromptAssemblyService,
    );
  });

  it('has name "todo" and priority 50', () => {
    expect(contributor.name).toBe("todo");
    expect(contributor.priority).toBe(50);
  });

  it("registers itself with the assembly service on module init", () => {
    contributor.onModuleInit();
    expect(assemblyService.register).toHaveBeenCalledWith(contributor);
  });

  it("returns null for chat context", async () => {
    const result = await contributor.contribute(
      makeCtx({ runType: "chat", workflowRunId: undefined }),
    );
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it("returns null when workflowRunId is absent", async () => {
    const result = await contributor.contribute(
      makeCtx({ workflowRunId: undefined }),
    );
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it("calls getTodoList with the workflowRunId from context", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    await contributor.contribute(makeCtx({ workflowRunId: "run-xyz" }));
    expect(todoService.getTodoList).toHaveBeenCalledWith("run-xyz");
  });

  it('returns block with title "Todo List" and priority 50', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Todo List");
    expect(result!.priority).toBe(50);
  });

  it("block content includes manage_todo_list instructions when list is empty", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result!.content).toContain("manage_todo_list");
    expect(result!.content).toContain("No todos yet");
  });

  it("block content includes formatted table with status icons when todos are present", async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([
        { title: "Set up schema", status: "completed" },
        { title: "Implement service", status: "in-progress" },
        { title: "Write tests", status: "not-started" },
      ]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result!.content).toContain("✅");
    expect(result!.content).toContain("🔄");
    expect(result!.content).toContain("⬜");
    expect(result!.content).toContain("Set up schema");
    expect(result!.content).toContain("Implement service");
    expect(result!.content).toContain("Write tests");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
npm run test --workspace=apps/api -- --testPathPattern=todo-prompt.contributor
```

Expected: FAIL — `TodoPromptContributor` does not exist yet.

- [ ] **Step 3: Implement `TodoPromptContributor`**

Create `apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts`:

```typescript
import { Injectable, OnModuleInit } from "@nestjs/common";
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
} from "../../system-prompt/system-prompt-contributor.types";
import { SystemPromptAssemblyService } from "../../system-prompt/system-prompt-assembly.service";
import { WorkflowRunTodoService } from "./workflow-run-todo.service";
import type { WorkflowRunTodoRecord } from "./workflow-run-todo.types";

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
export class TodoPromptContributor
  implements ISystemPromptContributor, OnModuleInit
{
  readonly name = "todo";
  readonly priority = TODO_CONTRIBUTOR_PRIORITY;

  constructor(
    private readonly todoService: WorkflowRunTodoService,
    private readonly assemblyService: SystemPromptAssemblyService,
  ) {}

  onModuleInit(): void {
    this.assemblyService.register(this);
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

- [ ] **Step 4: Run the tests again to confirm they pass**

```
npm run test --workspace=apps/api -- --testPathPattern=todo-prompt.contributor
```

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Wire `TodoPromptContributor` into `WorkflowRunOperationsModule`**

In `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts`, add the import and include it in `providers`:

```typescript
import { TodoPromptContributor } from "./todo-prompt.contributor";
```

Add `TodoPromptContributor` to the `providers` array (no export needed — it self-registers):

```typescript
providers: [
  QuestionIdleContainerListener,
  QuestionIdleTrackerService,
  UserQuestionAwaitService,
  WorkflowGraphReadModelService,
  WorkflowRunAwaitingInputListener,
  WorkflowRunBrowserSessionCleanupListener,
  WorkflowRunAutonomyDiagnosticsService,
  WorkflowRunHeartbeatService,
  WorkflowRunReconciliationService,
  WorkflowRunSteeringService,
  WorkflowRunTodoService,
  WorkflowRunWorkspaceService,
  TodoPromptContributor,   // ← add this line
],
```

`TodoPromptContributor` does **not** need to be added to `exports` — it self-registers with `SystemPromptAssemblyService` via `onModuleInit()` and is not consumed directly by other modules.

- [ ] **Step 6: Typecheck**

`SystemPromptAssemblyService` is provided by `SystemPromptAssemblyModule`, which is `@Global()` — `WorkflowRunOperationsModule` does **not** need to import it explicitly. NestJS resolves it globally.

Run the NestJS build (not `tsc` directly — the project uses `nest build` for TypeORM reflection):

```
npm run build:api
```

Expected: Exits 0, no type errors.

- [ ] **Step 7: Run the full api test suite to verify no regressions**

```
npm run test:api
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```
git add apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.ts \
        apps/api/src/workflow/workflow-run-operations/todo-prompt.contributor.spec.ts \
        apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts
git commit -m "feat(system-prompt): inject todo instructions and live state into workflow agent prompts"
```
