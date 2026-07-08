# Kanban Refinement Phase 2 — Adaptive Depth & Mode-Aware Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 1 merged.

**Goal:** Make refinement effort proportional to the work. A hybrid triage step assigns each item a track (`trivial | standard | complex`); downstream heavy steps run only when the track warrants them. Activate the architect's `risk_level` so high-risk plan exits are gated by orchestration mode (HITL in `supervised`/`notifications_only`, direct in `autonomous`).

**Architecture:** Three new MCP tools plus refinement-workflow rewiring. `kanban.work_item_triage` computes a deterministic track + an `ambiguous` flag. A conditional LLM job refines only ambiguous cases. `kanban.work_item_finalize_triage` picks the final track and persists it, giving downstream jobs one field to gate on. `kanban.work_item_gated_transition` replaces the plain `transition_to_todo` call, queuing the exit for approval when `risk_level == high` and mode `!= autonomous`.

**Tech Stack:** NestJS, TypeScript, Zod, Vitest, Handlebars seed YAML, existing `OrchestrationService` + `orchestration-action-requests.service.ts`.

---

## File Structure

**Create:**

- `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts` (+ `.spec.ts`)
- `apps/kanban/src/mcp/tools/mutation/work-item-finalize-triage.tool.ts` (+ `.spec.ts`)
- `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts` (+ `.spec.ts`)
- `apps/kanban/src/work-item/work-item-triage.helper.ts` (+ `.spec.ts`) — pure deterministic scoring (testable in isolation, SRP)
- `seed/workflows/prompts/work-item-refinement-default/triage-classify.md`

**Modify:**

- `apps/kanban/src/mcp/tools/mutation/index.ts` + provider module — register the three tools
- `seed/workflows/work-item-refinement-default.workflow.yaml` — insert triage jobs, gate existing jobs, swap the exit transition

---

## Part 1 — Deterministic triage scoring helper

Keeping the scoring pure and separate from the tool makes the thresholds unit-testable and is the single source of truth for "ambiguous".

### Task 1: Triage helper — failing test

**Files:**

- Create: `apps/kanban/src/work-item/work-item-triage.helper.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { scoreTriage } from "./work-item-triage.helper";

describe("scoreTriage", () => {
  it("classifies a tiny, few-AC item as trivial", () => {
    const r = scoreTriage({ description: "Fix typo in label.", acCount: 1 });
    expect(r.track).toBe("trivial");
    expect(r.ambiguous).toBe(false);
  });

  it("classifies a large, many-AC item as complex", () => {
    const r = scoreTriage({ description: "x".repeat(3000), acCount: 9 });
    expect(r.track).toBe("complex");
    expect(r.ambiguous).toBe(false);
  });

  it("classifies a mid-size item as standard", () => {
    const r = scoreTriage({ description: "x".repeat(1200), acCount: 5 });
    expect(r.track).toBe("standard");
  });

  it("flags ambiguous when signals straddle a boundary", () => {
    // few ACs (suggests trivial) but a long description (suggests >= standard)
    const r = scoreTriage({ description: "x".repeat(900), acCount: 2 });
    expect(r.ambiguous).toBe(true);
  });

  it("treats missing description as zero length", () => {
    const r = scoreTriage({ description: null, acCount: 0 });
    expect(r.track).toBe("trivial");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-triage.helper.spec.ts`
Expected: FAIL — module not found.

### Task 2: Triage helper — implementation

**Files:**

- Create: `apps/kanban/src/work-item/work-item-triage.helper.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
export type TriageTrack = "trivial" | "standard" | "complex";

export interface TriageSignals {
  description: string | null | undefined;
  acCount: number;
}

export interface TriageScore {
  track: TriageTrack;
  ambiguous: boolean;
  acCount: number;
  descriptionLength: number;
}

const TRIVIAL_MAX_AC = 2;
const TRIVIAL_MAX_DESC = 600;
const COMPLEX_MIN_AC = 8;
const COMPLEX_MIN_DESC = 2500;
// Ambiguity margin: signals within this band of a threshold, or signals that
// disagree on the track, force the LLM tie-breaker.
const AMBIGUITY_DESC_MARGIN = 300;

export function scoreTriage(signals: TriageSignals): TriageScore {
  const descriptionLength = signals.description?.length ?? 0;
  const acCount = signals.acCount;

  const acTrack: TriageTrack =
    acCount <= TRIVIAL_MAX_AC
      ? "trivial"
      : acCount >= COMPLEX_MIN_AC
        ? "complex"
        : "standard";
  const descTrack: TriageTrack =
    descriptionLength < TRIVIAL_MAX_DESC
      ? "trivial"
      : descriptionLength > COMPLEX_MIN_DESC
        ? "complex"
        : "standard";

  // Final track = the more demanding of the two signals.
  const order: TriageTrack[] = ["trivial", "standard", "complex"];
  const track =
    order.indexOf(acTrack) >= order.indexOf(descTrack) ? acTrack : descTrack;

  const signalsDisagree = acTrack !== descTrack;
  const nearDescBoundary =
    Math.abs(descriptionLength - TRIVIAL_MAX_DESC) <= AMBIGUITY_DESC_MARGIN ||
    Math.abs(descriptionLength - COMPLEX_MIN_DESC) <= AMBIGUITY_DESC_MARGIN;
  const ambiguous = signalsDisagree || nearDescBoundary;

  return { track, ambiguous, acCount, descriptionLength };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-triage.helper.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/work-item/work-item-triage.helper.ts apps/kanban/src/work-item/work-item-triage.helper.spec.ts
git commit -m "feat(kanban): add deterministic refinement triage scoring helper"
```

---

## Part 2 — Triage MCP tools

### Task 3: `kanban.work_item_triage` tool — test + implementation

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.spec.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts`

- [ ] **Step 6: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemTriageTool } from "./work-item-triage.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

describe("WorkItemTriageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let tool: WorkItemTriageTool;

  beforeEach(() => {
    const workItems = {
      listWorkItems: vi.fn(() =>
        Promise.resolve([
          {
            id: "wi-1",
            description: "Acceptance: AC-1 do thing. AC-2 do other.",
            metadata: null,
          },
        ]),
      ),
    } as unknown as WorkItemService;
    tool = new WorkItemTriageTool(workItems);
  });

  it("has the triage tool name", () => {
    expect(tool.getName()).toBe("kanban.work_item_triage");
  });

  it("returns a track and ambiguity flag derived from the work item", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
    });
    expect(result.track).toBe("trivial");
    expect(result).toHaveProperty("ambiguous");
    expect(result.acCount).toBe(2);
  });
});
```

- [ ] **Step 7: Run it — expect FAIL** (`npm run test --workspace=apps/kanban -- work-item-triage.tool.spec.ts`).

- [ ] **Step 8: Implement the tool**

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";
import {
  scoreTriage,
  type TriageScore,
} from "../../../work-item/work-item-triage.helper";

const AC_PATTERN = /\bAC-?\d+\b/gi;

interface TriageParams {
  project_id?: string | null;
  workItemId: string;
}

@Injectable()
export class WorkItemTriageTool implements IInternalToolHandler<
  TriageParams,
  TriageScore
> {
  constructor(private readonly workItems: WorkItemService) {}

  getName(): string {
    return "kanban.work_item_triage";
  }

  getDefinition() {
    return {
      name: "kanban.work_item_triage",
      description:
        "Deterministically classify a work item's refinement track (trivial|standard|complex) and flag ambiguity.",
      inputSchema: ContextualWorkItemIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: TriageParams,
  ): Promise<TriageScore> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const all = await this.workItems.listWorkItems(projectId);
    const item = all.find((entry) => entry.id === params.workItemId);
    if (!item) {
      throw new NotFoundException(
        `Work item ${params.workItemId} not found for project ${projectId}`,
      );
    }
    const description = item.description ?? "";
    const acCount = new Set(
      (description.match(AC_PATTERN) ?? []).map((m) => m.toUpperCase()),
    ).size;
    return scoreTriage({ description, acCount });
  }
}
```

- [ ] **Step 9: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-triage.tool.spec.ts
git commit -m "feat(kanban): add deterministic work item triage tool"
```

### Task 4: `kanban.work_item_finalize_triage` tool — test + implementation

This tool picks the final track (LLM result when ambiguous, else deterministic) and persists it to `metadata.refinement.track` so downstream jobs gate on one stable field.

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-finalize-triage.tool.spec.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/work-item-finalize-triage.tool.ts`

- [ ] **Step 10: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemFinalizeTriageTool } from "./work-item-finalize-triage.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

describe("WorkItemFinalizeTriageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let patchMetadata: ReturnType<typeof vi.fn>;
  let tool: WorkItemFinalizeTriageTool;

  beforeEach(() => {
    patchMetadata = vi.fn(() => Promise.resolve({ id: "wi-1" }));
    const workItems = { patchMetadata } as unknown as WorkItemService;
    tool = new WorkItemFinalizeTriageTool(workItems);
  });

  it("uses the deterministic track when not ambiguous", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "standard",
      ambiguous: false,
    });
    expect(result.track).toBe("standard");
    expect(patchMetadata).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({ refinement: { track: "standard" } }),
    );
  });

  it("uses the classified track when ambiguous and provided", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "trivial",
      ambiguous: true,
      classified_track: "complex",
    });
    expect(result.track).toBe("complex");
  });

  it("falls back to the deterministic track when ambiguous but no classification arrived", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "standard",
      ambiguous: true,
    });
    expect(result.track).toBe("standard");
  });
});
```

- [ ] **Step 11: Run it — expect FAIL.**

- [ ] **Step 12: Confirm the persistence method name**

Run: `git grep -n "patchMetadata\|patch_metadata" -- apps/kanban/src/work-item/work-item.service.ts`
Expected: the method `WorkItemService` exposes to merge metadata (used by `kanban.work_item_patch_metadata`). If the public method is named differently (e.g. `patchWorkItemMetadata`), use that exact name in the implementation and test instead of `patchMetadata`.

- [ ] **Step 13: Implement the tool**

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";

const TrackSchema = z.enum(["trivial", "standard", "complex"]);

const FinalizeTriageSchema = ContextualWorkItemIdSchema.extend({
  deterministic_track: TrackSchema,
  ambiguous: z.boolean(),
  classified_track: TrackSchema.optional(),
});

interface FinalizeTriageParams {
  project_id?: string | null;
  workItemId: string;
  deterministic_track: "trivial" | "standard" | "complex";
  ambiguous: boolean;
  classified_track?: "trivial" | "standard" | "complex";
}

@Injectable()
export class WorkItemFinalizeTriageTool implements IInternalToolHandler<
  FinalizeTriageParams,
  { track: "trivial" | "standard" | "complex" }
> {
  constructor(private readonly workItems: WorkItemService) {}

  getName(): string {
    return "kanban.work_item_finalize_triage";
  }

  getDefinition() {
    return {
      name: "kanban.work_item_finalize_triage",
      description:
        "Persist the final refinement track (classified track when ambiguous, else deterministic).",
      inputSchema: FinalizeTriageSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: FinalizeTriageParams,
  ): Promise<{ track: "trivial" | "standard" | "complex" }> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const track =
      params.ambiguous && params.classified_track
        ? params.classified_track
        : params.deterministic_track;

    // Use the same public metadata-merge method the patch-metadata tool uses.
    await this.workItems.patchMetadata(projectId, params.workItemId, {
      refinement: { track },
    });
    return { track };
  }
}
```

- [ ] **Step 14: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-finalize-triage.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-finalize-triage.tool.spec.ts
git commit -m "feat(kanban): add finalize-triage tool persisting refinement track"
```

---

## Part 3 — Mode-aware gated transition

### Task 5: Verify approval-execution wiring (investigation gate)

The exit gate queues a transition via `orchestration-action-requests.service.ts` when supervised + high risk. The research did **not** confirm that an _approved_ action request is actually executed (its transition performed). This must be settled before building the gate.

- [ ] **Step 15: Trace approval execution**

Run:

```bash
git grep -n "executedAt\|approveActionRequest\|action_requests" -- apps/kanban/src apps/api/src
```

Determine: when `approveActionRequest` flips status to `approved`, does anything read the `payload` and perform the action (set `executedAt`)?

- [ ] **Step 16: Record the finding and branch**

- **If an executor exists:** note the file + entry point in this plan; the gate's queued payload must match the shape that executor consumes (`action`, `payload.workItemId`, `payload.toStatus`). Skip Task 8.
- **If no executor exists:** Task 8 adds one — on approval, perform `work_item_transition_status` from the stored payload.

Commit the note:

```bash
git commit --allow-empty -m "docs(kanban): record approval-execution finding for plan-gate"
```

### Task 6: `kanban.work_item_gated_transition` tool — test + implementation

**Files:**

- Create: `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.spec.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts`

- [ ] **Step 17: Write the failing test**

```typescript
import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemGatedTransitionTool } from "./work-item-gated-transition.tool";

describe("WorkItemGatedTransitionTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let updateStatus: ReturnType<typeof vi.fn>;
  let requestAction: ReturnType<typeof vi.fn>;
  let getMode: ReturnType<typeof vi.fn>;
  let tool: WorkItemGatedTransitionTool;

  beforeEach(() => {
    updateStatus = vi.fn(() => Promise.resolve({ id: "wi-1", status: "todo" }));
    requestAction = vi.fn(() => Promise.resolve({ id: "req-1" }));
    getMode = vi.fn(() => Promise.resolve("supervised"));
    tool = new WorkItemGatedTransitionTool(
      { updateStatus } as never,
      {
        get: () => Promise.resolve({ orchestrationMode: getMode() }),
        requestAction,
      } as never,
    );
  });

  it("transitions directly when mode is autonomous regardless of risk", async () => {
    getMode.mockReturnValue(Promise.resolve("autonomous"));
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
    });
    expect(updateStatus).toHaveBeenCalledWith("project-1", "wi-1", "todo");
    expect(requestAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ gated: false });
  });

  it("transitions directly for low risk even in supervised mode", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "low",
    });
    expect(updateStatus).toHaveBeenCalled();
    expect(result).toMatchObject({ gated: false });
  });

  it("queues for approval when high risk and supervised", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
    });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(requestAction).toHaveBeenCalled();
    expect(result).toMatchObject({ gated: true });
  });
});
```

- [ ] **Step 18: Run it — expect FAIL.**

- [ ] **Step 19: Confirm the OrchestrationService API surface**

Run: `git grep -n "async get(\|requestAction\|orchestrationMode" -- apps/kanban/src/orchestration/orchestration.service.ts apps/kanban/src/orchestration/orchestration-action-requests.service.ts`
Confirm: the exact method to read mode (`OrchestrationService.get(projectId)` returning an object with `orchestrationMode`) and the exact `requestAction` signature (project id + `{ action, payload, requestedBy, workflowRunId }`). Adjust the implementation below to match the real signatures.

- [ ] **Step 20: Implement the tool**

```typescript
import { Injectable } from "@nestjs/common";
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
} from "@nexus/core";
import { z } from "zod";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";
import { OrchestrationService } from "../../../orchestration/orchestration.service";

const GATED_RISK = "high";
const PLAN_APPROVAL_ACTION = "approve_refinement_plan_exit";

const GatedTransitionSchema = ContextualWorkItemIdSchema.extend({
  target_status: z.string().min(1),
  risk_level: z.string().optional(),
});

interface GatedTransitionParams {
  project_id?: string | null;
  workItemId: string;
  target_status: string;
  risk_level?: string;
}

@Injectable()
export class WorkItemGatedTransitionTool implements IInternalToolHandler<
  GatedTransitionParams,
  unknown
> {
  constructor(
    private readonly workItems: WorkItemService,
    private readonly orchestration: OrchestrationService,
  ) {}

  getName(): string {
    return "kanban.work_item_gated_transition";
  }

  getDefinition() {
    return {
      name: "kanban.work_item_gated_transition",
      description:
        "Transition a work item, queuing for human approval when risk is high and orchestration mode is not autonomous.",
      inputSchema: GatedTransitionSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    context: InternalToolExecutionContext,
    params: GatedTransitionParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const state = await this.orchestration.get(projectId);
    const mode = state.orchestrationMode;
    const highRisk = (params.risk_level ?? "").toLowerCase() === GATED_RISK;

    if (highRisk && mode !== "autonomous") {
      const request = await this.orchestration.requestAction(projectId, {
        action: PLAN_APPROVAL_ACTION,
        payload: {
          workItemId: params.workItemId,
          toStatus: params.target_status,
          riskLevel: params.risk_level,
        },
        requestedBy: "work_item_refinement_default",
      });
      return { gated: true, actionRequestId: request.id, mode };
    }

    const resource = await this.workItems.updateStatus(
      projectId,
      params.workItemId,
      params.target_status as never,
    );
    return { gated: false, resource };
  }
}
```

- [ ] **Step 21: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.spec.ts
git commit -m "feat(kanban): add mode-aware gated transition tool"
```

### Task 7: Register all three tools

- [ ] **Step 22: Barrel-export + provider-register** `WorkItemTriageTool`, `WorkItemFinalizeTriageTool`, `WorkItemGatedTransitionTool` following Phase 1 Task A3 (index.ts + the provider module). `WorkItemGatedTransitionTool` needs `OrchestrationService` injectable in that module's scope — confirm the MCP tools module imports `OrchestrationModule` (the transition-status tool already depends on orchestration services, so it should).

- [ ] **Step 23: Build + targeted tests**

Run: `npm run build --workspace=apps/kanban && npm run test --workspace=apps/kanban -- work-item-triage.tool.spec.ts work-item-finalize-triage.tool.spec.ts work-item-gated-transition.tool.spec.ts`
Expected: clean build, all pass.

- [ ] **Step 24: Commit**

```bash
git add apps/kanban/src/mcp
git commit -m "chore(kanban): register triage, finalize-triage, and gated-transition tools"
```

### Task 8: (Conditional) Wire approval execution

Only if Task 5/Step 16 found **no** executor for approved requests.

- [ ] **Step 25: Add execution on approval**

In `orchestration-action-requests.service.ts` `approveActionRequest` (after status flips to `approved`), when `request.action === "approve_refinement_plan_exit"`, perform the transition from the payload via `WorkItemService.updateStatus(projectId, payload.workItemId, payload.toStatus)` and set `executedAt`. Write a unit test first (mirror the existing approve test) asserting `updateStatus` is called with the payload values on approval. Then implement, run, commit:

```bash
git add apps/kanban/src/orchestration
git commit -m "feat(kanban): execute approved refinement plan-exit transitions"
```

---

## Part 4 — Rewire the refinement workflow

**Files:** `seed/workflows/work-item-refinement-default.workflow.yaml`, new prompt `seed/workflows/prompts/work-item-refinement-default/triage-classify.md`.

### Task 9: Insert the triage jobs

- [ ] **Step 26: Add `triage` as the first job**

Add before `codebase_analysis`:

```yaml
- id: triage
  type: mcp_tool_call
  tier: light
  inputs:
    server_id: kanban-mcp
    tool_name: kanban.work_item_triage
    params:
      project_id: "{{ trigger.scopeId }}"
      workItemId: "{{ trigger.contextId }}"
    policy:
      allowed_servers: [kanban-mcp]
      allowed_tools: [kanban.*]
```

- [ ] **Step 27: Add the conditional classifier job**

```yaml
- id: triage_classify
  type: execution
  tier: light
  depends_on:
    - triage
  condition: "{{#if jobs.triage.output.ambiguous}}true{{else}}false{{/if}}"
  output_contract:
    required:
      - track
  max_retries: 1
  retry_prompt: |
    Call set_job_output exactly once with a native object: { "track": "trivial" | "standard" | "complex" } reflecting the true complexity of this work item.
  inputs:
    agent_profile: product-manager
  steps:
    - id: classify
      type: agent
      prompt_file: prompts/work-item-refinement-default/triage-classify.md
```

- [ ] **Step 28: Add the finalize job**

```yaml
- id: finalize_triage
  type: mcp_tool_call
  tier: light
  depends_on:
    - triage
    - triage_classify
  inputs:
    server_id: kanban-mcp
    tool_name: kanban.work_item_finalize_triage
    params:
      project_id: "{{ trigger.scopeId }}"
      workItemId: "{{ trigger.contextId }}"
      deterministic_track: "{{ jobs.triage.output.track }}"
      ambiguous: "{{ jobs.triage.output.ambiguous }}"
      classified_track: "{{ jobs.triage_classify.output.track }}"
    policy:
      allowed_servers: [kanban-mcp]
      allowed_tools: [kanban.*]
```

- [ ] **Step 29: Write the classifier prompt**

Create `seed/workflows/prompts/work-item-refinement-default/triage-classify.md`:

```markdown
# Refinement Triage Tie-Breaker

The deterministic triage was ambiguous for this work item. Decide its refinement track.

Read the work item spec (`{{ trigger.resource.metadata.workItemMarkdownPath }}` if present, else `{{ trigger.resource.description }}`).

Choose exactly one `track`:

- `trivial` — a small, well-understood change touching few files; no design questions. Skip codebase analysis, PM clarification, and war-room.
- `standard` — a normal feature/fix needing codebase grounding and an architect plan, but no cross-functional debate.
- `complex` — cross-cutting, risky, or design-contested work needing full PM + war-room alignment.

Call `set_job_output` exactly once: `{ "track": "<trivial|standard|complex>" }`.
```

### Task 10: Gate the existing heavy jobs on track

- [ ] **Step 30: Gate `codebase_analysis`**

Add a `depends_on: [finalize_triage]` and a condition that skips it for `trivial`:

```yaml
depends_on:
  - finalize_triage
condition: "{{#if (eq jobs.finalize_triage.output.track 'trivial')}}false{{else}}true{{/if}}"
```

- [ ] **Step 31: Gate `pm_refinement`** — runs only for `complex` (standard/trivial skip PM unless ACs ambiguous is a future refinement):

```yaml
depends_on:
  - finalize_triage
  - codebase_analysis
condition: "{{#if (eq jobs.finalize_triage.output.track 'complex')}}true{{else}}false{{/if}}"
```

- [ ] **Step 32: Gate `war_room_refinement_alignment`** — change its `condition` from `true` to complex-only:

```yaml
condition: "{{#if (eq jobs.finalize_triage.output.track 'complex')}}true{{else}}false{{/if}}"
```

- [ ] **Step 33: Confirm skipped-dependency semantics (critical)**

`architect_refinement` depends on `persist_pm_artifacts` and `war_room_refinement_alignment`, which now skip for non-complex tracks. Run:

```bash
git grep -rn "skip\|skipped\|depends_on" -- apps/api/src/workflow | head -50
```

Verify the workflow engine treats a **skipped** dependency as satisfied (does not block dependents). If it does NOT, change `architect_refinement.depends_on` to `[finalize_triage]` only and rely on `persist_*`/`war_room` conditions, OR add `condition` guards on the `persist_pm_artifacts` job so the chain stays connected. Document the engine's actual behavior here before proceeding.

### Task 11: Swap the exit transition for the gated tool

- [ ] **Step 34: Replace `transition_to_todo`'s tool call**

Change the `transition_to_todo` job's `tool_name` from `kanban.work_item_transition_status` to `kanban.work_item_gated_transition`, and pass `risk_level`:

```yaml
tool_name: kanban.work_item_gated_transition
params:
  project_id: "{{ trigger.scopeId }}"
  workItemId: "{{ trigger.contextId }}"
  target_status: todo
  risk_level: "{{ jobs.architect_refinement.output.risk_level }}"
```

> The existing exit-readiness gate (`validate_refinement_exit_readiness` / `mark_refinement_completed`) stays unchanged — it still runs before this job. When the gate queues the exit (`gated: true`), the item remains in `refinement` until a human approves, at which point the approved-action executor (Task 8 or the existing executor) performs the `todo` transition.

- [ ] **Step 35: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS.

- [ ] **Step 36: Commit**

```bash
git add seed/workflows/work-item-refinement-default.workflow.yaml seed/workflows/prompts/work-item-refinement-default/triage-classify.md
git commit -m "feat(kanban): adaptive refinement depth via triage + mode-aware plan-gate"
```

---

## Phase 2 Verification

- [ ] **Step 37: Full kanban test + lint + build**

Run: `npm run test:kanban && npm run lint:kanban && npm run build:kanban`
Expected: all green.

- [ ] **Step 38: Live smoke (post-deploy)**

- A `trivial` item refines without running codebase-analysis/PM/war-room and exits to `todo`.
- A `complex` item with `risk_level: high` in a `supervised` project does **not** auto-exit; an action request appears in the pending-action panel; approving it transitions the item to `todo`.
- The same item in an `autonomous` project exits directly.

## Notes / follow-ups

- `risk_level`-driven _extra war-room round_ on architect escalation is intentionally deferred (war-room runs before the architect; reordering is out of scope). Captured in the design's follow-ups.
- PM-only-when-ACs-ambiguous (for `standard`) is deferred; standard currently skips PM. Revisit if standard items show AC-clarity rejections in Phase 4 metrics.
