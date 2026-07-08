# Configurable Orchestration — Phases 2 & 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the curated Orchestration Policy surface (per-phase autonomy + curated keys) on top of the Phase 1 scoped-variable store, wire kanban enforcement to read per-phase autonomy, expose generic + curated editors in the web UI, and add Phase 3 polish (variable audit history + effective-config inspector).

**Architecture:** Phase 1 shipped an **API-owned**, kanban-neutral `scoped_variables` store (`apps/api/src/variables/`) whose effective values are snapshotted into `state_variables.vars` at run launch. Phase 2/3 add: (1) a curated **policy-key registry** in `packages/kanban-contracts` (all orchestration _meaning_ lives here — keys, types, defaults, enums, groups, and the `mode ⇄ autonomy` mapping); (2) **per-phase autonomy enforcement** — the CEO workflow YAML reads `{{ vars.autonomy.* }}` for dispatch/backlog-promotion gating, and the kanban gated-transition tool reads an `autonomy_merge` tool param; (3) a kanban **OrchestrationPolicy** service/controller that resolves + validates + writes curated policy through an **HTTP client to the API variable store** (kanban never touches the API DB); (4) a kanban **startup backfill** that mirrors each project's legacy `mode` into project-scoped `autonomy.*` vars; (5) web **Variables editor** (raw) + **Orchestration Policy panel** (registry-driven); (6) Phase 3 **audit history** + **effective-config inspector**.

**Tech Stack:** NestJS + TypeORM (apps/api, apps/kanban), Zod (`packages/kanban-contracts`, `@nexus/core`), Handlebars (workflow templating), Vite + React + Tailwind + React Query + shadcn/ui (apps/web), Vitest (unit), Playwright (web E2E).

## Global Constraints

- **Core/Kanban boundary (hard lint gate `nexus-boundaries/no-core-kanban-residue`):** `apps/api/src` and `packages/core/src` must remain Kanban-neutral — no `kanban`, work-item, or project-domain identifiers, and no import of `@nexus/kanban-contracts`. All orchestration semantics (key names, defaults, enums, mode mapping) live in `packages/kanban-contracts`. The API variable store validates **key format + value_type only**; it never learns an orchestration key.
- **No lint suppression:** Never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, allowlists, or rule downgrades. Fix in code.
- **Strict typing:** Shared contracts in `@nexus/core` (generic store types) or `@nexus/kanban-contracts` (orchestration registry). No local redefinition.
- **TDD:** Red → Green → Refactor for every task. NestJS tests rely on SWC decorator metadata — keep Vitest/SWC config aligned with existing specs.
- **Build order:** `npm run build --workspace=packages/core` and `npm run build --workspace=packages/kanban-contracts` before consuming apps when contracts change.
- **NestJS build:** use `nest build` (not `tsc`) for apps.
- **Curated key set & defaults (verbatim from spec §8 — these preserve today's exact behavior):**
  | Key | Type | Default |
  | --- | --- | --- |
  | `autonomy.dispatch` | enum `auto`/`ask`/`off` | `auto` |
  | `autonomy.backlog_promotion` | enum `auto`/`ask`/`off` | `auto` |
  | `autonomy.merge` | enum `auto`/`ask` | `ask` |
  | `backlog.bootstrap_enabled` | boolean | `true` |
  | `backlog.ideation_enabled` | boolean | `true` |
  | `gates.rediscovery_merge_threshold` | number | `10` |
  | `gates.roadmap_when_no_active_initiative` | boolean | `true` |
  | `gates.ideation_starvation_cycles` | number | `2` |
  | `promotion.max_items_per_cycle` | number | `-1` (unbounded; `0` = disabled) |
- **Autonomy source of truth (decided):** the **API variable store is authoritative**. Kanban reaches it only over HTTP (reuse the `CoreScopeClientService` / `KanbanCoreHttpClient` pattern). The kanban `KanbanOrchestrationEntity.mode` column becomes a **display mirror**, re-derived and written whenever policy changes; never the source of enforcement.
- **`mode ⇄ autonomy` mapping (canonical, lives in kanban-contracts):**
  - `autonomous` → `{dispatch: auto, backlog_promotion: auto, merge: auto}`
  - `supervised` → `{dispatch: ask, backlog_promotion: ask, merge: ask}`
  - `notifications_only` → `{dispatch: off, backlog_promotion: off, merge: ask}`
  - reverse (lossy, display only): derive from `autonomy.dispatch` → `off`→`notifications_only`, `ask`→`supervised`, `auto`→`autonomous`.

---

## Existing code this plan builds on (read before starting)

- `packages/core/src/variables/scoped-variable.types.ts` — `ResolvedVariable`, `UpsertScopedVariableRequest`, `UpsertScopedVariableSchema` (key regex `^[a-z0-9]+(?:[._][a-z0-9]+)*$`).
- `apps/api/src/variables/variables.controller.ts` — routes: `GET /variables?scopeId`, `GET /variables/effective?scopeId`, `POST /variables`, `DELETE /variables?key&scopeId`.
- `apps/api/src/variables/variable-resolver.service.ts` — `resolveEffective(scopeNodeId): Promise<ResolvedVariable[]>`, `resolveContext(scopeNodeId): Promise<Record<string,unknown>>`.
- `apps/api/src/variables/database/repositories/scoped-variable.repository.ts` — `upsert`, `deleteByKeyAndScope`, `listForScope`, `findOneByKeyAndScope`.
- `seed/variables/orchestration-defaults.json` — seeded global defaults (already present).
- `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` — gates already on `vars.gates.*`/`vars.backlog.ideation_enabled`; `promote_safe_backlog` (line ~236) and `strategize`/`dispatch` `autonomous_mode` inputs (lines ~226, ~268) still on the coarse `inputs.autonomous_mode`.
- `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts` — `GatedTransitionSchema`, gates high-risk when `mode !== "autonomous"`.
- `apps/kanban/src/orchestration/human-decision-resolution-policy.service.ts` + `.types.ts` — `selectPolicy({orchestrationMode})`.
- `apps/kanban/src/core/core-scope-client.service.ts`, `apps/kanban/src/core/kanban-core-http-client.ts` (`getJson`/`postJson`), `apps/kanban/src/core/kanban-core-auth-token.provider.ts` — kanban→API authenticated HTTP pattern.
- `packages/kanban-contracts/src/orchestration.schema.ts` + `index.ts` (star-export convention).
- `apps/web/src/lib/api/client.ts` (axios wrapper: `get`/`post`/`patch`/`delete`), `apps/web/src/lib/queryKeys.ts`, `apps/web/src/pages/project-workspace/OrchestrationControlsCard.tsx` (Mode selector), `apps/web/src/hooks/useProjectOrchestration.ts`.

---

## File Structure (created / modified)

**packages/kanban-contracts**

- Create: `src/orchestration-policy.schema.ts` — registry value enums + Zod schemas.
- Create: `src/orchestration-policy.types.ts` — `OrchestrationPolicyKeyDescriptor`, autonomy types.
- Create: `src/orchestration-policy.registry.ts` — the `ORCHESTRATION_POLICY_REGISTRY` array + pure helpers (`autonomyValuesForMode`, `modeFromAutonomyValues`, `validatePolicyEntry`).
- Modify: `src/index.ts` — star-export the three new files.

**apps/kanban**

- Modify: `src/mcp/tools/mutation/work-item-gated-transition.tool.ts` — `autonomy_merge` param.
- Create: `src/core/core-variables-client.service.ts` — HTTP client to API `/variables`.
- Create: `src/core/core-variables-client.types.ts` — client interface.
- Modify: `src/core/core.module.ts` (or wherever `CoreScopeClientService` is provided) — register the variables client.
- Create: `src/orchestration/orchestration-policy.service.ts` — resolve/validate/write curated policy + preset; derive + mirror `mode`.
- Create: `src/orchestration/orchestration-policy.controller.ts` — `GET/PUT /orchestration/:projectId/policy`, `PUT /orchestration/:projectId/policy/preset`.
- Create: `src/orchestration/orchestration-policy-backfill.service.ts` — startup backfill (implements `OnApplicationBootstrap`).
- Modify: `src/orchestration/orchestration.module.ts` — register policy service, controller, backfill, variables client.
- Modify: `src/orchestration/orchestration.service.ts` — re-point existing mode update to write the preset (vars + mirror).

**apps/api** (Phase 3)

- Create: `src/variables/database/entities/scoped-variable-audit.entity.ts`.
- Create: `src/variables/database/repositories/scoped-variable-audit.repository.ts`.
- Create: `src/database/migrations/20260620090000-create-scoped-variable-audit.ts`.
- Modify: `src/variables/database/repositories/scoped-variable.repository.ts` — record audit on upsert/delete.
- Modify: `src/variables/variables.controller.ts` — `GET /variables/audit?scopeId&key`.
- Modify: `src/variables/variables.module.ts` + `src/database/database.module.ts` — register audit entity/repo.

**apps/web**

- Create: `src/lib/api/client.variables.ts` + types — generic variables client.
- Create: `src/lib/api/client.orchestration-policy.ts` + types — curated policy client.
- Create: `src/hooks/useScopedVariables.ts`, `src/hooks/useOrchestrationPolicy.ts`.
- Modify: `src/lib/queryKeys.ts` — `variables` + `orchestrationPolicy` keys.
- Create: `src/pages/variables/VariablesEditorPage.tsx` (+ row/dialog subcomponents) — generic editor.
- Create: `src/components/orchestration/OrchestrationPolicyPanel.tsx` — curated panel.
- Create: `src/components/variables/EffectiveConfigInspector.tsx` (Phase 3) — layer-trace inspector.
- Modify: `src/App.tsx` — route for the Variables editor; surface the policy panel in the project workspace.

---

# PHASE 2 — Curated policy + per-phase autonomy + UI

## Task 1: Orchestration policy-key registry in `kanban-contracts`

**Files:**

- Create: `packages/kanban-contracts/src/orchestration-policy.schema.ts`
- Create: `packages/kanban-contracts/src/orchestration-policy.types.ts`
- Create: `packages/kanban-contracts/src/orchestration-policy.registry.ts`
- Modify: `packages/kanban-contracts/src/index.ts`
- Test: `apps/kanban/src/orchestration/orchestration-policy-registry.spec.ts` (imports from `@nexus/kanban-contracts`; runs under `test:kanban`)

**Interfaces:**

- Produces:
  - `type OrchestrationAutonomyValue = "auto" | "ask" | "off"`
  - `type OrchestrationMode = "autonomous" | "supervised" | "notifications_only"`
  - `type OrchestrationPolicyValueType = "string" | "number" | "boolean"`
  - `interface OrchestrationPolicyKeyDescriptor { key: string; valueType: OrchestrationPolicyValueType; defaultValue: string | number | boolean; enumValues?: readonly string[]; group: string; label: string; description: string; min?: number; max?: number; step?: number; }`
  - `const ORCHESTRATION_POLICY_REGISTRY: readonly OrchestrationPolicyKeyDescriptor[]`
  - `function autonomyValuesForMode(mode: OrchestrationMode): Record<string, OrchestrationAutonomyValue>`
  - `function modeFromAutonomyValues(values: Record<string, unknown>): OrchestrationMode`
  - `function validatePolicyEntry(key: string, value: unknown): { ok: true } | { ok: false; error: string }`
  - `function findPolicyDescriptor(key: string): OrchestrationPolicyKeyDescriptor | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/kanban/src/orchestration/orchestration-policy-registry.spec.ts
import { describe, expect, it } from "vitest";
import {
  ORCHESTRATION_POLICY_REGISTRY,
  autonomyValuesForMode,
  modeFromAutonomyValues,
  validatePolicyEntry,
  findPolicyDescriptor,
} from "@nexus/kanban-contracts";

describe("orchestration policy registry", () => {
  it("contains the nine curated keys with spec defaults", () => {
    const byKey = Object.fromEntries(
      ORCHESTRATION_POLICY_REGISTRY.map((d) => [d.key, d]),
    );
    expect(byKey["autonomy.dispatch"].defaultValue).toBe("auto");
    expect(byKey["autonomy.merge"].defaultValue).toBe("ask");
    expect(byKey["gates.rediscovery_merge_threshold"].defaultValue).toBe(10);
    expect(byKey["gates.ideation_starvation_cycles"].defaultValue).toBe(2);
    expect(byKey["promotion.max_items_per_cycle"].defaultValue).toBe(-1);
    expect(byKey["backlog.ideation_enabled"].defaultValue).toBe(true);
    expect(Object.keys(byKey)).toHaveLength(9);
  });

  it("maps mode to per-phase autonomy values", () => {
    expect(autonomyValuesForMode("autonomous")).toEqual({
      "autonomy.dispatch": "auto",
      "autonomy.backlog_promotion": "auto",
      "autonomy.merge": "auto",
    });
    expect(autonomyValuesForMode("supervised")).toEqual({
      "autonomy.dispatch": "ask",
      "autonomy.backlog_promotion": "ask",
      "autonomy.merge": "ask",
    });
    expect(autonomyValuesForMode("notifications_only")).toEqual({
      "autonomy.dispatch": "off",
      "autonomy.backlog_promotion": "off",
      "autonomy.merge": "ask",
    });
  });

  it("derives a display mode from autonomy.dispatch (lossy)", () => {
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "auto" })).toBe(
      "autonomous",
    );
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "ask" })).toBe(
      "supervised",
    );
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "off" })).toBe(
      "notifications_only",
    );
    expect(modeFromAutonomyValues({})).toBe("autonomous"); // default
  });

  it("validates curated entries against the registry", () => {
    expect(validatePolicyEntry("autonomy.dispatch", "auto")).toEqual({
      ok: true,
    });
    expect(validatePolicyEntry("autonomy.dispatch", "sometimes").ok).toBe(
      false,
    );
    expect(validatePolicyEntry("autonomy.merge", "off").ok).toBe(false); // merge has no 'off'
    expect(validatePolicyEntry("gates.rediscovery_merge_threshold", 5)).toEqual(
      {
        ok: true,
      },
    );
    expect(
      validatePolicyEntry("gates.rediscovery_merge_threshold", "five").ok,
    ).toBe(false);
    expect(validatePolicyEntry("backlog.ideation_enabled", true)).toEqual({
      ok: true,
    });
    expect(validatePolicyEntry("unknown.key", 1).ok).toBe(false);
  });

  it("exposes descriptors by key", () => {
    expect(findPolicyDescriptor("autonomy.dispatch")?.group).toBe("autonomy");
    expect(findPolicyDescriptor("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-policy-registry`
Expected: FAIL — `Cannot find module '@nexus/kanban-contracts'` exports / functions undefined.

- [ ] **Step 3: Write the schema file**

```typescript
// packages/kanban-contracts/src/orchestration-policy.schema.ts
import { z } from "zod";

export const OrchestrationAutonomyValueSchema = z.enum(["auto", "ask", "off"]);

export const OrchestrationMergeAutonomyValueSchema = z.enum(["auto", "ask"]);

export const OrchestrationPolicyModeSchema = z.enum([
  "autonomous",
  "supervised",
  "notifications_only",
]);

export const OrchestrationPolicyValueTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
]);
```

- [ ] **Step 4: Write the types file**

```typescript
// packages/kanban-contracts/src/orchestration-policy.types.ts
import type { z } from "zod";
import type {
  OrchestrationAutonomyValueSchema,
  OrchestrationPolicyModeSchema,
  OrchestrationPolicyValueTypeSchema,
} from "./orchestration-policy.schema";

export type OrchestrationAutonomyValue = z.infer<
  typeof OrchestrationAutonomyValueSchema
>;
export type OrchestrationMode = z.infer<typeof OrchestrationPolicyModeSchema>;
export type OrchestrationPolicyValueType = z.infer<
  typeof OrchestrationPolicyValueTypeSchema
>;

export interface OrchestrationPolicyKeyDescriptor {
  key: string;
  valueType: OrchestrationPolicyValueType;
  defaultValue: string | number | boolean;
  enumValues?: readonly string[];
  group: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
}
```

- [ ] **Step 5: Write the registry + helpers**

```typescript
// packages/kanban-contracts/src/orchestration-policy.registry.ts
import type {
  OrchestrationAutonomyValue,
  OrchestrationMode,
  OrchestrationPolicyKeyDescriptor,
} from "./orchestration-policy.types";

export const AUTONOMY_DISPATCH_KEY = "autonomy.dispatch";
export const AUTONOMY_BACKLOG_PROMOTION_KEY = "autonomy.backlog_promotion";
export const AUTONOMY_MERGE_KEY = "autonomy.merge";

const AUTONOMY_ENUM = ["auto", "ask", "off"] as const;
const MERGE_ENUM = ["auto", "ask"] as const;

export const ORCHESTRATION_POLICY_REGISTRY: readonly OrchestrationPolicyKeyDescriptor[] =
  [
    {
      key: AUTONOMY_DISPATCH_KEY,
      valueType: "string",
      defaultValue: "auto",
      enumValues: AUTONOMY_ENUM,
      group: "autonomy",
      label: "Dispatch",
      description:
        "Whether the CEO cycle dispatches work autonomously (auto), asks for approval (ask), or only records recommendations (off).",
    },
    {
      key: AUTONOMY_BACKLOG_PROMOTION_KEY,
      valueType: "string",
      defaultValue: "auto",
      enumValues: AUTONOMY_ENUM,
      group: "autonomy",
      label: "Backlog promotion",
      description:
        "Whether zero-todo backlog promotion happens automatically (auto), asks (ask), or is disabled (off).",
    },
    {
      key: AUTONOMY_MERGE_KEY,
      valueType: "string",
      defaultValue: "ask",
      enumValues: MERGE_ENUM,
      group: "autonomy",
      label: "Merge / high-risk transitions",
      description:
        "Whether high-risk work-item transitions proceed automatically (auto) or queue for human approval (ask).",
    },
    {
      key: "backlog.bootstrap_enabled",
      valueType: "boolean",
      defaultValue: true,
      group: "backlog",
      label: "Bootstrap enabled",
      description: "Whether bootstrap work-item generation runs.",
    },
    {
      key: "backlog.ideation_enabled",
      valueType: "boolean",
      defaultValue: true,
      group: "backlog",
      label: "Ideation enabled",
      description: "Whether the ideation gate may fire.",
    },
    {
      key: "gates.rediscovery_merge_threshold",
      valueType: "number",
      defaultValue: 10,
      group: "gates",
      label: "Rediscovery merge threshold",
      description:
        "Merges-since-discovery count at/above which deep rediscovery is triggered.",
      min: 1,
      max: 100,
      step: 1,
    },
    {
      key: "gates.roadmap_when_no_active_initiative",
      valueType: "boolean",
      defaultValue: true,
      group: "gates",
      label: "Roadmap when no active initiative",
      description:
        "Whether roadmap planning fires when there is no active now-horizon initiative.",
    },
    {
      key: "gates.ideation_starvation_cycles",
      valueType: "number",
      defaultValue: 2,
      group: "gates",
      label: "Ideation starvation cycles",
      description: "Starvation-forecast cycles at/under which ideation fires.",
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "promotion.max_items_per_cycle",
      valueType: "number",
      defaultValue: -1,
      group: "promotion",
      label: "Max promotions per cycle",
      description:
        "Promotion volume cap per cycle. -1 = unbounded, 0 = disabled.",
      min: -1,
      max: 100,
      step: 1,
    },
  ];

const REGISTRY_BY_KEY = new Map(
  ORCHESTRATION_POLICY_REGISTRY.map((d) => [d.key, d]),
);

export function findPolicyDescriptor(
  key: string,
): OrchestrationPolicyKeyDescriptor | undefined {
  return REGISTRY_BY_KEY.get(key);
}

export function autonomyValuesForMode(
  mode: OrchestrationMode,
): Record<string, OrchestrationAutonomyValue> {
  switch (mode) {
    case "autonomous":
      return {
        [AUTONOMY_DISPATCH_KEY]: "auto",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "auto",
        [AUTONOMY_MERGE_KEY]: "auto",
      };
    case "supervised":
      return {
        [AUTONOMY_DISPATCH_KEY]: "ask",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "ask",
        [AUTONOMY_MERGE_KEY]: "ask",
      };
    case "notifications_only":
      return {
        [AUTONOMY_DISPATCH_KEY]: "off",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "off",
        [AUTONOMY_MERGE_KEY]: "ask",
      };
  }
}

export function modeFromAutonomyValues(
  values: Record<string, unknown>,
): OrchestrationMode {
  const dispatch = values[AUTONOMY_DISPATCH_KEY];
  if (dispatch === "off") return "notifications_only";
  if (dispatch === "ask") return "supervised";
  return "autonomous";
}

export function validatePolicyEntry(
  key: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  const descriptor = REGISTRY_BY_KEY.get(key);
  if (!descriptor) {
    return { ok: false, error: `Unknown orchestration policy key: ${key}` };
  }
  if (descriptor.valueType === "boolean" && typeof value !== "boolean") {
    return { ok: false, error: `${key} expects a boolean` };
  }
  if (descriptor.valueType === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return { ok: false, error: `${key} expects a number` };
    }
    if (descriptor.min !== undefined && value < descriptor.min) {
      return { ok: false, error: `${key} must be >= ${descriptor.min}` };
    }
    if (descriptor.max !== undefined && value > descriptor.max) {
      return { ok: false, error: `${key} must be <= ${descriptor.max}` };
    }
  }
  if (descriptor.valueType === "string") {
    if (typeof value !== "string") {
      return { ok: false, error: `${key} expects a string` };
    }
    if (descriptor.enumValues && !descriptor.enumValues.includes(value)) {
      return {
        ok: false,
        error: `${key} must be one of ${descriptor.enumValues.join(", ")}`,
      };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 6: Export from the package index**

In `packages/kanban-contracts/src/index.ts`, add (alongside the existing star-exports):

```typescript
export * from "./orchestration-policy.schema";
export * from "./orchestration-policy.types";
export * from "./orchestration-policy.registry";
```

- [ ] **Step 7: Build the contracts package and run the test**

Run: `npm run build --workspace=packages/kanban-contracts && npm run test --workspace=apps/kanban -- orchestration-policy-registry`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/kanban-contracts/src apps/kanban/src/orchestration/orchestration-policy-registry.spec.ts
git commit -m "feat(contracts): orchestration policy-key registry + mode/autonomy mapping"
```

---

## Task 2: Per-phase merge autonomy in the gated-transition tool

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.spec.ts` (exists — add cases)

**Interfaces:**

- Consumes: `OrchestrationService.get(projectId)` (existing) → `{ orchestrationMode }`.
- Produces: `GatedTransitionParams` gains `autonomy_merge?: "auto" | "ask"`. Enforcement prefers the param; falls back to deriving from `mode` (`autonomous` → `auto`, else `ask`).

- [ ] **Step 1: Add failing tests**

Append to `work-item-gated-transition.tool.spec.ts` (reuse the file's existing mock setup for `WorkItemService` + `OrchestrationService`):

```typescript
it("gates a high-risk transition when autonomy_merge=ask even if mode is autonomous", async () => {
  orchestration.get.mockResolvedValue({ orchestrationMode: "autonomous" });
  orchestration.requestAction.mockResolvedValue({ id: "req-1" });

  const result = await tool.execute({ scopeId: "proj-1" } as never, {
    workItemId: "wi-1",
    target_status: "in_progress",
    risk_level: "high",
    autonomy_merge: "ask",
  });

  expect(result).toMatchObject({ gated: true, actionRequestId: "req-1" });
  expect(workItems.updateStatus).not.toHaveBeenCalled();
});

it("proceeds on high-risk transition when autonomy_merge=auto even if mode is supervised", async () => {
  orchestration.get.mockResolvedValue({ orchestrationMode: "supervised" });
  workItems.updateStatus.mockResolvedValue({ id: "wi-1" });

  const result = await tool.execute({ scopeId: "proj-1" } as never, {
    workItemId: "wi-1",
    target_status: "in_progress",
    risk_level: "high",
    autonomy_merge: "auto",
  });

  expect(result).toMatchObject({ gated: false });
  expect(orchestration.requestAction).not.toHaveBeenCalled();
});

it("falls back to mode when autonomy_merge is absent (back-compat)", async () => {
  orchestration.get.mockResolvedValue({ orchestrationMode: "supervised" });
  orchestration.requestAction.mockResolvedValue({ id: "req-2" });

  const result = await tool.execute({ scopeId: "proj-1" } as never, {
    workItemId: "wi-1",
    target_status: "in_progress",
    risk_level: "high",
  });

  expect(result).toMatchObject({ gated: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- work-item-gated-transition`
Expected: FAIL — `autonomy_merge` not accepted; autonomous mode bypasses regardless.

- [ ] **Step 3: Implement the param + precedence**

In `work-item-gated-transition.tool.ts`:

```typescript
const GatedTransitionSchema = ContextualWorkItemIdSchema.extend({
  target_status: WorkItemStatusSchema,
  risk_level: z.string().optional(),
  autonomy_merge: z.enum(["auto", "ask"]).optional(),
});

interface GatedTransitionParams {
  project_id?: string | null;
  workItemId: string;
  target_status: WorkItemStatus;
  risk_level?: string;
  autonomy_merge?: "auto" | "ask";
}
```

Replace the enforcement block (was lines 67-82):

```typescript
const state = await this.orchestration.get(projectId);
const mode = state.orchestrationMode;
const mergeAutonomy =
  params.autonomy_merge ?? (mode === "autonomous" ? "auto" : "ask");
const highRisk = (params.risk_level ?? "").toLowerCase() === GATED_RISK;

if (highRisk && mergeAutonomy !== "auto") {
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
```

Also update the tool `description` in `getDefinition()` to mention the `autonomy_merge` param.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- work-item-gated-transition`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-gated-transition.tool.spec.ts
git commit -m "feat(kanban): gated-transition honors per-phase autonomy_merge tool param"
```

---

## Task 3: CEO workflow YAML — dispatch & backlog-promotion from `vars.autonomy.*`

**Files:**

- Modify: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`
- Test: `apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts` (exists — add regression assertions)

**Interfaces:**

- Consumes: `vars.autonomy.dispatch`, `vars.autonomy.backlog_promotion` (snapshotted into `state_variables.vars` at launch by Phase 1 engine injection, scoped to `trigger.scopeId`).
- Produces: no new outputs; `autonomous_mode` boolean handed to agents is now derived from `vars.autonomy.dispatch == 'auto'`; `promote_safe_backlog` gates on `vars.autonomy.backlog_promotion == 'auto'`.

- [ ] **Step 1: Add failing contract assertions**

In `project-orchestration-cycle-ceo.seed-contract.spec.ts` add:

```typescript
it("derives strategize/dispatch autonomous_mode from vars.autonomy.dispatch", () => {
  const yaml = loadCeoWorkflowYaml(); // existing helper in this spec file
  const strategize = yaml.jobs.find(
    (j: { id: string }) => j.id === "strategize",
  );
  const dispatch = yaml.jobs.find((j: { id: string }) => j.id === "dispatch");
  expect(strategize.inputs.autonomous_mode).toContain("vars.autonomy.dispatch");
  expect(dispatch.inputs.autonomous_mode).toContain("vars.autonomy.dispatch");
});

it("gates promote_safe_backlog on vars.autonomy.backlog_promotion", () => {
  const yaml = loadCeoWorkflowYaml();
  const promote = yaml.jobs.find(
    (j: { id: string }) => j.id === "promote_safe_backlog",
  );
  expect(promote.condition).toContain("vars.autonomy.backlog_promotion");
  expect(promote.condition).not.toContain(
    "groomed_board_summary.autonomous_mode",
  );
});
```

> If `loadCeoWorkflowYaml` does not yet exist in the spec, add a helper that reads `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` from repo root and parses it with the `yaml` package already used by other seed-contract specs.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- project-orchestration-cycle-ceo.seed-contract`
Expected: FAIL — inputs still reference `inputs.autonomous_mode`; promote condition references `groomed_board_summary.autonomous_mode`.

- [ ] **Step 3: Edit the YAML**

`strategize` job inputs (line ~226):

```yaml
autonomous_mode: "{{#if (eq vars.autonomy.dispatch 'auto')}}true{{else}}false{{/if}}"
```

`dispatch` job inputs (line ~268):

```yaml
autonomous_mode: "{{#if (eq vars.autonomy.dispatch 'auto')}}true{{else}}false{{/if}}"
```

`promote_safe_backlog` condition (line ~236):

```yaml
condition: "{{#if (and (eq jobs.strategize.output.groomed_board_summary.todo_count 0) (eq vars.autonomy.backlog_promotion 'auto'))}}true{{else}}false{{/if}}"
```

Update the workflow's top-of-file `description` note and the `inputs.autonomous_mode` comment (line ~17-18) to record that per-phase autonomy now flows from `vars.autonomy.*` (the `inputs.autonomous_mode` default is retained only as a manual-launch fallback).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- project-orchestration-cycle-ceo.seed-contract`
Expected: PASS.

- [ ] **Step 5: Validate seed data still parses**

Run: `npm run validate:seed-data`
Expected: PASS (no schema errors).

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/project-orchestration-cycle-ceo.workflow.yaml apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts
git commit -m "feat(orchestration): CEO dispatch + backlog promotion gate on vars.autonomy.*"
```

---

## Task 4: Kanban → API variables HTTP client

**Files:**

- Create: `apps/kanban/src/core/core-variables-client.types.ts`
- Create: `apps/kanban/src/core/core-variables-client.service.ts`
- Modify: the NestJS module that provides `CoreScopeClientService` (find with `grep -rn "CoreScopeClientService" apps/kanban/src --include=*.module.ts`) — register the new provider and export it.
- Test: `apps/kanban/src/core/core-variables-client.service.spec.ts`

**Interfaces:**

- Consumes: `KanbanCoreHttpClient` (`getJson<T>(path, label)`, `postJson<T>(path, body, label)`), `KanbanCoreAuthTokenProvider.resolveAuthorizationHeader()`, env `KANBAN_CORE_BASE_URL` (default `http://localhost:3010/api`).
- Produces:
  - `interface CoreVariablesClient { getEffective(scopeId: string): Promise<ResolvedVariable[]>; upsert(input: UpsertScopedVariableRequest): Promise<void>; }`
  - `class CoreVariablesClientService implements CoreVariablesClient`
  - The API wraps responses as `{ success: true, data: ... }`; the client unwraps `.data`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/kanban/src/core/core-variables-client.service.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoreVariablesClientService } from "./core-variables-client.service";

const getJson = vi.fn();
const postJson = vi.fn();

vi.mock("./kanban-core-http-client", () => ({
  KanbanCoreHttpClient: vi
    .fn()
    .mockImplementation(() => ({ getJson, postJson })),
}));

describe("CoreVariablesClientService", () => {
  let service: CoreVariablesClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CoreVariablesClientService({
      resolveAuthorizationHeader: () => "Bearer test",
    } as never);
  });

  it("fetches effective variables and unwraps data", async () => {
    getJson.mockResolvedValue({
      success: true,
      data: [
        {
          key: "autonomy.dispatch",
          value: "auto",
          type: "string",
          layer: "global",
        },
      ],
    });

    const result = await service.getEffective("proj-1");

    expect(getJson).toHaveBeenCalledWith(
      "/variables/effective?scopeId=proj-1",
      expect.any(String),
    );
    expect(result).toEqual([
      {
        key: "autonomy.dispatch",
        value: "auto",
        type: "string",
        layer: "global",
      },
    ]);
  });

  it("posts an upsert", async () => {
    postJson.mockResolvedValue({ success: true, data: {} });

    await service.upsert({
      scopeNodeId: "proj-1",
      key: "autonomy.dispatch",
      value: "ask",
      valueType: "string",
    });

    expect(postJson).toHaveBeenCalledWith(
      "/variables",
      {
        scopeNodeId: "proj-1",
        key: "autonomy.dispatch",
        value: "ask",
        valueType: "string",
      },
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- core-variables-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types**

```typescript
// apps/kanban/src/core/core-variables-client.types.ts
import type {
  ResolvedVariable,
  UpsertScopedVariableRequest,
} from "@nexus/core";

export interface CoreVariablesClient {
  getEffective(scopeId: string): Promise<ResolvedVariable[]>;
  upsert(input: UpsertScopedVariableRequest): Promise<void>;
}

export const CORE_VARIABLES_CLIENT = Symbol("CORE_VARIABLES_CLIENT");
```

- [ ] **Step 4: Write the service (mirror `CoreScopeClientService`)**

```typescript
// apps/kanban/src/core/core-variables-client.service.ts
import { Inject, Injectable } from "@nestjs/common";
import type {
  ResolvedVariable,
  ServiceClientHttpOptions,
  UpsertScopedVariableRequest,
} from "@nexus/core";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";
import type { CoreVariablesClient } from "./core-variables-client.types";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable()
export class CoreVariablesClientService implements CoreVariablesClient {
  private readonly httpClient: KanbanCoreHttpClient;

  constructor(
    @Inject(KanbanCoreAuthTokenProvider)
    private readonly authTokenProvider: KanbanCoreAuthTokenProvider,
  ) {
    const coreBaseUrl =
      this.readOptionalEnv("KANBAN_CORE_BASE_URL") ?? DEFAULT_CORE_BASE_URL;
    this.httpClient = new KanbanCoreHttpClient(
      coreBaseUrl,
      this.resolveHttpOptions(coreBaseUrl),
    );
  }

  async getEffective(scopeId: string): Promise<ResolvedVariable[]> {
    const response = await this.httpClient.getJson<
      ApiEnvelope<ResolvedVariable[]>
    >(
      `/variables/effective?scopeId=${encodeURIComponent(scopeId)}`,
      "resolve effective variables",
    );
    return response.data;
  }

  async upsert(input: UpsertScopedVariableRequest): Promise<void> {
    await this.httpClient.postJson<ApiEnvelope<unknown>>(
      "/variables",
      input,
      "upsert variable",
    );
  }

  private resolveHttpOptions(baseUrl: string): ServiceClientHttpOptions {
    return {
      baseUrl,
      authorizationHeaderResolver: () =>
        this.authTokenProvider.resolveAuthorizationHeader(),
    };
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
```

> If `ResolvedVariable` / `UpsertScopedVariableRequest` are not re-exported from `@nexus/core` root, import from `@nexus/core` after confirming the export in `packages/core/src/index.ts`; add the export there if missing and rebuild core.

- [ ] **Step 5: Register the provider**

In the module that provides `CoreScopeClientService`, add `CoreVariablesClientService` to `providers` and to `exports` (bind the `CORE_VARIABLES_CLIENT` token to `CoreVariablesClientService` if you prefer token injection; otherwise inject the class directly).

- [ ] **Step 6: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- core-variables-client`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/core/core-variables-client.* apps/kanban/src/core/*.module.ts
git commit -m "feat(kanban): authenticated HTTP client for the API variable store"
```

---

## Task 5: OrchestrationPolicy service + controller (resolve / validate / write / preset)

**Files:**

- Create: `apps/kanban/src/orchestration/orchestration-policy.service.ts`
- Create: `apps/kanban/src/orchestration/orchestration-policy.controller.ts`
- Modify: `apps/kanban/src/orchestration/orchestration.module.ts`
- Test: `apps/kanban/src/orchestration/orchestration-policy.service.spec.ts`

**Interfaces:**

- Consumes: `CoreVariablesClientService` (Task 4), `OrchestrationService` (existing — to mirror `mode`; assume `setModeMirror(projectId, mode)` added in Task 6, OR reuse the existing mode-setter — see Task 6 for the exact method), `ORCHESTRATION_POLICY_REGISTRY`, `validatePolicyEntry`, `autonomyValuesForMode`, `modeFromAutonomyValues`, `findPolicyDescriptor` from `@nexus/kanban-contracts`.
- Produces:
  - `interface ResolvedPolicyEntry { key: string; value: string | number | boolean; layer: string; defaultValue: string | number | boolean; descriptor: OrchestrationPolicyKeyDescriptor; }`
  - `resolvePolicy(projectId: string): Promise<ResolvedPolicyEntry[]>` — effective values for every registry key, defaulted when unset, with layer trace.
  - `updatePolicy(projectId: string, entries: Array<{ key: string; value: unknown }>): Promise<ResolvedPolicyEntry[]>` — validates each against the registry (throws `BadRequestException` on first invalid), upserts each as project-scoped vars, re-derives + mirrors `mode`, returns refreshed policy.
  - `applyPreset(projectId: string, mode: OrchestrationMode): Promise<ResolvedPolicyEntry[]>` — writes the three `autonomy.*` keys for the mode, mirrors `mode`, returns refreshed policy.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/kanban/src/orchestration/orchestration-policy.service.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { OrchestrationPolicyService } from "./orchestration-policy.service";

const variablesClient = { getEffective: vi.fn(), upsert: vi.fn() };
const orchestration = { setModeMirror: vi.fn() };

describe("OrchestrationPolicyService", () => {
  let service: OrchestrationPolicyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrchestrationPolicyService(
      variablesClient as never,
      orchestration as never,
    );
  });

  it("returns registry defaults when no variables are set", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    const policy = await service.resolvePolicy("proj-1");
    const dispatch = policy.find((p) => p.key === "autonomy.dispatch");
    expect(dispatch?.value).toBe("auto");
    expect(dispatch?.layer).toBe("default");
    expect(policy).toHaveLength(9);
  });

  it("overlays effective values with their layer trace", async () => {
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "ask",
        type: "string",
        layer: "proj-1",
      },
    ]);
    const policy = await service.resolvePolicy("proj-1");
    const dispatch = policy.find((p) => p.key === "autonomy.dispatch");
    expect(dispatch?.value).toBe("ask");
    expect(dispatch?.layer).toBe("proj-1");
  });

  it("rejects an invalid value before writing", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await expect(
      service.updatePolicy("proj-1", [
        { key: "autonomy.dispatch", value: "nope" },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(variablesClient.upsert).not.toHaveBeenCalled();
  });

  it("upserts valid entries as project-scoped vars and mirrors mode", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await service.updatePolicy("proj-1", [
      { key: "autonomy.dispatch", value: "off" },
      { key: "gates.rediscovery_merge_threshold", value: 5 },
    ]);
    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "proj-1",
      key: "autonomy.dispatch",
      value: "off",
      valueType: "string",
    });
    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "proj-1",
      key: "gates.rediscovery_merge_threshold",
      value: 5,
      valueType: "number",
    });
    expect(orchestration.setModeMirror).toHaveBeenCalledWith(
      "proj-1",
      "notifications_only",
    );
  });

  it("applies a preset by writing the three autonomy keys", async () => {
    variablesClient.getEffective.mockResolvedValue([]);
    await service.applyPreset("proj-1", "supervised");
    expect(variablesClient.upsert).toHaveBeenCalledTimes(3);
    expect(orchestration.setModeMirror).toHaveBeenCalledWith(
      "proj-1",
      "supervised",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- orchestration-policy.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// apps/kanban/src/orchestration/orchestration-policy.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import {
  ORCHESTRATION_POLICY_REGISTRY,
  autonomyValuesForMode,
  findPolicyDescriptor,
  modeFromAutonomyValues,
  validatePolicyEntry,
  type OrchestrationMode,
  type OrchestrationPolicyKeyDescriptor,
} from "@nexus/kanban-contracts";
import { CoreVariablesClientService } from "../core/core-variables-client.service";
import { OrchestrationService } from "./orchestration.service";

export interface ResolvedPolicyEntry {
  key: string;
  value: string | number | boolean;
  layer: string;
  defaultValue: string | number | boolean;
  descriptor: OrchestrationPolicyKeyDescriptor;
}

const DEFAULT_LAYER = "default";

@Injectable()
export class OrchestrationPolicyService {
  constructor(
    private readonly variablesClient: CoreVariablesClientService,
    private readonly orchestration: OrchestrationService,
  ) {}

  async resolvePolicy(projectId: string): Promise<ResolvedPolicyEntry[]> {
    const effective = await this.variablesClient.getEffective(projectId);
    const byKey = new Map(effective.map((v) => [v.key, v]));

    return ORCHESTRATION_POLICY_REGISTRY.map((descriptor) => {
      const resolved = byKey.get(descriptor.key);
      return {
        key: descriptor.key,
        value: (resolved?.value ?? descriptor.defaultValue) as
          | string
          | number
          | boolean,
        layer: resolved?.layer ?? DEFAULT_LAYER,
        defaultValue: descriptor.defaultValue,
        descriptor,
      };
    });
  }

  async updatePolicy(
    projectId: string,
    entries: Array<{ key: string; value: unknown }>,
  ): Promise<ResolvedPolicyEntry[]> {
    for (const entry of entries) {
      const result = validatePolicyEntry(entry.key, entry.value);
      if (!result.ok) {
        throw new BadRequestException(result.error);
      }
    }

    for (const entry of entries) {
      const descriptor = findPolicyDescriptor(entry.key);
      if (!descriptor) continue;
      await this.variablesClient.upsert({
        scopeNodeId: projectId,
        key: entry.key,
        value: entry.value,
        valueType: descriptor.valueType,
      });
    }

    return this.refreshAndMirror(projectId);
  }

  async applyPreset(
    projectId: string,
    mode: OrchestrationMode,
  ): Promise<ResolvedPolicyEntry[]> {
    const autonomy = autonomyValuesForMode(mode);
    for (const [key, value] of Object.entries(autonomy)) {
      await this.variablesClient.upsert({
        scopeNodeId: projectId,
        key,
        value,
        valueType: "string",
      });
    }
    return this.refreshAndMirror(projectId, mode);
  }

  private async refreshAndMirror(
    projectId: string,
    explicitMode?: OrchestrationMode,
  ): Promise<ResolvedPolicyEntry[]> {
    const policy = await this.resolvePolicy(projectId);
    const values = Object.fromEntries(policy.map((p) => [p.key, p.value]));
    const mode = explicitMode ?? modeFromAutonomyValues(values);
    await this.orchestration.setModeMirror(projectId, mode);
    return policy;
  }
}
```

- [ ] **Step 4: Implement the controller**

```typescript
// apps/kanban/src/orchestration/orchestration-policy.controller.ts
import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { OrchestrationPolicyModeSchema } from "@nexus/kanban-contracts";
import { z } from "zod";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { OrchestrationPolicyService } from "./orchestration-policy.service";

const UpdatePolicySchema = z.object({
  entries: z.array(z.object({ key: z.string().min(1), value: z.unknown() })),
});

const PresetSchema = z.object({ mode: OrchestrationPolicyModeSchema });

@ApiTags("orchestration-policy")
@UseGuards(KanbanPermissionsGuard)
@Controller("orchestration")
export class OrchestrationPolicyController {
  constructor(private readonly policy: OrchestrationPolicyService) {}

  @Get(":projectId/policy")
  @ApiOperation({
    summary: "Resolve effective orchestration policy for a project",
  })
  async resolve(@Param("projectId") projectId: string) {
    return { success: true, data: await this.policy.resolvePolicy(projectId) };
  }

  @Put(":projectId/policy")
  @ApiOperation({ summary: "Update curated orchestration policy values" })
  async update(@Param("projectId") projectId: string, @Body() body: unknown) {
    const { entries } = UpdatePolicySchema.parse(body);
    return {
      success: true,
      data: await this.policy.updatePolicy(projectId, entries),
    };
  }

  @Put(":projectId/policy/preset")
  @ApiOperation({
    summary: "Apply a mode preset (writes the three autonomy keys)",
  })
  async preset(@Param("projectId") projectId: string, @Body() body: unknown) {
    const { mode } = PresetSchema.parse(body);
    return {
      success: true,
      data: await this.policy.applyPreset(projectId, mode),
    };
  }
}
```

> Match the project's existing controller validation idiom: if other kanban controllers use a `ZodBody`-style decorator or a validation pipe rather than inline `.parse()`, mirror that here. Confirm the guard name/path used by sibling controllers in `apps/kanban/src/orchestration/` and reuse it.

- [ ] **Step 5: Register in the module**

In `orchestration.module.ts`: add `OrchestrationPolicyService` to `providers`, `OrchestrationPolicyController` to `controllers`, and ensure `CoreVariablesClientService` is importable (import the module that exports it from Task 4).

- [ ] **Step 6: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- orchestration-policy.service`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration-policy.* apps/kanban/src/orchestration/orchestration.module.ts
git commit -m "feat(kanban): orchestration policy service + controller over the variable store"
```

---

## Task 6: Make `mode` a display mirror

**Files:**

- Modify: `apps/kanban/src/orchestration/orchestration.service.ts`
- Test: `apps/kanban/src/orchestration/orchestration.service.spec.ts` (exists — add a case)

**Interfaces:**

- Produces: `OrchestrationService.setModeMirror(projectId: string, mode: KanbanOrchestrationMode): Promise<void>` — persists `mode` to the `KanbanOrchestrationEntity.mode` column **without** triggering enforcement side effects (it is a denormalized display cache).
- Consumes: existing repository update method on `KanbanOrchestrationRepository` (find the existing mode-write path; reuse it).

- [ ] **Step 1: Write the failing test**

In `orchestration.service.spec.ts`:

```typescript
it("setModeMirror persists the derived mode without re-launching", async () => {
  await service.setModeMirror("proj-1", "supervised");
  expect(orchestrations.updateMode).toHaveBeenCalledWith(
    "proj-1",
    "supervised",
  );
  // mirror must not start/stop runs:
  expect(coreClient.requestWorkflowRun).not.toHaveBeenCalled();
});
```

> Use the spec file's existing mock names. If the repository method is not named `updateMode`, assert on the actual persistence method the existing mode-setter calls (discover it by reading the current mode-update path in `orchestration.service.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- orchestration.service.spec`
Expected: FAIL — `setModeMirror` undefined.

- [ ] **Step 3: Implement `setModeMirror` and re-point the existing mode update**

Add to `OrchestrationService`:

```typescript
async setModeMirror(
  projectId: string,
  mode: KanbanOrchestrationMode,
): Promise<void> {
  await this.orchestrations.updateMode(projectId, mode);
}
```

Find the existing public method the web Mode selector calls (the one behind `PATCH`/`PUT` project orchestration mode — search `grep -rn "orchestrationMode" apps/kanban/src/orchestration --include=*.ts` for the setter). Re-point it to delegate to `OrchestrationPolicyService.applyPreset(projectId, mode)` so selecting a mode now writes the three `autonomy.*` vars and mirrors the column.

> To avoid a circular dependency (`OrchestrationService` ↔ `OrchestrationPolicyService`), inject `OrchestrationPolicyService` into the controller/handler that serves the mode endpoint (not into `OrchestrationService`), and call `applyPreset` there. `setModeMirror` on `OrchestrationService` stays dependency-free.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- orchestration.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration.service.ts apps/kanban/src/orchestration/orchestration.service.spec.ts
git commit -m "feat(kanban): mode column becomes a display mirror of autonomy vars"
```

---

## Task 7: Startup backfill of existing projects

**Files:**

- Create: `apps/kanban/src/orchestration/orchestration-policy-backfill.service.ts`
- Modify: `apps/kanban/src/orchestration/orchestration.module.ts`
- Test: `apps/kanban/src/orchestration/orchestration-policy-backfill.service.spec.ts`

**Interfaces:**

- Consumes: a repository method that lists all orchestrations with `{ projectId, mode }` (discover the existing list method on `KanbanOrchestrationRepository`; if none returns mode, add a thin `listAllModes(): Promise<Array<{ projectId: string; mode: string }>>`), `CoreVariablesClientService.getEffective` + `.upsert`, `autonomyValuesForMode`.
- Produces: `OrchestrationPolicyBackfillService implements OnApplicationBootstrap` — for each project, if no project-scoped (`layer === projectId`) `autonomy.*` var exists, upsert the three keys from `autonomyValuesForMode(mode)`. Idempotent; logs counts; never throws out of bootstrap (catches and logs per project).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/kanban/src/orchestration/orchestration-policy-backfill.service.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrchestrationPolicyBackfillService } from "./orchestration-policy-backfill.service";

const orchestrations = { listAllModes: vi.fn() };
const variablesClient = { getEffective: vi.fn(), upsert: vi.fn() };

describe("OrchestrationPolicyBackfillService", () => {
  let service: OrchestrationPolicyBackfillService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrchestrationPolicyBackfillService(
      orchestrations as never,
      variablesClient as never,
    );
  });

  it("backfills autonomy vars from mode when project has no project-scoped override", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-sup", mode: "supervised" },
    ]);
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "auto",
        type: "string",
        layer: "global",
      },
    ]);

    await service.onApplicationBootstrap();

    expect(variablesClient.upsert).toHaveBeenCalledWith({
      scopeNodeId: "p-sup",
      key: "autonomy.dispatch",
      value: "ask",
      valueType: "string",
    });
    expect(variablesClient.upsert).toHaveBeenCalledTimes(3);
  });

  it("skips projects that already have a project-scoped autonomy override", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-set", mode: "autonomous" },
    ]);
    variablesClient.getEffective.mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "ask",
        type: "string",
        layer: "p-set",
      },
    ]);

    await service.onApplicationBootstrap();

    expect(variablesClient.upsert).not.toHaveBeenCalled();
  });

  it("isolates per-project failures", async () => {
    orchestrations.listAllModes.mockResolvedValue([
      { projectId: "p-bad", mode: "supervised" },
      { projectId: "p-ok", mode: "supervised" },
    ]);
    variablesClient.getEffective
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([]);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(variablesClient.upsert).toHaveBeenCalled(); // p-ok still processed
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test --workspace=apps/kanban -- orchestration-policy-backfill`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the backfill service**

```typescript
// apps/kanban/src/orchestration/orchestration-policy-backfill.service.ts
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  AUTONOMY_BACKLOG_PROMOTION_KEY,
  AUTONOMY_DISPATCH_KEY,
  AUTONOMY_MERGE_KEY,
  autonomyValuesForMode,
  type OrchestrationMode,
} from "@nexus/kanban-contracts";
import { CoreVariablesClientService } from "../core/core-variables-client.service";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";

const AUTONOMY_KEYS = [
  AUTONOMY_DISPATCH_KEY,
  AUTONOMY_BACKLOG_PROMOTION_KEY,
  AUTONOMY_MERGE_KEY,
];

@Injectable()
export class OrchestrationPolicyBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrchestrationPolicyBackfillService.name);

  constructor(
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly variablesClient: CoreVariablesClientService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let backfilled = 0;
    const projects = await this.orchestrations.listAllModes().catch((error) => {
      this.logger.error(`Backfill skipped: ${String(error)}`);
      return [] as Array<{ projectId: string; mode: string }>;
    });

    for (const { projectId, mode } of projects) {
      try {
        if (await this.hasProjectScopedAutonomy(projectId)) continue;
        const autonomy = autonomyValuesForMode(this.normalizeMode(mode));
        for (const [key, value] of Object.entries(autonomy)) {
          await this.variablesClient.upsert({
            scopeNodeId: projectId,
            key,
            value,
            valueType: "string",
          });
        }
        backfilled += 1;
      } catch (error) {
        this.logger.warn(
          `Autonomy backfill failed for ${projectId}: ${String(error)}`,
        );
      }
    }

    this.logger.log(`Orchestration autonomy backfill complete: ${backfilled}`);
  }

  private async hasProjectScopedAutonomy(projectId: string): Promise<boolean> {
    const effective = await this.variablesClient.getEffective(projectId);
    return effective.some(
      (v) => AUTONOMY_KEYS.includes(v.key) && v.layer === projectId,
    );
  }

  private normalizeMode(mode: string): OrchestrationMode {
    if (mode === "autonomous" || mode === "notifications_only") return mode;
    return "supervised";
  }
}
```

> If `KanbanOrchestrationRepository` lacks `listAllModes`, add it: a query returning `project_id` + `mode` for all rows. Reuse the repository's existing query builder/entity manager.

- [ ] **Step 4: Register in the module**

Add `OrchestrationPolicyBackfillService` to `orchestration.module.ts` `providers`.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test --workspace=apps/kanban -- orchestration-policy-backfill`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration-policy-backfill.service.* apps/kanban/src/orchestration/orchestration.module.ts apps/kanban/src/database/repositories/kanban-orchestration.repository.ts
git commit -m "feat(kanban): startup backfill of per-project autonomy vars from legacy mode"
```

---

## Task 8: Web API clients + hooks (generic variables + curated policy)

**Files:**

- Create: `apps/web/src/lib/api/client.variables.ts`
- Create: `apps/web/src/lib/api/client.orchestration-policy.ts`
- Create: `apps/web/src/hooks/useScopedVariables.ts`
- Create: `apps/web/src/hooks/useOrchestrationPolicy.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`
- Test: `apps/web/src/hooks/useOrchestrationPolicy.spec.ts`

**Interfaces:**

- Consumes: `api.get/post/put/delete` (`apps/web/src/lib/api/client.ts`).
- Produces (types):
  - `interface ScopedVariableRow { id: string; scope_node_id: string | null; key: string; value: unknown; value_type: "string" | "number" | "boolean" | "json"; description: string | null; }`
  - `interface ResolvedVariableDto { key: string; value: unknown; type: string; layer: string; }`
  - `interface ResolvedPolicyEntryDto { key: string; value: string | number | boolean; layer: string; defaultValue: string | number | boolean; descriptor: { key: string; valueType: "string"|"number"|"boolean"; enumValues?: string[]; group: string; label: string; description: string; min?: number; max?: number; step?: number; } }`
  - API fns: `listVariables(scopeId?)`, `getEffectiveVariables(scopeId?)`, `upsertVariable(body)`, `deleteVariable(key, scopeId?)`, `getOrchestrationPolicy(projectId)`, `updateOrchestrationPolicy(projectId, entries)`, `applyOrchestrationPreset(projectId, mode)`.
  - Hooks: `useScopedVariables(scopeId)`, `useEffectiveVariables(scopeId)`, `useUpsertVariable()`, `useDeleteVariable()`, `useOrchestrationPolicy(projectId)`, `useUpdateOrchestrationPolicy(projectId)`, `useApplyOrchestrationPreset(projectId)`.

- [ ] **Step 1: Add query keys**

In `apps/web/src/lib/queryKeys.ts` add to the `queryKeys` object:

```typescript
  variables: {
    list: (scopeId: string | null) => ["variables", "list", scopeId] as const,
    effective: (scopeId: string | null) =>
      ["variables", "effective", scopeId] as const,
  },
  orchestrationPolicy: {
    detail: (projectId: string) =>
      ["orchestration-policy", projectId] as const,
  },
```

- [ ] **Step 2: Write the API clients**

```typescript
// apps/web/src/lib/api/client.variables.ts
import { api } from "./client";

export interface ScopedVariableRow {
  id: string;
  scope_node_id: string | null;
  key: string;
  value: unknown;
  value_type: "string" | "number" | "boolean" | "json";
  description: string | null;
}

export interface ResolvedVariableDto {
  key: string;
  value: unknown;
  type: string;
  layer: string;
}

export interface UpsertVariableBody {
  scopeNodeId: string | null;
  key: string;
  value: unknown;
  valueType: "string" | "number" | "boolean" | "json";
  description?: string | null;
}

const scopeParam = (scopeId?: string | null) =>
  scopeId ? { params: { scopeId } } : undefined;

export async function listVariables(
  scopeId?: string | null,
): Promise<ScopedVariableRow[]> {
  const res = await api.get<{ success: boolean; data: ScopedVariableRow[] }>(
    "/variables",
    scopeParam(scopeId),
  );
  return res.data;
}

export async function getEffectiveVariables(
  scopeId?: string | null,
): Promise<ResolvedVariableDto[]> {
  const res = await api.get<{ success: boolean; data: ResolvedVariableDto[] }>(
    "/variables/effective",
    scopeParam(scopeId),
  );
  return res.data;
}

export async function upsertVariable(body: UpsertVariableBody): Promise<void> {
  await api.post("/variables", body);
}

export async function deleteVariable(
  key: string,
  scopeId?: string | null,
): Promise<void> {
  const query = new URLSearchParams({ key });
  if (scopeId) query.set("scopeId", scopeId);
  await api.delete(`/variables?${query.toString()}`);
}
```

```typescript
// apps/web/src/lib/api/client.orchestration-policy.ts
import { api } from "./client";

export type OrchestrationMode =
  | "autonomous"
  | "supervised"
  | "notifications_only";

export interface PolicyDescriptorDto {
  key: string;
  valueType: "string" | "number" | "boolean";
  enumValues?: string[];
  group: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ResolvedPolicyEntryDto {
  key: string;
  value: string | number | boolean;
  layer: string;
  defaultValue: string | number | boolean;
  descriptor: PolicyDescriptorDto;
}

export async function getOrchestrationPolicy(
  projectId: string,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.get<{
    success: boolean;
    data: ResolvedPolicyEntryDto[];
  }>(`/orchestration/${projectId}/policy`);
  return res.data;
}

export async function updateOrchestrationPolicy(
  projectId: string,
  entries: Array<{ key: string; value: unknown }>,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.put<{
    success: boolean;
    data: ResolvedPolicyEntryDto[];
  }>(`/orchestration/${projectId}/policy`, { entries });
  return res.data;
}

export async function applyOrchestrationPreset(
  projectId: string,
  mode: OrchestrationMode,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.put<{
    success: boolean;
    data: ResolvedPolicyEntryDto[];
  }>(`/orchestration/${projectId}/policy/preset`, { mode });
  return res.data;
}
```

> The kanban policy controller is served by the kanban service. Confirm the web base URL routing: if web reaches kanban through the API gateway prefix used by other kanban calls (check `client.projects.settings.ts` for how kanban settings are fetched), prefix the policy paths the same way. If kanban has its own base URL in `config.ts`, route these clients there.

- [ ] **Step 3: Write the hooks**

```typescript
// apps/web/src/hooks/useScopedVariables.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  deleteVariable,
  getEffectiveVariables,
  listVariables,
  upsertVariable,
  type UpsertVariableBody,
} from "@/lib/api/client.variables";

export function useScopedVariables(scopeId: string | null) {
  return useQuery({
    queryKey: queryKeys.variables.list(scopeId),
    queryFn: () => listVariables(scopeId),
  });
}

export function useEffectiveVariables(scopeId: string | null) {
  return useQuery({
    queryKey: queryKeys.variables.effective(scopeId),
    queryFn: () => getEffectiveVariables(scopeId),
  });
}

export function useUpsertVariable(scopeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertVariableBody) => upsertVariable(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.list(scopeId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.effective(scopeId),
      });
    },
  });
}

export function useDeleteVariable(scopeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteVariable(key, scopeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.list(scopeId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.variables.effective(scopeId),
      });
    },
  });
}
```

```typescript
// apps/web/src/hooks/useOrchestrationPolicy.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  applyOrchestrationPreset,
  getOrchestrationPolicy,
  updateOrchestrationPolicy,
  type OrchestrationMode,
} from "@/lib/api/client.orchestration-policy";

export function useOrchestrationPolicy(projectId: string) {
  return useQuery({
    queryKey: queryKeys.orchestrationPolicy.detail(projectId),
    queryFn: () => getOrchestrationPolicy(projectId),
    enabled: !!projectId,
  });
}

export function useUpdateOrchestrationPolicy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: Array<{ key: string; value: unknown }>) =>
      updateOrchestrationPolicy(projectId, entries),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestrationPolicy.detail(projectId),
      }),
  });
}

export function useApplyOrchestrationPreset(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: OrchestrationMode) =>
      applyOrchestrationPreset(projectId, mode),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestrationPolicy.detail(projectId),
      }),
  });
}
```

> Confirm the React Query import path matches the rest of the web app (`@tanstack/react-query`). Match the existing `useProjectOrchestration.ts` import style exactly.

- [ ] **Step 4: Write a hook test**

```typescript
// apps/web/src/hooks/useOrchestrationPolicy.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOrchestrationPolicy } from "./useOrchestrationPolicy";
import * as client from "@/lib/api/client.orchestration-policy";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useOrchestrationPolicy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches resolved policy for a project", async () => {
    vi.spyOn(client, "getOrchestrationPolicy").mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "auto",
        layer: "default",
        defaultValue: "auto",
        descriptor: {
          key: "autonomy.dispatch",
          valueType: "string",
          enumValues: ["auto", "ask", "off"],
          group: "autonomy",
          label: "Dispatch",
          description: "",
        },
      },
    ]);

    const { result } = renderHook(() => useOrchestrationPolicy("p-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].key).toBe("autonomy.dispatch");
  });
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:unit:web -- useOrchestrationPolicy`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/client.variables.ts apps/web/src/lib/api/client.orchestration-policy.ts apps/web/src/hooks/useScopedVariables.ts apps/web/src/hooks/useOrchestrationPolicy.ts apps/web/src/hooks/useOrchestrationPolicy.spec.ts apps/web/src/lib/queryKeys.ts
git commit -m "feat(web): API clients + hooks for scoped variables and orchestration policy"
```

---

## Task 9: Web — generic Variables editor + curated Orchestration Policy panel

**Files:**

- Create: `apps/web/src/pages/variables/VariablesEditorPage.tsx`
- Create: `apps/web/src/components/orchestration/OrchestrationPolicyPanel.tsx`
- Modify: `apps/web/src/App.tsx` (add `/variables` route)
- Modify: the project workspace orchestration tab (where `OrchestrationControlsCard` renders) to mount `OrchestrationPolicyPanel`
- Test: `apps/web/src/components/orchestration/OrchestrationPolicyPanel.spec.tsx`

**Interfaces:**

- Consumes: hooks from Task 8; shadcn primitives `Card`, `Label`, `Select`, `Switch`, `Input`, `Button`, `Badge` from `@/components/ui/*`.
- Produces: `OrchestrationPolicyPanel({ projectId }: { projectId: string })` — renders one control per registry entry grouped by `descriptor.group`: enum → `Select`, boolean → `Switch`, number → `Input type="number"` (respecting `min`/`max`/`step`); shows the layer badge (`default` vs `project`); a "Mode preset" `Select` calling `useApplyOrchestrationPreset`; a Save button calling `useUpdateOrchestrationPolicy` with the changed entries.

- [ ] **Step 1: Write the failing component test**

```typescript
// apps/web/src/components/orchestration/OrchestrationPolicyPanel.spec.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrchestrationPolicyPanel } from "./OrchestrationPolicyPanel";
import * as hooks from "@/hooks/useOrchestrationPolicy";

const updateMutate = vi.fn();

const policyEntry = {
  key: "backlog.ideation_enabled",
  value: true,
  layer: "default",
  defaultValue: true,
  descriptor: {
    key: "backlog.ideation_enabled",
    valueType: "boolean" as const,
    group: "backlog",
    label: "Ideation enabled",
    description: "Whether the ideation gate may fire.",
  },
};

describe("OrchestrationPolicyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(hooks, "useOrchestrationPolicy").mockReturnValue({
      data: [policyEntry],
      isLoading: false,
    } as never);
    vi.spyOn(hooks, "useUpdateOrchestrationPolicy").mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as never);
    vi.spyOn(hooks, "useApplyOrchestrationPreset").mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as never);
  });

  it("renders a control per registry entry with its label", () => {
    render(<OrchestrationPolicyPanel projectId="p-1" />);
    expect(screen.getByText("Ideation enabled")).toBeTruthy();
  });

  it("saves only changed entries", () => {
    render(<OrchestrationPolicyPanel projectId="p-1" />);
    fireEvent.click(screen.getByRole("switch", { name: /ideation enabled/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateMutate).toHaveBeenCalledWith([
      { key: "backlog.ideation_enabled", value: false },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit:web -- OrchestrationPolicyPanel`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `OrchestrationPolicyPanel`**

```tsx
// apps/web/src/components/orchestration/OrchestrationPolicyPanel.tsx
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useApplyOrchestrationPreset,
  useOrchestrationPolicy,
  useUpdateOrchestrationPolicy,
} from "@/hooks/useOrchestrationPolicy";
import type { ResolvedPolicyEntryDto } from "@/lib/api/client.orchestration-policy";

type DraftValue = string | number | boolean;

function PolicyControl(props: {
  entry: ResolvedPolicyEntryDto;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
}) {
  const { entry, value, onChange } = props;
  const { descriptor } = entry;

  if (descriptor.valueType === "boolean") {
    return (
      <Switch
        aria-label={descriptor.label}
        checked={value as boolean}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }
  if (descriptor.valueType === "number") {
    return (
      <Input
        type="number"
        aria-label={descriptor.label}
        value={String(value)}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (descriptor.enumValues) {
    return (
      <Select value={String(value)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger aria-label={descriptor.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {descriptor.enumValues.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      aria-label={descriptor.label}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function OrchestrationPolicyPanel({
  projectId,
}: Readonly<{ projectId: string }>) {
  const { data, isLoading } = useOrchestrationPolicy(projectId);
  const update = useUpdateOrchestrationPolicy(projectId);
  const preset = useApplyOrchestrationPreset(projectId);
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});

  useEffect(() => {
    if (data) {
      setDraft(Object.fromEntries(data.map((e) => [e.key, e.value])));
    }
  }, [data]);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent>Loading policy…</CardContent>
      </Card>
    );
  }

  const changed = data
    .filter((e) => draft[e.key] !== e.value)
    .map((e) => ({ key: e.key, value: draft[e.key] }));

  const groups = Array.from(new Set(data.map((e) => e.descriptor.group)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Orchestration Policy</span>
          <Select
            onValueChange={(mode) =>
              preset.mutate(
                mode as "autonomous" | "supervised" | "notifications_only",
              )
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Apply preset…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="autonomous">autonomous</SelectItem>
              <SelectItem value="supervised">supervised</SelectItem>
              <SelectItem value="notifications_only">
                notifications_only
              </SelectItem>
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((group) => (
          <div key={group} className="space-y-3">
            <h4 className="text-sm font-semibold capitalize">{group}</h4>
            {data
              .filter((e) => e.descriptor.group === group)
              .map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="space-y-0.5">
                    <Label>{entry.descriptor.label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {entry.descriptor.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {entry.layer === "default" ? "default" : "project"}
                    </Badge>
                    <PolicyControl
                      entry={entry}
                      value={draft[entry.key] ?? entry.value}
                      onChange={(value) =>
                        setDraft((prev) => ({ ...prev, [entry.key]: value }))
                      }
                    />
                  </div>
                </div>
              ))}
          </div>
        ))}
        <Button
          disabled={changed.length === 0 || update.isPending}
          onClick={() => update.mutate(changed)}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the panel test to verify pass**

Run: `npm run test:unit:web -- OrchestrationPolicyPanel`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the generic Variables editor page**

```tsx
// apps/web/src/pages/variables/VariablesEditorPage.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDeleteVariable,
  useScopedVariables,
  useUpsertVariable,
} from "@/hooks/useScopedVariables";

const VALUE_TYPES = ["string", "number", "boolean", "json"] as const;

function coerce(value: string, type: (typeof VALUE_TYPES)[number]): unknown {
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "json") return JSON.parse(value);
  return value;
}

export function VariablesEditorPage() {
  // Scope selection: reuse the existing ScopeNodePicker if a scope filter is desired.
  // Null scopeId == global layer.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const { data: rows } = useScopedVariables(scopeId);
  const upsert = useUpsertVariable(scopeId);
  const remove = useDeleteVariable(scopeId);

  const [key, setKey] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [valueType, setValueType] =
    useState<(typeof VALUE_TYPES)[number]>("string");

  const handleSave = () => {
    upsert.mutate({
      scopeNodeId: scopeId,
      key,
      value: coerce(rawValue, valueType),
      valueType,
    });
    setKey("");
    setRawValue("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Variables ({scopeId ? "project" : "global"})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Key</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Value</Label>
            <Input
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={valueType}
              onValueChange={(v) =>
                setValueType(v as (typeof VALUE_TYPES)[number])
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={!key}>
            Save
          </Button>
        </div>

        <div className="space-y-2">
          {(rows ?? []).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded border p-2"
            >
              <span className="font-mono text-sm">
                {row.key} = {JSON.stringify(row.value)} ({row.value_type})
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => remove.mutate(row.key)}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Wire routing + panel mount**

In `apps/web/src/App.tsx`, add inside the protected nested `<Routes>`:

```tsx
<Route path="/variables" element={<VariablesEditorPage />} />
```

(import `VariablesEditorPage` at the top). In the project workspace orchestration tab — the file that renders `<OrchestrationControlsCard .../>` (search `grep -rn "OrchestrationControlsCard" apps/web/src --include=*.tsx`) — mount `<OrchestrationPolicyPanel projectId={projectId} />` beneath it.

- [ ] **Step 7: Typecheck + run web unit tests**

Run: `npm run build:web` (or the web typecheck script) then `npm run test:unit:web -- VariablesEditor OrchestrationPolicyPanel`
Expected: typecheck clean; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/variables apps/web/src/components/orchestration/OrchestrationPolicyPanel.tsx apps/web/src/components/orchestration/OrchestrationPolicyPanel.spec.tsx apps/web/src/App.tsx
git commit -m "feat(web): generic variables editor + curated orchestration policy panel"
```

---

## Task 10: Phase 2 verification gate (no behavior drift + lint)

**Files:** none (verification only).

- [ ] **Step 1: Lint the touched workspaces**

Run: `npm run lint:summary`
Expected: zero new errors in `packages/kanban-contracts`, `apps/kanban`, `apps/web`, `apps/api`. Fix any in code (no suppression).

- [ ] **Step 2: Run the full unit suites for changed apps**

Run: `npm run test:kanban && npm run test:api && npm run test:unit:web`
Expected: all PASS.

- [ ] **Step 3: Boundary check**

Run: `npm run lint:api` and confirm `nexus-boundaries/no-core-kanban-residue` reports nothing — the API variable store must not reference any orchestration key or `@nexus/kanban-contracts`.

- [ ] **Step 4: Zero-drift confirmation**

Confirm via the CEO seed-contract spec (Task 3) and the registry defaults (Task 1) that with seeded global defaults the CEO gates and dispatch/promotion evaluate exactly as before the refactor (dispatch=auto ⇒ `autonomous_mode=true`; backlog_promotion=auto ⇒ promote fires at todo_count=0; thresholds 10/2). Document the result in the PR description.

- [ ] **Step 5: Commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore: phase 2 lint + verification fixes"
```

---

# PHASE 3 — Polish: audit history + effective-config inspector

## Task 11: Variable change audit history (API)

**Files:**

- Create: `apps/api/src/variables/database/entities/scoped-variable-audit.entity.ts`
- Create: `apps/api/src/variables/database/repositories/scoped-variable-audit.repository.ts`
- Create: `apps/api/src/database/migrations/20260620090000-create-scoped-variable-audit.ts`
- Modify: `apps/api/src/variables/database/repositories/scoped-variable.repository.ts`
- Modify: `apps/api/src/variables/variables.controller.ts`
- Modify: `apps/api/src/variables/variables.module.ts`, `apps/api/src/database/database.module.ts`
- Test: `apps/api/src/variables/scoped-variable-audit.spec.ts`

Follows the `adding-entity-migration` skill (domain-local entity dir, repository pattern, DatabaseModule registration).

**Interfaces:**

- Produces:
  - Entity `ScopedVariableAudit` columns: `id` uuid PK, `scope_node_id` uuid nullable, `key` varchar(128), `action` enum(`upsert`,`delete`), `previous_value` jsonb nullable, `new_value` jsonb nullable, `actor` varchar nullable, `created_at` timestamptz.
  - `ScopedVariableAuditRepository.record({ scopeNodeId, key, action, previousValue, newValue, actor }): Promise<void>`
  - `ScopedVariableAuditRepository.listFor(scopeNodeId: string | null, key?: string): Promise<ScopedVariableAudit[]>`
  - New route `GET /variables/audit?scopeId&key`.
- Consumes: existing `ScopedVariableRepository.upsert` / `deleteByKeyAndScope` (record audit inside them, reading prior value via `findOneByKeyAndScope`).

- [ ] **Step 1: Write the failing repository test**

```typescript
// apps/api/src/variables/scoped-variable-audit.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScopedVariableRepository } from "./database/repositories/scoped-variable.repository";

describe("ScopedVariableRepository audit integration", () => {
  let repo: ScopedVariableRepository;
  const ormRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    create: vi.fn((x) => x),
  };
  const audit = { record: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ScopedVariableRepository(ormRepo as never, audit as never);
  });

  it("records an upsert audit with previous + new value", async () => {
    ormRepo.findOne.mockResolvedValue({
      key: "autonomy.dispatch",
      value: "auto",
      scope_node_id: "p-1",
    });
    ormRepo.save.mockResolvedValue({});

    await repo.upsert({
      scopeNodeId: "p-1",
      key: "autonomy.dispatch",
      value: "ask",
      valueType: "string",
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeNodeId: "p-1",
        key: "autonomy.dispatch",
        action: "upsert",
        previousValue: "auto",
        newValue: "ask",
      }),
    );
  });

  it("records a delete audit", async () => {
    ormRepo.findOne.mockResolvedValue({
      key: "autonomy.dispatch",
      value: "ask",
      scope_node_id: "p-1",
    });
    ormRepo.delete.mockResolvedValue({});

    await repo.deleteByKeyAndScope("autonomy.dispatch", "p-1");

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", previousValue: "ask" }),
    );
  });
});
```

> Match the actual constructor signature/ORM access pattern of the existing `ScopedVariableRepository` (it may use `DataSource`/`EntityManager` rather than an injected repo). Adapt the mock to the real shape; the assertion on `audit.record` is the behavior under test.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:api -- scoped-variable-audit`
Expected: FAIL — repo doesn't accept/call an audit recorder.

- [ ] **Step 3: Create the entity**

```typescript
// apps/api/src/variables/database/entities/scoped-variable-audit.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "scoped_variable_audit" })
@Index(["scope_node_id", "key"])
export class ScopedVariableAudit {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", nullable: true })
  scope_node_id!: string | null;

  @Column({ type: "varchar", length: 128 })
  key!: string;

  @Column({ type: "varchar", length: 16 })
  action!: "upsert" | "delete";

  @Column({ type: "jsonb", nullable: true })
  previous_value!: unknown;

  @Column({ type: "jsonb", nullable: true })
  new_value!: unknown;

  @Column({ type: "varchar", nullable: true })
  actor!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
```

- [ ] **Step 4: Create the migration**

```typescript
// apps/api/src/database/migrations/20260620090000-create-scoped-variable-audit.ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScopedVariableAudit20260620090000 implements MigrationInterface {
  name = "CreateScopedVariableAudit20260620090000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scoped_variable_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope_node_id" uuid,
        "key" varchar(128) NOT NULL,
        "action" varchar(16) NOT NULL,
        "previous_value" jsonb,
        "new_value" jsonb,
        "actor" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scoped_variable_audit" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_scoped_variable_audit_scope_key"
        ON "scoped_variable_audit" ("scope_node_id", "key")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scoped_variable_audit_scope_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scoped_variable_audit"`);
  }
}
```

> Match the migration class/naming convention used by `20260619120000-create-scoped-variables.ts` exactly (timestamp prefix, exported class name, `gen_random_uuid()` vs `uuid_generate_v4()`).

- [ ] **Step 5: Create the audit repository**

```typescript
// apps/api/src/variables/database/repositories/scoped-variable-audit.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ScopedVariableAudit } from "../entities/scoped-variable-audit.entity";

export interface RecordAuditInput {
  scopeNodeId: string | null;
  key: string;
  action: "upsert" | "delete";
  previousValue: unknown;
  newValue: unknown;
  actor?: string | null;
}

@Injectable()
export class ScopedVariableAuditRepository {
  constructor(
    @InjectRepository(ScopedVariableAudit)
    private readonly repo: Repository<ScopedVariableAudit>,
  ) {}

  async record(input: RecordAuditInput): Promise<void> {
    await this.repo.save(
      this.repo.create({
        scope_node_id: input.scopeNodeId,
        key: input.key,
        action: input.action,
        previous_value: input.previousValue ?? null,
        new_value: input.newValue ?? null,
        actor: input.actor ?? null,
      }),
    );
  }

  async listFor(
    scopeNodeId: string | null,
    key?: string,
  ): Promise<ScopedVariableAudit[]> {
    return this.repo.find({
      where: { scope_node_id: scopeNodeId, ...(key ? { key } : {}) },
      order: { created_at: "DESC" },
      take: 200,
    });
  }
}
```

> If the existing `ScopedVariableRepository` does NOT use `@InjectRepository`, match the audit repo to the same DataSource/manager pattern instead.

- [ ] **Step 6: Wire audit into `ScopedVariableRepository`**

Inject `ScopedVariableAuditRepository` into `ScopedVariableRepository`. In `upsert`, before writing, read the prior row via `findOneByKeyAndScope`, then after `save`, call `audit.record({ ..., action: "upsert", previousValue: prior?.value ?? null, newValue: input.value })`. In `deleteByKeyAndScope`, read prior, delete, then `audit.record({ action: "delete", previousValue: prior?.value ?? null, newValue: null })`.

- [ ] **Step 7: Add the audit endpoint**

In `variables.controller.ts`:

```typescript
  @Get('audit')
  @ApiOperation({ summary: 'List audit history for a scope (optionally by key)' })
  async audit(
    @Query('scopeId') scopeId?: string,
    @Query('key') key?: string,
  ) {
    const data = await this.auditRepository.listFor(scopeId ?? null, key);
    return { success: true, data };
  }
```

Inject `ScopedVariableAuditRepository` into the controller. **Order matters:** declare the `audit` route handler before any catch-all; `GET /variables/audit` must not be shadowed by `GET /variables`.

- [ ] **Step 8: Register entity/repo**

Add `ScopedVariableAudit` to the `TypeOrmModule.forFeature([...])` (where `ScopedVariable` is registered) and add `ScopedVariableAuditRepository` to `variables.module.ts` providers (+ exports if needed). Register the entity in `database.module.ts` alongside `ScopedVariable`.

- [ ] **Step 9: Run to verify pass**

Run: `npm run test:api -- scoped-variable-audit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/variables apps/api/src/database/migrations/20260620090000-create-scoped-variable-audit.ts apps/api/src/database/database.module.ts
git commit -m "feat(api): scoped-variable change audit history + endpoint"
```

---

## Task 12: Effective-config inspector (web)

**Files:**

- Create: `apps/web/src/components/variables/EffectiveConfigInspector.tsx`
- Modify: mount it in the Variables editor page and/or the project workspace policy area
- Test: `apps/web/src/components/variables/EffectiveConfigInspector.spec.tsx`

**Interfaces:**

- Consumes: `useEffectiveVariables(scopeId)` (Task 8) — `ResolvedVariableDto[]` carrying `layer` (`global` or scope id). Optionally `GET /variables/audit` via a small `useVariableAudit(scopeId, key)` hook (add to `client.variables.ts` if surfacing history rows).
- Produces: `EffectiveConfigInspector({ scopeId }: { scopeId: string | null })` — a table of `key`, resolved `value`, and a layer badge (`global` vs `project`), so users see provenance per spec §6/§10 Phase 3.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/components/variables/EffectiveConfigInspector.spec.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffectiveConfigInspector } from "./EffectiveConfigInspector";
import * as hooks from "@/hooks/useScopedVariables";

describe("EffectiveConfigInspector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the resolving layer for each effective variable", () => {
    vi.spyOn(hooks, "useEffectiveVariables").mockReturnValue({
      data: [
        { key: "autonomy.dispatch", value: "ask", type: "string", layer: "p-1" },
        { key: "autonomy.merge", value: "ask", type: "string", layer: "global" },
      ],
      isLoading: false,
    } as never);

    render(<EffectiveConfigInspector scopeId="p-1" />);

    expect(screen.getByText("autonomy.dispatch")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("global")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit:web -- EffectiveConfigInspector`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the inspector**

```tsx
// apps/web/src/components/variables/EffectiveConfigInspector.tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffectiveVariables } from "@/hooks/useScopedVariables";

export function EffectiveConfigInspector({
  scopeId,
}: Readonly<{ scopeId: string | null }>) {
  const { data, isLoading } = useEffectiveVariables(scopeId);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent>Loading effective config…</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Effective Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center justify-between gap-4 border-b py-1 text-sm"
          >
            <span className="font-mono">{entry.key}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono">{JSON.stringify(entry.value)}</span>
              <Badge variant="outline">
                {entry.layer === "global" ? "global" : "project"}
              </Badge>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Mount + run test**

Add `<EffectiveConfigInspector scopeId={scopeId} />` to `VariablesEditorPage` (and optionally the project workspace policy area with the project id).

Run: `npm run test:unit:web -- EffectiveConfigInspector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/variables apps/web/src/pages/variables/VariablesEditorPage.tsx
git commit -m "feat(web): effective-config inspector with layer-trace provenance"
```

---

## Task 13: Phase 3 verification + documentation

**Files:**

- Modify: `docs/guide/README.md` (and/or the relevant orchestration deep-dive) — document the variable store, curated Orchestration Policy, per-phase autonomy, `mode` mirror, and "applies next cycle" snapshot semantics.
- Modify: `apps/api/README.md` and/or `apps/kanban/README.md` — the new endpoints (`/variables/audit`, `/orchestration/:projectId/policy[/preset]`).

- [ ] **Step 1: Update the docs**

Document: the curated key set + defaults (link spec §8), that the API store is kanban-neutral and the registry lives in `kanban-contracts`, the kanban→API HTTP path, the `mode` mirror, the backfill, and the snapshot-at-launch / "applies next cycle" behavior. Note that registry validation runs server-side at the kanban policy endpoint (the generic `/variables` store validates key-format + value_type only, by boundary design).

- [ ] **Step 2: Full verification sweep**

Run: `npm run lint:summary && npm run test:kanban && npm run test:api && npm run test:unit:web && npm run validate:seed-data`
Expected: all PASS / clean.

- [ ] **Step 3: Migration smoke (live stack)**

Run: `docker compose up -d --build` then confirm the API applies `20260620090000-create-scoped-variable-audit` cleanly and the kanban backfill logs `Orchestration autonomy backfill complete: N` on boot. Spot-check `GET /variables/effective?scopeId=<project>` returns project-scoped `autonomy.*` for a previously-supervised project.

- [ ] **Step 4: Commit**

```bash
git add docs apps/api/README.md apps/kanban/README.md
git commit -m "docs: configurable orchestration policy + variable store guide"
```

---

## Self-Review (performed against the spec)

**Spec coverage:**

- §8 curated keys/defaults → Task 1 registry (verbatim defaults) + Global Constraints table. ✓
- §9 mode→preset, per-key override wins, kanban reads per-phase autonomy via tool params, mode derived/display-only, backfill → Tasks 2 (merge param), 3 (dispatch/promotion via vars), 5 (preset + per-key write, registry validation), 6 (mode mirror), 7 (backfill). ✓
- §10 Phase 2 (registry, per-phase autonomy, web editor + policy panel) → Tasks 1–9. ✓
- §10 Phase 3 (effective-config inspector, server-side registry validation, audit history) → validation in Task 5 (kanban policy endpoint, boundary-correct), Task 11 (audit), Task 12 (inspector). ✓
- §11 testing strategy (resolver/store already Phase 1; per-phase autonomy param; mode backfill; preset writes all three; per-key beats preset; API contract) → covered by Tasks 1,2,5,7,11 tests. ✓
- §12 risks: zero-drift gate (Task 10 step 4), boundary (Global Constraints + Task 10 step 3), typed coercion (registry validation Task 1/5). ✓

**Boundary note (resolved during planning):** spec §10 lists "server-side validation of well-known keys against the registry" under Phase 3, but the API store cannot import `kanban-contracts`. Resolved by placing registry validation in the kanban `OrchestrationPolicyService` (Task 5), which is the server-side write path for curated keys. The generic `/variables` API endpoint keeps format/type-only validation. Documented in Task 13.

**Type consistency:** `autonomyValuesForMode` / `modeFromAutonomyValues` / `validatePolicyEntry` / `findPolicyDescriptor` names are consistent across Tasks 1, 5, 7. `setModeMirror` consistent across Tasks 5, 6. `ResolvedPolicyEntry(Dto)` shape consistent across Tasks 5, 8, 9, 12.

**Open items deferred (non-blocking, per spec §10/§13):** file-based `.nexus/variables.yaml` GitOps (explicitly out of scope); per-project "reset to global" affordance (spec §13 nicety — implementable later as a delete-of-project-scoped-key button on the policy panel).
