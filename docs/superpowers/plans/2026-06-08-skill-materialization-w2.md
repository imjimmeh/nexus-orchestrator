# EPIC-205 W2: `create_skill` Tool, Persona, and Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `create_skill` internal tool, `skill-author` agent persona, and `create_skill` workflow so that a manually-dispatched run authors or updates a `SKILL.md` on disk with provenance metadata and a recommended scope.

**Architecture:** `CreateSkillTool` is an `api_callback` internal tool registered in `WorkflowInternalToolsModule`. Its HTTP callback is a new route added to the existing `WorkflowRuntimeInternalToolCallbacksController` (the same controller that handles `create_skill_proposal` and every other internal tool callback). The tool's `execute()` calls `AgentSkillsService.upsertSkill()` — a new method that branches on `skillExists` to call `createSkill` or `updateSkill` — and injects provenance metadata into the SKILL.md frontmatter via `js-yaml` before persisting. A new `skill-author` seed agent is granted the tool. The `create_skill` workflow has one job that instructs the agent to author/refine skill content, call the tool, recommend a scope, then emit `set_job_output` / `step_complete`.

**Tech Stack:** TypeScript, NestJS, Zod (`@nexus/core`), Vitest, js-yaml. Test commands: `npm run test:api -- <relative-path>`. Build/typecheck: `npm run build:api`. Seed files (JSON/YAML/Markdown) are applied by the seeder at runtime — no tests needed for them, but they must be well-formed.

**Reference files to consult before implementing:**
- `apps/api/src/workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool.ts` — internal tool pattern + exact imports
- `apps/api/src/workflow/workflow-runtime/workflow-runtime-internal-tool-callbacks.controller.ts` — callback routing pattern + guard/decorator usage
- `seed/workflows/project-charter-ceo.workflow.yaml` — workflow YAML structure
- `seed/workflows/prompts/project-charter-ceo/onboard.md` — step prompt structure

**Conventions:**
- Internal tool test: construct with `new CreateSkillTool(mockService)` — no DI container.
- `AgentSkillsService` tests: construct with `new AgentSkillsService(skillLibraryMock, searchPipeline, profileRepo)` — the existing harness in `agent-skills.service.spec.ts`.
- All callback endpoints use `@UseGuards(JwtAuthGuard, RolesGuard)` (class-level) + `@Roles('Admin', 'Developer', 'Agent')` (per endpoint).
- The callback controller routes via `this.executeInternalToolCallback(req, 'create_skill', body)` — the tool name string must exactly match `getName()`.

---

### Task 1: Add `upsertSkill` to `AgentSkillsService`

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-skills.service.spec.ts`

`upsertSkill` branches on `this.skillLibrary.skillExists(normalizedName)` to call `createSkill` (new) or `updateSkill` (existing). The private `normalizeName(name)` method is already on the service (line ~268) — call it to get the normalized name for the existence check.

- [ ] **Step 1: Write the failing tests**

Append a new `describe('upsertSkill', ...)` block inside the top-level `describe('AgentSkillsService', ...)` in `agent-skills.service.spec.ts`. The `skillLibraryMock` object is already declared in the outer describe — use it directly (call `skillLibraryMock.skillExists.mockReturnValue(...)`). Add `skillExists` to the mock if it isn't already there (check the mock object around line 15-26 first).

```typescript
describe('upsertSkill', () => {
  const dto: CreateAgentSkillRequest = {
    name: 'my-skill',
    skill_markdown: '---\nname: my-skill\ndescription: Test skill\n---\n\n# Body',
  };

  const mockRecord: SkillLibraryRecord = {
    id: 'my-skill',
    name: 'my-skill',
    description: 'Test skill',
    skillMarkdown: dto.skill_markdown,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    isActive: true,
    version: 1,
    source: 'imported',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    rootPath: '/tmp/my-skill',
  };

  it('calls createSkill and returns action: created when skill does not exist', () => {
    skillLibraryMock.skillExists.mockReturnValue(false);
    const createSpy = vi.spyOn(service, 'createSkill').mockReturnValue(mockRecord);

    const result = service.upsertSkill(dto);

    expect(createSpy).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ record: mockRecord, action: 'created' });
  });

  it('calls updateSkill and returns action: updated when skill already exists', () => {
    skillLibraryMock.skillExists.mockReturnValue(true);
    const updateSpy = vi.spyOn(service, 'updateSkill').mockReturnValue(mockRecord);

    const result = service.upsertSkill(dto);

    expect(updateSpy).toHaveBeenCalledWith('my-skill', { skill_markdown: dto.skill_markdown });
    expect(result).toEqual({ record: mockRecord, action: 'updated' });
  });
});
```

If `SkillLibraryRecord` or `CreateAgentSkillRequest` are not yet imported in the spec file, add them at the top from `'../agent-skill-library.service.types'` and `'@nexus/core'` respectively.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:api -- src/ai-config/services/agent-skills.service.spec.ts`
Expected: FAIL — `service.upsertSkill is not a function`

- [ ] **Step 3: Implement `upsertSkill`**

In `apps/api/src/ai-config/services/agent-skills.service.ts`, add after `updateSkill`:

```typescript
  upsertSkill(dto: CreateAgentSkillRequest): { record: SkillLibraryRecord; action: 'created' | 'updated' } {
    const name = this.normalizeName(dto.name);
    if (this.skillLibrary.skillExists(name)) {
      const record = this.updateSkill(name, { skill_markdown: dto.skill_markdown });
      return { record, action: 'updated' };
    }
    const record = this.createSkill(dto);
    return { record, action: 'created' };
  }
```

`SkillLibraryRecord` and `CreateAgentSkillRequest` are already imported in the service file. `normalizeName` is the existing private method on the class.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:api -- src/ai-config/services/agent-skills.service.spec.ts`
Expected: PASS (all pre-existing tests still pass, 2 new tests pass)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skills.service.ts apps/api/src/ai-config/services/agent-skills.service.spec.ts
git commit -m "feat(skills): add upsertSkill to AgentSkillsService (EPIC-205 W2)"
```

---

### Task 2: Create `CreateSkillTool` and its unit tests

**Files:**
- Create: `apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.ts`
- Create: `apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts`

**Before writing anything:** Read `apps/api/src/workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool.ts` to get exact import paths for `IInternalToolHandler`, `Capability`, and the `RuntimeCapabilityDefinition` return type of `getDefinition()`. Match those paths exactly.

The `injectProvenance` helper parses YAML frontmatter with `js-yaml`, merges provenance keys into the `metadata` object, and re-serializes. `js-yaml` is already in `package.json` (used by `agent-skill-library.service.ts`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSkillTool } from './create-skill.tool';
import type { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';
import type { SkillLibraryRecord } from '../../../../ai-config/services/agent-skill-library.service.types';

const makeRecord = (name: string): SkillLibraryRecord => ({
  id: name,
  name,
  description: 'Test',
  skillMarkdown: `---\nname: ${name}\ndescription: Test\n---\n`,
  compatibility: null,
  category: null,
  tags: [],
  metadata: null,
  scope: null,
  isActive: true,
  version: 1,
  source: 'imported',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  rootPath: `/tmp/${name}`,
});

describe('CreateSkillTool', () => {
  const upsertMock = vi.fn();
  let tool: CreateSkillTool;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockReturnValue({ record: makeRecord('my-skill'), action: 'created' });
    tool = new CreateSkillTool({ upsertSkill: upsertMock } as unknown as AgentSkillsService);
  });

  it('getName returns create_skill', () => {
    expect(tool.getName()).toBe('create_skill');
  });

  it('calls upsertSkill with name and markdown when no provenance provided', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute({ name: 'my-skill', skill_markdown: markdown });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-skill', skill_markdown: markdown }),
    );
  });

  it('returns action, name, and scope from the upsert result', async () => {
    const record = makeRecord('my-skill');
    record.scope = { projects: ['scope-123'], agents: [], workflows: [] };
    upsertMock.mockReturnValue({ record, action: 'updated' });

    const result = await tool.execute({
      name: 'my-skill',
      skill_markdown: '---\nname: my-skill\ndescription: Test\n---\n',
    });

    expect(result).toEqual({ action: 'updated', name: 'my-skill', scope: record.scope });
  });

  it('injects source_proposal_id into frontmatter metadata', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute({ name: 'my-skill', skill_markdown: markdown, source_proposal_id: 'prop-abc' });

    const calledWith = upsertMock.mock.calls[0][0] as { skill_markdown: string };
    expect(calledWith.skill_markdown).toContain('source_proposal_id: prop-abc');
  });

  it('injects generated_from_run_id into frontmatter metadata', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute({ name: 'my-skill', skill_markdown: markdown, generated_from_run_id: 'run-xyz' });

    const calledWith = upsertMock.mock.calls[0][0] as { skill_markdown: string };
    expect(calledWith.skill_markdown).toContain('generated_from_run_id: run-xyz');
  });

  it('does not alter markdown when neither provenance field is provided', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute({ name: 'my-skill', skill_markdown: markdown });

    const calledWith = upsertMock.mock.calls[0][0] as { skill_markdown: string };
    expect(calledWith.skill_markdown).toBe(markdown);
  });

  it('merges provenance into existing metadata without overwriting other keys', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\nmetadata:\n  custom_key: hello\n---\n\n# Body';

    await tool.execute({
      name: 'my-skill',
      skill_markdown: markdown,
      source_proposal_id: 'prop-abc',
    });

    const calledWith = upsertMock.mock.calls[0][0] as { skill_markdown: string };
    expect(calledWith.skill_markdown).toContain('custom_key: hello');
    expect(calledWith.skill_markdown).toContain('source_proposal_id: prop-abc');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:api -- src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts`
Expected: FAIL — cannot find module `./create-skill.tool`

- [ ] **Step 3: Create the tool file**

First, read `apps/api/src/workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool.ts` to copy the exact import paths and `getDefinition()` implementation pattern. Then create `apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import yaml from 'js-yaml';
// Copy the exact import paths for Capability, IInternalToolHandler, RuntimeCapabilityDefinition
// from create-skill-proposal.tool.ts — they follow the relative path from that file's location
import { Capability } from '<path-from-reference-file>';
import type { IInternalToolHandler, RuntimeCapabilityDefinition } from '<path-from-reference-file>';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';
import type { SkillScope } from '../../../../ai-config/services/agent-skill-library.service.types';

const createSkillToolSchema = z.object({
  name: z.string().min(1).max(64),
  skill_markdown: z.string().min(1).max(20480),
  source_proposal_id: z.string().min(1).optional(),
  generated_from_run_id: z.string().min(1).optional(),
});

type CreateSkillParams = z.infer<typeof createSkillToolSchema>;

interface CreateSkillResult {
  action: 'created' | 'updated';
  name: string;
  scope: SkillScope | null;
}

@Injectable()
export class CreateSkillTool implements IInternalToolHandler<CreateSkillParams> {
  constructor(private readonly agentSkillsService: AgentSkillsService) {}

  getName(): string {
    return 'create_skill';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'create_skill',
      description: 'Creates or updates a SKILL.md in the skill library. Pass the complete skill markdown including YAML frontmatter. Optionally provide source_proposal_id and generated_from_run_id for provenance tracking.',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/materialize',
        bodyMapping: {
          name: 'name',
          skill_markdown: 'skill_markdown',
          source_proposal_id: 'source_proposal_id',
          generated_from_run_id: 'generated_from_run_id',
        },
      },
      inputSchema: createSkillToolSchema,
    };
  }

  async execute(params: CreateSkillParams): Promise<CreateSkillResult> {
    const enrichedMarkdown = this.injectProvenance(
      params.skill_markdown,
      params.source_proposal_id,
      params.generated_from_run_id,
    );

    const { record, action } = this.agentSkillsService.upsertSkill({
      name: params.name,
      skill_markdown: enrichedMarkdown,
    });

    return { action, name: record.name, scope: record.scope };
  }

  private injectProvenance(
    markdown: string,
    proposalId?: string,
    runId?: string,
  ): string {
    if (!proposalId && !runId) {
      return markdown;
    }

    const match = markdown.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
    if (!match) {
      return markdown;
    }

    const frontmatter = yaml.load(match[2]) as Record<string, unknown>;
    const existing = (frontmatter.metadata as Record<string, unknown>) ?? {};
    frontmatter.metadata = {
      ...existing,
      ...(proposalId ? { source_proposal_id: proposalId } : {}),
      ...(runId ? { generated_from_run_id: runId } : {}),
    };

    const serialized = yaml.dump(frontmatter).trimEnd();
    return `---\n${serialized}\n---${match[4]}`;
  }
}
```

**Note on `getDefinition()` signature and `RuntimeCapabilityDefinition` shape:** The exact field names in `RuntimeCapabilityDefinition` may differ from what's shown above (e.g., `inputSchema` might be `schema`, `description` might not be a top-level field). Read `create-skill-proposal.tool.ts` and its type imports to get the correct shape, then adjust accordingly. The logic in `execute()` and `injectProvenance()` is correct regardless.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:api -- src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.ts apps/api/src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts
git commit -m "feat(skills): add CreateSkillTool internal tool with provenance injection (EPIC-205 W2)"
```

---

### Task 3: Register `CreateSkillTool` and add its callback route

**Files:**
- Modify: `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-internal-tool-callbacks.controller.ts`

There are no new files — both modifications are additions to existing files.

**Before modifying:** Read both files fully to understand the exact patterns (the module's providers/factory array and the controller's existing route methods).

- [ ] **Step 1: Register the tool in `WorkflowInternalToolsModule`**

In `workflow-internal-tools.module.ts`:

(a) Add `CreateSkillTool` to the `imports` at the top of the file:
```typescript
import { CreateSkillTool } from './tools/skills/create-skill.tool';
```

(b) Add `CreateSkillTool` to the `providers` array (alongside the other tool class providers).

(c) Add `CreateSkillTool` to the `inject` array of the `INTERNAL_TOOL_HANDLER` multi-provider factory (the array of all tool handlers that becomes `INTERNAL_TOOL_HANDLER`). Add it alongside the other tools in that factory's inject list and as a parameter in the factory function.

The pattern for a tool that takes a service via DI (read the existing factory to understand — some tools are plain class providers, others use `useFactory`). Since `CreateSkillTool` takes `AgentSkillsService` which is exported by `AiConfigModule` (already imported by this module), register it as a plain class provider:
```typescript
// In providers array:
CreateSkillTool,

// In INTERNAL_TOOL_HANDLER factory inject array — add CreateSkillTool to the list
// In INTERNAL_TOOL_HANDLER factory function — add as a parameter and include in the returned array
```

- [ ] **Step 2: Add the callback route to the controller**

In `workflow-runtime-internal-tool-callbacks.controller.ts`, add a new route method after the last existing route. Follow the exact same pattern as `createSkillProposal` (which calls `this.executeInternalToolCallback(req, 'create_skill_proposal', body)`):

```typescript
  @Post('skills/materialize')
  @Roles('Admin', 'Developer', 'Agent')
  @ApiOperation({ summary: 'Materialize a skill via the create_skill tool' })
  async materializeSkill(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'create_skill', body);
  }
```

The string `'create_skill'` must exactly match `CreateSkillTool.getName()`.

- [ ] **Step 3: Verify the tool is wired up end-to-end**

Run: `npm run build:api`
Expected: Clean build — confirms imports, types, and module wiring are correct.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts apps/api/src/workflow/workflow-runtime/workflow-runtime-internal-tool-callbacks.controller.ts
git commit -m "feat(skills): register CreateSkillTool and add /skills/materialize callback route (EPIC-205 W2)"
```

---

### Task 4: Create the `skill-author` agent seed

**Files:**
- Create: `seed/agents/skill-author/agent.json`
- Create: `seed/agents/skill-author/PROMPT.md`

No tests needed — these are seed data files applied by the seeder at runtime. Validate JSON is well-formed.

- [ ] **Step 1: Create `seed/agents/skill-author/agent.json`**

```json
{
  "name": "skill-author",
  "tier_preference": "heavy",
  "assigned_skills": [],
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow create_skill *",
      "allow read_skill_manifest *",
      "allow set_job_output *",
      "allow step_complete *"
    ]
  },
  "is_active": true
}
```

The `name` field must match the directory name exactly. `tier_preference: heavy` because skill authoring is a complex reasoning task. The tool policy grants only the four tools this agent needs.

- [ ] **Step 2: Create `seed/agents/skill-author/PROMPT.md`**

```markdown
# Skill Author

You are the Skill Author — a specialist responsible for producing high-quality `SKILL.md` files that encode reusable knowledge into the skill library.

## Your Role

You receive a skill improvement proposal: a target skill name, a proposed SKILL.md (the full resulting content, not a diff), a summary of what improvement is being made, and optionally a project scope identifier.

Your job is to:
1. **Review** the proposed SKILL.md for completeness, accuracy, and correct SKILL.md formatting
2. **Refine** the content if needed — improve clarity, add missing sections, or fix frontmatter
3. **Decide** whether you are creating a new skill or updating an existing one (use `read_skill_manifest` to check)
4. **Recommend a scope** — decide whether this skill is best kept global or bound to a specific project, agent profile, or workflow
5. **Persist** the skill using the `create_skill` tool
6. **Report** the result via `set_job_output` and `step_complete`

## SKILL.md Format

Every SKILL.md must have valid YAML frontmatter with these required fields:
- `name`: lowercase slug matching the file directory name
- `description`: one-sentence description of what the skill does
- `version`: semver string (e.g. `1.0.0`)

Optional frontmatter fields:
- `scope`: object with `projects`, `agents`, and/or `workflows` string arrays (omit for global)
- `compatibility`: model tier guidance
- `tags`: array of string tags
- `category`: single category string
- `metadata`: key/value pairs for provenance and custom data

## Scope Guidance

- **Global** (no `scope` field): the skill is useful across all projects and agents
- **Project-scoped** (`scope.projects: [<scopeId>]`): the skill is specific to a particular project's context, conventions, or codebase
- **Agent-scoped** (`scope.agents: [<profile-name>]`): the skill is only relevant to a specific agent role
- **Workflow-scoped** (`scope.workflows: [<workflow_id>]`): the skill is used only within a specific workflow
- You may combine axes (e.g. project + agent) when appropriate

## Output Contract

After calling `create_skill`, call `set_job_output` with:
```json
{
  "skill_name": "<the persisted skill name>",
  "materialized": true,
  "recommended_scope": <scope object or null for global>,
  "scope_rationale": "<1-2 sentences explaining why you chose this scope>"
}
```
Then call `step_complete` with a brief summary.
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('seed/agents/skill-author/agent.json', 'utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add seed/agents/skill-author/agent.json seed/agents/skill-author/PROMPT.md
git commit -m "feat(skills): add skill-author agent persona seed (EPIC-205 W2)"
```

---

### Task 5: Create the `create_skill` workflow and step prompt

**Files:**
- Create: `seed/workflows/create-skill.workflow.yaml`
- Create: `seed/workflows/prompts/create-skill/author.md`

No unit tests needed — these are seed data files. The workflow is validated by the YAML parser and schema at seeder runtime.

**Before writing:** Read `seed/workflows/project-charter-ceo.workflow.yaml` to confirm the exact YAML structure (trigger.inputs format, job inputs template syntax, output_contract format). Match it exactly.

- [ ] **Step 1: Create `seed/workflows/prompts/create-skill/author.md`**

```markdown
You are operating as the Skill Author in the `create_skill` workflow.

## Context

You have been dispatched to materialize a skill improvement proposal into the skill library. Your inputs are:

- **target_skill_name**: `{{ inputs.target_skill_name }}` — the skill slug to create or update
- **patch_markdown**: provided in your job context — the full proposed SKILL.md content
- **proposal_summary**: `{{ inputs.proposal_summary }}` — what improvement this proposal makes
- **scope_id**: `{{ inputs.scope_id }}` — the project scope where this proposal originated (may be empty for global proposals)
- **source_proposal_id**: `{{ inputs.source_proposal_id }}` — the proposal ID for provenance tracking

## Instructions

### Step 1: Check if the skill already exists

Call `read_skill_manifest` with `{ "name": "{{ inputs.target_skill_name }}" }` to see if the skill already exists. If it does, you will be updating it; if not, you will be creating it.

### Step 2: Review and refine the proposed SKILL.md

Read the `patch_markdown` provided. Evaluate it for:
- Correct frontmatter (name matches `{{ inputs.target_skill_name }}`, description present, version set)
- Clear, actionable skill body
- No placeholder text or incomplete sections

Make any necessary improvements. The `name` field in frontmatter **must** be `{{ inputs.target_skill_name }}`.

### Step 3: Determine scope recommendation

Based on the proposal summary and the `scope_id` value:
- If `scope_id` is provided and the skill content is specific to that project's context, recommend `scope.projects: ["{{ inputs.scope_id }}"]`
- If the skill is broadly applicable, recommend global (no scope)
- If the skill is only relevant for a specific agent role or workflow, recommend accordingly

Prepare your `recommended_scope` (a scope object, or `null` for global) and a 1-2 sentence `scope_rationale`.

### Step 4: Persist the skill

Call `create_skill` with:
```json
{
  "name": "{{ inputs.target_skill_name }}",
  "skill_markdown": "<your final SKILL.md content>",
  "source_proposal_id": "{{ inputs.source_proposal_id }}"
}
```

### Step 5: Report the result

Call `set_job_output` with:
```json
{
  "skill_name": "{{ inputs.target_skill_name }}",
  "materialized": true,
  "recommended_scope": <your scope object or null>,
  "scope_rationale": "<your rationale>"
}
```

Then call `step_complete` with a brief summary of what you authored and why you chose the scope you did.
```

- [ ] **Step 2: Create `seed/workflows/create-skill.workflow.yaml`**

```yaml
workflow_id: create_skill
name: Create or Update Skill
description: Agent-authored skill materialization. Dispatched when a skill improvement proposal is approved. The skill-author agent reviews the proposed SKILL.md, refines it, recommends a scope, and persists it to the library.

trigger:
  type: manual
  inputs:
    - name: target_skill_name
      type: string
      required: true
    - name: patch_markdown
      type: string
      required: true
    - name: proposal_summary
      type: string
      required: true
    - name: source_proposal_id
      type: string
      required: false
    - name: scope_id
      type: string
      required: false

permissions:
  tool_policy:
    default: deny
    rules:
      - effect: allow
        tool: create_skill
      - effect: allow
        tool: read_skill_manifest
      - effect: allow
        tool: set_job_output
      - effect: allow
        tool: step_complete

jobs:
  - id: author_skill
    type: execution
    tier: heavy
    inputs:
      agent_profile: skill-author
      target_skill_name: "{{ trigger.target_skill_name }}"
      patch_markdown: "{{ trigger.patch_markdown }}"
      proposal_summary: "{{ trigger.proposal_summary }}"
      source_proposal_id: "{{ trigger.source_proposal_id }}"
      scope_id: "{{ trigger.scope_id }}"
    output_contract:
      required:
        - skill_name
        - materialized
        - scope_rationale
      optional:
        - recommended_scope
    steps:
      - id: author
        prompt_file: prompts/create-skill/author.md
```

- [ ] **Step 3: Validate the YAML is well-formed**

Run: `node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('seed/workflows/create-skill.workflow.yaml', 'utf8')); console.log('valid')"`
Expected: `valid`

If `js-yaml` is not available as a standalone CLI, use: `node -e "try { require('js-yaml').load(require('fs').readFileSync('seed/workflows/create-skill.workflow.yaml','utf8')); console.log('valid') } catch(e) { console.error(e.message); process.exit(1) }"`

- [ ] **Step 4: Commit**

```bash
git add seed/workflows/create-skill.workflow.yaml seed/workflows/prompts/create-skill/author.md
git commit -m "feat(skills): add create_skill workflow and skill-author step prompt (EPIC-205 W2)"
```

---

## Final Verification

- [ ] **Full test sweep for changed API code**

Run: `npm run test:api -- src/ai-config/services/agent-skills.service.spec.ts src/workflow/workflow-internal-tools/tools/skills/create-skill.tool.spec.ts`
Expected: All tests PASS

- [ ] **Typecheck**

Run: `npm run build:api`
Expected: Clean build — no type errors introduced

- [ ] **Smoke check seed files**

Verify these files exist and are parseable:
- `seed/agents/skill-author/agent.json` — valid JSON with `name`, `tool_policy`, `tier_preference`, `is_active`
- `seed/agents/skill-author/PROMPT.md` — non-empty markdown
- `seed/workflows/create-skill.workflow.yaml` — valid YAML with `workflow_id: create_skill`
- `seed/workflows/prompts/create-skill/author.md` — non-empty markdown

---

## Self-Review Notes

- **Acceptance criteria coverage:** Tool create-vs-update branching → Task 1 (`upsertSkill`) + Task 2 (tool tests). Provenance metadata injection → Task 2 (`injectProvenance`). Manual dispatch writes `SKILL.md` → Tasks 3–5 together. Structured job output → Task 5 (`author.md` prompt + output_contract in YAML).
- **Type consistency:** `upsertSkill` returns `{ record: SkillLibraryRecord; action: 'created' | 'updated' }`. `CreateSkillTool.execute()` returns `Promise<{ action, name, scope }>`. All types reference `SkillLibraryRecord` and `SkillScope` from `agent-skill-library.service.types.ts` (Task 1 and Task 2 are consistent).
- **W3 dependency:** This plan ends at W2. The approval dispatch wiring (W3) requires this workflow to exist — `workflow_id: create_skill` is what W3's listener will pass to `startWorkflow()`.
- **`getDefinition()` pattern:** Task 2 Step 3 notes that the exact `RuntimeCapabilityDefinition` field names must be verified from the reference file. This is the one area where the implementer must do a read-first step.
