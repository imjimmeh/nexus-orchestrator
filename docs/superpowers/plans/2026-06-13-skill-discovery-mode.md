# Skill Discovery Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assigned skills exposed to agents directly by default ("native"), with an opt-in "search" mode (today's behavior) settable per job-step, per workflow, and per agent profile, resolved step → workflow → agent → default.

**Architecture:** A shared `SkillDiscoveryMode` enum + pure resolver in `@nexus/core` is the single source of truth for the precedence cascade. The resolved mode drives two things: (1) how the assigned-skill section of the system prompt is rendered (a shared prompt-section helper, used by both the step-agent and subagent paths), and (2) whether the `search_skills` API capability is offered (gated in capability-preflight for steps and in the subagent container-config for subagents). `read_skill_manifest` is never gated.

**Tech Stack:** TypeScript, NestJS, TypeORM (Postgres), Vitest, js-yaml.

**Design reference:** `docs/superpowers/specs/2026-06-13-skill-discovery-mode-design.md`

---

## File Structure

**Create:**

- `packages/core/src/skills/skill-discovery-mode.ts` — `SkillDiscoveryMode` type, `DEFAULT_SKILL_DISCOVERY_MODE`, `resolveSkillDiscoveryMode()`.
- `packages/core/src/skills/skill-discovery-mode.spec.ts` — resolver unit tests.
- `apps/api/src/workflow/skill-catalog-prompt.helpers.ts` — shared, pure prompt-section renderer used by both prompt paths.
- `apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts` — renderer unit tests.
- `apps/api/src/database/migrations/20260613120000-add-skill-discovery-mode-to-agent-profiles.ts` — nullable column.

**Modify:**

- `packages/core/src/interfaces/workflow-legacy.types.ts` — add `skill_discovery_mode?` to `IJobStep` and `IWorkflowDefinition`.
- `packages/core/src/interfaces/agent-profile.types.ts` — add `skill_discovery_mode?` to `IAgentProfile`.
- `packages/core/src/index.ts` (barrel) — export the new skills module.
- `apps/api/src/ai-config/database/entities/agent-profile.entity.ts` — add column.
- `apps/api/src/database/migrations/registered-migrations.ts` — register migration.
- `apps/api/src/workflow/workflow-parser.service.ts` — validate the enum at root + step level.
- `apps/api/src/workflow/job-execution.types.ts` — add `workflowSkillDiscoveryMode?` to `JobQueueData`.
- `apps/api/src/workflow/workflow-run-job-execution.service.ts` + `apps/api/src/workflow/workflow-job-message-queue.service.ts` — pass workflow-level mode into the queue payload.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` — consume mode in the prompt builder.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` — resolve mode, pass it down.
- `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.skills.helpers.ts` — consume mode.
- `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` — resolve mode, render + gate.
- `apps/api/src/tool/capability-preflight.service.ts` (+ `capability-preflight.types.ts`) — gate `search_skills` when native.
- `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts` — pass resolved mode into preflight.

**Conventions to follow:** `adding-entity-migration`, `nestjs-module-conventions`, `workflow-yaml-authoring`, `testing-unit-patterns`.

---

## Task 1: Core type + resolver

**Files:**

- Create: `packages/core/src/skills/skill-discovery-mode.ts`
- Test: `packages/core/src/skills/skill-discovery-mode.spec.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/skills/skill-discovery-mode.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL_DISCOVERY_MODE,
  resolveSkillDiscoveryMode,
} from "./skill-discovery-mode";

describe("resolveSkillDiscoveryMode", () => {
  it("defaults to native when nothing is set", () => {
    expect(resolveSkillDiscoveryMode({})).toBe("native");
    expect(DEFAULT_SKILL_DISCOVERY_MODE).toBe("native");
  });

  it("uses the agent-profile value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ agentProfile: "search" })).toBe(
      "search",
    );
  });

  it("uses the workflow value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ workflow: "search" })).toBe("search");
  });

  it("uses the step value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ step: "search" })).toBe("search");
  });

  it("prefers step over workflow over agent profile", () => {
    expect(
      resolveSkillDiscoveryMode({
        step: "native",
        workflow: "search",
        agentProfile: "search",
      }),
    ).toBe("native");
    expect(
      resolveSkillDiscoveryMode({ workflow: "native", agentProfile: "search" }),
    ).toBe("native");
  });

  it("treats null/undefined at a level as 'not set'", () => {
    expect(
      resolveSkillDiscoveryMode({
        step: null,
        workflow: undefined,
        agentProfile: "search",
      }),
    ).toBe("search");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run packages/core/src/skills/skill-discovery-mode.spec.ts`
Expected: FAIL — cannot resolve `./skill-discovery-mode`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/skills/skill-discovery-mode.ts`:

```ts
/**
 * How assigned skills are surfaced to an agent.
 * - `native`: list assigned skills directly in the system prompt; the agent
 *   sees only its assigned set (the `search_skills` tool is suppressed).
 * - `search`: skills are not listed; the agent uses the `search_skills` tool
 *   to discover any active skill (legacy behavior).
 */
export type SkillDiscoveryMode = "native" | "search";

export const DEFAULT_SKILL_DISCOVERY_MODE: SkillDiscoveryMode = "native";

/**
 * Resolve the effective skill discovery mode using a most-specific-wins
 * cascade: step → workflow → agent profile → default (`native`).
 * Each level is optional; null/undefined means "not set at this level".
 */
export function resolveSkillDiscoveryMode(inputs: {
  step?: SkillDiscoveryMode | null;
  workflow?: SkillDiscoveryMode | null;
  agentProfile?: SkillDiscoveryMode | null;
}): SkillDiscoveryMode {
  return (
    inputs.step ??
    inputs.workflow ??
    inputs.agentProfile ??
    DEFAULT_SKILL_DISCOVERY_MODE
  );
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, add (next to the other `export * from "./..."` lines):

```ts
export * from "./skills/skill-discovery-mode";
```

If `packages/core/src/index.ts` re-exports via subdirectory barrels instead of direct files, mirror the existing pattern (e.g. add a `packages/core/src/skills/index.ts` that does `export * from "./skill-discovery-mode";` and export that). Match whatever convention the neighboring exports use.

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run packages/core/src/skills/skill-discovery-mode.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck core**

Run: `npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skills packages/core/src/index.ts
git commit -m "feat(core): add SkillDiscoveryMode type and resolver"
```

---

## Task 2: Add `skill_discovery_mode` to core interfaces

**Files:**

- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts:200` (IJobStep), `:374` (IWorkflowDefinition)
- Modify: `packages/core/src/interfaces/agent-profile.types.ts:22` (IAgentProfile)

- [ ] **Step 1: Add the import + field to `IJobStep`**

In `packages/core/src/interfaces/workflow-legacy.types.ts`, ensure the type is imported at the top of the file:

```ts
import type { SkillDiscoveryMode } from "../skills/skill-discovery-mode";
```

Then in `IJobStep` (after the `prompt_mode?` line, ~line 200):

```ts
	/** Override how assigned skills are surfaced for this step. */
	skill_discovery_mode?: SkillDiscoveryMode;
```

- [ ] **Step 2: Add the field to `IWorkflowDefinition`**

In the same file, in `IWorkflowDefinition` (after `strict_dependencies?`, ~line 375):

```ts
	/** Default skill discovery mode for all steps in this workflow. */
	skill_discovery_mode?: SkillDiscoveryMode;
```

- [ ] **Step 3: Add the field to `IAgentProfile`**

In `packages/core/src/interfaces/agent-profile.types.ts`, add the import at the top:

```ts
import type { SkillDiscoveryMode } from "../skills/skill-discovery-mode";
```

Then after `assigned_skills?` (line 22):

```ts
  skill_discovery_mode?: SkillDiscoveryMode | null;
```

- [ ] **Step 4: Typecheck core**

Run: `npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: no errors (no consumers reference the new optional fields yet).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/interfaces
git commit -m "feat(core): add skill_discovery_mode to step, workflow, and agent-profile types"
```

---

## Task 3: Agent-profile entity column + migration

**Files:**

- Modify: `apps/api/src/ai-config/database/entities/agent-profile.entity.ts:61`
- Create: `apps/api/src/database/migrations/20260613120000-add-skill-discovery-mode-to-agent-profiles.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`

Reference an existing nullable-column migration: `apps/api/src/database/migrations/20260608150000-add-supports-vision-columns.ts`.

- [ ] **Step 1: Add the column to the entity**

In `agent-profile.entity.ts`, import the type at the top:

```ts
import type { SkillDiscoveryMode } from "@nexus/core";
```

Then add after the `assigned_skills` column (line 61):

```ts
  @Column({ type: 'varchar', length: 32, nullable: true })
  skill_discovery_mode?: SkillDiscoveryMode | null;
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/database/migrations/20260613120000-add-skill-discovery-mode-to-agent-profiles.ts`:

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSkillDiscoveryModeToAgentProfiles20260613120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS skill_discovery_mode character varying(32) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS skill_discovery_mode;
    `);
  }
}
```

- [ ] **Step 3: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, import the class at the top with the others and append it to the END of the `registeredMigrations` array (order matters — newest last):

```ts
import { AddSkillDiscoveryModeToAgentProfiles20260613120000 } from "./20260613120000-add-skill-discovery-mode-to-agent-profiles";
```

```ts
  AddSkillDiscoveryModeToAgentProfiles20260613120000,
```

- [ ] **Step 4: Typecheck the api app**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/database/entities/agent-profile.entity.ts apps/api/src/database/migrations
git commit -m "feat(ai-config): persist skill_discovery_mode on agent profiles"
```

---

## Task 4: Validate the field in the workflow YAML parser

**Files:**

- Modify: `apps/api/src/workflow/workflow-parser.service.ts`
- Test: `apps/api/src/workflow/workflow-parser.service.spec.ts` (create if absent; otherwise add to it)

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-parser.service.spec.ts` (follow the existing setup in that file if present; otherwise instantiate `new WorkflowParserService()`):

```ts
it("accepts a valid root-level skill_discovery_mode", () => {
  const def = parser.parseWorkflow(
    [
      "workflow_id: wf",
      "name: Example",
      "skill_discovery_mode: search",
      "jobs:",
      "  - id: job1",
      "    type: execution",
      "    tier: heavy",
      "    steps:",
      "      - id: s1",
      "        skill_discovery_mode: native",
    ].join("\n"),
  );
  expect(def.skill_discovery_mode).toBe("search");
  expect(def.jobs?.[0]?.steps?.[0]?.skill_discovery_mode).toBe("native");
});

it("rejects an invalid root-level skill_discovery_mode", () => {
  expect(() =>
    parser.parseWorkflow(
      ["workflow_id: wf", "name: Example", "skill_discovery_mode: bogus"].join(
        "\n",
      ),
    ),
  ).toThrow(/skill_discovery_mode/);
});

it("rejects an invalid step-level skill_discovery_mode", () => {
  expect(() =>
    parser.parseWorkflow(
      [
        "workflow_id: wf",
        "name: Example",
        "jobs:",
        "  - id: job1",
        "    type: execution",
        "    tier: heavy",
        "    steps:",
        "      - id: s1",
        "        skill_discovery_mode: bogus",
      ].join("\n"),
    ),
  ).toThrow(/skill_discovery_mode/);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run apps/api/src/workflow/workflow-parser.service.spec.ts`
Expected: FAIL — invalid values are not yet rejected.

- [ ] **Step 3: Add validation to the parser**

In `apps/api/src/workflow/workflow-parser.service.ts`, add a constant near the top and a guard. Inside `parseAndValidateDocument()` (after the `trigger` validation block) add:

```ts
if (doc.skill_discovery_mode !== undefined) {
  this.validateSkillDiscoveryMode(doc.skill_discovery_mode, "workflow");
}
for (const job of doc.jobs ?? []) {
  for (const step of job.steps ?? []) {
    if (step.skill_discovery_mode !== undefined) {
      this.validateSkillDiscoveryMode(
        step.skill_discovery_mode,
        `step ${step.id}`,
      );
    }
  }
}
```

Add the helper method (mirror the style of `validateConcurrencyPolicy`):

```ts
  private validateSkillDiscoveryMode(mode: unknown, where: string): void {
    const validModes = ['native', 'search'];
    if (typeof mode !== 'string' || !validModes.includes(mode)) {
      throw new Error(
        `skill_discovery_mode (${where}) must be one of: ${validModes.join(', ')}`,
      );
    }
  }
```

> Note: `normalizeJobsShape` runs before/around this — make sure the step iteration runs against the normalized `doc.jobs[].steps`. If `normalizeJobsShape` mutates shape, call the validation after it (mirror where `validateConcurrencyPolicy` sits relative to normalization).

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run apps/api/src/workflow/workflow-parser.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-parser.service.ts apps/api/src/workflow/workflow-parser.service.spec.ts
git commit -m "feat(workflow): validate skill_discovery_mode in YAML parser"
```

---

## Task 5: Shared prompt-section renderer

This consolidates the duplicated skill-section logic from `step-agent-step-executor.helpers.ts` and `subagent-orchestrator.skills.helpers.ts` into one pure helper that branches on mode.

**Files:**

- Create: `apps/api/src/workflow/skill-catalog-prompt.helpers.ts`
- Test: `apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSkillSection } from "./skill-catalog-prompt.helpers";

const skills = [
  { id: "abc", name: "git-flow", description: "Branch and PR hygiene." },
  { id: "def", name: "tdd", description: "Red-green-refactor." },
];

describe("renderSkillSection", () => {
  it("native: lists assigned skills and omits the search guidance", () => {
    const out = renderSkillSection({
      mode: "native",
      assignedSkills: skills,
      availableCategories: ["dev"],
    });
    expect(out).toContain("git-flow");
    expect(out).toContain("Branch and PR hygiene.");
    expect(out).toContain("read_skill_manifest");
    expect(out).not.toContain("search_skills");
    expect(out).not.toContain("Available skill categories");
  });

  it("search: emits the discovery guidance + categories and no skill list", () => {
    const out = renderSkillSection({
      mode: "search",
      assignedSkills: skills,
      availableCategories: ["dev"],
    });
    expect(out).toContain("search_skills");
    expect(out).toContain("Available skill categories include: dev.");
    expect(out).not.toContain("git-flow");
  });

  it("returns empty string when there are no skills and no categories", () => {
    expect(renderSkillSection({ mode: "native", assignedSkills: [] })).toBe("");
    expect(renderSkillSection({ mode: "search", assignedSkills: [] })).toBe("");
  });

  it("native with no skills returns empty even if categories exist", () => {
    expect(
      renderSkillSection({
        mode: "native",
        assignedSkills: [],
        availableCategories: ["dev"],
      }),
    ).toBe("");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/workflow/skill-catalog-prompt.helpers.ts`:

```ts
import type { SkillDiscoveryMode } from "@nexus/core";

export interface SkillSectionSkill {
  id?: string;
  name: string;
  description: string;
}

const SKILL_DISCOVERY_GUIDANCE =
  "Skill discovery:\nUse `search_skills` to find relevant guidance by query, category, or tags before choosing a skill. Do not call `read_file`, `search_file`, or `read_skill_file` unless those tools are explicitly listed in the current tool set.";

/**
 * Render the assigned-skill portion of an agent system prompt.
 * Returns '' when there is nothing to add (caller decides how to append).
 *
 * - `native`: list the assigned skills directly; the agent loads full content
 *   via `read_skill_manifest`. No category line (the agent sees its full set).
 * - `search`: emit the legacy discovery guidance + the available categories.
 */
export function renderSkillSection(params: {
  mode: SkillDiscoveryMode;
  assignedSkills: SkillSectionSkill[] | undefined;
  availableCategories?: string[];
}): string {
  const skills = params.assignedSkills ?? [];
  const hasAssigned = skills.length > 0;

  if (params.mode === "native") {
    if (!hasAssigned) {
      return "";
    }
    const lines = skills
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (s) => `- ${s.name} — ${s.description}${s.id ? ` (id: ${s.id})` : ""}`,
      );
    return [
      "Assigned skills (use `read_skill_manifest` with the skill id to load full instructions):",
      ...lines,
    ].join("\n");
  }

  // search mode (legacy behavior)
  const hasCategories =
    params.availableCategories && params.availableCategories.length > 0;
  if (!hasAssigned && !hasCategories) {
    return "";
  }
  const sections: string[] = [];
  if (hasAssigned) {
    sections.push(SKILL_DISCOVERY_GUIDANCE);
  }
  if (hasCategories) {
    sections.push(
      `Available skill categories include: ${params.availableCategories!.join(", ")}.`,
    );
  }
  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/skill-catalog-prompt.helpers.ts apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts
git commit -m "feat(workflow): add shared skill-section prompt renderer with mode branch"
```

---

## Task 6: Wire mode into the step-agent prompt path

Replace the local `appendSkillCatalogToPrompt` with the shared renderer and thread the resolved mode from the service.

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` (`appendSkillCatalogToPrompt` ~280-305, `buildAgentSystemPrompt` ~417-455, `buildStepRunnerConfigPayloadCore` params ~71-86 + call to `buildAgentSystemPrompt`)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` (`buildStepRunnerConfigPayload` ~355-400)
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`

- [ ] **Step 1: Update the existing helper spec for both modes**

In `step-agent-step-executor.helpers.spec.ts`, the existing assertion at line 58 (`expect(payload.prompt.systemPrompt).toContain('Use \`search_skills\`')`) assumes search behavior. Update it: when the payload is built with `skillDiscoveryMode: 'search'`, expect `Use \`search_skills\``; add a sibling test where `skillDiscoveryMode: 'native'`(the default) expects the assigned skill names listed and NOT`search_skills`. Mirror the existing test's setup (it passes `assignedSkills`); add a `skillDiscoveryMode` to the params object the test builds. (See Step 3 for the new param.)

```ts
// existing test → force legacy mode explicitly
//   skillDiscoveryMode: 'search'  → toContain('Use `search_skills`')
// new test → default native mode
//   skillDiscoveryMode: 'native'  → toContain('<assigned skill name>'), not.toContain('search_skills')
```

- [ ] **Step 2: Run the spec, verify the new native test fails**

Run: `npx vitest run apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`
Expected: FAIL — native rendering not implemented; `skillDiscoveryMode` param not accepted.

- [ ] **Step 3: Replace `appendSkillCatalogToPrompt` with the shared renderer**

In `step-agent-step-executor.helpers.ts`:

1. Remove the `SKILL_DISCOVERY_GUIDANCE` constant (lines 39-40) and the whole `appendSkillCatalogToPrompt` function (lines 280-305).
2. Add the import:

```ts
import { renderSkillSection } from "../skill-catalog-prompt.helpers";
import type { SkillDiscoveryMode } from "@nexus/core";
```

3. Add `skillDiscoveryMode: SkillDiscoveryMode` to the `buildStepRunnerConfigPayloadCore` params type (~line 79, beside `assignedSkills`) and to the `buildAgentSystemPrompt` params type (~line 417).
4. In `buildStepRunnerConfigPayloadCore`, pass `skillDiscoveryMode: params.skillDiscoveryMode` through to `buildAgentSystemPrompt`.
5. Replace the body of `buildAgentSystemPrompt`'s final `return appendSkillCatalogToPrompt(...)` with:

```ts
const skillSection = renderSkillSection({
  mode: params.skillDiscoveryMode,
  assignedSkills: params.assignedSkills?.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  })),
  availableCategories: params.availableCategories,
});
return [baseSystemPrompt, skillSection]
  .filter((section) => section && section.trim().length > 0)
  .join("\n\n");
```

- [ ] **Step 4: Resolve the mode in the service and pass it down**

In `step-agent-step-executor.service.ts`, `buildStepRunnerConfigPayload` (after `profileEntity` is loaded ~line 369, and using `data.workflowSkillDiscoveryMode` added in Task 7):

```ts
import { resolveSkillDiscoveryMode } from "@nexus/core";
```

```ts
const skillDiscoveryMode = resolveSkillDiscoveryMode({
  step: step.skill_discovery_mode ?? null,
  workflow: data.workflowSkillDiscoveryMode ?? null,
  agentProfile:
    (await this.aiConfig.getAgentProfileByName(agentProfile ?? ""))
      ?.skill_discovery_mode ?? null,
});
```

> To avoid a duplicate DB read, reuse the `profileEntity` already fetched at lines 367-368 instead of calling `getAgentProfileByName` again — capture it in a variable and read `profileEntity?.skill_discovery_mode`. Then in the `search`-mode-only `hasSearchSkill`/`availableCategories` computation, only compute `availableCategories` when `skillDiscoveryMode === 'search'` (native ignores it):

```ts
const availableCategories =
  skillDiscoveryMode === "search"
    ? this.aiConfig.listSkillCategories(
        hasSearchSkill ? undefined : assignedSkills.map((s) => s.id),
      )
    : undefined;
```

Pass `skillDiscoveryMode` into `buildStepRunnerConfigPayloadCore({ ... })`.

- [ ] **Step 5: Run the spec + typecheck**

Run: `npx vitest run apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`
Then: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts
git commit -m "feat(workflow): render assigned skills natively in step-agent prompt by mode"
```

---

## Task 7: Thread workflow-level mode through the job queue

**Files:**

- Modify: `apps/api/src/workflow/job-execution.types.ts` (`JobQueueData`)
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts:354`
- Modify: `apps/api/src/workflow/workflow-job-message-queue.service.ts:55`

- [ ] **Step 1: Add the field to `JobQueueData`**

In `apps/api/src/workflow/job-execution.types.ts`, add to the `JobQueueData` interface, next to `workflowPermissions`:

```ts
import type { SkillDiscoveryMode } from "@nexus/core";
```

```ts
  workflowSkillDiscoveryMode?: SkillDiscoveryMode;
```

- [ ] **Step 2: Populate it at both enqueue sites**

In `workflow-run-job-execution.service.ts` (the `this.stepQueue.add('execute-job', { ... })` payload, ~line 354), add beside `workflowPermissions`:

```ts
        workflowSkillDiscoveryMode: def.skill_discovery_mode || undefined,
```

In `workflow-job-message-queue.service.ts` (the resume `this.stepQueue.add('execute-job', { ... })` payload, ~line 55), add the same line beside `workflowPermissions`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no errors (Task 6 already consumes `data.workflowSkillDiscoveryMode`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workflow/job-execution.types.ts apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-job-message-queue.service.ts
git commit -m "feat(workflow): carry workflow-level skill_discovery_mode into job queue"
```

---

## Task 8: Wire mode into the subagent prompt path

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.skills.helpers.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts:38-63`
- Test: a focused spec for the container-config skill section (create `subagent-orchestrator.container-config.skills.spec.ts` if no suitable spec exists)

Subagents inherit mode from their agent profile only (there is no step/workflow level in a spawn). Resolve with the profile value, defaulting to native.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts` that calls the same `renderSkillSection` path the operation uses, asserting: native mode lists the assigned skills and omits `search_skills`; search mode emits the guidance. (If the operation is hard to unit-test directly due to DI, test `renderSkillSection` is already covered in Task 5 — instead add a test asserting `resolveSubagentSkillDiscoveryMode` returns the profile value / native default, see Step 3.)

```ts
import { describe, expect, it } from "vitest";
import { resolveSubagentSkillDiscoveryMode } from "./subagent-orchestrator.skills.helpers";

describe("resolveSubagentSkillDiscoveryMode", () => {
  it("defaults to native when the profile has no mode", () => {
    expect(resolveSubagentSkillDiscoveryMode(null)).toBe("native");
    expect(resolveSubagentSkillDiscoveryMode(undefined)).toBe("native");
  });
  it("uses the profile mode when set", () => {
    expect(resolveSubagentSkillDiscoveryMode("search")).toBe("search");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts`
Expected: FAIL — `resolveSubagentSkillDiscoveryMode` not exported.

- [ ] **Step 3: Update the skills helper**

In `subagent-orchestrator.skills.helpers.ts`:

1. Remove the local `SKILL_DISCOVERY_GUIDANCE` (lines 8-9) and the local `appendSkillCatalogToSystemPrompt` (lines 15-40) — they are superseded by the shared renderer.
2. Add:

```ts
import {
  resolveSkillDiscoveryMode,
  type SkillDiscoveryMode,
} from "@nexus/core";

export function resolveSubagentSkillDiscoveryMode(
  profileMode: SkillDiscoveryMode | null | undefined,
): SkillDiscoveryMode {
  return resolveSkillDiscoveryMode({ agentProfile: profileMode ?? null });
}
```

- [ ] **Step 4: Update the container-config operation**

In `subagent-orchestrator.container-config.operations.ts`, replace the skill-section block (lines 52-63) with a mode-aware version. The agent profile mode is read from the profile entity:

```ts
import { renderSkillSection } from "../skill-catalog-prompt.helpers";
import { resolveSubagentSkillDiscoveryMode } from "./subagent-orchestrator.skills.helpers";
```

```ts
const profileEntity = await context.aiConfig.getAgentProfileByName(
  params.spawnParams.agent_profile,
);
const skillDiscoveryMode = resolveSubagentSkillDiscoveryMode(
  profileEntity?.skill_discovery_mode ?? null,
);

const hasSearchSkill = params.assignedSkills?.some(
  (s) => s.name === "search_skills",
);
const availableCategories =
  skillDiscoveryMode === "search"
    ? context.aiConfig.listSkillCategories(
        hasSearchSkill ? undefined : params.assignedSkills?.map((s) => s.name),
      )
    : undefined;

const skillSection = renderSkillSection({
  mode: skillDiscoveryMode,
  assignedSkills: params.assignedSkills,
  availableCategories,
});
const systemPrompt = [profileSettings.systemPrompt, skillSection]
  .filter((section) => section && section.trim().length > 0)
  .join("\n\n");
```

Keep `skillDiscoveryMode` in scope — Task 9 uses it for tool gating in this same function.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts`
Then: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.skills.helpers.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts
git commit -m "feat(subagents): render assigned skills natively in subagent prompt by mode"
```

---

## Task 9: Gate the `search_skills` tool by mode

`search_skills` is an `api`-owned capability that is only callable when requested (`job.tools` / `job.permissions.allow_tools` / `workflowPermissions`). In `native` mode it must be dropped from the candidate set. `read_skill_manifest` is never dropped.

**Files:**

- Modify: `apps/api/src/tool/capability-preflight.service.ts` (`resolveRequestedApiCapabilityNames` ~234-269, `resolveCapabilitySnapshot` ~69, `resolveCandidateResolution` ~190)
- Modify: `apps/api/src/tool/capability-preflight.types.ts` (`PreflightInput`)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts:84,170` (preflight call sites)
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (subagent tool request set)
- Test: `apps/api/src/tool/capability-preflight.service.spec.ts`

- [ ] **Step 1: Write the failing test (step path)**

In `capability-preflight.service.spec.ts`, add a test: given a job/workflow that requests `search_skills` and `read_skill_manifest`, calling `resolveCapabilitySnapshot({ ..., skillDiscoveryMode: 'native' })` yields `callableToolNames` that excludes `search_skills` but includes `read_skill_manifest`; with `skillDiscoveryMode: 'search'` both are present. Mirror the existing `resolveCapabilitySnapshot` test setup at lines 270/294.

```ts
it("native mode drops search_skills but keeps read_skill_manifest", async () => {
  const snapshot = await service.resolveCapabilitySnapshot({
    job: makeJob({ tools: ["search_skills", "read_skill_manifest"] }),
    skillDiscoveryMode: "native",
  });
  expect(snapshot.callableToolNames).not.toContain("search_skills");
  expect(snapshot.callableToolNames).toContain("read_skill_manifest");
});

it("search mode keeps search_skills", async () => {
  const snapshot = await service.resolveCapabilitySnapshot({
    job: makeJob({ tools: ["search_skills", "read_skill_manifest"] }),
    skillDiscoveryMode: "search",
  });
  expect(snapshot.callableToolNames).toContain("search_skills");
});
```

(Match the existing helper/factory used in that spec for building jobs and the discovered-capability registry; ensure `search_skills` + `read_skill_manifest` are present as `api` discovered entries in the test's mock registry.)

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run apps/api/src/tool/capability-preflight.service.spec.ts`
Expected: FAIL — `skillDiscoveryMode` not accepted; `search_skills` still present in native.

- [ ] **Step 3: Add `skillDiscoveryMode` to preflight input + gate**

In `capability-preflight.types.ts`, add to `PreflightInput` (and it will flow to `CapabilityPreflightResult` callers unchanged):

```ts
import type { SkillDiscoveryMode } from "@nexus/core";
```

```ts
  skillDiscoveryMode?: SkillDiscoveryMode;
```

In `capability-preflight.service.ts`:

- Thread `params.skillDiscoveryMode` from `resolveCapabilitySnapshot` into `resolveCandidateResolution(job, workflowPermissions, skillDiscoveryMode)` and then into `resolveRequestedApiCapabilityNames(...)`.
- Add a module constant:

```ts
const SKILL_SEARCH_CAPABILITY = "search_skills";
```

- At the end of `resolveRequestedApiCapabilityNames`, before returning, drop the search capability when native:

```ts
const names = discoveredEntries
  .filter(
    (entry) => entry.runtimeOwner === "api" && requestedNames.has(entry.name),
  )
  .map((entry) => entry.name);
return skillDiscoveryMode === "native"
  ? names.filter((name) => name !== SKILL_SEARCH_CAPABILITY)
  : names;
```

Default behavior (when `skillDiscoveryMode` is undefined) must remain the legacy "include it" — so only filter on an explicit `=== 'native'`. (Note: callers that don't pass the mode keep today's behavior; the step orchestrator passes the resolved mode in Step 4, where the project-wide default resolves to `native`.)

- [ ] **Step 4: Pass the resolved mode from the step orchestrator**

In `step-execution-orchestrator.service.ts`, at both `preflightJobExecution({ ... })` call sites (lines 84 and 170), compute and pass the resolved mode. The orchestrator has `job`, `data.workflowSkillDiscoveryMode`, and the step; read the profile mode via `aiConfig`. Resolve once:

```ts
import { resolveSkillDiscoveryMode } from "@nexus/core";
```

```ts
      skillDiscoveryMode: resolveSkillDiscoveryMode({
        step: firstStep?.skill_discovery_mode ?? null,
        workflow: data.workflowSkillDiscoveryMode ?? null,
        agentProfile: profileMode ?? null,
      }),
```

where `firstStep` is `job.steps?.[0]` and `profileMode` comes from the agent profile already resolved in this path (reuse the existing profile lookup; if none exists here, fetch `await this.aiConfig.getAgentProfileByName(profileName)` once and read `.skill_discovery_mode`). If the orchestrator does not currently know the agent profile name, resolve it with the same `support.resolveAgentProfileFromJobInputs(...)` used in the executor service.

- [ ] **Step 5: Gate the subagent tool request**

In `subagent-orchestrator.container-config.operations.ts`, find where the subagent's requested tool list / permissions are assembled into its container tool config (the set that determines callable `api` tools for the subagent — inspect `provisionSubagentToolMount` and `buildSubagentVolumes` usage and the spawnParams tool/permission fields). When `skillDiscoveryMode === 'native'`, remove `'search_skills'` from that requested set before it is written, leaving `read_skill_manifest` intact. Concretely, wherever the requested tool names array is built (e.g. from `params.spawnParams.tools` / permissions), apply:

```ts
const requestedTools = (rawRequestedTools ?? []).filter(
  (name) => skillDiscoveryMode !== "native" || name !== "search_skills",
);
```

> Implementation note: read the file to locate the exact variable holding the subagent's requested tool names (the one passed into the tool mount / container config). If subagents reuse `CapabilityPreflightService`, prefer passing `skillDiscoveryMode` into that call instead of a local filter, to keep one gating path.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run apps/api/src/tool/capability-preflight.service.spec.ts`
Then: `npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tool/capability-preflight.service.ts apps/api/src/tool/capability-preflight.types.ts apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts apps/api/src/tool/capability-preflight.service.spec.ts
git commit -m "feat(tool): suppress search_skills capability in native skill discovery mode"
```

---

## Task 10: Docs + operator note for the default flip

**Files:**

- Modify: the workflow YAML authoring docs (find with `git grep -l "skill" docs` and the `workflow-yaml-authoring` skill's reference doc) — document the new `skill_discovery_mode` field at workflow root and step level, allowed values, default `native`, and precedence step → workflow → agent profile.
- Modify: operator/changelog doc (look in `docs/` for an operator or changelog file used by recent features) — call out the behavior change: agents with assigned skills now see them listed and `search_skills` is suppressed unless `skill_discovery_mode: search` is set.

- [ ] **Step 1: Update authoring docs**

Add a short section documenting the field, with a YAML example:

```yaml
workflow_id: example
name: Example
# Optional. Default: native. One of: native | search.
skill_discovery_mode: native
jobs:
  - id: build
    type: execution
    tier: heavy
    steps:
      - id: implement
        # Step overrides workflow + agent profile.
        skill_discovery_mode: search
```

- [ ] **Step 2: Add the operator/changelog note**

Document: default is now `native` (assigned skills listed in-prompt, `search_skills` suppressed for agents that have assigned skills). To keep the old search-only behavior, set `skill_discovery_mode: search` at the agent profile, workflow, or step level.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: document skill_discovery_mode and the default-native behavior change"
```

---

## Final Verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc -p packages/core/tsconfig.json --noEmit && npx tsc -p apps/api/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 2: Run all touched test files**

Run:

```bash
npx vitest run \
  packages/core/src/skills/skill-discovery-mode.spec.ts \
  apps/api/src/workflow/skill-catalog-prompt.helpers.spec.ts \
  apps/api/src/workflow/workflow-parser.service.spec.ts \
  apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts \
  apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts \
  apps/api/src/tool/capability-preflight.service.spec.ts
```

Expected: all PASS.

- [ ] **Step 3: Run the broader workflow + tool suites to catch regressions**

Run: `npx vitest run apps/api/src/workflow apps/api/src/tool`
Expected: all PASS. Pay attention to any existing test asserting the old always-`search_skills` prompt text — update those to set `skill_discovery_mode: 'search'` or to the new native expectation.

- [ ] **Step 4: Sanity-check the migration applies**

Apply migrations against a dev/test database per the project's migration command, confirm the `skill_discovery_mode` column exists on `agent_profiles`, then confirm a profile with `NULL` resolves to `native` via the resolver.

---

## Notes / Risks

- **Default flip is a behavior change.** Existing deployments relying on search-only exposure will now see assigned skills listed and `search_skills` suppressed for agents with assigned skills. Opt back in with `skill_discovery_mode: search`. Surfaced in Task 10.
- **Single gating path preferred.** Tasks 6/8 (prompt) and Task 9 (tools) both consume the resolved mode; keep `search_skills` removal at one choke point per path to avoid drift. If subagents already route through `CapabilityPreflightService`, pass the mode there instead of a local filter (Task 9, Step 5 note).
- **Determinism.** `renderSkillSection` sorts skills by name so prompt snapshots stay stable.
- **No filesystem-native discovery.** This plan does not add `.claude/skills/` or change the existing skill mount — native exposure is the in-prompt catalog, per the spec's YAGNI boundary.
