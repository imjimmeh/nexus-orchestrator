# Capacity-Gated CEO Orchestration Wakeup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Project Orchestration Cycle (CEO) workflow from waking on intermediate work-item stage transitions; wake it only when a terminal run frees the dispatch slot it held, with a global default and per-project override.

**Architecture:** Add an item-level capacity gate to the core lifecycle stream consumer's terminal-run handler. The gate is two pure functions (`resolveWakePolicy`, `shouldWakeForTerminalRun`) wrapped by a thin IO service (`OrchestrationWakePolicyService`) that reads a global kanban setting and a per-project JSONB override. The existing `isProjectDispatchActive` predicate supplies the "still consuming a slot" signal. The wakeup service's existing gates (human-stop, 60s coalesce, lease) are untouched.

**Tech Stack:** TypeScript, NestJS, TypeORM (Postgres), Vitest, Zod, pnpm/npm workspaces (`apps/kanban`, `packages/kanban-contracts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-28-capacity-gated-ceo-wakeup-design.md`.
- All code lives in the main checkout at `G:\code\AI\nexus-orchestator` (the `apps/kanban` and `packages/kanban-contracts` workspaces). The session's worktree directory is empty/unregistered — **do not** work from it; cd into `G:/code/AI/nexus-orchestator` for every command. **Verify `git branch --show-current` before committing** (concurrent agents move HEAD).
- Policy enum values are exactly `"slot_freed"` and `"every_terminal"`. Default is `"slot_freed"`.
- Resolution precedence: **project override → global setting → `"slot_freed"`**. Any unknown/malformed value normalizes to `"slot_freed"`.
- The gate applies **only to work-item runs** (`workItemRunKind` of `"completed_work_item"` or `"failed_work_item"`). Non-work-item runs (`"other"`) always wake, exactly as today.
- Fail **open**: any error loading the work item or project resolves to "wake".
- Do not change the wakeup service, the stale reconciler, the 60s coalesce window, or the cycle lease.
- The "slot consumed" signal is `isProjectDispatchActive(item)` from `apps/kanban/src/dispatch/project-dispatch-capacity.ts` — reuse it; do not reimplement.
- Setting key name: `orchestration_wake_policy`.
- Run kanban unit tests with: `npm run test --workspace apps/kanban -- <path>` (single file). Typecheck with `npm run build --workspace apps/kanban` (or the repo's `npm run typecheck`).

---

### Task 1: Pure wake-policy helpers

Two pure functions with no IO: normalize a policy value, and decide whether a terminal run should wake the CEO cycle.

**Files:**

- Create: `apps/kanban/src/orchestration/orchestration-wake-policy.ts`
- Test: `apps/kanban/src/orchestration/orchestration-wake-policy.spec.ts`

**Interfaces:**

- Produces:
  - `type WakePolicy = "slot_freed" | "every_terminal"`
  - `type TerminalWorkItemRunKind = "completed_work_item" | "failed_work_item" | "other"` (re-import the existing type from `../core/core-lifecycle-stream.types`; do not redefine)
  - `function resolveWakePolicy(projectOverride: unknown, globalSetting: unknown): WakePolicy`
  - `function shouldWakeForTerminalRun(input: { policy: WakePolicy; workItemRunKind: TerminalWorkItemRunKind; itemStillActive: boolean }): { wake: boolean; suppressReason?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/orchestration/orchestration-wake-policy.spec.ts
import { describe, it, expect } from "vitest";
import {
  resolveWakePolicy,
  shouldWakeForTerminalRun,
} from "./orchestration-wake-policy";

describe("resolveWakePolicy", () => {
  it("defaults to slot_freed when nothing is set", () => {
    expect(resolveWakePolicy(undefined, undefined)).toBe("slot_freed");
  });

  it("uses the global setting when no project override", () => {
    expect(resolveWakePolicy(undefined, "every_terminal")).toBe(
      "every_terminal",
    );
  });

  it("prefers the project override over the global setting", () => {
    expect(resolveWakePolicy("slot_freed", "every_terminal")).toBe(
      "slot_freed",
    );
  });

  it("normalizes unknown values to slot_freed", () => {
    expect(resolveWakePolicy("nonsense", 42)).toBe("slot_freed");
    expect(resolveWakePolicy(null, "EVERY_TERMINAL")).toBe("slot_freed");
  });
});

describe("shouldWakeForTerminalRun", () => {
  it("every_terminal always wakes", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "every_terminal",
        workItemRunKind: "completed_work_item",
        itemStillActive: true,
      }),
    ).toEqual({ wake: true });
  });

  it("non-work-item runs always wake regardless of policy", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "other",
        itemStillActive: true,
      }),
    ).toEqual({ wake: true });
  });

  it("slot_freed wakes when the item no longer consumes a slot", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "completed_work_item",
        itemStillActive: false,
      }),
    ).toEqual({ wake: true });
  });

  it("slot_freed suppresses when the item still consumes a slot", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "completed_work_item",
        itemStillActive: true,
      }),
    ).toEqual({ wake: false, suppressReason: "slot_not_freed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/kanban -- src/orchestration/orchestration-wake-policy.spec.ts`
Expected: FAIL — module `./orchestration-wake-policy` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/kanban/src/orchestration/orchestration-wake-policy.ts
import type { TerminalWorkItemRunKind } from "../core/core-lifecycle-stream.types";

export type WakePolicy = "slot_freed" | "every_terminal";

const DEFAULT_WAKE_POLICY: WakePolicy = "slot_freed";
const KNOWN_POLICIES = new Set<WakePolicy>(["slot_freed", "every_terminal"]);

function normalize(value: unknown): WakePolicy | undefined {
  return typeof value === "string" && KNOWN_POLICIES.has(value as WakePolicy)
    ? (value as WakePolicy)
    : undefined;
}

/**
 * Resolve the effective wake policy. Precedence: project override → global
 * setting → default. Unknown or malformed values fall through to the default.
 */
export function resolveWakePolicy(
  projectOverride: unknown,
  globalSetting: unknown,
): WakePolicy {
  return (
    normalize(projectOverride) ??
    normalize(globalSetting) ??
    DEFAULT_WAKE_POLICY
  );
}

/**
 * Decide whether a terminal workflow run should request a CEO orchestration
 * wakeup. `every_terminal` always wakes (legacy behavior). Non-work-item runs
 * always wake (unchanged). Under `slot_freed`, a work-item run wakes only when
 * the owning item no longer consumes a dispatch slot.
 */
export function shouldWakeForTerminalRun(input: {
  policy: WakePolicy;
  workItemRunKind: TerminalWorkItemRunKind;
  itemStillActive: boolean;
}): { wake: boolean; suppressReason?: string } {
  if (input.policy === "every_terminal") {
    return { wake: true };
  }
  if (input.workItemRunKind === "other") {
    return { wake: true };
  }
  if (input.itemStillActive) {
    return { wake: false, suppressReason: "slot_not_freed" };
  }
  return { wake: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/kanban -- src/orchestration/orchestration-wake-policy.spec.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add apps/kanban/src/orchestration/orchestration-wake-policy.ts apps/kanban/src/orchestration/orchestration-wake-policy.spec.ts && git commit -m "feat(kanban): pure wake-policy resolver and terminal-run decision helpers"
```

---

### Task 2: Register the `orchestration_wake_policy` global setting

Add the new string-enum setting to the contracts enum and the kanban defaults. This requires widening the settings-definition types to allow a string-valued setting.

**Files:**

- Modify: `packages/kanban-contracts/src/settings.schema.ts:3-17` (add key to `KanbanSettingKeySchema`)
- Modify: `apps/kanban/src/settings/kanban-settings.constants.ts:3-13` (widen types) and `:19-127` (add default)
- Test: `apps/kanban/src/settings/kanban-settings.constants.spec.ts` (create if absent)

**Interfaces:**

- Produces: kanban setting key `"orchestration_wake_policy"` with default value `"slot_freed"`, readable via `KanbanSettingsService.get<unknown>("orchestration_wake_policy")`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/settings/kanban-settings.constants.spec.ts
import { describe, it, expect } from "vitest";
import {
  KANBAN_SETTING_DEFAULTS,
  isKanbanSettingKey,
} from "./kanban-settings.constants";

describe("orchestration_wake_policy setting", () => {
  it("is a known key", () => {
    expect(isKanbanSettingKey("orchestration_wake_policy")).toBe(true);
  });

  it("defaults to slot_freed", () => {
    expect(KANBAN_SETTING_DEFAULTS.orchestration_wake_policy.value).toBe(
      "slot_freed",
    );
  });

  it("is a string-typed orchestration setting", () => {
    const def = KANBAN_SETTING_DEFAULTS.orchestration_wake_policy;
    expect(def.type).toBe("string");
    expect(def.group).toBe("orchestration");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/kanban -- src/settings/kanban-settings.constants.spec.ts`
Expected: FAIL — `orchestration_wake_policy` missing from defaults / not a known key.

- [ ] **Step 3: Add the contracts enum key**

In `packages/kanban-contracts/src/settings.schema.ts`, add the key to the enum array (after `"work_item_run_lease_enabled",`):

```ts
export const KanbanSettingKeySchema = z.enum([
  "work_item_dispatch_max_active_per_project",
  "work_item_scheduler_enabled",
  "work_item_scheduler_scope_weight_large",
  "work_item_scheduler_scope_weight_standard",
  "work_item_preflight_pipeline_enabled",
  "work_item_preflight_required",
  "work_item_dispatch_polling_enabled",
  "work_item_dispatch_poll_interval_seconds",
  "work_item_dispatch_poll_batch_size",
  "orchestration_auto_restart_enabled",
  "orchestration_auto_restart_max_attempts",
  "orchestration_auto_restart_cooldown_seconds",
  "work_item_run_lease_enabled",
  "orchestration_wake_policy",
]);
```

- [ ] **Step 4: Widen the definition types and add the default**

In `apps/kanban/src/settings/kanban-settings.constants.ts`, widen the type aliases:

```ts
type KanbanSettingType = "boolean" | "number" | "string";
type KanbanSettingGroup =
  | "dispatch"
  | "auto-restart"
  | "work-item-lease"
  | "orchestration";

type KanbanSettingDefinition = {
  value: boolean | number | string;
  description: string;
  type: KanbanSettingType;
  group: KanbanSettingGroup;
  min?: number;
  max?: number;
  options?: readonly string[];
};
```

Then add the default entry inside `KANBAN_SETTING_DEFAULTS` (after `work_item_run_lease_enabled`):

```ts
  orchestration_wake_policy: {
    value: "slot_freed",
    description:
      "When to wake the Project Orchestration Cycle on a terminal work-item run. 'slot_freed' wakes only when the item frees its dispatch slot (e.g. merge into done); 'every_terminal' wakes on every terminal run (legacy).",
    type: "string",
    group: "orchestration",
    options: ["slot_freed", "every_terminal"],
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace apps/kanban -- src/settings/kanban-settings.constants.spec.ts`
Expected: PASS.

Also build the contracts package to confirm the enum change typechecks:
Run: `npm run build --workspace packages/kanban-contracts`
Expected: success.

- [ ] **Step 6: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add packages/kanban-contracts/src/settings.schema.ts apps/kanban/src/settings/kanban-settings.constants.ts apps/kanban/src/settings/kanban-settings.constants.spec.ts && git commit -m "feat(kanban): add orchestration_wake_policy global setting (default slot_freed)"
```

---

### Task 3: Per-project override — contracts type + entity column + migration

Add the per-project override storage. The override is a JSONB blob on `kanban_projects` plus a normalized contract type.

**Files:**

- Create: `packages/kanban-contracts/src/orchestration-settings.schema.ts`
- Modify: `packages/kanban-contracts/src/index.ts` (export the new schema/types — confirm the barrel path)
- Modify: `apps/kanban/src/database/entities/kanban-project.entity.ts:52` (add column)
- Create: `apps/kanban/src/database/migrations/20260628120000-add-project-orchestration-settings.ts`
- Test: `packages/kanban-contracts/src/orchestration-settings.schema.spec.ts`

**Interfaces:**

- Produces:
  - `OrchestrationWakePolicySchema` (zod enum `["slot_freed","every_terminal"]`)
  - `ProjectOrchestrationSettingsSchema` = `{ wakePolicy?: "slot_freed" | "every_terminal" }` (strict)
  - `type ProjectOrchestrationSettings`
  - `function resolveProjectOrchestrationSettings(raw: unknown): ProjectOrchestrationSettings` (safe-parse, returns `{}` on failure)
  - Entity field `orchestration_settings: Record<string, unknown> | null`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kanban-contracts/src/orchestration-settings.schema.spec.ts
import { describe, it, expect } from "vitest";
import { resolveProjectOrchestrationSettings } from "./orchestration-settings.schema";

describe("resolveProjectOrchestrationSettings", () => {
  it("returns empty object for null/undefined", () => {
    expect(resolveProjectOrchestrationSettings(null)).toEqual({});
    expect(resolveProjectOrchestrationSettings(undefined)).toEqual({});
  });

  it("passes through a valid wakePolicy", () => {
    expect(
      resolveProjectOrchestrationSettings({ wakePolicy: "every_terminal" }),
    ).toEqual({ wakePolicy: "every_terminal" });
  });

  it("drops an invalid wakePolicy back to empty", () => {
    expect(
      resolveProjectOrchestrationSettings({ wakePolicy: "bogus" }),
    ).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace packages/kanban-contracts -- src/orchestration-settings.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the contract schema**

```ts
// packages/kanban-contracts/src/orchestration-settings.schema.ts
import { z } from "zod";

export const OrchestrationWakePolicySchema = z.enum([
  "slot_freed",
  "every_terminal",
]);

export const ProjectOrchestrationSettingsSchema = z
  .object({
    wakePolicy: OrchestrationWakePolicySchema.optional(),
  })
  .strict();

export type ProjectOrchestrationSettings = z.infer<
  typeof ProjectOrchestrationSettingsSchema
>;

/**
 * Parse a persisted orchestration-settings blob, returning an empty object when
 * the value is missing or fails validation so callers can fall back to the
 * global setting.
 */
export function resolveProjectOrchestrationSettings(
  raw: unknown,
): ProjectOrchestrationSettings {
  const result = ProjectOrchestrationSettingsSchema.safeParse(raw ?? {});
  return result.success ? result.data : {};
}
```

Then export it from the contracts barrel (`packages/kanban-contracts/src/index.ts`): add `export * from "./orchestration-settings.schema";`. (Open the index file first to match the existing export style.)

- [ ] **Step 4: Add the entity column**

In `apps/kanban/src/database/entities/kanban-project.entity.ts`, add after the `repository_workflow_settings` column (line 52):

```ts
  @Column({
    name: "orchestration_settings",
    type: "jsonb",
    nullable: true,
  })
  orchestration_settings!: Record<string, unknown> | null;
```

- [ ] **Step 5: Add the migration**

```ts
// apps/kanban/src/database/migrations/20260628120000-add-project-orchestration-settings.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectOrchestrationSettings20260628120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects ADD COLUMN orchestration_settings jsonb NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects DROP COLUMN orchestration_settings",
    );
  }
}
```

Confirm migrations are auto-discovered by glob (check the DataSource/migrations config); if they are explicitly listed in an array, register this class there.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test --workspace packages/kanban-contracts -- src/orchestration-settings.schema.spec.ts`
Expected: PASS.
Run: `npm run build --workspace packages/kanban-contracts && npm run build --workspace apps/kanban`
Expected: success.

- [ ] **Step 7: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add packages/kanban-contracts/src/orchestration-settings.schema.ts packages/kanban-contracts/src/orchestration-settings.schema.spec.ts packages/kanban-contracts/src/index.ts apps/kanban/src/database/entities/kanban-project.entity.ts apps/kanban/src/database/migrations/20260628120000-add-project-orchestration-settings.ts && git commit -m "feat(kanban): per-project orchestration_settings override (schema, entity, migration)"
```

---

### Task 4: Project service get/update + controller routes for orchestration settings

Surface the per-project override through the project service and HTTP API, mirroring the existing repository-workflow-settings pattern.

**Files:**

- Modify: `apps/kanban/src/project/project.service.ts` (add two methods near `getRepositoryWorkflowSettings` at line 403; add an `orchestration_settings` field to the `get()` mapping at line ~259)
- Modify: `apps/kanban/src/project/project.controller.ts` (add routes after the repository-workflows routes at line 110)
- Test: `apps/kanban/src/project/project.service.spec.ts` (add cases; create file if absent)

**Interfaces:**

- Consumes: `resolveProjectOrchestrationSettings` (Task 3), `this.projects.findById` / `this.projects.save` (existing).
- Produces:
  - `ProjectService.getOrchestrationSettings(project_id: string): Promise<ProjectOrchestrationSettings>`
  - `ProjectService.updateOrchestrationSettings(project_id: string, settings: Partial<ProjectOrchestrationSettings>): Promise<ProjectOrchestrationSettings>`
  - `GET /:project_id/orchestration/settings`, `PATCH /:project_id/orchestration/settings`

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/project/project.service.spec.ts (add to existing describe or create file)
import { describe, it, expect, vi } from "vitest";
import { ProjectService } from "./project.service";

function buildProjectRepoStub(initial: Record<string, unknown> | null) {
  const project: any = { id: "p1", orchestration_settings: initial };
  return {
    project,
    repo: {
      findById: vi.fn().mockResolvedValue(project),
      save: vi.fn().mockImplementation(async (p: any) => p),
    },
  };
}

describe("ProjectService orchestration settings", () => {
  it("returns empty settings when none persisted", async () => {
    const { repo } = buildProjectRepoStub(null);
    // NOTE: construct ProjectService with the repo stub in the `projects` slot
    // following the existing spec's TestingModule / constructor wiring.
    const service = new ProjectService(
      repo as any /* + other deps as the
      existing spec wires them; reuse that spec's helper */,
    );
    await expect(service.getOrchestrationSettings("p1")).resolves.toEqual({});
  });

  it("merges and persists a wakePolicy override", async () => {
    const { project, repo } = buildProjectRepoStub({});
    const service = new ProjectService(repo as any);
    const result = await service.updateOrchestrationSettings("p1", {
      wakePolicy: "every_terminal",
    });
    expect(result).toEqual({ wakePolicy: "every_terminal" });
    expect(project.orchestration_settings).toEqual({
      wakePolicy: "every_terminal",
    });
    expect(repo.save).toHaveBeenCalled();
  });
});
```

> Implementer note: `ProjectService` has many constructor deps. Reuse the construction helper already used by the existing `project.service.spec.ts`; the stubs above only illustrate the `projects` repository behavior (`findById`/`save`). If no spec helper exists, build the service via a NestJS `Test.createTestingModule` with the other dependencies mocked, following `testing-unit-patterns`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/kanban -- src/project/project.service.spec.ts`
Expected: FAIL — `getOrchestrationSettings` / `updateOrchestrationSettings` not a function.

- [ ] **Step 3: Implement the service methods**

Add to `apps/kanban/src/project/project.service.ts` (import the contract helpers at the top: `import { resolveProjectOrchestrationSettings, type ProjectOrchestrationSettings } from "@nexus/kanban-contracts";`):

```ts
  async getOrchestrationSettings(
    project_id: string,
  ): Promise<ProjectOrchestrationSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);
    return resolveProjectOrchestrationSettings(project.orchestration_settings);
  }

  async updateOrchestrationSettings(
    project_id: string,
    settings: Partial<ProjectOrchestrationSettings>,
  ): Promise<ProjectOrchestrationSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);
    const current = resolveProjectOrchestrationSettings(
      project.orchestration_settings,
    );
    const merged: ProjectOrchestrationSettings = {
      ...current,
      ...(settings.wakePolicy ? { wakePolicy: settings.wakePolicy } : {}),
    };
    project.orchestration_settings = merged as Record<string, unknown>;
    await this.projects.save(project);
    return merged;
  }
```

If the `get()` mapping at line ~259 returns a `ProjectRecord` DTO, add `orchestration_settings: project.orchestration_settings ?? null` to that mapping and to the `ProjectRecord` type so the override is observable via the existing project read path. (Open the `ProjectRecord` type to add the optional field.)

- [ ] **Step 4: Implement the controller routes**

Add to `apps/kanban/src/project/project.controller.ts` after line 122:

```ts
  @Get(":project_id/orchestration/settings")
  async getOrchestrationSettings(@Param("project_id") project_id: string) {
    const data = await this.projects.getOrchestrationSettings(project_id);
    return { success: true, data };
  }

  @Patch(":project_id/orchestration/settings")
  async updateOrchestrationSettings(
    @Param("project_id") project_id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.projects.updateOrchestrationSettings(
      project_id,
      body,
    );
    return { success: true, data };
  }
```

(Validate `body` against `ProjectOrchestrationSettingsSchema` inside the service or via the existing Zod pipe if the controller uses one — follow the repository-workflow-settings route's validation approach. The service already drops invalid values via `resolveProjectOrchestrationSettings` on read, but reject an invalid `wakePolicy` on write with `BadRequestException` for a clean API.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace apps/kanban -- src/project/project.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add apps/kanban/src/project/project.service.ts apps/kanban/src/project/project.controller.ts apps/kanban/src/project/project.service.spec.ts && git commit -m "feat(kanban): project orchestration-settings get/update service + routes"
```

---

### Task 5: `OrchestrationWakePolicyService` — resolve effective policy for a project

A thin IO service that reads the project override and the global setting, then delegates to the pure `resolveWakePolicy`.

**Files:**

- Create: `apps/kanban/src/orchestration/orchestration-wake-policy.service.ts`
- Test: `apps/kanban/src/orchestration/orchestration-wake-policy.service.spec.ts`

**Interfaces:**

- Consumes: `resolveWakePolicy` (Task 1), `ProjectService.getOrchestrationSettings` (Task 4), `KanbanSettingsService.get` (existing).
- Produces: `OrchestrationWakePolicyService.resolveForProject(projectId: string): Promise<WakePolicy>` — fails **open** to `"slot_freed"`'s pure-default on error (i.e. returns `resolveWakePolicy(undefined, undefined)`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/kanban/src/orchestration/orchestration-wake-policy.service.spec.ts
import { describe, it, expect, vi } from "vitest";
import { OrchestrationWakePolicyService } from "./orchestration-wake-policy.service";

function build(overrides: {
  projectSettings?: unknown;
  globalValue?: unknown;
  projectThrows?: boolean;
}) {
  const projects = {
    getOrchestrationSettings: vi.fn(async () => {
      if (overrides.projectThrows) throw new Error("boom");
      return overrides.projectSettings ?? {};
    }),
  };
  const settings = {
    get: vi.fn(async () => overrides.globalValue ?? "slot_freed"),
  };
  const service = new OrchestrationWakePolicyService(
    projects as any,
    settings as any,
  );
  return { service, projects, settings };
}

describe("OrchestrationWakePolicyService.resolveForProject", () => {
  it("returns the project override when present", async () => {
    const { service } = build({
      projectSettings: { wakePolicy: "every_terminal" },
      globalValue: "slot_freed",
    });
    await expect(service.resolveForProject("p1")).resolves.toBe(
      "every_terminal",
    );
  });

  it("falls back to the global setting", async () => {
    const { service } = build({
      projectSettings: {},
      globalValue: "every_terminal",
    });
    await expect(service.resolveForProject("p1")).resolves.toBe(
      "every_terminal",
    );
  });

  it("fails open to slot_freed when the project read throws", async () => {
    const { service } = build({ projectThrows: true });
    await expect(service.resolveForProject("p1")).resolves.toBe("slot_freed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/kanban -- src/orchestration/orchestration-wake-policy.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// apps/kanban/src/orchestration/orchestration-wake-policy.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ProjectService } from "../project/project.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import {
  resolveWakePolicy,
  type WakePolicy,
} from "./orchestration-wake-policy";

@Injectable()
export class OrchestrationWakePolicyService {
  private readonly logger = new Logger(OrchestrationWakePolicyService.name);

  constructor(
    private readonly projects: ProjectService,
    private readonly settings: KanbanSettingsService,
  ) {}

  async resolveForProject(projectId: string): Promise<WakePolicy> {
    try {
      const [projectSettings, globalValue] = await Promise.all([
        this.projects
          .getOrchestrationSettings(projectId)
          .catch(() => ({}) as { wakePolicy?: WakePolicy }),
        this.settings.get<unknown>("orchestration_wake_policy"),
      ]);
      return resolveWakePolicy(projectSettings?.wakePolicy, globalValue);
    } catch (error) {
      this.logger.warn(
        `resolveForProject failed for ${projectId}; failing open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return resolveWakePolicy(undefined, undefined);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace apps/kanban -- src/orchestration/orchestration-wake-policy.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register the provider**

Add `OrchestrationWakePolicyService` to the providers (and exports, if consumed cross-module) of the module that owns the orchestration services (the same module that declares `ProjectOrchestrationWakeupService`). Open that module file, add the import + provider entry. Build to confirm DI resolves:
Run: `npm run build --workspace apps/kanban`
Expected: success.

- [ ] **Step 6: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add apps/kanban/src/orchestration/orchestration-wake-policy.service.ts apps/kanban/src/orchestration/orchestration-wake-policy.service.spec.ts apps/kanban/src/orchestration/*.module.ts && git commit -m "feat(kanban): OrchestrationWakePolicyService resolves effective wake policy per project"
```

---

### Task 6: Gate the lifecycle-stream wakeup on the resolved policy

Wire the gate into `evaluateContinuationForTerminalRun`: after reconciliation, reload the work item, compute whether it still consumes a slot, resolve the policy, and only `requestWakeup` when the decision says wake.

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` (constructor: inject `OrchestrationWakePolicyService`; method `evaluateContinuationForTerminalRun` at lines 377-457)
- Modify: the consumer's owning module (add `OrchestrationWakePolicyService` to providers/imports so DI resolves)
- Test: `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts` (add cases; follow the existing consumer spec's harness)

**Interfaces:**

- Consumes: `OrchestrationWakePolicyService.resolveForProject` (Task 5), `isProjectDispatchActive` (`../dispatch/project-dispatch-capacity`), `shouldWakeForTerminalRun` (Task 1), `KanbanWorkItemRepository.findByProjectAndId` (existing).

- [ ] **Step 1: Write the failing test**

Add to the consumer spec (reuse its existing builder for the consumer + mocked deps; the new dep is `wakePolicyService` with `resolveForProject`). Cover the four behaviors:

```ts
// apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts (new cases)
describe("evaluateContinuationForTerminalRun capacity gate", () => {
  it("suppresses the wakeup when the completed item is still active (in-review)", async () => {
    const h = buildConsumerHarness(); // existing helper
    h.wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    h.workItems.findByProjectAndId.mockResolvedValue({
      id: "wi1",
      status: "in-review",
      linked_run_id: null,
      current_execution_id: null,
    });
    await h.consumer.handleEnvelope(
      completedWorkItemRunEnvelope({ projectId: "p1", workItemId: "wi1" }),
    );
    expect(h.wakeupService.requestWakeup).not.toHaveBeenCalled();
  });

  it("wakes when the completed item is done (slot freed)", async () => {
    const h = buildConsumerHarness();
    h.wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    h.workItems.findByProjectAndId.mockResolvedValue({
      id: "wi1",
      status: "done",
      linked_run_id: null,
      current_execution_id: null,
    });
    await h.consumer.handleEnvelope(
      completedWorkItemRunEnvelope({ projectId: "p1", workItemId: "wi1" }),
    );
    expect(h.wakeupService.requestWakeup).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        source: "core_lifecycle_stream",
      }),
    );
  });

  it("every_terminal wakes even when the item is still active", async () => {
    const h = buildConsumerHarness();
    h.wakePolicyService.resolveForProject.mockResolvedValue("every_terminal");
    h.workItems.findByProjectAndId.mockResolvedValue({
      id: "wi1",
      status: "in-review",
      linked_run_id: null,
      current_execution_id: null,
    });
    await h.consumer.handleEnvelope(
      completedWorkItemRunEnvelope({ projectId: "p1", workItemId: "wi1" }),
    );
    expect(h.wakeupService.requestWakeup).toHaveBeenCalled();
  });

  it("non-work-item runs still wake (unchanged)", async () => {
    const h = buildConsumerHarness();
    h.wakePolicyService.resolveForProject.mockResolvedValue("slot_freed");
    await h.consumer.handleEnvelope(
      completedLifecycleRunEnvelope({ projectId: "p1" }), // workItemId = __orchestration_lifecycle__
    );
    expect(h.wakeupService.requestWakeup).toHaveBeenCalled();
  });
});
```

> Implementer note: if the existing consumer spec lacks `buildConsumerHarness`/envelope factories, add minimal ones following the patterns already in that spec file. The key new mock is `wakePolicyService.resolveForProject` and ensuring `workItems.findByProjectAndId` is stubbed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/kanban -- src/core/core-lifecycle-stream.consumer.spec.ts`
Expected: FAIL — `requestWakeup` still called for the in-review case (gate not yet implemented), and/or `wakePolicyService` undefined.

- [ ] **Step 3: Inject the dependency**

In `core-lifecycle-stream.consumer.ts`, add the import and constructor parameter:

```ts
import { OrchestrationWakePolicyService } from "../orchestration/orchestration-wake-policy.service";
import { isProjectDispatchActive } from "../dispatch/project-dispatch-capacity";
import { shouldWakeForTerminalRun } from "../orchestration/orchestration-wake-policy";
```

Add to the constructor parameter list (alongside the other orchestration deps):

```ts
    private readonly wakePolicyService: OrchestrationWakePolicyService,
```

- [ ] **Step 4: Implement the gate**

Replace the tail of `evaluateContinuationForTerminalRun` (the block from line 444 `const trigger = ...` through line 456) with:

```ts
    const trigger = resolveContinuationTrigger(terminalStatus, workItemRunKind);

    const itemStillActive = await this.isWorkItemStillActive(
      projectId,
      workItemId,
      workItemRunKind,
    );
    const policy = await this.wakePolicyService.resolveForProject(projectId);
    const decision = shouldWakeForTerminalRun({
      policy,
      workItemRunKind,
      itemStillActive,
    });

    if (!decision.wake) {
      this.logger.debug(
        `Suppressed orchestration wakeup for project ${projectId} (workItem ${workItemId ?? "n/a"}): ${decision.suppressReason}`,
      );
      return;
    }

    await this.wakeupService
      .requestWakeup({
        projectId,
        reason: trigger,
        source: "core_lifecycle_stream",
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to request orchestration wakeup for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Whether the work item that owned this terminal run is still consuming a
   * dispatch slot. Non-work-item runs are reported inactive (the policy layer
   * ignores `itemStillActive` for them). Reload failures fail open (treated as
   * inactive → wake).
   */
  private async isWorkItemStillActive(
    projectId: string,
    workItemId: string | undefined,
    workItemRunKind: TerminalWorkItemRunKind,
  ): Promise<boolean> {
    if (workItemRunKind === "other" || !isRealWorkItemId(workItemId)) {
      return false;
    }
    try {
      const item = await this.workItems.findByProjectAndId(
        projectId,
        workItemId,
      );
      if (!item) {
        return false;
      }
      return isProjectDispatchActive({
        status: item.status,
        linked_run_id: item.linked_run_id,
        current_execution_id: item.current_execution_id,
      } as Parameters<typeof isProjectDispatchActive>[0]);
    } catch (error) {
      this.logger.warn(
        `Failed to load work item ${workItemId} for wake gate; failing open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
```

Add the type import if not already present: `import type { TerminalWorkItemRunKind } from "./core-lifecycle-stream.types";`. (`isRealWorkItemId` is already imported.)

- [ ] **Step 5: Register the provider for the consumer's module**

Ensure `OrchestrationWakePolicyService` is available to the consumer's module (provider or imported module export). Build to confirm DI:
Run: `npm run build --workspace apps/kanban`
Expected: success.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace apps/kanban -- src/core/core-lifecycle-stream.consumer.spec.ts`
Expected: PASS (all four new cases + existing cases green).

- [ ] **Step 7: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts apps/kanban/src/**/*.module.ts && git commit -m "feat(kanban): gate lifecycle-stream CEO wakeup on slot-freed wake policy"
```

---

### Task 7: Full verification + docs

Verify the whole kanban suite is green, the skill doc reflects the new gate, and the setting is documented.

**Files:**

- Modify: `.claude/skills/kanban-work-item-lifecycle/SKILL.md` (Dispatch Logic / Automation Triggers section — note the slot-freed wake gate and the setting)
- Modify: any settings reference doc that lists kanban settings (search for `work_item_run_lease_enabled` in `docs/`)

- [ ] **Step 1: Run the full kanban unit suite**

Run: `npm run test --workspace apps/kanban`
Expected: PASS (no regressions). If any pre-existing failures appear, confirm they are unrelated to this change (compare against a clean `main` run) before proceeding.

- [ ] **Step 2: Typecheck the whole repo**

Run: `npm run build --workspace packages/kanban-contracts && npm run build --workspace apps/kanban`
Expected: success.

- [ ] **Step 3: Update the lifecycle skill doc**

In `.claude/skills/kanban-work-item-lifecycle/SKILL.md`, under "Dispatch Logic", add a paragraph:

```markdown
### CEO wakeup gating (slot-freed)

A terminal work-item run only wakes the Project Orchestration Cycle when the
item frees its dispatch slot (`isProjectDispatchActive` is now false — e.g.
merge into `done`, or a failure that parks the item in `blocked`). Intermediate
stage transitions (`in-progress → in-review`, `in-review → ready-to-merge`) keep
the slot occupied and are suppressed. This is controlled by the
`orchestration_wake_policy` kanban setting (`slot_freed` default, `every_terminal`
legacy) with a per-project override under `kanban_projects.orchestration_settings`.
```

- [ ] **Step 4: Commit**

```bash
cd /g/code/AI/nexus-orchestator && git add .claude/skills/kanban-work-item-lifecycle/SKILL.md docs && git commit -m "docs(kanban): document slot-freed CEO wakeup gating and setting"
```

---

## Deployment notes (post-merge, not part of TDD tasks)

- Run the new migration against the kanban DB (the entity column is required before the API boots with the new entity).
- `KanbanSettingsService.seedDefaults()` seeds `orchestration_wake_policy=slot_freed` on boot; no manual seed needed.
- Rebuild + redeploy nexus-kanban.
- Behavior change is immediate and global on deploy; to restore the old behavior for a project, PATCH `/:project_id/orchestration/settings` with `{ "wakePolicy": "every_terminal" }`, or set the global setting to `every_terminal`.

## Self-review notes

- **Spec coverage:** gate (Task 6), `isProjectDispatchActive` reuse (Task 6), global setting (Task 2), per-project override (Tasks 3–4), precedence + fail-open + normalization (Tasks 1, 5), non-work-item unchanged (Tasks 1, 6), untouched wakeup gates (no edits to wakeup service), testing matrix (every task), edge cases (Task 6 tests + `isWorkItemStillActive`). All covered.
- **Type consistency:** `WakePolicy`, `TerminalWorkItemRunKind`, `ProjectOrchestrationSettings`, `resolveWakePolicy`, `shouldWakeForTerminalRun`, `resolveForProject`, `getOrchestrationSettings`/`updateOrchestrationSettings`, `findByProjectAndId`, `isProjectDispatchActive` used consistently across tasks.
- **Open implementer confirmations (flagged inline, not placeholders):** exact owning module filename for DI registration; the contracts barrel export style; whether `ProjectRecord`/`get()` mapping should expose the override; the existing consumer-spec test harness names. Each has a concrete template referenced in-task.
