# Skill Scoping Foundation (EPIC-205 W1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give skills an optional scope (project / agent / workflow) so the workflow runtime mounts the correct skill set per agent step; skills with no scope stay global, exactly as today.

**Architecture:** The filesystem stays the single source of truth — scope is an optional `scope` object in `SKILL.md` frontmatter (`projects`/`agents`/`workflows` string arrays). `AgentSkillLibraryService` parses it into `SkillLibraryRecord.scope` and gains `listSkillsForScope(context)`. `WorkflowStageSkillPolicyService.resolveAssignedSkills` unions a profile's **global** assigned skills with any skills scoped to the current `scopeId` / agent profile / `workflowId`, then applies the existing stage-policy filter unchanged. `StepSupportService` derives `scopeId` from the trigger and `workflowId` from the run, and threads them in.

**Tech Stack:** TypeScript, NestJS, Zod (`@nexus/core`), Vitest, js-yaml. This is the W1 foundation slice of `docs/epics/EPIC-205-workflow-driven-skill-materialization-and-scoping.md`; it ships independently of the materialization workflow (W2–W4).

**Scope of this plan:** W1 only. The `create_skill` tool/workflow (W2), approval→dispatch wiring (W3), and human scope-confirmation UI (W4) are separate plans that build on this one.

**Conventions (match the codebase):**
- Run a single test file: `npm run test:api -- <relative-path-to-spec>` (Vitest). Example: `npm run test:api -- src/ai-config/services/agent-skill-library.service.spec.ts`.
- `scope.projects` holds **`scopeId`** values (the neutral execution-scope id per `AGENTS.md`), `scope.agents` holds **agent profile names**, `scope.workflows` holds **`workflow_id`** values.
- Absent / all-empty scope ⇒ skill is **global**.

---

### Task 1: Add `SkillScopeSchema` to the `@nexus/core` skills contract

**Files:**
- Modify: `packages/core/src/schemas/ai-config/skills.schema.ts`
- Test: `packages/core/src/schemas/ai-config/skills.schema.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `packages/core/src/schemas/ai-config/skills.schema.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CreateAgentSkillSchema, SkillScopeSchema } from "./skills.schema";

const VALID_MARKDOWN = "---\nname: my-skill\ndescription: d\n---\n# Body";

describe("SkillScopeSchema", () => {
  it("accepts project/agent/workflow string arrays", () => {
    const parsed = SkillScopeSchema.parse({
      projects: ["scope-123"],
      agents: ["software-architect"],
      workflows: ["create_skill"],
    });
    expect(parsed.projects).toEqual(["scope-123"]);
    expect(parsed.agents).toEqual(["software-architect"]);
    expect(parsed.workflows).toEqual(["create_skill"]);
  });

  it("accepts an empty object (all axes optional)", () => {
    expect(SkillScopeSchema.parse({})).toEqual({});
  });

  it("allows CreateAgentSkillSchema to carry an optional scope", () => {
    const parsed = CreateAgentSkillSchema.parse({
      name: "my-skill",
      description: "d",
      skill_markdown: VALID_MARKDOWN,
      scope: { projects: ["scope-123"] },
    });
    expect(parsed.scope?.projects).toEqual(["scope-123"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- src/schemas/ai-config/skills.schema.spec.ts`
Expected: FAIL — `SkillScopeSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/core/src/schemas/ai-config/skills.schema.ts`, add after the `SKILL_NAME_PATTERN` const (line 3) and extend `CreateAgentSkillSchema`:

```typescript
export const SkillScopeSchema = z.object({
  projects: z.array(z.string().min(1)).optional(),
  agents: z.array(z.string().min(1)).optional(),
  workflows: z.array(z.string().min(1)).optional(),
});

export type SkillScopeInput = z.infer<typeof SkillScopeSchema>;

export const CreateAgentSkillSchema = z.object({
  name: z.string().min(1).max(64).regex(SKILL_NAME_PATTERN, {
    message:
      "name must be lowercase and may include letters, numbers, and hyphens",
  }),
  description: z.string().min(1).max(1024),
  skill_markdown: z.string().min(1).max(20480),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
  scope: SkillScopeSchema.optional(),
});
```

(Leave `UpdateAgentSkillSchema = CreateAgentSkillSchema.partial();` as-is — it inherits `scope`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- src/schemas/ai-config/skills.schema.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/ai-config/skills.schema.ts packages/core/src/schemas/ai-config/skills.schema.spec.ts
git commit -m "feat(skills): add SkillScopeSchema to core skill contract (EPIC-205 W1)"
```

---

### Task 2: Parse `scope` frontmatter into `SkillLibraryRecord`

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.types.ts`
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.ts` (`SkillFrontmatter` interface line 18-27; `buildSkillRecord` line 299-344)
- Test: `apps/api/src/ai-config/services/agent-skill-library.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe('AgentSkillLibraryService', ...)` block in the spec (reuse the existing `service`/`tempRoot` harness):

```typescript
describe('scope frontmatter', () => {
  const SCOPED_MARKDOWN = (name: string) =>
    `---\nname: ${name}\ndescription: A test skill\nscope:\n  projects: [scope-123]\n  agents: [software-architect]\n  workflows: [create_skill]\n---\n\n# Body`;

  it('parses scope arrays into the record', () => {
    const record = service.writeSkillMarkdown(
      'scoped-skill',
      SCOPED_MARKDOWN('scoped-skill'),
    );

    expect(record.scope).toEqual({
      projects: ['scope-123'],
      agents: ['software-architect'],
      workflows: ['create_skill'],
    });
  });

  it('returns null scope when no scope frontmatter is present', () => {
    const record = service.writeSkillMarkdown(
      'global-skill',
      VALID_MARKDOWN('global-skill'),
    );

    expect(record.scope).toBeNull();
  });

  it('returns null scope when all scope arrays are empty', () => {
    const markdown = `---\nname: empty-scope\ndescription: A test skill\nscope:\n  projects: []\n---\n\n# Body`;
    const record = service.writeSkillMarkdown('empty-scope', markdown);

    expect(record.scope).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- src/ai-config/services/agent-skill-library.service.spec.ts`
Expected: FAIL — `record.scope` is `undefined`, not the expected object/`null`.

- [ ] **Step 3: Add the `SkillScope` type to the record**

In `apps/api/src/ai-config/services/agent-skill-library.service.types.ts`, add the interface and field:

```typescript
export interface SkillScope {
  projects: string[];
  agents: string[];
  workflows: string[];
}

export interface SkillLibraryRecord {
  id: string;
  name: string;
  description: string;
  skillMarkdown: string;
  compatibility: string | null;
  category: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  scope: SkillScope | null;
  isActive: boolean;
  version: number;
  source: 'admin' | 'agent_factory' | 'imported';
  createdAt: Date;
  updatedAt: Date;
  rootPath: string;
}
```

- [ ] **Step 4: Parse scope in `buildSkillRecord`**

In `apps/api/src/ai-config/services/agent-skill-library.service.ts`:

(a) Import the type and add `scope?` to the frontmatter interface. Change the import on line 10 and the interface on lines 18-27:

```typescript
import type {
  SkillLibraryRecord,
  SkillScope,
} from './agent-skill-library.service.types';
```

```typescript
interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  compatibility?: unknown;
  category?: unknown;
  tags?: unknown;
  metadata?: unknown;
  scope?: unknown;
  is_active?: unknown;
  version?: unknown;
}
```

(b) In `buildSkillRecord` (line 309-343 return object), add the `scope` field right after the `metadata` block (after line 333):

```typescript
      scope: this.parseScope(parsed.frontmatter.scope),
```

(c) Add the two private helpers right after `buildSkillRecord` (before `parseVersion`, line 346):

```typescript
  private parseScope(value: unknown): SkillScope | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const projects = this.parseScopeList(record.projects);
    const agents = this.parseScopeList(record.agents);
    const workflows = this.parseScopeList(record.workflows);

    if (
      projects.length === 0 &&
      agents.length === 0 &&
      workflows.length === 0
    ) {
      return null;
    }

    return { projects, agents, workflows };
  }

  private parseScopeList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:api -- src/ai-config/services/agent-skill-library.service.spec.ts`
Expected: PASS (all existing tests in the file still pass too)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skill-library.service.ts apps/api/src/ai-config/services/agent-skill-library.service.types.ts apps/api/src/ai-config/services/agent-skill-library.service.spec.ts
git commit -m "feat(skills): parse scope frontmatter into SkillLibraryRecord (EPIC-205 W1)"
```

---

### Task 3: Add `listSkillsForScope` to the library and service

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.ts` (add public method near `listSkills`, line 46)
- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts` (add delegating method near `listSkills`, line 32)
- Test: `apps/api/src/ai-config/services/agent-skill-library.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block in `agent-skill-library.service.spec.ts`:

```typescript
describe('listSkillsForScope', () => {
  const SCOPED = (name: string, scopeYaml: string) =>
    `---\nname: ${name}\ndescription: A test skill\n${scopeYaml}---\n\n# Body`;

  beforeEach(() => {
    service.writeSkillMarkdown('global-skill', VALID_MARKDOWN('global-skill'));
    service.writeSkillMarkdown(
      'project-skill',
      SCOPED('project-skill', 'scope:\n  projects: [scope-123]\n'),
    );
    service.writeSkillMarkdown(
      'agent-skill',
      SCOPED('agent-skill', 'scope:\n  agents: [software-architect]\n'),
    );
    service.writeSkillMarkdown(
      'workflow-skill',
      SCOPED('workflow-skill', 'scope:\n  workflows: [create_skill]\n'),
    );
  });

  it('returns skills matching the project scopeId', () => {
    const names = service
      .listSkillsForScope({ scopeId: 'scope-123' })
      .map((s) => s.name);
    expect(names).toEqual(['project-skill']);
  });

  it('returns skills matching the agent profile', () => {
    const names = service
      .listSkillsForScope({ agentProfile: 'software-architect' })
      .map((s) => s.name);
    expect(names).toEqual(['agent-skill']);
  });

  it('returns skills matching the workflowId', () => {
    const names = service
      .listSkillsForScope({ workflowId: 'create_skill' })
      .map((s) => s.name);
    expect(names).toEqual(['workflow-skill']);
  });

  it('unions matches across all three axes and never returns global skills', () => {
    const names = service
      .listSkillsForScope({
        scopeId: 'scope-123',
        agentProfile: 'software-architect',
        workflowId: 'create_skill',
      })
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(['agent-skill', 'project-skill', 'workflow-skill']);
  });

  it('returns nothing when no context keys are supplied', () => {
    expect(service.listSkillsForScope({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- src/ai-config/services/agent-skill-library.service.spec.ts`
Expected: FAIL — `service.listSkillsForScope is not a function`.

- [ ] **Step 3: Implement `listSkillsForScope` in the library**

In `apps/api/src/ai-config/services/agent-skill-library.service.ts`, add immediately after `listSkills` (after line 64):

```typescript
  listSkillsForScope(context: {
    scopeId?: string;
    agentProfile?: string;
    workflowId?: string;
  }): SkillLibraryRecord[] {
    const { scopeId, agentProfile, workflowId } = context;
    if (!scopeId && !agentProfile && !workflowId) {
      return [];
    }

    return this.listSkills().filter((skill) => {
      const scope = skill.scope;
      if (!scope) {
        return false;
      }

      return (
        (scopeId !== undefined && scope.projects.includes(scopeId)) ||
        (agentProfile !== undefined && scope.agents.includes(agentProfile)) ||
        (workflowId !== undefined && scope.workflows.includes(workflowId))
      );
    });
  }
```

- [ ] **Step 4: Delegate from `AgentSkillsService`**

In `apps/api/src/ai-config/services/agent-skills.service.ts`, add after `listSkills` (after line 34):

```typescript
  listSkillsForScope(context: {
    scopeId?: string;
    agentProfile?: string;
    workflowId?: string;
  }) {
    return this.skillLibrary.listSkillsForScope(context);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:api -- src/ai-config/services/agent-skill-library.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skill-library.service.ts apps/api/src/ai-config/services/agent-skills.service.ts apps/api/src/ai-config/services/agent-skill-library.service.spec.ts
git commit -m "feat(skills): add listSkillsForScope library + service method (EPIC-205 W1)"
```

---

### Task 4: Union scoped skills into the resolver

**Files:**
- Modify: `apps/api/src/workflow/workflow-stage-skill-policy.service.ts` (`resolveAssignedSkills` line 50-134)
- Test: `apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts`

The resolver currently uses `profileSkills = listSkillsByProfileName(agentProfile)`. Change the base set to: the profile's **global** assigned skills, unioned (deduped by name) with scope-matched skills. Everything downstream (stage-policy include/exclude) is unchanged.

- [ ] **Step 1: Write the failing test**

In `workflow-stage-skill-policy.service.spec.ts`, the existing harness mocks `listSkillsByProfileName`, `listSkills`, and `settings.get`. Add a mock for the new method and a new `describe`. First, locate the `agentSkills` mock object in `beforeEach` (around line 74) and add `listSkillsForScope: listSkillsForScopeMock` to it; declare `const listSkillsForScopeMock = vi.fn();` alongside the other mocks (near line 10-12) and add `listSkillsForScopeMock.mockReturnValue([]);` inside `beforeEach` after `vi.clearAllMocks()`.

Then append this `describe` block:

```typescript
describe('scope union', () => {
  const projectSkill: SkillLibraryRecord = {
    id: 'project-skill',
    name: 'project-skill',
    description: 'Project-scoped skill',
    skillMarkdown: '---\nname: project-skill\ndescription: d\n---\n',
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: { projects: ['scope-123'], agents: [], workflows: [] },
    version: 1,
    source: 'imported',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    rootPath: '/tmp/project-skill',
    isActive: true,
  };

  it('includes scope-matched skills alongside global assigned skills', async () => {
    listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
    listSkillsForScopeMock.mockReturnValue([projectSkill]);

    const selection = await service.resolveAssignedSkills({
      agentProfile: 'software-architect',
      scopeId: 'scope-123',
    });

    const names = selection.skills.map((s) => s.name).sort();
    expect(names).toEqual(['architecture-review', 'project-skill']);
    expect(listSkillsForScopeMock).toHaveBeenCalledWith({
      scopeId: 'scope-123',
      agentProfile: 'software-architect',
      workflowId: undefined,
    });
  });

  it('excludes an assigned skill that is itself scoped to a non-matching context', async () => {
    const scopedAssigned: SkillLibraryRecord = {
      ...projectSkill,
      id: 'scoped-assigned',
      name: 'scoped-assigned',
      scope: { projects: ['other-scope'], agents: [], workflows: [] },
    };
    listSkillsByProfileNameMock.mockResolvedValue([
      architectureSkill,
      scopedAssigned,
    ]);
    listSkillsForScopeMock.mockReturnValue([]);

    const selection = await service.resolveAssignedSkills({
      agentProfile: 'software-architect',
      scopeId: 'scope-123',
    });

    expect(selection.skills.map((s) => s.name)).toEqual([
      'architecture-review',
    ]);
  });
});
```

> Note: the existing `architectureSkill`/`testSkill` fixtures in this file omit `scope`. Add `scope: null` (and `category: null`, `tags: []` if not already present) to each existing fixture so they satisfy the updated `SkillLibraryRecord` type.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- src/workflow/workflow-stage-skill-policy.service.spec.ts`
Expected: FAIL — `scopeId` is not an accepted param / scoped skill not unioned.

- [ ] **Step 3: Implement the union**

In `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`, change the `resolveAssignedSkills` signature (line 50-54) and the `profileSkills` assignment (line 70-71):

```typescript
  async resolveAssignedSkills(params: {
    agentProfile?: string;
    workflowStage?: WorkflowLifecycleStage | null;
    stateVariables?: Record<string, unknown>;
    scopeId?: string;
    workflowId?: string;
  }): Promise<WorkflowStageSkillSelection> {
```

Replace the existing line 70-71:

```typescript
    const profileSkills = await this.resolveBaseSkillSet(
      agentProfile,
      params.scopeId,
      params.workflowId,
    );
```

Add this private method after `resolveAssignedSkills` (before `buildSelection`, line 136):

```typescript
  private async resolveBaseSkillSet(
    agentProfile: string,
    scopeId?: string,
    workflowId?: string,
  ): Promise<SkillLibraryRecord[]> {
    const assignedGlobal = (
      await this.agentSkills.listSkillsByProfileName(agentProfile)
    ).filter((skill) => !skill.scope);

    const scoped = this.agentSkills.listSkillsForScope({
      scopeId,
      agentProfile,
      workflowId,
    });

    const byName = new Map<string, SkillLibraryRecord>();
    for (const skill of [...assignedGlobal, ...scoped]) {
      byName.set(normalizeSkillName(skill.name), skill);
    }
    return [...byName.values()];
  }
```

(`normalizeSkillName` is already imported at line 13; `SkillLibraryRecord` is already imported at line 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- src/workflow/workflow-stage-skill-policy.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-stage-skill-policy.service.ts apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts
git commit -m "feat(skills): union scope-matched skills into stage resolver (EPIC-205 W1)"
```

---

### Task 5: Thread `scopeId` and `workflowId` into the resolver

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` (`resolveAssignedSkillsForProfile` line 227-240)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` (call site line 462)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` (call site line 394; `resolveSkillMountForJob` params line 386-399 and its caller)
- Test: `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts` (create if absent)

`StepSupportService` already injects `runRepo` (line 60) and imports `getScopeId` + `resolveTriggerContext`. Derive `scopeId` from the trigger; fetch `workflowId` from the run by `workflowRunId`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts` (or append if it exists):

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepSupportService } from './step-support.service';

describe('StepSupportService.resolveAssignedSkillsForProfile', () => {
  const resolveAssignedSkillsMock = vi.fn();
  const findByIdMock = vi.fn();

  let service: StepSupportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAssignedSkillsMock.mockResolvedValue({ skills: [] });
    findByIdMock.mockResolvedValue({ workflow_id: 'create_skill' });

    service = new StepSupportService(
      {} as any, // aiConfig
      { findById: findByIdMock } as any, // runRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      { resolveAssignedSkills: resolveAssignedSkillsMock } as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
    );
  });

  it('derives scopeId from the trigger and workflowId from the run', async () => {
    await service.resolveAssignedSkillsForProfile('software-architect', {
      stateVariables: { trigger: { scopeId: 'scope-123' } },
      workflowRunId: 'run-1',
    });

    expect(findByIdMock).toHaveBeenCalledWith('run-1');
    expect(resolveAssignedSkillsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
        workflowId: 'create_skill',
      }),
    );
  });

  it('omits workflowId when no workflowRunId is provided', async () => {
    await service.resolveAssignedSkillsForProfile('software-architect', {
      stateVariables: { trigger: { scopeId: 'scope-123' } },
    });

    expect(findByIdMock).not.toHaveBeenCalled();
    expect(resolveAssignedSkillsMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: undefined }),
    );
  });
});
```

> The constructor argument order above matches `step-support.service.ts` lines 58-66 (`aiConfig, runRepo, toolMounting, stateManager, gitWorktreeService, stageSkillPolicy, toolPolicyEvaluator`). Verify and keep them aligned.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- src/workflow/workflow-step-execution/step-support.service.spec.ts`
Expected: FAIL — `scopeId`/`workflowId` not passed through; `findById` not called.

- [ ] **Step 3: Implement the threading in `StepSupportService`**

Replace `resolveAssignedSkillsForProfile` (lines 227-240) with:

```typescript
  async resolveAssignedSkillsForProfile(
    agentProfile?: string,
    stageContext?: {
      workflowStage?: WorkflowLifecycleStage | null;
      stateVariables?: Record<string, unknown>;
      workflowRunId?: string;
    },
  ): Promise<SkillLibraryRecord[]> {
    const scopeId = this.resolveScopeIdFromState(stageContext?.stateVariables);
    const workflowId = await this.resolveWorkflowId(
      stageContext?.workflowRunId,
    );

    const selection = await this.stageSkillPolicy.resolveAssignedSkills({
      agentProfile,
      workflowStage: stageContext?.workflowStage,
      stateVariables: stageContext?.stateVariables,
      scopeId,
      workflowId,
    });
    return selection.skills;
  }

  private resolveScopeIdFromState(
    stateVariables?: Record<string, unknown>,
  ): string | undefined {
    if (!stateVariables) {
      return undefined;
    }
    const context = resolveTriggerContext(stateVariables.trigger);
    return getScopeId(context) ?? undefined;
  }

  private async resolveWorkflowId(
    workflowRunId?: string,
  ): Promise<string | undefined> {
    if (!workflowRunId) {
      return undefined;
    }
    const run = await this.runRepo.findById(workflowRunId);
    return run?.workflow_id ?? undefined;
  }
```

(`resolveTriggerContext` is imported at line 40; `getScopeId` at line 13; `SkillLibraryRecord` at line 18.)

- [ ] **Step 4: Pass `workflowRunId` from the two call sites**

In `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts`, update the call at line 462-467:

```typescript
    const assignedSkills = await this.support.resolveAssignedSkillsForProfile(
      agentProfile,
      {
        stateVariables,
        workflowRunId: data.workflowRunId,
      },
    );
```

In `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts`:
- Add `workflowRunId` to the `resolveSkillMountForJob` params type (line 386-389) and pass it through (line 394-399):

```typescript
  private async resolveSkillMountForJob(params: {
    agentProfile?: string;
    stateVariables: Record<string, unknown>;
    mountKey: string;
    workflowRunId: string;
  }): Promise<{
    assignedSkills: Array<{ name: string }>;
    skillMountPath: string | null;
  }> {
    const assignedSkills = await this.support.resolveAssignedSkillsForProfile(
      params.agentProfile,
      {
        stateVariables: params.stateVariables,
        workflowRunId: params.workflowRunId,
      },
    );
```

- At the single caller of `resolveSkillMountForJob` (search the same file for `resolveSkillMountForJob(`), add `workflowRunId` to the argument object using the `workflowRunId` already in scope there (the method runs inside job provisioning which has `workflowRunId`). Run: `grep -n "resolveSkillMountForJob(" apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` and pass `workflowRunId` at the call.

- [ ] **Step 5: Run the resolver test + both executor test suites**

Run: `npm run test:api -- src/workflow/workflow-step-execution/step-support.service.spec.ts`
Expected: PASS

Run: `npm run test:api -- src/workflow/workflow-step-execution`
Expected: PASS (no regression in executor specs)

- [ ] **Step 6: Typecheck the API workspace**

Run: `npm run build:api`
Expected: Builds clean — confirms the new `SkillLibraryRecord.scope` field and param changes typecheck across all call sites.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-support.service.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts
git commit -m "feat(skills): thread scopeId and workflowId into skill resolver (EPIC-205 W1)"
```

---

## Final Verification

- [ ] **Full skills + workflow-execution test sweep**

Run: `npm run test:api -- src/ai-config/services src/workflow/workflow-step-execution src/workflow/workflow-stage-skill-policy.service.spec.ts`
Expected: All PASS.

- [ ] **Core contract tests**

Run: `npm run test --workspace=packages/core -- src/schemas/ai-config`
Expected: All PASS.

- [ ] **Typecheck + lint**

Run: `npm run build:api && npm run lint:api`
Expected: Clean.

- [ ] **Manual backward-compat smoke (optional but recommended)**

Start the API, then in any project run a workflow whose agent has an unscoped (global) assigned skill. Confirm the skill still mounts (inspect the prepared skill mount / `_catalog`). Then add `scope:\n  projects: [<that project's scopeId>]` to a test `SKILL.md`, assign it to no profile, and confirm it mounts **only** for runs in that project and not elsewhere.

---

## Self-Review Notes

- **Spec coverage (W1 only):** scope schema (Task 1), frontmatter parse → record (Task 2), `listSkillsForScope` (Task 3), resolver union + assigned-but-scoped exclusion (Task 4), scopeId/workflowId threading + plumbing gap closed (Task 5). W2–W4 of EPIC-205 are out of scope here.
- **Type consistency:** `listSkillsForScope({ scopeId?, agentProfile?, workflowId? })` is identical in the library, the service delegate, and the resolver call. `SkillScope` = `{ projects: string[]; agents: string[]; workflows: string[] }` everywhere; `SkillLibraryRecord.scope` is `SkillScope | null`. `resolveAssignedSkillsForProfile` stageContext gains `workflowRunId?: string`.
- **Backward compatibility:** unscoped skills parse to `scope: null`, pass the `!skill.scope` global filter, and resolve exactly as before. `listSkillsForScope({})` returns `[]`.
- **Known follow-up (not W1):** existing `SkillLibraryRecord` fixtures across other spec files may need `scope: null` added to satisfy the type — `build:api` in Task 5 Step 6 surfaces any missed ones; fix them in that commit.
