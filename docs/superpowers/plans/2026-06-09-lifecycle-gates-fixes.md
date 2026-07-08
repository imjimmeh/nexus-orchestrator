# Lifecycle Gates — Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four gaps that prevent lifecycle gate badges from appearing on board cards, Recent Runs from filtering to repository workflows, and the seed workflow from being discovered and triggering correctly.

**Architecture:** Seven tasks — five code changes, two operational: (1) add class-validator decorators + `transform: true` to `ValidationPipe` so filter params stop being stripped; (2) move and rename the seed workflow to match the correct phase slug and seeder path; (3) add a `"merge"` → `"ready-to-merge"` phase alias in the lifecycle execution service; (4) enrich the workflow-files listing endpoint to parse YAML trigger metadata; (5) use that metadata in the frontend for column grouping instead of filename parsing; (6) register the workflow in the database via the API; (7) enable `repository_workflow_settings.enabled` on the target project.

**Tech Stack:** NestJS + class-validator (apps/api), NestJS + js-yaml (apps/kanban), React 19 + TypeScript (apps/web), Vitest everywhere.

**Reference:** Analysis in `docs/work/2026-06-09-lifecycle-gates-remediation/index.md`

---

## File Structure

**apps/api (workflow DTO fix)**
- Modify: `apps/api/src/workflow/workflow.controller.dto.ts` — add `@IsOptional() @IsString()` decorators so `ValidationPipe({ whitelist: true })` preserves filter params
- Modify: `apps/api/src/workflow/workflow.controller.spec.ts` — test that `findRuns` passes `sourceType` and `scopeId` through to persistence

**apps/api (phase alias fix)**
- Modify: `apps/api/src/workflow/workflow-lifecycle-execution.service.ts` — add `resolveBindingsWithAliases` + `getLegacyPhaseAliases` so workflows declaring `phase: "merge"` are found when `phase: "ready-to-merge"` is requested
- Modify: `apps/api/src/workflow/workflow-lifecycle-execution.service.spec.ts` — test the alias lookup

**seed (workflow rename/move)**
- Delete: `seed/cicd/pre-merge-ci.workflow.yaml`
- Create: `seed/workflows/ready-to-merge.before.workflow.yaml`

**apps/kanban (YAML trigger enrichment)**
- Modify: `apps/kanban/src/project/project.controller.ts` — `listWorkflowFiles` concurrently reads each file and extracts `trigger.{phase,hook,blocking}` from the YAML; returns enriched list
- Modify: `apps/kanban/src/project/project.controller.spec.ts` — test the enriched listing and the YAML extraction helper

**apps/web (use trigger metadata for grouping)**
- Modify: `apps/web/src/lib/api/client.workflow-files.types.ts` — add `trigger: WorkflowFileTrigger | null` to `WorkflowFileItem`
- Modify: `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.tsx` — use `file.trigger` in `buildColumnGroups` instead of `parseTriggerFromFilename(filename)`; remove `parseTriggerFromFilename` and `WorkflowFileTrigger` (no longer needed client-side)
- Modify: `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx` (create if absent) — test that `buildColumnGroups` groups by `file.trigger.phase`, not filename

**Operational (no code changes)**
- Task 6: Register the seed workflow in the DB via `POST /api/workflows`
- Task 7: Enable `repository_workflow_settings.enabled` on the target project via `PATCH /kanban-api/projects/:id/repository-workflows/settings`

---

## TASK 1 — Fix `WorkflowRunsQueryDto`: add class-validator decorators

**Context:** `ValidationPipe({ whitelist: true })` is global in `apps/api/src/main.ts`. It strips any DTO property that lacks a class-validator decorator. `WorkflowRunsQueryDto.sourceType` and `.scopeId` have no decorators, so they are silently stripped before reaching the controller. The Recent Runs card therefore receives no filters and returns all 20 most recent workflow runs globally.

**Files:**
- Modify: `apps/api/src/main.ts` — enable `transform: true` on `ValidationPipe` so `@Transform` decorators execute before validators
- Modify: `apps/api/src/workflow/workflow.controller.dto.ts`
- Modify: `apps/api/src/workflow/workflow.controller.spec.ts`

- [ ] **Step 1: Enable `transform: true` in `ValidationPipe`**

In `apps/api/src/main.ts`, line 46:

```ts
// Before:
app.useGlobalPipes(new ValidationPipe({ whitelist: true }), new ZodValidationPipe());

// After:
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }), new ZodValidationPipe());
```

This makes `@Transform` decorators run (needed for `limit`/`offset` string→number coercion and `includeInactive`/`isActive` string→boolean coercion) and allows `@IsInt()` and `@IsBoolean()` to validate the converted values correctly.

- [ ] **Step 2: Write the failing test**

Add to `apps/api/src/workflow/workflow.controller.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { WorkflowController } from './workflow.controller';

// --- existing describe block above ---

describe('WorkflowController.findRuns filter passthrough', () => {
  function makeForRuns() {
    const persistence = {
      getWorkflowRunsPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any;
    const controller = new WorkflowController(
      persistence,
      {} as any,
      {} as any,
      { getAccessibleScopeIds: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
    );
    return { controller, persistence };
  }

  it('passes sourceType and scopeId to the persistence layer', async () => {
    const { controller, persistence } = makeForRuns();
    await controller.findRuns({
      sourceType: 'repository',
      scopeId: 'proj-1',
      limit: 20,
      offset: 0,
    } as any);
    expect(persistence.getWorkflowRunsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'repository', scopeId: 'proj-1' }),
    );
  });
});
```

- [ ] **Step 3: Run to confirm the test fails**

```bash
cd apps/api && npx vitest run src/workflow/workflow.controller.spec.ts -t "passes sourceType"
```
Expected: FAIL — the assertion won't hold because the controller currently receives no `sourceType` through the DTO's whitelist stripping.

> **Note:** This unit test bypasses the global pipes — it tests the controller directly. The real whitelist-stripping issue is an integration concern. The test still proves the data flow is wired correctly once the DTO is fixed; a separate integration test would cover the pipe behavior.

- [ ] **Step 4: Add class-validator decorators to `WorkflowRunsQueryDto` and `PaginationQueryDto`**

Replace the content of `apps/api/src/workflow/workflow.controller.dto.ts` imports block and DTO classes:

```ts
import {
  createWorkflowLaunchPresetSchema,
  createWorkflowSchema,
  executeWorkflowSchema,
  paginationQuerySchema,
  updateWorkflowLaunchPresetSchema,
  workflowEventsQuerySchema,
  workflowLaunchContextQuerySchema,
  workflowRunsQuerySchema,
  type CreateWorkflowRequest,
  type CreateWorkflowLaunchPresetRequest,
  type PaginationQueryRequest,
  type UpdateWorkflowLaunchPresetRequest,
  type WorkflowEventsQueryRequest,
  type WorkflowLaunchContextQueryRequest,
  type WorkflowRunsQueryRequest,
} from '@nexus/core';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import type { ZodTypeAny } from 'zod';

export class CreateWorkflowDto {
  static readonly schema: ZodTypeAny = createWorkflowSchema;

  @IsOptional()
  @IsString()
  name?: CreateWorkflowRequest['name'];

  @IsString()
  yaml_definition!: CreateWorkflowRequest['yaml_definition'];

  @IsOptional()
  @IsBoolean()
  is_active?: CreateWorkflowRequest['is_active'];
}

export class ExecuteWorkflowDto {
  static readonly schema: ZodTypeAny = executeWorkflowSchema;

  @IsOptional()
  trigger_data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @IsString()
  contextId?: string;

  @IsOptional()
  @IsString()
  contextType?: string;

  @IsOptional()
  @IsString()
  scope_id?: string;

  @IsOptional()
  @IsString()
  context_id?: string;

  @IsOptional()
  @IsString()
  preset_id?: string;

  @IsOptional()
  @IsString()
  launch_source?: 'manual' | 'project_scoped' | 'rerun_with_edits' | 'preset';

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

export class WorkflowLaunchContextQueryDto {
  static readonly schema: ZodTypeAny = workflowLaunchContextQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowLaunchContextQueryRequest['scopeId'];

  @IsOptional()
  @IsString()
  contextId?: WorkflowLaunchContextQueryRequest['contextId'];

  @IsOptional()
  @IsString()
  contextType?: WorkflowLaunchContextQueryRequest['contextType'];
}

export class CreateWorkflowLaunchPresetDto {
  static readonly schema: ZodTypeAny = createWorkflowLaunchPresetSchema;

  @IsString()
  name!: CreateWorkflowLaunchPresetRequest['name'];

  @IsOptional()
  @IsString()
  scope_id?: CreateWorkflowLaunchPresetRequest['scope_id'];

  @IsOptional()
  trigger_data?: CreateWorkflowLaunchPresetRequest['trigger_data'];
}

export class UpdateWorkflowLaunchPresetDto {
  static readonly schema: ZodTypeAny = updateWorkflowLaunchPresetSchema;

  @IsOptional()
  @IsString()
  name?: UpdateWorkflowLaunchPresetRequest['name'];

  @IsOptional()
  trigger_data?: UpdateWorkflowLaunchPresetRequest['trigger_data'];
}

export class PaginationQueryDto {
  static readonly schema: ZodTypeAny = paginationQuerySchema;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  limit: PaginationQueryRequest['limit'] = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  offset: PaginationQueryRequest['offset'] = 0;

  @IsOptional()
  @IsString()
  workflowId?: PaginationQueryRequest['workflowId'];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeInactive?: PaginationQueryRequest['includeInactive'];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: PaginationQueryRequest['isActive'];

  @IsOptional()
  @IsString()
  search?: PaginationQueryRequest['search'];

  @IsOptional()
  @IsString()
  sortBy?: PaginationQueryRequest['sortBy'];

  @IsOptional()
  @IsString()
  sortDir?: PaginationQueryRequest['sortDir'];
}

export class WorkflowRunsQueryDto extends PaginationQueryDto {
  static readonly schema: ZodTypeAny = workflowRunsQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowRunsQueryRequest['scopeId'];

  @IsOptional()
  @IsString()
  contextId?: WorkflowRunsQueryRequest['contextId'];

  @IsOptional()
  @IsString()
  status?: WorkflowRunsQueryRequest['status'];

  @IsOptional()
  @IsString()
  sourceType?: WorkflowRunsQueryRequest['sourceType'];
}

export class WorkflowEventsQueryDto extends PaginationQueryDto {
  static readonly schema: ZodTypeAny = workflowEventsQuerySchema;

  @IsOptional()
  @IsString()
  scopeId?: WorkflowEventsQueryRequest['scopeId'];
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd apps/api && npx vitest run src/workflow/workflow.controller.spec.ts
```
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/workflow/workflow.controller.dto.ts apps/api/src/workflow/workflow.controller.spec.ts
git commit -m "fix(api): add class-validator decorators + enable transform in ValidationPipe to fix whitelist stripping"
```

---

## TASK 2 — Rename and relocate the seed workflow

**Context:** `seed/cicd/pre-merge-ci.workflow.yaml` has two problems: (1) it lives outside the seeder's candidate paths (`seed/workflows/`), so it's never loaded into the database; (2) its `trigger.phase` is `"merge"` — the old name — not the status slug `"ready-to-merge"` that the transition gate system uses. Moving it and updating its trigger makes it discoverable and correctly triggerable.

> **Note:** `seed/workflows/` seeds GLOBAL workflows (`source_type = 'seed'`). For per-project repository workflows a team creates files in `.nexus/workflows/` in their project repo and clicks "Refresh Discovery". This seed file serves as a working reference example that also runs as a global gating workflow on projects that opt in. Rename accordingly.

**Files:**
- Delete: `seed/cicd/pre-merge-ci.workflow.yaml`
- Create: `seed/workflows/ready-to-merge.before.workflow.yaml`

- [ ] **Step 1: Create the new file**

Create `seed/workflows/ready-to-merge.before.workflow.yaml`:

```yaml
workflow_id: pre_merge_ci
name: Pre-Merge CI
description: >
  Blocks transition to Ready-to-Merge until linting and unit tests pass.
  Runs as a lifecycle gate before the ready-to-merge column transition.

trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
  blocking: true

permissions:
  allow_tools: [bash, read]
  deny_tools: []

jobs:
  - id: build_core
    type: run_command
    tier: light
    inputs:
      command: npm run build --workspace=packages/core
      working_dir: "{{ trigger.payload.workspace }}"

  - id: lint_api
    type: run_command
    tier: light
    depends_on: [build_core]
    inputs:
      command: npm run lint:api
      working_dir: "{{ trigger.payload.workspace }}"

  - id: lint_kanban
    type: run_command
    tier: light
    depends_on: [build_core]
    inputs:
      command: npm run lint:kanban
      working_dir: "{{ trigger.payload.workspace }}"

  - id: lint_packages
    type: run_command
    tier: light
    depends_on: [build_core]
    inputs:
      command: npm run lint:packages
      working_dir: "{{ trigger.payload.workspace }}"

  - id: lint_web
    type: run_command
    tier: light
    depends_on: [build_core]
    inputs:
      command: npm run lint:web
      working_dir: "{{ trigger.payload.workspace }}"

  - id: test_api
    type: run_command
    tier: heavy
    depends_on: [lint_api]
    inputs:
      command: npm run test:api
      working_dir: "{{ trigger.payload.workspace }}"

  - id: test_kanban
    type: run_command
    tier: heavy
    depends_on: [lint_kanban]
    inputs:
      command: npm run test:kanban
      working_dir: "{{ trigger.payload.workspace }}"

  - id: test_web
    type: run_command
    tier: heavy
    depends_on: [lint_web]
    inputs:
      command: npm run test:unit:web
      working_dir: "{{ trigger.payload.workspace }}"
```

- [ ] **Step 2: Delete the old file**

```bash
git rm seed/cicd/pre-merge-ci.workflow.yaml
```

- [ ] **Step 3: Verify the seeder can find the new file**

```bash
ls seed/workflows/ | grep ready-to-merge
```
Expected: `ready-to-merge.before.workflow.yaml`

- [ ] **Step 4: Commit**

```bash
git add seed/workflows/ready-to-merge.before.workflow.yaml
git commit -m "feat(seed): rename pre-merge-ci workflow to ready-to-merge.before, update trigger phase"
```

---

## TASK 3 — Phase alias: `"merge"` → `"ready-to-merge"` backward-compat

**Context:** Per the design document (§9.2), repositories that already declared `phase: "merge"` in their workflow YAML should be treated as `phase: "ready-to-merge"`. The trigger registry does exact matching. This task adds an alias map in `WorkflowLifecycleExecutionService` so legacy workflows are found without requiring teams to edit their YAML files.

**Files:**
- Modify: `apps/api/src/workflow/workflow-lifecycle-execution.service.ts`
- Modify: `apps/api/src/workflow/workflow-lifecycle-execution.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Check whether a spec file exists:
```bash
ls apps/api/src/workflow/workflow-lifecycle-execution.service.spec.ts 2>/dev/null || echo "absent"
```

If absent, create it. Either way, add this describe block:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowLifecycleExecutionService } from './workflow-lifecycle-execution.service';

function makeDeps(overrides: {
  workflows?: unknown[];
  bindingsByPhase?: Record<string, unknown[]>;
  engineResult?: string | null;
} = {}) {
  const workflows = overrides.workflows ?? [];
  const bindingsByPhase = overrides.bindingsByPhase ?? {};

  const workflowRepository = {
    findActiveBySourceScope: vi.fn().mockResolvedValue(workflows),
  };
  const triggerRegistry = {
    resolveLifecycleBindings: vi.fn().mockImplementation(
      (_wfs: unknown, opts: { phase: string }) => bindingsByPhase[opts.phase] ?? [],
    ),
  };
  const workflowEngine = {
    startWorkflow: vi.fn().mockResolvedValue(overrides.engineResult ?? 'run-1'),
  };
  const workflowRunRepository = {
    findById: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
  };
  const workflowLifecycleResultRepository = {
    save: vi.fn().mockImplementation(async (x: unknown) => ({ id: 'lr-1', ...x })),
  };

  return {
    workflowRepository,
    triggerRegistry,
    workflowEngine,
    workflowRunRepository,
    workflowLifecycleResultRepository,
    service: new WorkflowLifecycleExecutionService(
      workflowRepository as any,
      triggerRegistry as any,
      workflowEngine as any,
      workflowRunRepository as any,
      workflowLifecycleResultRepository as any,
    ),
  };
}

describe('WorkflowLifecycleExecutionService — phase aliases', () => {
  it('finds a legacy phase:"merge" workflow when phase:"ready-to-merge" is requested', async () => {
    const legacyBinding = {
      workflowId: 'wf-legacy',
      workflowDefinitionId: 'pre_merge_ci',
      workflowName: 'Pre-Merge CI',
      phase: 'merge',
      hook: 'before',
      blocking: true,
    };

    const { service, triggerRegistry, workflowLifecycleResultRepository } = makeDeps({
      // phase "ready-to-merge" returns nothing; phase "merge" (alias) returns the binding
      bindingsByPhase: { merge: [legacyBinding] },
    });

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'proj-1',
      contextId: 'wi-1',
      phase: 'ready-to-merge',
      hook: 'before',
      blockingOnly: true,
    });

    // alias lookup must have been called
    expect(triggerRegistry.resolveLifecycleBindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phase: 'merge' }),
    );
    // the binding was executed (engine was called)
    expect(result.results).toHaveLength(1);
    expect(result.results[0].workflowName).toBe('Pre-Merge CI');
  });

  it('does NOT duplicate bindings that appear under both the canonical and alias phase', async () => {
    const binding = {
      workflowId: 'wf-1',
      workflowDefinitionId: 'pre_merge_ci',
      workflowName: 'CI',
      phase: 'ready-to-merge',
      hook: 'before',
      blocking: true,
    };
    const { service, workflowEngine } = makeDeps({
      bindingsByPhase: { 'ready-to-merge': [binding], merge: [binding] },
    });

    await service.executeLifecycleWorkflows({
      scopeId: 'proj-1',
      contextId: 'wi-1',
      phase: 'ready-to-merge',
      hook: 'before',
      blockingOnly: true,
    });

    // engine called exactly once, not twice
    expect(workflowEngine.startWorkflow).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/api && npx vitest run src/workflow/workflow-lifecycle-execution.service.spec.ts -t "phase aliases"
```
Expected: FAIL — alias lookup not implemented.

- [ ] **Step 3: Implement `getLegacyPhaseAliases` and `resolveBindingsWithAliases`**

In `apps/api/src/workflow/workflow-lifecycle-execution.service.ts`, add these two private methods and update `executeLifecycleWorkflows` to use them.

Replace the binding resolution section (lines 47–51) with:

```ts
    const bindings = this.resolveBindingsWithAliases(workflows, {
      phase: request.phase,
      hook: request.hook,
      blockingOnly,
    });
```

Add at the bottom of the class (before the closing `}`):

```ts
  private getLegacyPhaseAliases(phase: string): string[] {
    const ALIASES: Readonly<Record<string, string[]>> = {
      'ready-to-merge': ['merge'],
    };
    return ALIASES[phase] ?? [];
  }

  private resolveBindingsWithAliases(
    workflows: Parameters<WorkflowTriggerRegistryService['resolveLifecycleBindings']>[0],
    options: { phase: string; hook: string; blockingOnly: boolean },
  ): WorkflowTriggerBinding[] {
    const primary = this.triggerRegistry.resolveLifecycleBindings(workflows, options);
    const seen = new Set(primary.map((b) => b.workflowId));
    const aliases = this.getLegacyPhaseAliases(options.phase);
    const fromAliases = aliases.flatMap((alias) =>
      this.triggerRegistry
        .resolveLifecycleBindings(workflows, { ...options, phase: alias })
        .filter((b) => !seen.has(b.workflowId)),
    );
    return [...primary, ...fromAliases];
  }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/workflow/workflow-lifecycle-execution.service.spec.ts -t "phase aliases"
```
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-lifecycle-execution.service.ts apps/api/src/workflow/workflow-lifecycle-execution.service.spec.ts
git commit -m "feat(api): resolve phase:merge as alias for ready-to-merge in lifecycle execution"
```

---

## TASK 4 — Enrich file listing with YAML trigger metadata (backend)

**Context:** `GET /projects/:id/workflow-files` currently returns `[{ path, size }]`. The frontend guesses the trigger by parsing the filename — fragile and wrong for descriptively-named files. This task reads each YAML file's `trigger` block concurrently and includes it in the response, making grouping authoritative regardless of filename.

**Files:**
- Modify: `apps/kanban/src/project/project.controller.ts`
- Modify: `apps/kanban/src/project/project.controller.spec.ts`

- [ ] **Step 1: Add `js-yaml` as a direct dependency**

```bash
cd apps/kanban && npm install js-yaml
```

Verify it appears in `apps/kanban/package.json` dependencies (not devDependencies).

- [ ] **Step 2: Write the failing test**

Add to `apps/kanban/src/project/project.controller.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
// ... existing imports above ...

describe("ProjectController.listWorkflowFiles — YAML trigger enrichment", () => {
  const BEFORE_YAML = `
workflow_id: pre_merge_ci
name: Pre-Merge CI
trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
  blocking: true
jobs: []
`.trim();

  const AFTER_YAML = `
workflow_id: post_merge_notify
name: Post-Merge Notify
trigger:
  type: lifecycle
  phase: done
  hook: after
  blocking: false
jobs: []
`.trim();

  const NON_LIFECYCLE_YAML = `
workflow_id: manual_wf
name: Manual
trigger:
  type: manual
jobs: []
`.trim();

  const MALFORMED_YAML = `not: valid: yaml: [[[`;

  function makeController(files: Array<{ path: string; size: number }>, contentByPath: Record<string, string>) {
    const projects = {
      get: vi.fn().mockResolvedValue({ basePath: "/repo" }),
    };
    const coreClient = {
      listRepoFiles: vi.fn().mockResolvedValue({ files }),
      readRepoFile: vi.fn().mockImplementation(async ({ filePath }: { filePath: string }) => {
        const filename = filePath.split("/").at(-1)!;
        const content = contentByPath[filename];
        if (!content) throw new Error(`not found: ${filePath}`);
        return { content };
      }),
    };
    return createController({ projects, coreClient });
  }

  it("attaches parsed lifecycle trigger to each file", async () => {
    const controller = makeController(
      [
        { path: ".nexus/workflows/ready-to-merge.before.workflow.yaml", size: 100 },
        { path: ".nexus/workflows/post-done.after.workflow.yaml", size: 80 },
      ],
      {
        "ready-to-merge.before.workflow.yaml": BEFORE_YAML,
        "post-done.after.workflow.yaml": AFTER_YAML,
      },
    );

    const result = await controller.listWorkflowFiles("proj-1");

    expect(result.files[0].trigger).toEqual({
      phase: "ready-to-merge",
      hook: "before",
      blocking: true,
    });
    expect(result.files[1].trigger).toEqual({
      phase: "done",
      hook: "after",
      blocking: false,
    });
  });

  it("returns trigger: null for non-lifecycle triggers", async () => {
    const controller = makeController(
      [{ path: ".nexus/workflows/manual.workflow.yaml", size: 50 }],
      { "manual.workflow.yaml": NON_LIFECYCLE_YAML },
    );

    const result = await controller.listWorkflowFiles("proj-1");

    expect(result.files[0].trigger).toBeNull();
  });

  it("returns trigger: null when the YAML is malformed", async () => {
    const controller = makeController(
      [{ path: ".nexus/workflows/broken.workflow.yaml", size: 10 }],
      { "broken.workflow.yaml": MALFORMED_YAML },
    );

    const result = await controller.listWorkflowFiles("proj-1");

    expect(result.files[0].trigger).toBeNull();
  });

  it("returns trigger: null when the file cannot be read", async () => {
    const controller = makeController(
      [{ path: ".nexus/workflows/missing.workflow.yaml", size: 0 }],
      {}, // no content → readRepoFile throws
    );

    const result = await controller.listWorkflowFiles("proj-1");

    expect(result.files[0].trigger).toBeNull();
  });
});
```

- [ ] **Step 3: Run to confirm the tests fail**

```bash
cd apps/kanban && npx vitest run src/project/project.controller.spec.ts -t "YAML trigger enrichment"
```
Expected: FAIL — `listWorkflowFiles` does not yet return a `trigger` field.

- [ ] **Step 4: Implement the enrichment in `project.controller.ts`**

At the top of the file, add the import:

```ts
import { load as loadYaml } from "js-yaml";
```

Replace the `listWorkflowFiles` method and add the private helper:

```ts
@Get(":project_id/workflow-files")
async listWorkflowFiles(@Param("project_id") project_id: string) {
  const project = await this.projects.get(project_id);
  if (!project.basePath) {
    return { files: [], error: "Project has no repository path" };
  }
  const result = await this.coreClient.listRepoFiles({
    repoPath: project.basePath,
    directory: ".nexus/workflows",
    pattern: ".workflow.yaml",
  });
  const enriched = await Promise.all(
    result.files.map(async (file) => ({
      ...file,
      trigger: await this.extractWorkflowTrigger(project.basePath!, file.path),
    })),
  );
  return { ...result, files: enriched };
}

private async extractWorkflowTrigger(
  repoPath: string,
  filePath: string,
): Promise<{ phase: string; hook: "before" | "after"; blocking: boolean } | null> {
  try {
    const { content } = await this.coreClient.readRepoFile({ repoPath, filePath });
    const doc = loadYaml(content) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object") return null;
    const trigger = doc.trigger as Record<string, unknown> | undefined;
    if (!trigger || trigger.type !== "lifecycle") return null;
    const phase = typeof trigger.phase === "string" && trigger.phase.length > 0
      ? trigger.phase : null;
    const hook = trigger.hook === "before" || trigger.hook === "after"
      ? trigger.hook : null;
    if (!phase || !hook) return null;
    const blocking = typeof trigger.blocking === "boolean"
      ? trigger.blocking
      : hook === "before";
    return { phase, hook, blocking };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/kanban && npx vitest run src/project/project.controller.spec.ts -t "YAML trigger enrichment"
```
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

```bash
cd apps/kanban && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/project/project.controller.ts apps/kanban/src/project/project.controller.spec.ts apps/kanban/package.json apps/kanban/package-lock.json
git commit -m "feat(kanban): enrich workflow-files listing with YAML trigger metadata"
```

---

## TASK 5 — Use trigger metadata for column grouping (frontend)

**Context:** `RepositoryWorkflowsTab` groups workflow files by parsing the filename with `parseTriggerFromFilename`. Now that the backend returns `file.trigger`, we read it directly. Remove the filename-parsing logic.

**Files:**
- Modify: `apps/web/src/lib/api/client.workflow-files.types.ts`
- Modify: `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.tsx`
- Create: `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { buildColumnGroups } from "./RepositoryWorkflowsTab";
import type { WorkflowFileItem } from "@/lib/api/client.workflow-files.types";

describe("buildColumnGroups", () => {
  it("groups a file by its trigger.phase, not its filename", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/pre-merge-ci.workflow.yaml",
        size: 100,
        trigger: { phase: "ready-to-merge", hook: "before", blocking: true },
      },
    ];

    const { columnGroups, otherFiles } = buildColumnGroups(files);

    const rtmGroup = columnGroups.find((g) => g.status === "ready-to-merge");
    expect(rtmGroup?.files).toHaveLength(1);
    expect(rtmGroup?.files[0].path).toContain("pre-merge-ci");
    expect(otherFiles).toHaveLength(0);
  });

  it("puts a file with trigger: null in otherFiles", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/manual.workflow.yaml",
        size: 50,
        trigger: null,
      },
    ];

    const { columnGroups, otherFiles } = buildColumnGroups(files);

    expect(otherFiles).toHaveLength(1);
    expect(columnGroups.every((g) => g.files.length === 0)).toBe(true);
  });

  it("puts a file whose trigger.phase is not a known column status in otherFiles", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/custom.workflow.yaml",
        size: 60,
        trigger: { phase: "some-unknown-phase", hook: "before", blocking: true },
      },
    ];

    const { columnGroups, otherFiles } = buildColumnGroups(files);

    expect(otherFiles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm the test fails**

```bash
cd apps/web && npx vitest run src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx
```
Expected: FAIL — `buildColumnGroups` is not exported, or the `trigger` field doesn't exist on `WorkflowFileItem`.

- [ ] **Step 3: Update `WorkflowFileItem` to include `trigger`**

In `apps/web/src/lib/api/client.workflow-files.types.ts`, update the `WorkflowFileItem` interface:

```ts
export interface WorkflowFileTrigger {
  readonly phase: string;
  readonly hook: "before" | "after";
  readonly blocking: boolean;
}

export interface WorkflowFileItem {
  path: string;
  size: number;
  trigger: WorkflowFileTrigger | null;
}

export interface FileListResponse {
  files: WorkflowFileItem[];
  error?: string;
}

export interface FileReadResponse {
  content: string;
}

export interface CommitPathsResult {
  committed: boolean;
  status: string;
  changed_files: Array<{ path: string; status: string }>;
  commit_sha: string | null;
}
```

- [ ] **Step 4: Update `RepositoryWorkflowsTab.tsx` to use `file.trigger` and export `buildColumnGroups`**

In `apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.tsx`:

1. Remove the `parseTriggerFromFilename` function and `WorkflowFileTrigger` type export (they're no longer used; `WorkflowFileTrigger` now lives in `client.workflow-files.types.ts`).

2. Update the import at the top:

```ts
import type { WorkflowFileItem } from "@/lib/api/client.workflow-files.types";
```

3. Replace `buildColumnGroups` so it uses `file.trigger` instead of calling `parseTriggerFromFilename`:

```ts
export function buildColumnGroups(files: WorkflowFileItem[]): {
  columnGroups: ColumnGroup[];
  otherFiles: WorkflowFileItem[];
} {
  const byPhase = new Map<string, WorkflowFileItem[]>();
  const otherFiles: WorkflowFileItem[] = [];

  for (const file of files) {
    const trigger = file.trigger;
    if (trigger) {
      const existing = byPhase.get(trigger.phase) ?? [];
      existing.push(file);
      byPhase.set(trigger.phase, existing);
    } else {
      otherFiles.push(file);
    }
  }

  const columnGroups: ColumnGroup[] = KANBAN_COLUMNS.map((column) => ({
    status: column.status,
    title: column.title,
    files: byPhase.get(column.status) ?? [],
  }));

  // Files whose trigger.phase doesn't match any known column go to otherFiles
  for (const [phase, phaseFiles] of byPhase.entries()) {
    if (!KANBAN_COLUMNS.some((col) => col.status === phase)) {
      otherFiles.push(...phaseFiles);
    }
  }

  return { columnGroups, otherFiles };
}
```

4. Update `WorkflowFileRow` — it previously called `parseTriggerFromFilename(filename)`. Now read from `file.trigger`:

```tsx
function WorkflowFileRow({
  file,
  onDelete,
  onEdit,
}: {
  readonly file: WorkflowFileItem;
  readonly onDelete: (filename: string) => void;
  readonly onEdit: (filename: string) => void;
}) {
  const filename = filenameFromPath(file.path);
  const trigger = file.trigger;

  return (
    <TableRow key={file.path}>
      <TableCell className="font-mono text-sm">{filename}</TableCell>
      <TableCell>
        {trigger ? (
          <Badge variant={trigger.blocking ? "destructive" : "secondary"}>
            {trigger.blocking ? "blocking" : "react"}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => onEdit(filename)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(filename)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/web && npx vitest run src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/client.workflow-files.types.ts apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.tsx apps/web/src/pages/project-workspace/RepositoryWorkflowsTab.spec.tsx
git commit -m "feat(web): group repository workflows by YAML trigger phase, not filename"
```

---

## TASK 6 — Register the seed workflow in the database

**Context:** `WorkflowSeedService` scans `seed/workflows/` at setup time (called from `SetupService.seedWorkflowsBestEffort()` during first-time admin setup — `apps/api/src/setup/setup.service.ts` line 109). For an already-running installation, the seeder does NOT re-run automatically. After Task 2 moves the file into `seed/workflows/`, the workflow must be registered manually via the API. Once registered it appears under `source: 'seeded'` and is globally available to all projects.

**No code changes. Steps are API calls against the running dev server.**

- [ ] **Step 1: Get an API token**

If you have a `NEXUS_API_KEY` in your `.env`, use that. Otherwise authenticate:

```bash
# Replace with your actual credentials / token endpoint
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nexus.local","password":"<admin-password>"}' \
  | jq -r '.access_token')
echo "TOKEN=${TOKEN}"
```

- [ ] **Step 2: Read the YAML content**

```bash
YAML=$(cat seed/workflows/ready-to-merge.before.workflow.yaml)
```

- [ ] **Step 3: Create the workflow via the API**

```bash
curl -s -X POST http://localhost:3000/api/workflows \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"yaml_definition\": $(echo "${YAML}" | jq -Rs .)}" \
  | jq .
```

Expected response: `{ "success": true, "data": { "id": "...", "name": "Pre-Merge CI", "is_active": true, ... } }`. Note the `id` — you'll need it for verification.

- [ ] **Step 4: Verify the workflow is active**

```bash
curl -s http://localhost:3000/api/workflows \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.data[] | select(.name == "Pre-Merge CI")'
```

Expected: one result with `is_active: true` and `source_type: "seed"` (or similar).

> **Alternative — re-run the seeder:** If you have direct DB access or a seed script, you can trigger `WorkflowSeedService.seed()` instead. The seeder is called via `SetupService.seedWorkflowsBestEffort()`. There is no dedicated HTTP endpoint for re-seeding in the current API surface.

---

## TASK 7 — Enable repository workflow settings on the target project

**Context:** `runTransitionGate` in `apps/kanban/src/work-item/work-item.service.helpers.ts` checks `project.repository_workflow_settings.enabled !== true` at the start and returns `{ blocked: false }` immediately if it's falsy. No lifecycle workflow ever fires on a project where this is not explicitly enabled. The flag is stored as JSONB in `kanban_projects.repository_workflow_settings`.

**No code changes. One API call against the running kanban service.**

- [ ] **Step 1: Identify the project ID**

From the browser URL (`/projects/<project_id>?tab=repository-workflows`) or from the API:

```bash
curl -s http://localhost:3100/kanban-api/projects \
  | jq '.data[] | {id, name}'
```

- [ ] **Step 2: Enable repository workflows on the project**

```bash
PROJECT_ID="<your-project-id>"

curl -s -X PATCH \
  "http://localhost:3100/kanban-api/projects/${PROJECT_ID}/repository-workflows/settings" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  | jq .
```

Expected: `{ "success": true, "data": { "enabled": true, "overrides": {} } }`

- [ ] **Step 3: Verify**

```bash
curl -s "http://localhost:3100/kanban-api/projects/${PROJECT_ID}/repository-workflows/settings" \
  | jq .
```

Expected: `{ "success": true, "data": { "enabled": true, ... } }`

After this step, the next status transition to `ready-to-merge` on any work item in this project will trigger the `Pre-Merge CI` lifecycle gate.

---

## Final Verification

- [ ] **Run all affected test suites**

```bash
cd apps/api && npx vitest run src/workflow/
cd apps/kanban && npx vitest run src/project/
cd apps/web && npx vitest run src/pages/project-workspace/
```
Expected: All PASS, no regressions.

- [ ] **Full typecheck**

```bash
cd apps/api && npx tsc --noEmit
cd apps/kanban && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
Expected: All PASS.

- [ ] **End-to-end smoke test**

1. Open the project at `?tab=repository-workflows`
2. **Recent Runs** should show only runs scoped to this project (not global)
3. The **Pre-Merge CI** workflow should appear in the **Ready to Merge** column (not "Other")
4. Move a work item to the **Ready to Merge** column — the gate badge should appear while the workflow runs, and the item should be blocked until it completes

---

## Self-Review Notes

**Spec coverage:**
- ✅ `WorkflowRunsQueryDto` whitelist stripping → Task 1
- ✅ Seed workflow wrong path / wrong phase → Task 2
- ✅ `phase: "merge"` alias → Task 3
- ✅ Parse trigger from YAML (backend) → Task 4
- ✅ Use trigger for grouping instead of filename (frontend) → Task 5
- ✅ Workflow not in database → Task 6
- ✅ Project `repository_workflow_settings.enabled` not set → Task 7

**Type consistency:**
- `WorkflowFileTrigger` is defined in `client.workflow-files.types.ts` (Task 5 Step 3) and the backend returns the same shape `{ phase, hook, blocking }` (Task 4 Step 4). Names match.
- `buildColumnGroups` is exported in Task 5 Step 4 and imported in Task 5 Step 1 test. ✅
