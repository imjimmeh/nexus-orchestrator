# Fix Refinement Workflow Root Causes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three confirmed orchestration defects that cause refinement workflow runs to fail with empty workspace, false required-tool retries, and brittle artifact persistence.

**Architecture:** Three independent fixes — one per root cause. Root Causes A and B are targeted minimal patches. Root Cause C is an architectural fix: change `submit_preflight_artifacts` from a fire-and-forget `mounted_tool` to a synchronous `api_callback`, making required-tool tracking durable and allowing the now-unnecessary `ToolCallTrackerService` to be fully deleted.

**Tech Stack:** NestJS / TypeScript, Vitest, Redis, Docker/container orchestration

---

## Context — What Was Broken and Why

### Root Cause A — Workspace silently empty for work-item jobs

`StepSupportService.resolveWorktreePathFromTrigger` has two branches:
- **With `workItemId`:** tries `getExistingWorktreePath`, returns `undefined` on miss — **no fallback**
- **Without `workItemId`:** falls back to `project.basePath`

When a work-item-triggered job has no managed worktree yet, the worktree lookup returns null and the function returns `undefined`. `ContainerOrchestratorService.resolveConfiguredVolumes` exits early when `worktreePath` is `undefined`, so no `/workspace` mount is added. The container starts at `workingDir: '/workspace'` on an empty directory.

### Root Cause B — Optional template fields become empty strings, not absent

The YAML workflow declares optional structured fields using template syntax:
```yaml
split_children: "{{ jobs.architect_refinement.output.split_children }}"
```

`resolveTemplatedInputValue` in `step-support-inputs.helpers.ts` first tries a direct path lookup. If the value is absent (`undefined`), it falls through to Handlebars `substituteTemplate`. Handlebars renders a missing variable as `""` (empty string). The key is then **present** in `resolvedStepInputs` with value `""`.

`readRecordArrayInputOrThrow` uses `hasInputKey(inputs, key)` to distinguish "user explicitly provided a bad value" from "field was omitted". After template resolution, **both cases look identical**: the key is present with value `""`. The guard throws:
```
Step X: record_metadata action set_preflight_artifacts requires inputs.split_children to be an array of objects
```

### Root Cause C — `submit_preflight_artifacts` is fire-and-forget; tracking is async

`submit_preflight_artifacts` is declared as `transport: 'mounted_tool'`. A mounted tool runs as a local stub inside the agent container and returns `{ ok: true }` without making any HTTP call to the API server. The only signal the API receives is the `tool_execution_end` WebSocket telemetry event — which is fire-and-forget from the container's perspective.

`StepRequiredToolRetryService` checks whether required tools were called by querying `ToolCallTrackerService`, which is populated from that same WebSocket event via Redis. By the time the container exits and the workflow engine checks required tools, the Redis write may not have arrived. A 500ms polling settle window was added as a band-aid, but it remains a race.

**Architectural fix:** change `submit_preflight_artifacts` to `transport: 'api_callback'`. When the agent calls the tool, the container runner makes a **synchronous HTTP POST** to a new API endpoint. That endpoint writes `jobs.{jobId}.output` to durable workflow state atomically, then returns `{ ok: true }` to the container. By the time the container finishes, the state variable is already committed. `StepRequiredToolRetryService` reads that state variable — no Redis, no settle window, no race. `ToolCallTrackerService` has no remaining callers that read from it, so it can be deleted entirely.

---

## File Map

| File | Change |
|------|--------|
| `apps/api/src/workflow/step-support.service.ts` | Fix `resolveWorktreePathFromTrigger` — add basePath fallback after failed worktree lookup |
| `apps/api/src/workflow/step-support-inputs.helpers.ts` | Fix `resolveTemplatedInputValue` — return `undefined` directly for absent pure-template fields; filter `undefined` entries in `resolveTemplatedInputs` |
| `apps/api/src/tool/capability-manifest.preflight.entry.ts` | Change `submit_preflight_artifacts` to `transport: 'api_callback'` with `apiCallback` config |
| `apps/api/src/workflow/workflow-runtime-preflight.service.ts` | **New file** — writes `jobs.{jobId}.output` synchronously when preflight tool is called |
| `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts` | Add `POST preflight/submit` endpoint |
| `apps/api/src/workflow/step-required-tool-retry.service.ts` | Remove `ToolCallTrackerService` dependency; remove settle window; check state variable directly |
| `apps/api/src/workflow/repro-root-causes.spec.ts` | Update Root Cause C test — remove Redis mock, add state output mock, confirm all three pass |
| `apps/api/src/workflow/step-support.service.spec.ts` | Add positive-path worktree-fallback tests |
| `apps/api/src/workflow/step-required-tool-retry.service.spec.ts` | Update coverage for new state-variable satisfaction path |
| `apps/api/src/workflow/workflow-runtime-preflight.service.spec.ts` | **New file** — unit tests for the preflight submit service |
| `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts` | Remove `toolCallTracker` param and Redis write from `trackToolExecutionCompat` |
| `apps/api/src/telemetry/telemetry.gateway.ts` | Remove `ToolCallTrackerService` injection; remove from `trackToolExecutionCompat` call |
| `apps/api/src/telemetry/telemetry-war-room.gateway.ts` | Remove `ToolCallTrackerService` injection; remove from war room tracking calls |
| `apps/api/src/telemetry/telemetry-gateway-war-room.tool-tracking.ts` | Remove all `ToolCallTrackerService` usage; functions become no-ops or are deleted |
| `apps/api/src/telemetry/telemetry-gateway-war-room.helpers.ts` | Remove `toolCallTracker` from params types |
| `apps/api/src/telemetry/telemetry-gateway-war-room-moderation.helpers.ts` | Remove `toolCallTracker` from params types |
| `apps/api/src/workflow/step-agent-container-support.service.ts` | Remove `toolCallTracker.clear()` and injection |
| `apps/api/src/redis/tool-call-tracker.service.ts` | **Delete** |
| `apps/api/src/redis/tool-call-tracker.service.spec.ts` | **Delete** |
| `apps/api/src/redis/redis.module.ts` | Remove `ToolCallTrackerService` from providers/exports |

---

## Task 1 — Fix Root Cause A: Workspace Fallback

**Files:**
- Modify: `apps/api/src/workflow/step-support.service.ts:294-323`
- Test: `apps/api/src/workflow/repro-root-causes.spec.ts` (existing repro, must pass)
- Test: `apps/api/src/workflow/step-support.service.spec.ts` (add coverage)

- [ ] **Step 1: Run the existing repro test and confirm it fails (Red)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: FAIL — `Root Cause A: Workspace Fallback > repro: fails to fallback to project basePath when worktree is missing` — `expected undefined to be '/data/repos/project-1'`

- [ ] **Step 2: Apply the minimal fix to `resolveWorktreePathFromTrigger`**

In `apps/api/src/workflow/step-support.service.ts`, replace the entire `resolveWorktreePathFromTrigger` method (starting at the `async resolveWorktreePathFromTrigger` declaration) with:

```ts
async resolveWorktreePathFromTrigger(
  stateVariables: Record<string, unknown>,
): Promise<string | undefined> {
  const trigger = asRecord(stateVariables.trigger);
  const projectId = readStringField(trigger, 'projectId');
  const workItemId = readStringField(trigger, 'workItemId');

  if (!projectId) {
    return undefined;
  }

  if (workItemId) {
    try {
      const existingPath =
        await this.gitWorktreeService.getExistingWorktreePath(
          projectId,
          workItemId,
        );
      if (existingPath) {
        return existingPath;
      }
    } catch {
      // fall through to project basePath fallback
    }
  }

  try {
    const project = await this.projectRepository.findById(projectId);
    return project?.basePath || undefined;
  } catch {
    return undefined;
  }
}
```

The change: the `if (workItemId)` block no longer returns early on a null/empty worktree path or on error. Control falls through to the `project.basePath` lookup in all cases where no managed worktree is found.

- [ ] **Step 3: Run the repro test and confirm it passes (Green)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: `Root Cause A` test block PASS.

- [ ] **Step 4: Add additional coverage to `step-support.service.spec.ts`**

In `apps/api/src/workflow/step-support.service.spec.ts`, add the following describe block inside the existing `describe('StepSupportService', ...)`:

```ts
describe('resolveWorktreePathFromTrigger', () => {
  beforeEach(() => {
    mockGitWorktreeService = { getExistingWorktreePath: vi.fn() };
    mockProjectRepository = { findById: vi.fn() };
  });

  it('returns worktree path when managed worktree exists', async () => {
    mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/item-1',
    );

    const result = await service.resolveWorktreePathFromTrigger({
      trigger: { projectId: 'project-1', workItemId: 'item-1' },
    });

    expect(result).toBe('/data/worktrees/project-1/item-1');
    expect(mockProjectRepository.findById).not.toHaveBeenCalled();
  });

  it('falls back to project basePath when worktree lookup returns null', async () => {
    mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);
    mockProjectRepository.findById.mockResolvedValue({
      id: 'project-1',
      basePath: '/data/repos/project-1',
    });

    const result = await service.resolveWorktreePathFromTrigger({
      trigger: { projectId: 'project-1', workItemId: 'item-1' },
    });

    expect(result).toBe('/data/repos/project-1');
  });

  it('falls back to project basePath when worktree lookup throws', async () => {
    mockGitWorktreeService.getExistingWorktreePath.mockRejectedValue(
      new Error('git error'),
    );
    mockProjectRepository.findById.mockResolvedValue({
      id: 'project-1',
      basePath: '/data/repos/project-1',
    });

    const result = await service.resolveWorktreePathFromTrigger({
      trigger: { projectId: 'project-1', workItemId: 'item-1' },
    });

    expect(result).toBe('/data/repos/project-1');
  });

  it('returns undefined when no projectId in trigger', async () => {
    const result = await service.resolveWorktreePathFromTrigger({
      trigger: { workItemId: 'item-1' },
    });

    expect(result).toBeUndefined();
    expect(mockGitWorktreeService.getExistingWorktreePath).not.toHaveBeenCalled();
  });

  it('uses project basePath directly when there is no workItemId', async () => {
    mockProjectRepository.findById.mockResolvedValue({
      id: 'project-1',
      basePath: '/data/repos/project-1',
    });

    const result = await service.resolveWorktreePathFromTrigger({
      trigger: { projectId: 'project-1' },
    });

    expect(result).toBe('/data/repos/project-1');
    expect(mockGitWorktreeService.getExistingWorktreePath).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the full service spec and confirm all tests pass**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/step-support.service.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/step-support.service.ts apps/api/src/workflow/step-support.service.spec.ts apps/api/src/workflow/repro-root-causes.spec.ts
git commit -m "fix(workflow): fall back to project basePath when no managed worktree exists

When resolveWorktreePathFromTrigger finds no managed worktree for a
work-item-triggered job, it now falls back to project.basePath instead
of returning undefined. This matches the chat-execution path and
prevents /workspace from being empty in agent containers.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2 — Fix Root Cause B: Template Resolution Preserves Absent Optional Fields

**Files:**
- Modify: `apps/api/src/workflow/step-support-inputs.helpers.ts:44-58` (resolveTemplatedInputValue)
- Modify: `apps/api/src/workflow/step-support-inputs.helpers.ts:27-42` (resolveTemplatedInputs)
- Test: `apps/api/src/workflow/repro-root-causes.spec.ts` (existing repro, must pass)

- [ ] **Step 1: Run the Root Cause B repro test and confirm it fails (Red)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: FAIL — `Root Cause B > repro: throws when optional array inputs are empty strings` — receives an Error instead of resolving cleanly.

- [ ] **Step 2: Fix `resolveTemplatedInputValue` to return `undefined` for absent pure-template fields**

In `apps/api/src/workflow/step-support-inputs.helpers.ts`, replace the `resolveTemplatedInputValue` function body:

**Before:**
```ts
function resolveTemplatedInputValue(
  value: unknown,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): unknown {
  if (typeof value === 'string') {
    const directTemplatePath = extractDirectTemplatePath(value);
    if (directTemplatePath) {
      const directValue = getNestedTemplateValue(variables, directTemplatePath);
      if (directValue !== undefined) {
        return directValue;
      }
    }

    return substituteTemplate(value);
  }
  // ... rest unchanged
```

**After:**
```ts
function resolveTemplatedInputValue(
  value: unknown,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): unknown {
  if (typeof value === 'string') {
    const directTemplatePath = extractDirectTemplatePath(value);
    if (directTemplatePath) {
      // Pure template expression: {{ some.path }}
      // Return the resolved value directly — undefined when absent.
      // This preserves "absent" semantics rather than degrading to "".
      return getNestedTemplateValue(variables, directTemplatePath);
    }

    return substituteTemplate(value);
  }
  // ... rest unchanged
```

- [ ] **Step 3: Fix `resolveTemplatedInputs` to omit entries whose resolved value is `undefined`**

In the same file, replace the `resolveTemplatedInputs` function:

**Before:**
```ts
export function resolveTemplatedInputs(
  inputs: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): Record<string, unknown> {
  if (!inputs) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      resolveTemplatedInputValue(value, variables, substituteTemplate),
    ]),
  );
}
```

**After:**
```ts
export function resolveTemplatedInputs(
  inputs: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): Record<string, unknown> {
  if (!inputs) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    const resolved = resolveTemplatedInputValue(value, variables, substituteTemplate);
    if (resolved !== undefined) {
      result[key] = resolved;
    }
  }
  return result;
}
```

Why: when a pure template `{{ foo.bar }}` resolves to `undefined` (value absent), the key is now omitted from the result entirely. `hasInputKey` then correctly returns `false`, and `readRecordArrayInputOrThrow` treats the field as not provided.

For mixed templates like `"prefix {{ foo.bar }} suffix"`, `extractDirectTemplatePath` returns `undefined` (regex requires the entire string to be a single `{{ ... }}`), so they still go through Handlebars where missing values render as `""`. This is correct for string interpolation contexts.

- [ ] **Step 4: Run the repro test and confirm Root Cause B passes (Green)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: `Root Cause B` test block PASS.

- [ ] **Step 5: Run the broader step-support and state-manager spec suites to check for regressions**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/step-support.service.spec.ts src/workflow/state-manager.service.spec.ts src/workflow/step-record-metadata-special-step.handler.spec.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/step-support-inputs.helpers.ts apps/api/src/workflow/repro-root-causes.spec.ts
git commit -m "fix(workflow): preserve absent semantics for pure-template optional fields

When a YAML input field is a pure template expression (e.g. {{ foo.bar }})
and the referenced path is absent from state variables, resolveTemplatedInputs
now omits the key entirely rather than setting it to empty string.

This fixes persist_architect_artifacts failing with 'requires inputs.split_children
to be an array of objects' when the architect did not produce split_children —
previously the absent field was resolved to '' which triggered the type guard.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3 — Fix Root Cause C: Make `submit_preflight_artifacts` Synchronous

**The problem:** `submit_preflight_artifacts` uses `transport: 'mounted_tool'`, which means it runs as a local stub inside the container with no HTTP call to the API. The only signal the API receives is a fire-and-forget WebSocket event. This creates a race between the WebSocket telemetry write and the required-tool check that runs after the container exits.

**The fix:** Change the tool to `transport: 'api_callback'`. When the agent calls it, the container runtime makes a synchronous HTTP POST to a new API endpoint. That endpoint writes `jobs.{jobId}.output` to durable workflow state before returning. `StepRequiredToolRetryService` then reads that state variable — no Redis, no polling window, no race.

**Files:**
- Modify: `apps/api/src/tool/capability-manifest.preflight.entry.ts`
- Create: `apps/api/src/workflow/workflow-runtime-preflight.service.ts`
- Create: `apps/api/src/workflow/workflow-runtime-preflight.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts`
- Modify: `apps/api/src/workflow/step-required-tool-retry.service.ts`
- Modify: `apps/api/src/workflow/repro-root-causes.spec.ts`
- Modify: `apps/api/src/workflow/step-required-tool-retry.service.spec.ts`

### Step 3.1 — Change the capability manifest entry to `api_callback`

- [ ] **Step 3.1.1: Run the Root Cause C repro test and confirm it fails (Red)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: FAIL — `Root Cause C > repro: retries even if output was captured if tracker is empty` — returns `'retried'` instead of `'proceed'`. Note: this test takes ~500ms due to the settle window.

- [ ] **Step 3.1.2: Replace the manifest entry**

In `apps/api/src/tool/capability-manifest.preflight.entry.ts`, replace the entire file content:

```ts
import { CapabilityManifestEntry } from './capability-manifest.types';

export const SUBMIT_PREFLIGHT_ARTIFACTS_ENTRY: CapabilityManifestEntry = {
  name: 'submit_preflight_artifacts',
  tierRestriction: 2,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['context'],
  description:
    'Capture PM and architect preflight planning artifacts for refinement workflows.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/preflight/submit',
    bodyMapping: {
      pm_summary: 'pm_summary',
      acceptance_clarifications: 'acceptance_clarifications',
      architect_summary: 'architect_summary',
      sdd_targets: 'sdd_targets',
      implementation_plan: 'implementation_plan',
    },
  },
  schema: {
    type: 'object',
    properties: {
      pm_summary: {
        type: 'string',
        description: 'Product manager summary of clarified requirements',
      },
      acceptance_clarifications: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Structured acceptance clarifications gathered during PM refinement',
      },
      architect_summary: {
        type: 'string',
        description: 'Architect summary of technical approach',
      },
      sdd_targets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Suggested SDD target sections or documents to update',
      },
      implementation_plan: {
        type: 'object',
        description:
          'Optional implementation plan payload for executionConfig persistence',
        additionalProperties: true,
      },
    },
    additionalProperties: false,
  },
};
```

Note: the `typescriptCode` property has been removed because `api_callback` tools do not execute local TypeScript — they make an HTTP call.

### Step 3.2 — Create the preflight submit service and endpoint

- [ ] **Step 3.2.1: Write the failing test for the new service (Red)**

Create `apps/api/src/workflow/workflow-runtime-preflight.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, beforeEach, it, expect, vi, Mock } from 'vitest';
import { WorkflowRuntimePreflightService } from './workflow-runtime-preflight.service';
import { StateManagerService } from './state-manager.service';

describe('WorkflowRuntimePreflightService', () => {
  let service: WorkflowRuntimePreflightService;
  let mockStateManager: { setVariable: Mock };

  beforeEach(async () => {
    mockStateManager = { setVariable: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimePreflightService,
        { provide: StateManagerService, useValue: mockStateManager },
      ],
    }).compile();

    service = module.get(WorkflowRuntimePreflightService);
  });

  it('writes the preflight payload to jobs.{jobId}.output in state', async () => {
    const payload = { pm_summary: 'PM done', architect_summary: 'Arch done' };

    await service.submitPreflightOutput('run-1', 'job-1', payload);

    expect(mockStateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      'jobs.job-1.output',
      payload,
    );
  });

  it('writes an empty object when payload has no fields', async () => {
    await service.submitPreflightOutput('run-1', 'job-1', {});

    expect(mockStateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      'jobs.job-1.output',
      {},
    );
  });
});
```

Run it and confirm FAIL (file does not exist yet):

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/workflow-runtime-preflight.service.spec.ts
```

Expected: FAIL — `Cannot find module './workflow-runtime-preflight.service'`

- [ ] **Step 3.2.2: Create the service**

Create `apps/api/src/workflow/workflow-runtime-preflight.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { StateManagerService } from './state-manager.service';

@Injectable()
export class WorkflowRuntimePreflightService {
  constructor(private readonly stateManager: StateManagerService) {}

  async submitPreflightOutput(
    workflowRunId: string,
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.stateManager.setVariable(
      workflowRunId,
      `jobs.${jobId}.output`,
      payload,
    );
  }
}
```

- [ ] **Step 3.2.3: Run the service spec and confirm it passes (Green)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/workflow-runtime-preflight.service.spec.ts
```

Expected: 2/2 PASS.

- [ ] **Step 3.2.4: Add the endpoint to `WorkflowRuntimeLifecycleController`**

Read `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts` first to understand the existing structure, then:

**Add to imports at the top of the file:**
```ts
import { WorkflowRuntimePreflightService } from './workflow-runtime-preflight.service';
```

**Add the body type near the other body type definitions:**
```ts
type SubmitPreflightArtifactsBody = {
  workflow_run_id: string;
  job_id: string;
  pm_summary?: string;
  acceptance_clarifications?: string[];
  architect_summary?: string;
  sdd_targets?: string[];
  implementation_plan?: Record<string, unknown>;
};
```

**Add `WorkflowRuntimePreflightService` to the constructor:**
```ts
constructor(
  private readonly lifecycleTools: WorkflowRuntimeCapabilityLifecycleService,
  private readonly preflightService: WorkflowRuntimePreflightService,
) {}
```

**Add the new endpoint method:**
```ts
@ApiOperation({ summary: 'Submit preflight artifacts from an agent container' })
@Post('preflight/submit')
async submitPreflightArtifacts(
  @Body() body: SubmitPreflightArtifactsBody,
): Promise<{ ok: boolean }> {
  await this.preflightService.submitPreflightOutput(
    body.workflow_run_id,
    body.job_id,
    {
      pm_summary: body.pm_summary,
      acceptance_clarifications: body.acceptance_clarifications,
      architect_summary: body.architect_summary,
      sdd_targets: body.sdd_targets,
      implementation_plan: body.implementation_plan,
    },
  );
  return { ok: true };
}
```

- [ ] **Step 3.2.5: Register `WorkflowRuntimePreflightService` in the workflow NestJS module**

Find the module file that declares `WorkflowRuntimeLifecycleController` (likely `workflow.module.ts` or `workflow-runtime.module.ts`). Add `WorkflowRuntimePreflightService` to its `providers` array.

Read the module file first, then add the provider. Example:
```ts
// In providers array:
WorkflowRuntimePreflightService,
```

- [ ] **Step 3.2.6: Typecheck to confirm no errors**

```bash
npm run build:api 2>&1 | head -40
```

Expected: no type errors related to the new files.

### Step 3.3 — Rewrite `StepRequiredToolRetryService` to use state variables

- [ ] **Step 3.3.1: Replace `StepRequiredToolRetryService` implementation**

In `apps/api/src/workflow/step-required-tool-retry.service.ts`, apply the following changes:

**Remove these two constants at the top of the file:**
```ts
const REQUIRED_TOOL_SETTLE_TIMEOUT_MS = 500;
const REQUIRED_TOOL_SETTLE_INTERVAL_MS = 50;
```

**Remove `ToolCallTrackerService` from the import and constructor.** The import line is:
```ts
import { ToolCallTrackerService } from '../redis/tool-call-tracker.service';
```
Delete it. Also remove `private readonly toolCallTracker: ToolCallTrackerService,` from the constructor parameters.

**In `checkRequiredToolCallsAndRetryJob`, replace the call to `resolveMissingToolsWithSettleWindow`:**

Before:
```ts
const missingTools = await this.resolveMissingToolsWithSettleWindow(
  workflowRunId,
  jobId,
  requiredTools,
);
```

After:
```ts
const missingTools = await this.resolveUnsatisfiedRequiredTools(
  workflowRunId,
  jobId,
  job,
  requiredTools,
);
```

**Delete the `resolveMissingToolsWithSettleWindow` and `delay` methods entirely:**
```ts
// DELETE this method:
private async resolveMissingToolsWithSettleWindow(...) { ... }

// DELETE this method:
private async delay(ms: number): Promise<void> { ... }
```

**Add the new `resolveUnsatisfiedRequiredTools` method** (add before the `logRequiredToolsSatisfied` method):
```ts
/**
 * Determines which required tools have not been satisfied.
 *
 * For jobs where the output_tool is among the required tools, the state
 * variable jobs.{jobId}.output is authoritative: if it is present, the
 * output_tool was called synchronously via api_callback before the container
 * exited. This requires no Redis, no polling, and no settle window.
 *
 * For required tools that are NOT the output_tool, no durable state signal
 * is currently available. Those tools are conservatively treated as missing.
 * In current workflow definitions all required_tool_calls match the
 * output_tool, so this path is not exercised in practice.
 */
private async resolveUnsatisfiedRequiredTools(
  workflowRunId: string,
  jobId: string,
  job: IJob,
  requiredTools: string[],
): Promise<string[]> {
  const outputTool = (job as { output_tool?: string }).output_tool;
  const outputStateKey = `jobs.${jobId}.output`;

  const outputCaptured = await this.stateManager.getVariable(
    workflowRunId,
    outputStateKey,
  );
  const hasOutput =
    outputCaptured !== null && outputCaptured !== undefined;

  return requiredTools.filter((tool) => {
    if (tool === outputTool && hasOutput) {
      return false; // satisfied by captured output state
    }
    return true; // unsatisfied
  });
}
```

- [ ] **Step 3.3.2: Run the repro test and confirm Root Cause C passes (Green)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: Root Cause C test FAIL — the test still mocks `ToolCallTrackerService` which no longer exists in the constructor. Proceed to Step 3.4 to update the test.

### Step 3.4 — Update the repro test for Root Cause C

- [ ] **Step 3.4.1: Update `repro-root-causes.spec.ts` Root Cause C section**

In `apps/api/src/workflow/repro-root-causes.spec.ts`, replace the entire `describe('Root Cause C: Required Tool Tracker Divergence', ...)` block:

**Remove this import:**
```ts
import { ToolCallTrackerService } from '../redis/tool-call-tracker.service';
```

**Replace the entire describe block with:**
```ts
describe('Root Cause C: Required Tool State Satisfaction', () => {
  let service: StepRequiredToolRetryService;
  let mockStateManager: { getVariable: Mock; setVariable: Mock };

  beforeEach(async () => {
    mockStateManager = {
      getVariable: vi.fn().mockImplementation(
        (_runId: string, key: string) => {
          if (key === 'jobs.job-1.output') {
            return Promise.resolve({ ok: true, pm_summary: 'done' });
          }
          return Promise.resolve(null); // no retry count recorded
        },
      ),
      setVariable: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepRequiredToolRetryService,
        {
          provide: SessionHydrationService,
          useValue: { saveSessionFromExitedContainer: vi.fn() },
        },
        { provide: StateManagerService, useValue: mockStateManager },
        {
          provide: WorkflowEventLogService,
          useValue: { appendBestEffort: vi.fn() },
        },
        {
          provide: WorkflowEngineService,
          useValue: { retryJobWithMessage: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(StepRequiredToolRetryService);
  });

  it('proceeds when output is captured in state for the output_tool', async () => {
    const job = {
      id: 'job-1',
      type: 'execution',
      required_tool_calls: ['submit_preflight_artifacts'],
      output_tool: 'submit_preflight_artifacts',
      max_retries: 1,
    } as any;

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'run-1',
      'job-1',
      job,
      'container-1',
    );

    expect(result).toBe('proceed');
  });
});
```

- [ ] **Step 3.4.2: Run the repro test and confirm all three root causes pass (Green)**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: all 3 repro tests PASS. Root Cause C test now completes near-instantly (no settle window).

- [ ] **Step 3.4.3: Update `step-required-tool-retry.service.spec.ts` coverage**

Read the existing spec file first, then replace or add within the appropriate describe block:

```ts
describe('resolveUnsatisfiedRequiredTools (via checkRequiredToolCallsAndRetryJob)', () => {
  it('proceeds when output_tool output is captured in state', async () => {
    mockStateManager.getVariable.mockImplementation(
      (_runId: string, key: string) => {
        if (key === 'jobs.job-1.output') return Promise.resolve({ ok: true });
        return Promise.resolve(null);
      },
    );

    const job = {
      id: 'job-1',
      type: 'execution',
      required_tool_calls: ['submit_preflight_artifacts'],
      output_tool: 'submit_preflight_artifacts',
      max_retries: 2,
    } as unknown as IJob;

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'run-1',
      'job-1',
      job,
      'container-1',
    );

    expect(result).toBe('proceed');
  });

  it('retries when output_tool is required but no output is captured', async () => {
    mockStateManager.getVariable.mockResolvedValue(null);

    const job = {
      id: 'job-2',
      type: 'execution',
      required_tool_calls: ['submit_preflight_artifacts'],
      output_tool: 'submit_preflight_artifacts',
      max_retries: 2,
    } as unknown as IJob;

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'run-1',
      'job-2',
      job,
      'container-1',
    );

    expect(result).toBe('retried');
  });

  it('proceeds when no required tools are declared', async () => {
    const job = {
      id: 'job-3',
      type: 'execution',
      required_tool_calls: [],
      max_retries: 2,
    } as unknown as IJob;

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'run-1',
      'job-3',
      job,
      'container-1',
    );

    expect(result).toBe('proceed');
    expect(mockStateManager.getVariable).not.toHaveBeenCalled();
  });

  it('treats non-output required tools conservatively as missing when output is captured', async () => {
    mockStateManager.getVariable.mockImplementation(
      (_runId: string, key: string) => {
        if (key === 'jobs.job-4.output') return Promise.resolve({ ok: true });
        return Promise.resolve(null);
      },
    );

    const job = {
      id: 'job-4',
      type: 'execution',
      required_tool_calls: ['some_other_tool'],
      output_tool: 'submit_preflight_artifacts', // different from required tool
      max_retries: 2,
    } as unknown as IJob;

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'run-1',
      'job-4',
      job,
      'container-1',
    );

    // some_other_tool is not the output_tool, treated as missing
    expect(result).toBe('retried');
  });
});
```

Also update the `beforeEach` mock setup in the spec: the `ToolCallTrackerService` mock provider should be **removed** from the module providers. The `mockStateManager` mock should have `getVariable` returning `null` by default (representing no retry count and no captured output).

- [ ] **Step 3.4.4: Run the retry service spec**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/step-required-tool-retry.service.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 3.4.5: Commit Task 3**

```bash
git add \
  apps/api/src/tool/capability-manifest.preflight.entry.ts \
  apps/api/src/workflow/workflow-runtime-preflight.service.ts \
  apps/api/src/workflow/workflow-runtime-preflight.service.spec.ts \
  apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts \
  apps/api/src/workflow/step-required-tool-retry.service.ts \
  apps/api/src/workflow/repro-root-causes.spec.ts \
  apps/api/src/workflow/step-required-tool-retry.service.spec.ts
git commit -m "fix(workflow): synchronise required-tool tracking via api_callback

Change submit_preflight_artifacts from mounted_tool to api_callback.
The container now POSTs to POST /api/workflow-runtime/preflight/submit
synchronously when the tool is called, writing jobs.{jobId}.output to
durable state before returning.

StepRequiredToolRetryService now reads that state variable instead of
polling Redis with a settle window. The Redis race and false required-tool
retries are eliminated by construction.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4 — Remove `ToolCallTrackerService`

`ToolCallTrackerService` had one consumer of its read path: `StepRequiredToolRetryService.checkRequiredToolCallsAndRetryJob`. That dependency has been removed in Task 3. The remaining uses are all write-only — fire-and-forget observability calls that no longer serve a correctness function. This task deletes the service and removes all references.

**Files:**
- Modify: `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`
- Modify: `apps/api/src/telemetry/telemetry.gateway.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-war-room.tool-tracking.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-war-room.helpers.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-war-room-moderation.helpers.ts`
- Modify: `apps/api/src/telemetry/telemetry-war-room.gateway.ts`
- Modify: `apps/api/src/workflow/step-agent-container-support.service.ts`
- Modify: `apps/api/src/redis/redis.module.ts`
- Delete: `apps/api/src/redis/tool-call-tracker.service.ts`
- Delete: `apps/api/src/redis/tool-call-tracker.service.spec.ts`

- [ ] **Step 4.1: Read each file to understand the scope before touching anything**

Read all files listed above before making any changes. Specifically understand:
- What `trackToolExecutionCompat` in `telemetry-gateway-compat.helpers.ts` does with `toolCallTracker`
- What callers pass `toolCallTracker` to `handleToolExecutionEndGatewayCompat` in `telemetry.gateway.ts`
- What `telemetry-gateway-war-room.tool-tracking.ts` exports and which files import it

This step is read-only.

- [ ] **Step 4.2: Remove `toolCallTracker` from `telemetry-gateway-compat.helpers.ts`**

In `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`:

1. Remove the `ToolCallTrackerService` type import.
2. In `trackToolExecutionCompat`, remove the `toolCallTracker` parameter from its params type and delete the `recordTrackedToolsAcrossKeys` call (or equivalent Redis write). Keep the `captureOutputAcrossKeys` call (or equivalent state-variable write) — that is still used for output capture in the non-`api_callback` path.
3. Update the function signature of `handleToolExecutionEndGatewayCompat` to remove `toolCallTracker` from its params type.

After the change, `trackToolExecutionCompat` must still call `captureOutputAcrossKeys` (or whatever writes to `ToolOutputCaptureService`). Only the Redis tracking write is removed.

- [ ] **Step 4.3: Remove `ToolCallTrackerService` from `telemetry.gateway.ts`**

In `apps/api/src/telemetry/telemetry.gateway.ts`:

1. Remove the `ToolCallTrackerService` import.
2. Remove `private readonly toolCallTracker: ToolCallTrackerService` from the constructor.
3. Remove `toolCallTracker: this.toolCallTracker` from the call to `handleToolExecutionEndGatewayCompat`.

- [ ] **Step 4.4: Remove `ToolCallTrackerService` from war room tracking files**

In `apps/api/src/telemetry/telemetry-gateway-war-room.tool-tracking.ts`:

The two exported functions `recordWarRoomCommandToolCall` and `recordWarRoomLifecycleToolCalls` do nothing except write to `ToolCallTrackerService`. Remove the `toolCallTracker` parameter from both functions and remove their bodies (or simplify to no-ops). Keep the function signatures public if other code calls them — just make them return immediately.

Updated versions:
```ts
export async function recordWarRoomCommandToolCall(params: {
  workflowRunId: string;
  client: AuthenticatedSocket;
  action: string;
}): Promise<void> {
  // Tool call tracking removed — submit_preflight_artifacts and similar tools
  // are now tracked synchronously via api_callback state writes.
}

export async function recordWarRoomLifecycleToolCalls(params: {
  workflowRunId: string;
  client: AuthenticatedSocket;
  resultPayload: Record<string, unknown>;
}): Promise<void> {
  // Tool call tracking removed — see recordWarRoomCommandToolCall.
}
```

Remove the `ToolCallTrackerService` import and all internal helper functions that only served the tracker (`recordNexusOrchestratorCall`, etc.).

- [ ] **Step 4.5: Remove `toolCallTracker` from war room helper param types**

In `apps/api/src/telemetry/telemetry-gateway-war-room.helpers.ts` and `apps/api/src/telemetry/telemetry-gateway-war-room-moderation.helpers.ts`:

Remove the `toolCallTracker?: ToolCallTrackerService` field from all params type definitions and remove the corresponding `ToolCallTrackerService` type imports.

- [ ] **Step 4.6: Remove `ToolCallTrackerService` from `telemetry-war-room.gateway.ts`**

In `apps/api/src/telemetry/telemetry-war-room.gateway.ts`:

1. Remove the `ToolCallTrackerService` import.
2. Remove the `@Optional()` injected `private readonly toolCallTracker?: ToolCallTrackerService` constructor parameter.
3. Remove `toolCallTracker: this.toolCallTracker` from any calls to war room helpers.

- [ ] **Step 4.7: Remove `toolCallTracker.clear()` from `step-agent-container-support.service.ts`**

In `apps/api/src/workflow/step-agent-container-support.service.ts`:

1. Remove the `ToolCallTrackerService` import.
2. Remove `private readonly toolCallTracker: ToolCallTrackerService` from the constructor.
3. Remove the `await this.toolCallTracker.clear(params.workflowRunId, params.jobId)` call from the cleanup method (and its surrounding try/catch if the try/catch contains nothing else).

- [ ] **Step 4.8: Run the telemetry gateway spec to confirm no regressions**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/telemetry/telemetry.gateway.spec.ts
```

Expected: all tests PASS. If any test mocks `ToolCallTrackerService`, update the mock to remove it.

- [ ] **Step 4.9: Remove `ToolCallTrackerService` from `redis.module.ts` and delete service files**

In `apps/api/src/redis/redis.module.ts`:
1. Remove the `ToolCallTrackerService` import.
2. Remove `ToolCallTrackerService` from the `providers` array.
3. Remove `ToolCallTrackerService` from the `exports` array.

Then delete the service and its spec:
```bash
rm apps/api/src/redis/tool-call-tracker.service.ts
rm apps/api/src/redis/tool-call-tracker.service.spec.ts
```

- [ ] **Step 4.10: Typecheck**

```bash
npm run build:api 2>&1 | head -60
```

Expected: no type errors. Fix any remaining `ToolCallTrackerService` references that were missed.

- [ ] **Step 4.11: Commit**

```bash
git add -A
git commit -m "refactor(redis): remove ToolCallTrackerService

ToolCallTrackerService tracked tool calls in Redis via WebSocket telemetry
for use in StepRequiredToolRetryService. Now that submit_preflight_artifacts
is an api_callback and StepRequiredToolRetryService reads from workflow state
directly, the Redis tracker has no remaining read consumers.

Remove all write paths, injections, and the service itself.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5 — Full Suite Verification

- [ ] **Step 5.1: Run all repro tests to confirm all three are green**

```bash
npm exec --workspace=apps/api -- vitest run --config vitest.config.ts src/workflow/repro-root-causes.spec.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5.2: Run the full API test suite**

```bash
npm run test:api
```

Expected: all tests PASS. If any new failures appear, investigate before proceeding — do not skip.

- [ ] **Step 5.3: Typecheck**

```bash
npm run build:api
```

Expected: no type errors.

- [ ] **Step 5.4: Final commit if any loose files remain**

```bash
git status
```

If any tracked files show as modified but uncommitted, stage and commit them.

---

## Self-Review Checklist

- [x] **Spec coverage:** Root Cause A (workspace fallback) → Task 1. Root Cause B (empty-string template fields) → Task 2. Root Cause C (Redis tracker race) → Task 3 (architectural fix). All three repro tests targeted.
- [x] **No placeholders:** All code blocks are complete and exact.
- [x] **Type consistency:** `IJob` cast via `{ output_tool?: string }` in Task 3 documented and justified. All other types match existing codebase patterns.
- [x] **No over-engineering:** Root Causes A and B are minimal targeted patches. Root Cause C is a genuine architectural improvement that removes complexity (settle window, Redis race, entire service) rather than adding it.
- [x] **TDD:** Each task follows Red → Green → add coverage → commit.
- [x] **Single source of truth:** After Task 4, required-tool satisfaction has exactly one signal path — the durable state variable written synchronously by the HTTP endpoint.
- [x] **`ToolCallTrackerService` removal scope:** The service was write-only after Task 3 (no remaining read consumers). Task 4 safely removes all write paths and the service itself.
