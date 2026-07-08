# Restart Orchestration Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kanban.restart_orchestration` MCP tool so the CEO agent can restart a completed or stalled orchestration cycle without requiring a manual REST API call.

**Architecture:** A new Zod schema and NestJS `@Injectable` handler class follow the exact same pattern as `OrchestrationCompleteTool`. The handler fetches existing goals from the DB when the caller omits them, then delegates to the already-working `OrchestrationService.start()`. Auto-discovery via the mutation barrel means no module file edits are needed. The CEO workflow YAML gains one new permission entry, and `decide.md` documents when to use it.

**Tech Stack:** NestJS, Zod, Vitest, TypeScript, YAML

---

## File Map

| Action | File |
|--------|------|
| Modify | `apps/kanban/src/mcp/tools/shared/schemas.ts` |
| Create | `apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.ts` |
| Create | `apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.spec.ts` |
| Modify | `apps/kanban/src/mcp/tools/mutation/index.ts` |
| Modify | `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` |
| Modify | `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` |

---

## Task 1: Add the Zod input schema

**Files:**
- Modify: `apps/kanban/src/mcp/tools/shared/schemas.ts`

- [ ] **Step 1: Append `RestartOrchestrationSchema` at the bottom of schemas.ts**

Add after the last export in the file (after `ListWorkItemsSchema`):

```typescript
export const RestartOrchestrationSchema = z.object({
  project_id: z.string().min(1),
  goals: z.string().min(1).optional(),
  orchestration_mode: z
    .enum(["supervised", "autonomous", "notifications_only"])
    .optional(),
  requested_by: z.string().optional(),
});
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit --project apps/kanban/tsconfig.json
```

Expected: no output (clean compile).

- [ ] **Step 3: Commit**

```bash
git add apps/kanban/src/mcp/tools/shared/schemas.ts
git commit -m "feat(kanban-mcp): add RestartOrchestrationSchema for restart tool"
```

---

## Task 2: Write the failing test (TDD — Red phase)

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.spec.ts`

- [ ] **Step 1: Create the test file**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { RestartOrchestrationSchema } from "../shared/schemas";
import { OrchestrationRestartTool } from "./orchestration-restart.tool";

interface MockOrchestration {
  get: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
}

describe("OrchestrationRestartTool", () => {
  const context = {} as InternalToolExecutionContext;

  const fakeProjectOrchestration = {
    id: "project-1",
    project_id: "project-1",
    goals: "Existing goals from DB",
    orchestrationMode: "supervised",
    currentWorkflowRunId: "run-new-1",
    status: "orchestrating",
  };

  function createMockOrchestration(): MockOrchestration {
    return {
      get: vi.fn().mockResolvedValue(fakeProjectOrchestration),
      start: vi.fn().mockResolvedValue(fakeProjectOrchestration),
    };
  }

  function createTool(overrides?: { orchestration?: MockOrchestration }): {
    tool: OrchestrationRestartTool;
    orchestration: MockOrchestration;
  } {
    const orchestration = overrides?.orchestration ?? createMockOrchestration();
    const tool = new OrchestrationRestartTool(
      orchestration as unknown as OrchestrationService,
    );
    return { tool, orchestration };
  }

  // ── Name & definition ──────────────────────────────────────────────

  it("returns the correct tool name from getName and getDefinition", () => {
    const { tool } = createTool();

    expect(tool.getName()).toBe("kanban.restart_orchestration");
    expect(tool.getDefinition().name).toBe("kanban.restart_orchestration");
  });

  it("has tier restriction 2, runner_local transport, runner owner", () => {
    const { tool } = createTool();
    const def = tool.getDefinition();

    expect(def.tierRestriction).toBe(2);
    expect(def.transport).toBe("runner_local");
    expect(def.runtimeOwner).toBe("runner");
  });

  it("exposes RestartOrchestrationSchema as inputSchema", () => {
    const { tool } = createTool();
    expect(tool.getDefinition().inputSchema).toBe(RestartOrchestrationSchema);
  });

  // ── execute — goals provided ───────────────────────────────────────

  it("calls start with provided goals and skips get when goals supplied", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-1",
      goals: "New goals from caller",
    });

    expect(orchestration.get).not.toHaveBeenCalled();
    expect(orchestration.start).toHaveBeenCalledTimes(1);
    expect(orchestration.start).toHaveBeenCalledWith("project-1", {
      goals: "New goals from caller",
      orchestrationMode: undefined,
      requestedBy: undefined,
    });
    expect(result).toEqual({
      ok: true,
      project_id: "project-1",
      linked_run_id: "run-new-1",
    });
  });

  // ── execute — goals omitted, falls back to DB ──────────────────────

  it("fetches existing goals via get when goals not supplied", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    const result = await tool.execute(context, {
      project_id: "project-1",
    });

    expect(orchestration.get).toHaveBeenCalledTimes(1);
    expect(orchestration.get).toHaveBeenCalledWith("project-1");
    expect(orchestration.start).toHaveBeenCalledWith("project-1", {
      goals: "Existing goals from DB",
      orchestrationMode: undefined,
      requestedBy: undefined,
    });
    expect(result).toEqual({
      ok: true,
      project_id: "project-1",
      linked_run_id: "run-new-1",
    });
  });

  // ── execute — optional fields forwarded ───────────────────────────

  it("forwards orchestration_mode and requested_by when provided", async () => {
    const orchestration = createMockOrchestration();
    const { tool } = createTool({ orchestration });

    await tool.execute(context, {
      project_id: "project-1",
      goals: "New goals",
      orchestration_mode: "autonomous",
      requested_by: "ceo-agent",
    });

    expect(orchestration.start).toHaveBeenCalledWith("project-1", {
      goals: "New goals",
      orchestrationMode: "autonomous",
      requestedBy: "ceo-agent",
    });
  });

  // ── Schema validation ──────────────────────────────────────────────

  it("schema parses minimal valid input (project_id only)", () => {
    expect(RestartOrchestrationSchema.parse({ project_id: "project-1" })).toEqual({
      project_id: "project-1",
    });
  });

  it("schema parses full valid input", () => {
    expect(
      RestartOrchestrationSchema.parse({
        project_id: "project-1",
        goals: "Ship feature X",
        orchestration_mode: "autonomous",
        requested_by: "ceo-agent",
      }),
    ).toEqual({
      project_id: "project-1",
      goals: "Ship feature X",
      orchestration_mode: "autonomous",
      requested_by: "ceo-agent",
    });
  });

  it("schema rejects empty project_id", () => {
    expect(() =>
      RestartOrchestrationSchema.parse({ project_id: "" }),
    ).toThrow();
  });

  it("schema rejects empty goals string when goals is provided", () => {
    expect(() =>
      RestartOrchestrationSchema.parse({ project_id: "p1", goals: "" }),
    ).toThrow();
  });

  it("schema rejects invalid orchestration_mode", () => {
    expect(() =>
      RestartOrchestrationSchema.parse({
        project_id: "p1",
        orchestration_mode: "turbo",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (file doesn't exist yet)**

```bash
npm run test:kanban -- --reporter=verbose orchestration-restart.tool.spec.ts
```

Expected: `Cannot find module './orchestration-restart.tool'` or similar import error. The test suite must fail at this stage.

---

## Task 3: Implement the tool handler (TDD — Green phase)

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.ts`

- [ ] **Step 1: Create the handler file**

```typescript
import { Injectable } from "@nestjs/common";
import type { IInternalToolHandler, InternalToolExecutionContext } from "@nexus/core";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { RestartOrchestrationSchema } from "../shared/schemas";

@Injectable()
export class OrchestrationRestartTool
  implements IInternalToolHandler<z.infer<typeof RestartOrchestrationSchema>, unknown>
{
  constructor(private readonly orchestration: OrchestrationService) {}

  getName(): string {
    return "kanban.restart_orchestration";
  }

  getDefinition() {
    return {
      name: "kanban.restart_orchestration",
      description:
        "Restart the orchestration cycle for a project. Use when the cycle has completed or stalled and a new cycle is required. Fetches existing project goals if goals are not supplied.",
      inputSchema: RestartOrchestrationSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: z.infer<typeof RestartOrchestrationSchema>,
  ): Promise<unknown> {
    const goals =
      params.goals ??
      (await this.orchestration.get(params.project_id)).goals;

    const result = await this.orchestration.start(params.project_id, {
      goals,
      orchestrationMode: params.orchestration_mode,
      requestedBy: params.requested_by,
    });

    return {
      ok: true,
      project_id: params.project_id,
      linked_run_id: result.currentWorkflowRunId,
    };
  }
}
```

- [ ] **Step 2: Run the tests to confirm they all pass**

```bash
npm run test:kanban -- --reporter=verbose orchestration-restart.tool.spec.ts
```

Expected: all tests pass, no failures.

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit --project apps/kanban/tsconfig.json
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.ts \
        apps/kanban/src/mcp/tools/mutation/orchestration-restart.tool.spec.ts
git commit -m "feat(kanban-mcp): implement OrchestrationRestartTool"
```

---

## Task 4: Register the tool via the barrel export

**Files:**
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

The `KanbanMcpModule` auto-discovers all exports from this barrel via `Object.values(MutationTools)`. Adding one line here is all that's needed — no module file edits.

- [ ] **Step 1: Add the export after `orchestration-complete.tool`**

In `apps/kanban/src/mcp/tools/mutation/index.ts`, add one line after `export * from "./orchestration-complete.tool";`:

```typescript
export * from "./orchestration-restart.tool";
```

The result of that section should look like:

```typescript
export * from "./orchestration-complete.tool";
export * from "./orchestration-restart.tool";
export * from "./write-probe-result.tool";
```

- [ ] **Step 2: Run the full kanban test suite to confirm nothing regressed**

```bash
npm run test:kanban
```

Expected: `Test Files  130 passed (130)` (or higher — no failures).

- [ ] **Step 3: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban-mcp): register OrchestrationRestartTool in mutation barrel"
```

---

## Task 5: Grant the CEO workflow permission to call the tool

**Files:**
- Modify: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

- [ ] **Step 1: Add the tool to the CEO's permission rules**

In `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`, inside the `permissions.tool_policy.rules` block, add a new entry directly after the `kanban.orchestration_complete` entry (currently around line 68):

```yaml
      - effect: allow
        tool: kanban.orchestration_complete
      - effect: allow
        tool: kanban.restart_orchestration
```

The surrounding context should look like:

```yaml
      - effect: allow
        tool: kanban.complete_orchestration_cycle_decision
      - effect: allow
        tool: kanban.orchestration_complete
      - effect: allow
        tool: kanban.restart_orchestration
      - effect: allow
        tool: kanban.reset_orchestration_intents
```

- [ ] **Step 2: Run the seed contract tests to confirm no regressions**

```bash
npm run test:kanban -- --reporter=verbose apps/kanban/src/seeds/workflows.seed.contract.spec.ts
```

Expected: all tests in the file pass. (Tests in `.worktrees/` paths are pre-existing failures from other branches — ignore them.)

- [ ] **Step 3: Commit**

```bash
git add seed/workflows/project-orchestration-cycle-ceo.workflow.yaml
git commit -m "feat(kanban-mcp): grant CEO workflow permission to kanban.restart_orchestration"
```

---

## Task 6: Document usage in the CEO decide.md prompt

**Files:**
- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md`

The CEO agent needs to know when to use `kanban.restart_orchestration` vs `kanban.orchestration_complete`.

- [ ] **Step 1: Add a RESTART ORCHESTRATION section**

In `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md`, locate the **STRATEGY AND LIFECYCLE RULES** section near the bottom (search for `## STRATEGY AND LIFECYCLE RULES`). Insert the following block immediately before `- If strategy has changed`:

```markdown
### Restart vs Complete

Use `kanban.restart_orchestration` (not a new cycle request) when:

- The orchestration cycle terminated (`status: completed`) but new work has since appeared or goals have changed and a fresh cycle should begin immediately.
- The cycle is stalled with no linked run and the CEO cannot self-recover through existing lifecycle tools.

Do NOT use `kanban.restart_orchestration` when:
- The board has work items that need dispatching — use `kanban.work_item_transition_status` instead.
- The cycle is `paused` — use the existing resume path.
- The project is genuinely finished — use `kanban.orchestration_complete`.

When calling `kanban.restart_orchestration`:
- Pass `project_id` (the scope id for this project).
- `goals` is optional: omit it to continue with the project's current goals; supply it only if the goals have materially changed.
- `orchestration_mode` is optional: omit to keep the project's current mode.

```json
kanban.restart_orchestration({
  "project_id": "<scope_id>",
  "requested_by": "ceo-cycle-restart"
})
```

```

- [ ] **Step 2: Run the seed contract tests again**

```bash
npm run test:kanban -- --reporter=verbose apps/kanban/src/seeds/workflows.seed.contract.spec.ts
```

Expected: all kanban-path tests pass.

- [ ] **Step 3: Run the full kanban suite for a final green gate**

```bash
npm run test:kanban
```

Expected: all 130+ test files pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md
git commit -m "docs(orchestration): document kanban.restart_orchestration usage in CEO decide prompt"
```

---

## Task 7: Push and close tracking issues

- [ ] **Step 1: Push**

```bash
git pull --rebase
git push
git status
```

Expected: `Your branch is up to date with 'origin/main'.`

- [ ] **Step 2: Close the beads issue**

```bash
bd close kanban-z390 --reason="kanban.restart_orchestration tool implemented"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ No in-agent restart tool → `kanban.restart_orchestration` tool added (Tasks 2–4)
- ✅ Auto-wake re-suppression after restart → not applicable here; this plan adds the missing tool, prior fix (commit 10feb34c) handles the discovery guard
- ✅ CEO workflow can call the tool → permission added (Task 5)
- ✅ CEO agent knows when to use it → decide.md updated (Task 6)
- ✅ Goals default to existing goals → handler fetches via `orchestration.get()` when omitted (Task 3)

**Placeholder scan:** No TBDs. All code blocks are complete and runnable.

**Type consistency:**
- `RestartOrchestrationSchema` defined in Task 1, imported identically in Tasks 2 and 3.
- `OrchestrationRestartTool` class name used consistently across handler, test, and barrel.
- `result.currentWorkflowRunId` matches the `ProjectOrchestration` shape returned by `OrchestrationService.start()` (confirmed from `orchestration-state-lifecycle.service.ts:toProjectOrchestration()`).
