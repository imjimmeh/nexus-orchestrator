# Kanban Refinement Phase 4 — QA-Rejection Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phases 1–3 merged. Phase 2's triage (`metadata.refinement.track`) is the consumer of the area-rejection signal produced here.

**Goal:** Close the quality loop. Aggregate QA rejections by code area (target-file path prefix), expose that aggregate via a read tool, inject "known failure patterns for this area" into refinement context, and let a high area-rejection rate bump an item's triage track upward.

**Architecture:** A new aggregation service reads existing rejection data — `executionConfig.rejectionFeedback.failedDeliverables[].affected_files` + `failure_type` — across a project's work items and groups counts by path prefix. A read MCP tool (`kanban.rejection_hotspots`) exposes the aggregate. The triage tool (Phase 2) consumes hotspot data to raise the track for items touching hot areas. The refinement codebase-analysis prompt gains a `known_failure_patterns` input. No new persistence table in v1 — aggregation is computed on read from existing work-item data.

**Tech Stack:** NestJS, TypeScript, Zod, Vitest. New code in `apps/kanban/src/orchestration` (aggregation) and `apps/kanban/src/mcp/tools/read`.

---

## File Structure

**Create:**

- `apps/kanban/src/orchestration/rejection-hotspots.service.ts` (+ `.spec.ts`) — area aggregation
- `apps/kanban/src/orchestration/rejection-hotspots.helper.ts` (+ `.spec.ts`) — pure grouping logic
- `apps/kanban/src/mcp/tools/read/rejection-hotspots.tool.ts` (+ `.spec.ts`) — read tool

**Modify:**

- `apps/kanban/src/mcp/tools/read/index.ts` + provider module — register the read tool
- `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts` — bump track on hot areas (extends Phase 2)
- `seed/workflows/work-item-refinement-default.workflow.yaml` — thread `known_failure_patterns` into codebase-analysis
- `seed/workflows/prompts/work-item-refinement-default/codebase-analysis.md` — render the patterns

---

## Part 1 — Pure aggregation helper

### Task 1: Hotspot grouping helper — failing test

**Files:**

- Create: `apps/kanban/src/orchestration/rejection-hotspots.helper.ts` spec

- [ ] **Step 1: Write the failing test**

`apps/kanban/src/orchestration/rejection-hotspots.helper.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  aggregateRejectionHotspots,
  normalizeArea,
} from "./rejection-hotspots.helper";

describe("normalizeArea", () => {
  it("reduces a file path to its first N path components", () => {
    expect(normalizeArea("apps/api/src/foo/bar.service.ts", 3)).toBe(
      "apps/api/src/*",
    );
    expect(normalizeArea("README.md", 3)).toBe("README.md/*");
  });
});

describe("aggregateRejectionHotspots", () => {
  it("counts failures per area and per failure type", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: [
            {
              failure_type: "test_failure",
              affected_files: ["apps/api/src/a/x.ts"],
            },
            {
              failure_type: "incorrect",
              affected_files: ["apps/api/src/a/y.ts"],
            },
          ],
        },
        {
          failedDeliverables: [
            {
              failure_type: "test_failure",
              affected_files: ["apps/api/src/a/z.ts"],
            },
            {
              failure_type: "incomplete",
              affected_files: ["apps/web/src/b/w.tsx"],
            },
          ],
        },
      ],
      3,
    );

    const apiArea = result.find((h) => h.area === "apps/api/src/*");
    expect(apiArea?.count).toBe(3);
    expect(apiArea?.failureTypes.test_failure).toBe(2);
    expect(apiArea?.failureTypes.incorrect).toBe(1);

    const webArea = result.find((h) => h.area === "apps/web/src/*");
    expect(webArea?.count).toBe(1);
  });

  it("sorts hottest area first", () => {
    const result = aggregateRejectionHotspots(
      [
        {
          failedDeliverables: [
            {
              failure_type: "incorrect",
              affected_files: ["a/b/c/1.ts", "a/b/c/2.ts"],
            },
          ],
        },
        {
          failedDeliverables: [
            { failure_type: "incorrect", affected_files: ["d/e/f/3.ts"] },
          ],
        },
      ],
      3,
    );
    expect(result[0].area).toBe("a/b/c/*");
  });

  it("ignores deliverables without affected_files", () => {
    const result = aggregateRejectionHotspots(
      [{ failedDeliverables: [{ failure_type: "not_implemented" }] }],
      3,
    );
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm run test --workspace=apps/kanban -- rejection-hotspots.helper.spec.ts`).

### Task 2: Hotspot helper — implementation

**Files:**

- Create: `apps/kanban/src/orchestration/rejection-hotspots.helper.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface FailedDeliverableLike {
  failure_type: string;
  affected_files?: string[];
}

export interface RejectionFeedbackLike {
  failedDeliverables?: FailedDeliverableLike[];
  failed_deliverables?: FailedDeliverableLike[];
}

export interface RejectionHotspot {
  area: string;
  count: number;
  failureTypes: Record<string, number>;
}

export function normalizeArea(file: string, depth: number): string {
  const parts = file.split("/").filter((part) => part && part !== ".");
  return `${parts.slice(0, depth).join("/")}/*`;
}

export function aggregateRejectionHotspots(
  feedbacks: RejectionFeedbackLike[],
  depth: number,
): RejectionHotspot[] {
  const byArea = new Map<string, RejectionHotspot>();

  for (const feedback of feedbacks) {
    const deliverables =
      feedback.failedDeliverables ?? feedback.failed_deliverables ?? [];
    for (const deliverable of deliverables) {
      for (const file of deliverable.affected_files ?? []) {
        const area = normalizeArea(file, depth);
        const hotspot = byArea.get(area) ?? {
          area,
          count: 0,
          failureTypes: {},
        };
        hotspot.count += 1;
        hotspot.failureTypes[deliverable.failure_type] =
          (hotspot.failureTypes[deliverable.failure_type] ?? 0) + 1;
        byArea.set(area, hotspot);
      }
    }
  }

  return [...byArea.values()].sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/orchestration/rejection-hotspots.helper.ts apps/kanban/src/orchestration/rejection-hotspots.helper.spec.ts
git commit -m "feat(kanban): add pure rejection-hotspot aggregation helper"
```

---

## Part 2 — Aggregation service

### Task 3: Hotspots service — test + implementation

Reads work items for a project, pulls `executionConfig.rejectionFeedback`, runs the helper.

**Files:**

- Create: `apps/kanban/src/orchestration/rejection-hotspots.service.spec.ts`
- Create: `apps/kanban/src/orchestration/rejection-hotspots.service.ts`

- [ ] **Step 5: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejectionHotspotsService } from "./rejection-hotspots.service";
import type { WorkItemService } from "../work-item/work-item.service";

describe("RejectionHotspotsService", () => {
  let service: RejectionHotspotsService;

  beforeEach(() => {
    const workItems = {
      listWorkItems: vi.fn(() =>
        Promise.resolve([
          {
            id: "wi-1",
            execution_config: {
              rejectionFeedback: {
                failedDeliverables: [
                  {
                    failure_type: "test_failure",
                    affected_files: ["apps/api/src/a/x.ts"],
                  },
                ],
              },
            },
          },
          { id: "wi-2", execution_config: null },
        ]),
      ),
    } as unknown as WorkItemService;
    service = new RejectionHotspotsService(workItems);
  });

  it("aggregates hotspots for a project", async () => {
    const result = await service.getHotspots("project-1", { depth: 3 });
    expect(result[0]).toMatchObject({ area: "apps/api/src/*", count: 1 });
  });

  it("returns the area's rejection count for a candidate file set", async () => {
    const score = await service.areaRejectionScore("project-1", [
      "apps/api/src/a/new.ts",
    ]);
    expect(score).toBe(1);
  });
});
```

- [ ] **Step 6: Run it — expect FAIL.**

- [ ] **Step 7: Implement the service**

```typescript
import { Injectable } from "@nestjs/common";
import { WorkItemService } from "../work-item/work-item.service";
import {
  aggregateRejectionHotspots,
  normalizeArea,
  type RejectionFeedbackLike,
  type RejectionHotspot,
} from "./rejection-hotspots.helper";

const DEFAULT_AREA_DEPTH = 3;

@Injectable()
export class RejectionHotspotsService {
  constructor(private readonly workItems: WorkItemService) {}

  async getHotspots(
    projectId: string,
    options?: { depth?: number },
  ): Promise<RejectionHotspot[]> {
    const depth = options?.depth ?? DEFAULT_AREA_DEPTH;
    const items = await this.workItems.listWorkItems(projectId);
    const feedbacks: RejectionFeedbackLike[] = [];
    for (const item of items) {
      const config = item.execution_config as Record<string, unknown> | null;
      const feedback = config?.["rejectionFeedback"];
      if (feedback && typeof feedback === "object") {
        feedbacks.push(feedback as RejectionFeedbackLike);
      }
    }
    return aggregateRejectionHotspots(feedbacks, depth);
  }

  /** Total rejection count across the areas the given files belong to. */
  async areaRejectionScore(
    projectId: string,
    files: string[],
    options?: { depth?: number },
  ): Promise<number> {
    const depth = options?.depth ?? DEFAULT_AREA_DEPTH;
    const hotspots = await this.getHotspots(projectId, { depth });
    const areas = new Set(files.map((file) => normalizeArea(file, depth)));
    return hotspots
      .filter((hotspot) => areas.has(hotspot.area))
      .reduce((sum, hotspot) => sum + hotspot.count, 0);
  }
}
```

- [ ] **Step 8: Register the service** in the owning module (the module that provides `OrchestrationService`; it already imports `WorkItemModule`/`WorkItemService`). Add `RejectionHotspotsService` to `providers` and `exports`. Build to confirm DI:

Run: `npm run build --workspace=apps/kanban`

- [ ] **Step 9: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/orchestration/rejection-hotspots.service.ts apps/kanban/src/orchestration/rejection-hotspots.service.spec.ts apps/kanban/src/orchestration
git commit -m "feat(kanban): aggregate QA rejections into per-area hotspots"
```

---

## Part 3 — Read tool

### Task 4: `kanban.rejection_hotspots` read tool — test + implementation

**Files:**

- Create: `apps/kanban/src/mcp/tools/read/rejection-hotspots.tool.spec.ts`
- Create: `apps/kanban/src/mcp/tools/read/rejection-hotspots.tool.ts`

- [ ] **Step 10: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { RejectionHotspotsTool } from "./rejection-hotspots.tool";
import type { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";

describe("RejectionHotspotsTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  const svc = {
    getHotspots: vi.fn(() =>
      Promise.resolve([
        { area: "apps/api/src/*", count: 3, failureTypes: { test_failure: 3 } },
      ]),
    ),
  } as unknown as RejectionHotspotsService;
  const tool = new RejectionHotspotsTool(svc);

  it("has the read tool name", () => {
    expect(tool.getName()).toBe("kanban.rejection_hotspots");
  });

  it("returns aggregated hotspots", async () => {
    const result = await tool.execute(context, { project_id: "project-1" });
    expect(result.hotspots[0]).toMatchObject({
      area: "apps/api/src/*",
      count: 3,
    });
  });
});
```

- [ ] **Step 11: Run it — expect FAIL.** Inspect an existing read tool first for the exact contextual-project schema/name:

Run: `git grep -ln "ContextualProjectIdSchema" -- apps/kanban/src/mcp/tools/read | head -1`

- [ ] **Step 12: Implement the tool** (mirror an existing read tool's structure; use `ContextualProjectIdSchema`):

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";
import type { RejectionHotspot } from "../../../orchestration/rejection-hotspots.helper";

const RejectionHotspotsSchema = ContextualProjectIdSchema.extend({
  depth: z.number().int().min(1).max(6).optional(),
});

interface RejectionHotspotsParams {
  project_id?: string | null;
  depth?: number;
}

@Injectable()
export class RejectionHotspotsTool implements IInternalToolHandler<
  RejectionHotspotsParams,
  { hotspots: RejectionHotspot[] }
> {
  constructor(private readonly hotspots: RejectionHotspotsService) {}

  getName(): string {
    return "kanban.rejection_hotspots";
  }

  getDefinition() {
    return {
      name: "kanban.rejection_hotspots",
      description:
        "List QA-rejection hotspots for a project, grouped by code area (file path prefix).",
      inputSchema: RejectionHotspotsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: RejectionHotspotsParams,
  ): Promise<{ hotspots: RejectionHotspot[] }> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const hotspots = await this.hotspots.getHotspots(projectId, {
      depth: params.depth,
    });
    return { hotspots };
  }
}
```

- [ ] **Step 13: Register** the read tool (`apps/kanban/src/mcp/tools/read/index.ts` + provider module). Build, run the test — expect PASS. Commit:

```bash
git add apps/kanban/src/mcp/tools/read apps/kanban/src/mcp
git commit -m "feat(kanban): add rejection-hotspots read tool"
```

---

## Part 4 — Feed the loop back into refinement

### Task 5: Triage bumps track for hot areas

Extends the Phase 2 `WorkItemTriageTool`. An item touching a high-rejection area should not get the `trivial` fast-path.

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.spec.ts`

- [ ] **Step 14: Add the failing test**

Add to the triage tool spec — inject the hotspots service and assert a hot area upgrades a would-be-trivial item to at least `standard`:

```typescript
it("upgrades a trivial item to standard when it touches a rejection hotspot", async () => {
  const workItems = {
    listWorkItems: vi.fn(() =>
      Promise.resolve([
        {
          id: "wi-1",
          description: "AC-1 tiny tweak",
          metadata: null,
          execution_config: {
            implementationPlan: {
              milestones: [
                {
                  name: "m",
                  tasks: [
                    { id: "1.1", target_files: ["apps/api/src/hot/x.ts"] },
                  ],
                },
              ],
            },
          },
        },
      ]),
    ),
  } as unknown as WorkItemService;
  const hotspots = {
    areaRejectionScore: vi.fn(() => Promise.resolve(5)),
  } as unknown as RejectionHotspotsService;
  const t = new WorkItemTriageTool(workItems, hotspots);

  const result = await t.execute(context, {
    project_id: "project-1",
    workItemId: "wi-1",
  });
  expect(result.track).not.toBe("trivial");
});
```

- [ ] **Step 15: Run it — expect FAIL** (constructor arity + no upgrade logic).

- [ ] **Step 16: Extend the tool**

Add `RejectionHotspotsService` as a second constructor arg. After computing the deterministic `score`, read the candidate's planned `target_files` (the item may not have a plan yet at triage time — fall back to an empty set) and call `areaRejectionScore`. If the score exceeds a threshold and the track is `trivial`, raise it to `standard`:

```typescript
const HOTSPOT_UPGRADE_THRESHOLD = 3;
// ...inside execute, after `const score = scoreTriage(...)`:
const planFiles = extractTargetFiles(
  (item.execution_config as Record<string, unknown> | null)?.[
    "implementationPlan"
  ],
);
const areaScore =
  planFiles.size > 0
    ? await this.hotspots.areaRejectionScore(projectId, [...planFiles])
    : 0;
if (areaScore >= HOTSPOT_UPGRADE_THRESHOLD && score.track === "trivial") {
  return { ...score, track: "standard" };
}
return score;
```

Import `extractTargetFiles` from `../../../dispatch/plan-contention.helper` (the Phase 3 helper — reuse, do not duplicate).

- [ ] **Step 17: Update DI registration** so the triage tool receives `RejectionHotspotsService` (provider module). Run the triage spec — expect PASS. Commit:

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.spec.ts apps/kanban/src/mcp
git commit -m "feat(kanban): bump triage track for work touching rejection hotspots"
```

### Task 6: Inject known-failure patterns into codebase analysis

**Files:**

- Modify: `seed/workflows/work-item-refinement-default.workflow.yaml`
- Modify: `seed/workflows/prompts/work-item-refinement-default/codebase-analysis.md`

- [ ] **Step 18: Add a hotspots-read job and thread it as an input**

Add a light read job before `codebase_analysis` (gated like the others on track, so trivial items still skip the heavy step but the read is cheap and can stay unconditional):

```yaml
- id: load_rejection_hotspots
  type: mcp_tool_call
  tier: light
  depends_on:
    - finalize_triage
  inputs:
    server_id: kanban-mcp
    tool_name: kanban.rejection_hotspots
    params:
      project_id: "{{ trigger.scopeId }}"
    policy:
      allowed_servers: [kanban-mcp]
      allowed_tools: [kanban.*]
```

Then add `known_failure_patterns` to the `codebase_analysis` execution job's `inputs` and `depends_on`:

```yaml
depends_on:
  - finalize_triage
  - load_rejection_hotspots
inputs:
  agent_profile: architect-agent
  known_failure_patterns: "{{ jobs.load_rejection_hotspots.output.hotspots }}"
```

- [ ] **Step 19: Render the patterns in the prompt**

Append to `seed/workflows/prompts/work-item-refinement-default/codebase-analysis.md`:

```markdown
## Known Failure Patterns In This Area

{{#if known_failure_patterns}}
Past QA rejections clustered in these areas (area — count — failure types):

{{#each known_failure_patterns}}

- `{{this.area}}` — {{this.count}} rejection(s) — {{json this.failureTypes}}
  {{/each}}

If this work item touches any of these areas, call them out in the Risk Flags
section and recommend extra verification for the listed failure types.
{{/if}}
```

> Confirm the `{{#each}}` / `{{json}}` helpers exist in this workflow's Handlebars dialect (other prompts iterate arrays — `git grep -n "{{#each" seed/workflows/prompts`). If `json` is unavailable, render `{{this.count}}` only and drop the `failureTypes` map.

- [ ] **Step 20: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS.

- [ ] **Step 21: Commit**

```bash
git add seed/workflows/work-item-refinement-default.workflow.yaml seed/workflows/prompts/work-item-refinement-default/codebase-analysis.md
git commit -m "feat(kanban): inject rejection-hotspot context into refinement"
```

---

## Phase 4 Verification

- [ ] **Step 22: Full kanban test + lint + build**

Run: `npm run test:kanban && npm run lint:kanban && npm run build:kanban`
Expected: all green.

- [ ] **Step 23: Live smoke (post-deploy)**

- Reject a few items with `affected_files` in one module; call `kanban.rejection_hotspots` and confirm that module is the top area.
- Refine a new trivial-looking item touching that module; confirm triage upgrades it off the `trivial` track and the codebase-analysis output cites the known failure patterns.

## Notes / follow-ups

- v1 computes hotspots on read from live work-item data (no new table). If projects accumulate enough history that read-time aggregation gets slow, add a materialized `qa_rejection_metrics` projection updated on QA-decision events (the design's Phase 4 open question) and have `RejectionHotspotsService` read from it.
- Prometheus counters (`nexus_qa_*`) for dashboards are optional and deferred — the read tool + in-refinement injection deliver the closed loop without them.
- Triage upgrade uses the candidate's _planned_ `target_files`, which exist only if a prior refinement produced a plan; first-time items get no upgrade. That is acceptable — the loop strengthens on items that have been around the block.
