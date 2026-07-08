# Kanban Refinement Phase 1 — Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two confirmed silent-failure gaps — split decompositions that silently drop a parent acceptance criterion, and umbrella parents that stay `blocked` forever after all their children finish.

**Architecture:** Two additions, both following existing Kanban idioms. (A) A deterministic MCP mutation tool `kanban.work_item_validate_split_coverage` that fails the split job when the children's AC assignments don't exactly cover the parent's ACs — modelled on `work-item-subtask-validate-blueprint.tool.ts`. (B) A mutation tool `kanban.work_item_resolve_umbrella_parent` plus a new seed workflow that triggers on a child reaching `done` and auto-transitions the umbrella parent to `done` once all siblings are done — modelled on the existing status-changed seed workflows.

**Tech Stack:** NestJS, TypeScript, Zod, Vitest, Handlebars-templated seed workflow YAML.

---

## File Structure

**Create:**

- `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts` — coverage validator tool
- `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts` — its unit test
- `apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.ts` — umbrella resolver tool
- `apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.spec.ts` — its unit test
- `seed/workflows/work-item-umbrella-resolution-default.workflow.yaml` — child-done → resolve-parent workflow

**Modify:**

- `apps/kanban/src/mcp/tools/mutation/index.ts` — barrel-export the two new tools
- the MCP tools provider module (wherever `WorkItemSubtaskValidateBlueprintTool` is listed in `providers`) — register both new tools
- `seed/workflows/work-item-split-default.workflow.yaml` — extend split output contract + add the coverage-validation gating job

---

## Feature A — Split AC-Coverage Validation

### Task A1: Coverage validator tool — failing test

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { WorkItemValidateSplitCoverageTool } from "./work-item-validate-split-coverage.tool";

describe("WorkItemValidateSplitCoverageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  const tool = new WorkItemValidateSplitCoverageTool();

  it("exposes the kanban coverage-validation tool name", () => {
    expect(tool.getName()).toBe("kanban.work_item_validate_split_coverage");
    expect(tool.getDefinition().name).toBe(
      "kanban.work_item_validate_split_coverage",
    );
  });

  it("passes when children cover every parent AC exactly once", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "parent-1",
      parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
      child_ac_assignments: [
        { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
        { child_ref: "child-b", ac_ids: ["AC-3"] },
      ],
    });
    expect(result).toEqual({ ok: true, coveredCount: 3 });
  });

  it("fails when a parent AC is dropped", async () => {
    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
        ],
      }),
    ).rejects.toThrow(/uncovered parent acceptance criteria: AC-3/i);
  });

  it("fails when an AC is assigned to more than one child", async () => {
    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
          { child_ref: "child-b", ac_ids: ["AC-2"] },
        ],
      }),
    ).rejects.toThrow(/duplicated across children: AC-2/i);
  });

  it("fails when a child references an unknown AC", async () => {
    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-9"] },
        ],
      }),
    ).rejects.toThrow(/unknown acceptance criteria not on the parent: AC-9/i);
  });

  it("rejects the BadRequestException type for violations", async () => {
    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1"],
        child_ac_assignments: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-validate-split-coverage.tool.spec.ts`
Expected: FAIL — `Cannot find module './work-item-validate-split-coverage.tool'`.

### Task A2: Coverage validator tool — implementation

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const ChildAcAssignmentSchema = z.object({
  child_ref: z.string().optional(),
  ac_ids: z.array(z.string().min(1)),
});

const WorkItemValidateSplitCoverageSchema = ContextualWorkItemIdSchema.extend({
  parent_ac_ids: z.array(z.string().min(1)),
  child_ac_assignments: z.array(ChildAcAssignmentSchema),
});

interface ChildAcAssignment {
  child_ref?: string;
  ac_ids: string[];
}

interface WorkItemValidateSplitCoverageParams {
  project_id?: string | null;
  workItemId: string;
  parent_ac_ids: string[];
  child_ac_assignments: ChildAcAssignment[];
}

@Injectable()
export class WorkItemValidateSplitCoverageTool implements IInternalToolHandler<
  WorkItemValidateSplitCoverageParams,
  { ok: true; coveredCount: number }
> {
  getName(): string {
    return "kanban.work_item_validate_split_coverage";
  }

  getDefinition() {
    return {
      name: "kanban.work_item_validate_split_coverage",
      description:
        "Validate that split children collectively cover every parent acceptance criterion exactly once.",
      inputSchema: WorkItemValidateSplitCoverageSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  execute(
    context: InternalToolExecutionContext,
    params: WorkItemValidateSplitCoverageParams,
  ): Promise<{ ok: true; coveredCount: number }> {
    resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const parentSet = new Set(params.parent_ac_ids);
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    const unknown = new Set<string>();

    for (const assignment of params.child_ac_assignments) {
      for (const acId of assignment.ac_ids) {
        if (!parentSet.has(acId)) {
          unknown.add(acId);
          continue;
        }
        if (seen.has(acId)) {
          duplicated.add(acId);
        }
        seen.add(acId);
      }
    }

    const uncovered = params.parent_ac_ids.filter((acId) => !seen.has(acId));

    const violations: string[] = [];
    if (uncovered.length > 0) {
      violations.push(
        `uncovered parent acceptance criteria: ${uncovered.join(", ")}`,
      );
    }
    if (duplicated.size > 0) {
      violations.push(
        `acceptance criteria duplicated across children: ${[...duplicated].join(", ")}`,
      );
    }
    if (unknown.size > 0) {
      violations.push(
        `unknown acceptance criteria not on the parent: ${[...unknown].join(", ")}`,
      );
    }

    if (violations.length > 0) {
      throw new BadRequestException(
        `Split coverage validation failed for ${params.workItemId}: ${violations.join("; ")}`,
      );
    }

    return Promise.resolve({ ok: true, coveredCount: parentSet.size });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-validate-split-coverage.tool.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts
git commit -m "feat(kanban): add split AC-coverage validation tool"
```

### Task A3: Register the coverage tool

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`
- Modify: the MCP tools provider module that lists `WorkItemSubtaskValidateBlueprintTool` in its `providers`

- [ ] **Step 6: Add the barrel export**

Append to `apps/kanban/src/mcp/tools/mutation/index.ts`:

```typescript
export * from "./work-item-validate-split-coverage.tool";
```

- [ ] **Step 7: Find the provider registration**

Run: `git grep -n "WorkItemSubtaskValidateBlueprintTool" -- "apps/kanban/src/**/*.module.ts"`
Expected: one module file listing it in a `providers` array (and likely in an exported tool-collection array).

- [ ] **Step 8: Register the new tool**

In the module file from Step 7, add `WorkItemValidateSplitCoverageTool` everywhere `WorkItemSubtaskValidateBlueprintTool` appears (import, `providers`, and any tool-list array used for MCP registration). Match the existing formatting exactly.

- [ ] **Step 9: Build + verify registration**

Run: `npm run build --workspace=apps/kanban`
Expected: builds clean (no missing-provider / DI errors).

- [ ] **Step 10: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/index.ts apps/kanban/src/mcp
git commit -m "chore(kanban): register split AC-coverage validation tool"
```

### Task A4: Wire coverage validation into the split workflow

**Files:**

- Modify: `seed/workflows/work-item-split-default.workflow.yaml`

- [ ] **Step 11: Extend the split job output contract**

In the `split_work_item` job, add the two new required outputs (keep existing required outputs `split_outcome`, `child_ids`, `child_files`):

```yaml
output_contract:
  required:
    - split_outcome
    - child_ids
    - child_files
    - parent_ac_ids
    - child_ac_assignments
max_retries: 1
retry_prompt: |
  You have NOT produced a complete split. Call set_job_output exactly once with a native object containing: split_outcome, child_ids (array), child_files (array), parent_ac_ids (array of the parent's acceptance-criterion identifiers, e.g. ["AC-1","AC-2"]), and child_ac_assignments (array of objects, one per child: { "child_ref": "<child slug or id>", "ac_ids": ["AC-1", ...] }). Every parent AC must appear in exactly one child's ac_ids.
```

- [ ] **Step 12: Update the split prompt to require the coverage data**

In `seed/workflows/prompts/work-item-split-default/split.md`, append to the output instructions:

```markdown
## Coverage output (required)

In your `set_job_output` call you MUST also return:

- `parent_ac_ids`: the list of the parent spec's acceptance-criterion identifiers (e.g. `["AC-1","AC-2","AC-3"]`).
- `child_ac_assignments`: an array with one entry per child — `{ "child_ref": "<child slug>", "ac_ids": ["AC-1", ...] }`.

Every parent AC must appear in exactly one child's `ac_ids`. Do not duplicate an AC across children and do not drop any. This is validated automatically; a mismatch fails the split.
```

- [ ] **Step 13: Add the gating validation job**

Insert this job after `split_work_item` and before `mark_parent_as_umbrella` (so a coverage failure aborts the split before the parent is marked/blocked). Match the indentation of the existing jobs:

```yaml
- id: validate_split_coverage
  type: mcp_tool_call
  tier: light
  depends_on:
    - split_work_item
  condition: "{{#if (eq jobs.split_work_item.output.split_outcome 'split_completed')}}true{{else}}false{{/if}}"
  inputs:
    server_id: kanban-mcp
    tool_name: kanban.work_item_validate_split_coverage
    params:
      project_id: "{{ trigger.scopeId }}"
      workItemId: "{{ trigger.contextId }}"
      parent_ac_ids: "{{ jobs.split_work_item.output.parent_ac_ids }}"
      child_ac_assignments: "{{ jobs.split_work_item.output.child_ac_assignments }}"
    policy:
      allowed_servers:
        - kanban-mcp
      allowed_tools:
        - kanban.*
```

- [ ] **Step 14: Make the parent-marking jobs depend on coverage passing**

In `mark_parent_as_umbrella`, add `validate_split_coverage` to its `depends_on` list so it only runs after coverage passes (a thrown `BadRequestException` fails `validate_split_coverage` and blocks the dependents):

```yaml
depends_on:
  - split_work_item
  - validate_split_coverage
```

- [ ] **Step 15: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS — no schema or reference errors in `work-item-split-default.workflow.yaml`.

- [ ] **Step 16: Commit**

```bash
git add seed/workflows/work-item-split-default.workflow.yaml seed/workflows/prompts/work-item-split-default/split.md
git commit -m "feat(kanban): gate work item split on AC-coverage validation"
```

---

## Feature B — Umbrella-Parent Auto-Resolution

### Task B1: Umbrella resolver tool — failing test

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.spec.ts`

- [ ] **Step 17: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemResolveUmbrellaParentTool } from "./work-item-resolve-umbrella-parent.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

type Item = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

describe("WorkItemResolveUmbrellaParentTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let items: Item[];
  let updateStatus: ReturnType<typeof vi.fn>;
  let tool: WorkItemResolveUmbrellaParentTool;

  beforeEach(() => {
    updateStatus = vi.fn((_p: string, id: string, status: string) => {
      const item = items.find((i) => i.id === id);
      if (item) item.status = status;
      return Promise.resolve({ id, status });
    });
    const workItems = {
      listWorkItems: vi.fn(() => Promise.resolve(items)),
      updateStatus,
    } as unknown as WorkItemService;
    tool = new WorkItemResolveUmbrellaParentTool(workItems);
  });

  it("exposes the resolve-umbrella-parent tool name", () => {
    items = [];
    expect(tool.getName()).toBe("kanban.work_item_resolve_umbrella_parent");
  });

  it("no-ops when the completed child has no parent", async () => {
    items = [{ id: "solo", status: "done", metadata: null }];
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "solo",
    });
    expect(result).toEqual({ resolved: false, reason: "no_parent" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("does not resolve while a sibling is still open", async () => {
    items = [
      {
        id: "parent",
        status: "blocked",
        metadata: { split: { proposedChildIds: ["c1", "c2"] } },
      },
      { id: "c1", status: "done", metadata: { split: { parentId: "parent" } } },
      {
        id: "c2",
        status: "in-progress",
        metadata: { split: { parentId: "parent" } },
      },
    ];
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c1",
    });
    expect(result).toEqual({ resolved: false, reason: "children_pending" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("transitions the parent to done when all children are done", async () => {
    items = [
      {
        id: "parent",
        status: "blocked",
        metadata: { split: { proposedChildIds: ["c1", "c2"] } },
      },
      { id: "c1", status: "done", metadata: { split: { parentId: "parent" } } },
      { id: "c2", status: "done", metadata: { split: { parentId: "parent" } } },
    ];
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c2",
    });
    expect(result).toEqual({ resolved: true, parentId: "parent" });
    expect(updateStatus).toHaveBeenCalledWith("project-1", "parent", "done");
  });

  it("does not re-resolve a parent that is already done", async () => {
    items = [
      {
        id: "parent",
        status: "done",
        metadata: { split: { proposedChildIds: ["c1"] } },
      },
      { id: "c1", status: "done", metadata: { split: { parentId: "parent" } } },
    ];
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "c1",
    });
    expect(result).toEqual({ resolved: false, reason: "already_resolved" });
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 18: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-resolve-umbrella-parent.tool.spec.ts`
Expected: FAIL — module not found.

### Task B2: Umbrella resolver tool — implementation

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.ts`

- [ ] **Step 19: Write minimal implementation**

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";

const UMBRELLA_RESOLVED_STATUS = "done";

interface ResolveUmbrellaParentParams {
  project_id?: string | null;
  workItemId: string;
}

type ResolveResult =
  | { resolved: false; reason: string }
  | { resolved: true; parentId: string };

@Injectable()
export class WorkItemResolveUmbrellaParentTool implements IInternalToolHandler<
  ResolveUmbrellaParentParams,
  ResolveResult
> {
  constructor(private readonly workItems: WorkItemService) {}

  getName(): string {
    return "kanban.work_item_resolve_umbrella_parent";
  }

  getDefinition() {
    return {
      name: "kanban.work_item_resolve_umbrella_parent",
      description:
        "If the given completed child's umbrella parent has all children done, transition the parent to done.",
      inputSchema: ContextualWorkItemIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: ResolveUmbrellaParentParams,
  ): Promise<ResolveResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const all = await this.workItems.listWorkItems(projectId);
    const byId = new Map(all.map((item) => [item.id, item]));

    const child = byId.get(params.workItemId);
    const parentId = this.readSplitString(child?.metadata, "parentId");
    if (!parentId) {
      return { resolved: false, reason: "no_parent" };
    }

    const parent = byId.get(parentId);
    if (!parent) {
      return { resolved: false, reason: "parent_not_found" };
    }
    if (parent.status === UMBRELLA_RESOLVED_STATUS) {
      return { resolved: false, reason: "already_resolved" };
    }

    const childIds = this.readSplitStringArray(
      parent.metadata,
      "proposedChildIds",
    );
    if (childIds.length === 0) {
      return { resolved: false, reason: "no_children" };
    }

    const allDone = childIds.every(
      (id) => byId.get(id)?.status === UMBRELLA_RESOLVED_STATUS,
    );
    if (!allDone) {
      return { resolved: false, reason: "children_pending" };
    }

    await this.workItems.updateStatus(
      projectId,
      parentId,
      UMBRELLA_RESOLVED_STATUS,
    );
    return { resolved: true, parentId };
  }

  private readSplit(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | undefined {
    const split = metadata?.["split"];
    return split && typeof split === "object"
      ? (split as Record<string, unknown>)
      : undefined;
  }

  private readSplitString(
    metadata: Record<string, unknown> | null | undefined,
    key: string,
  ): string | undefined {
    const value = this.readSplit(metadata)?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private readSplitStringArray(
    metadata: Record<string, unknown> | null | undefined,
    key: string,
  ): string[] {
    const value = this.readSplit(metadata)?.[key];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }
}
```

> **Note:** `updateStatus` is `updateStatus(project_id, workItemId, status)` and uses actor `"system"` (see `work-item.service.ts`). It emits the lifecycle event and runs transition gates, so the parent's own status-changed event fires normally.

- [ ] **Step 20: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-resolve-umbrella-parent.tool.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 21: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-resolve-umbrella-parent.tool.spec.ts
git commit -m "feat(kanban): add umbrella-parent auto-resolution tool"
```

### Task B3: Register the resolver tool

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`
- Modify: the same provider module as Task A3

- [ ] **Step 22: Add the barrel export**

Append to `apps/kanban/src/mcp/tools/mutation/index.ts`:

```typescript
export * from "./work-item-resolve-umbrella-parent.tool";
```

- [ ] **Step 23: Register the provider**

In the module from Task A3 Step 7, add `WorkItemResolveUmbrellaParentTool` alongside the other tools (import, `providers`, tool-list array). It takes `WorkItemService` via constructor DI — confirm `WorkItemService` is importable in that module's scope (it is exported by `WorkItemModule`; the MCP tools module already depends on Kanban services).

- [ ] **Step 24: Build + verify DI**

Run: `npm run build --workspace=apps/kanban && npm run test --workspace=apps/kanban -- work-item-resolve-umbrella-parent.tool.spec.ts`
Expected: builds clean; test still passes.

- [ ] **Step 25: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/index.ts apps/kanban/src/mcp
git commit -m "chore(kanban): register umbrella-parent auto-resolution tool"
```

### Task B4: Umbrella-resolution seed workflow

**Files:**

- Create: `seed/workflows/work-item-umbrella-resolution-default.workflow.yaml`

- [ ] **Step 26: Write the workflow**

Mirror the header/shape of `work-item-split-default.workflow.yaml`. The trigger fires when a child completes (`status == done` and the resource carries `metadata.split.parentId`):

```yaml
id: work_item_umbrella_resolution_default
name: Work Item Umbrella Resolution (Default)
version: 1
description: >-
  When a split child reaches done, resolve its umbrella parent to done once all
  sibling children are complete.

trigger:
  type: event
  event: kanban.work_item.status_changed.v1
  condition: "{{#if (and (eq trigger.status 'done') trigger.resource trigger.resource.metadata.split.parentId)}}true{{else}}false{{/if}}"

jobs:
  - id: resolve_umbrella_parent
    type: mcp_tool_call
    tier: light
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.work_item_resolve_umbrella_parent
      params:
        project_id: "{{ trigger.scopeId }}"
        workItemId: "{{ trigger.contextId }}"
      policy:
        allowed_servers:
          - kanban-mcp
        allowed_tools:
          - kanban.*
```

> Match the exact top-level field names (`id`/`name`/`version`/`trigger`/`jobs`) used by the other `seed/workflows/*.workflow.yaml` files — copy the header block from `work-item-split-default.workflow.yaml` and adapt. Verify the schema with Step 27.

- [ ] **Step 27: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS — the new workflow parses and its trigger/tool references resolve.

- [ ] **Step 28: Commit**

```bash
git add seed/workflows/work-item-umbrella-resolution-default.workflow.yaml
git commit -m "feat(kanban): auto-resolve umbrella parents when all children complete"
```

---

## Phase 1 Verification

- [ ] **Step 29: Full kanban test + lint**

Run: `npm run test:kanban && npm run lint:kanban`
Expected: all tests pass; no lint findings.

- [ ] **Step 30: Build the workspace chain**

Run: `npm run build --workspace=packages/kanban-contracts && npm run build:kanban`
Expected: clean build.

## Notes / follow-ups

- **Live verification** (post-deploy, per project memory's "live re-verify pending" pattern): split a `large` item, confirm a dropped-AC split fails the job; complete all children of an umbrella and confirm the parent flips to `done`.
- The umbrella resolves to `done` (locked decision). If a future need arises for a human confirmation step on umbrella closure, route it through the Phase 2 mode-aware gate rather than changing this workflow.
