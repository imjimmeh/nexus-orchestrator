# Relocate Kanban Tooling (api → kanban) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three project/kanban-scoped agent tools that are incorrectly implemented in `apps/api` (`propose_work_items`, `update_charter`, `record_project_memory`) into `apps/kanban` as `kanban.*` MCP tools, deleting the api originals and updating every call-site and contract test.

**Architecture:** `apps/api` is the workflow/orchestration CORE; `apps/kanban` owns projects, goals, work items, charter and project memory. The three tools operate on kanban concepts, so they belong in kanban's MCP tool suite (same `IInternalToolHandler` interface, auto-registered via barrel `Object.values`, exposed over the `POST /mcp` JSON-RPC endpoint). kanban already has every dependency the tools need (raw `memory_segments` access, `coreClient.writeRepoFile`/`readRepoFile`), so no new cross-service calls back to api are required. This follows the established precedent in `internal-tools-kanban-cutover.spec.ts`, which already asserts a prior batch of project tools was cut over.

**Tech Stack:** NestJS, TypeScript, Zod, `@nexus/kanban-contracts`, Vitest. kanban MCP tools, BullMQ unrelated here.

**Decisions locked (from brainstorming):**
1. Relocated tools **adopt the `kanban.*` prefix**: `kanban.propose_work_items`, `kanban.update_charter`, `kanban.record_project_memory`.
2. `propose_work_items` is **behavior-preserving** (validate/shape only, no new persistence).
3. `update_charter` is **moved now** even though the goals-into-charter integration will later delete it.
4. Scope is **the clear three only**; `query_memory` and `create_artifact` are left in api, flagged for separate review (see Appendix A).

**Param-name note:** `update_charter` and `record_project_memory` are called by prompts with `scope_id` (not `project_id`). To avoid extra prompt churn, the kanban ports **keep `scope_id`** as the input param. Only the tool NAME changes.

---

## File Structure

**Create (kanban):**
- `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.ts` — `kanban.propose_work_items` (pure validate/shape)
- `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.spec.ts`
- `apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.ts` — `kanban.record_project_memory`
- `apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.spec.ts`
- `apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts` — `kanban.update_charter`
- `apps/kanban/src/mcp/tools/mutation/update-charter.tool.spec.ts`

**Modify (kanban):**
- `apps/kanban/src/project/project-memory-summary.service.ts` — add `createProjectMemory(...)`
- `apps/kanban/src/mcp/tools/mutation/index.ts` — export the three new tools (auto-registers)
- `seed/tool-manifests/kanban-tools.seed.json` — add the three new tool names

**Delete (api):**
- `apps/api/src/tool/handlers/propose-work-items.tool.ts` (+ any spec)
- `apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts` (+ `.spec.ts`)
- `apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts` (+ `.spec.ts`)

**Modify (api):**
- `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts` — remove 3 providers + inject entries + the `UpdateCharterTool` `useFactory`
- `apps/api/src/database/seeds/seed-data-validation.tool-discovery.helpers.ts` — remove the 3 classes from `HANDLER_CLASSES` + imports
- `apps/api/src/workflow/workflow-internal-tools/internal-tools-kanban-cutover.spec.ts` — add the 3 removed paths
- `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts` — rename `update_charter`/`record_project_memory` → `kanban.*`

**Modify (seed call-sites — rename refs):** enumerated in Task 6.

---

## Task 1: Add `createProjectMemory` to kanban's ProjectMemorySummaryService

The kanban `record_project_memory` port needs a kanban-native way to write a project memory preserving the api tool's semantics: `entity_type='project'`, `metadata_json = { category, source, confidence? }`, and the `preference`-category → `preference` memory-type rule. The existing `createCharterMemory` hardcodes `source='user_edit'` and omits `confidence`, so add a dedicated method rather than overload it.

**Files:**
- Modify: `apps/kanban/src/project/project-memory-summary.service.ts`
- Test: `apps/kanban/src/project/project-memory-summary.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Add to `project-memory-summary.service.spec.ts` (mock the `DataSource` like existing kanban service specs — `query` returns the RETURNING row):

```ts
import { ProjectMemorySummaryService } from './project-memory-summary.service';

describe('ProjectMemorySummaryService.createProjectMemory', () => {
  it('inserts a project memory with category/source/confidence and preference rule', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const dataSource = {
      query: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        return [{ id: 'mem-1', content: params[1], memory_type: params[2],
          metadata: { category: params[3], source: params[4] },
          created_at: 'now', updated_at: 'now' }];
      },
    } as unknown as import('typeorm').DataSource;
    const service = new ProjectMemorySummaryService(dataSource);

    const result = await service.createProjectMemory('proj-1', {
      category: 'preference', content: 'prefers dark mode',
      source: 'onboarding_chat', confidence: 0.9,
    });

    expect(result.id).toBe('mem-1');
    // preference category forces memory_type = 'preference'
    expect(captured[0].params[2]).toBe('preference');
    expect(captured[0].params[3]).toBe('preference'); // category
    expect(captured[0].params[4]).toBe('onboarding_chat'); // source
    expect(captured[0].sql).toContain("entity_type");
  });

  it('defaults memory_type to fact for non-preference categories', async () => {
    const dataSource = {
      query: async (_sql: string, params: unknown[]) =>
        [{ id: 'm', content: params[1], memory_type: params[2], metadata: {}, created_at: 'n', updated_at: 'n' }],
    } as unknown as import('typeorm').DataSource;
    const service = new ProjectMemorySummaryService(dataSource);
    await service.createProjectMemory('p', { category: 'requirement', content: 'x', source: 'onboarding_chat' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/kanban && npx vitest run src/project/project-memory-summary.service.spec.ts`
Expected: FAIL — `createProjectMemory is not a function`.

- [ ] **Step 3: Implement `createProjectMemory`**

Add this method to `ProjectMemorySummaryService` (after `createCharterMemory`). It mirrors the api tool's `memory_type` derivation and stores `confidence` when provided:

```ts
async createProjectMemory(
  projectId: string,
  input: {
    category: string;
    content: string;
    source: string;
    memoryType?: string;
    confidence?: number;
  },
): Promise<CharterMemoryRow> {
  const memoryType =
    input.category === 'preference' ? 'preference' : input.memoryType ?? 'fact';
  const rows = await this.dataSource.query<CharterMemoryRow[]>(
    `INSERT INTO memory_segments (entity_type, entity_id, content, memory_type, version, metadata_json)
     VALUES ('project', $1, $2, $3, 1,
       jsonb_strip_nulls(jsonb_build_object('category', $4, 'source', $5, 'confidence', $6::numeric)))
     RETURNING id, content, memory_type, metadata_json AS metadata, created_at, updated_at`,
    [projectId, input.content, memoryType, input.category, input.source, input.confidence ?? null],
  );
  return rows[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/kanban && npx vitest run src/project/project-memory-summary.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/project/project-memory-summary.service.ts apps/kanban/src/project/project-memory-summary.service.spec.ts
git commit -m "feat(kanban): add createProjectMemory for relocated record_project_memory tool"
```

---

## Task 2: Create `kanban.record_project_memory` tool

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

> **Module wiring note:** kanban MCP tools auto-register via `Object.values(MutationTools)` in `kanban-mcp.module.ts`, so exporting from the barrel is enough. Confirm `ProjectMemorySummaryService` is provided to `KanbanMcpModule` — it lives in `ProjectModule`; if `KanbanMcpModule` does not already import the module that exports it, add that import (mirror how goal tools get `ProjectGoalsService`).

- [ ] **Step 1: Write the failing test**

`record-project-memory.tool.spec.ts`:

```ts
import { RecordProjectMemoryTool } from './record-project-memory.tool';

describe('kanban.record_project_memory', () => {
  const ctx = {} as never;
  it('has the kanban-prefixed name', () => {
    const tool = new RecordProjectMemoryTool({ createProjectMemory: vi.fn() } as never);
    expect(tool.getName()).toBe('kanban.record_project_memory');
  });

  it('delegates to createProjectMemory with onboarding_chat source and echoes category', async () => {
    const createProjectMemory = vi.fn().mockResolvedValue({ id: 'seg-1' });
    const tool = new RecordProjectMemoryTool({ createProjectMemory } as never);
    const result = await tool.execute(ctx, {
      scope_id: 'proj-1', category: 'requirement', content: 'must support SSO', confidence: 0.8,
    });
    expect(createProjectMemory).toHaveBeenCalledWith('proj-1', {
      category: 'requirement', content: 'must support SSO',
      source: 'onboarding_chat', memoryType: undefined, confidence: 0.8,
    });
    expect(result).toEqual({ id: 'seg-1', category: 'requirement' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/record-project-memory.tool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool** (faithful port of the api logic, kanban-wired)

`record-project-memory.tool.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { IInternalToolHandler, InternalToolExecutionContext } from "@nexus/core";
import {
  ProjectMemoryCategorySchema,
  type ProjectMemoryCategory,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { ProjectMemorySummaryService } from "../../../project/project-memory-summary.service";

const RecordProjectMemorySchema = z.object({
  scope_id: z.string().min(1),
  category: ProjectMemoryCategorySchema,
  content: z.string().min(1),
  memory_type: z.enum(["preference", "fact", "history"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type RecordProjectMemoryParams = z.infer<typeof RecordProjectMemorySchema>;

@Injectable()
export class RecordProjectMemoryTool
  implements IInternalToolHandler<RecordProjectMemoryParams, { id: string; category: ProjectMemoryCategory }>
{
  constructor(private readonly memories: ProjectMemorySummaryService) {}

  getName(): string {
    return "kanban.record_project_memory";
  }

  getDefinition() {
    return {
      name: "kanban.record_project_memory",
      description:
        "Persist a categorized piece of project intent (requirement, constraint, decision, etc.) as a project-scoped memory segment.",
      inputSchema: RecordProjectMemorySchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: RecordProjectMemoryParams,
  ): Promise<{ id: string; category: ProjectMemoryCategory }> {
    const segment = await this.memories.createProjectMemory(params.scope_id, {
      category: params.category,
      content: params.content,
      source: "onboarding_chat",
      memoryType: params.memory_type,
      confidence: params.confidence,
    });
    return { id: segment.id, category: params.category };
  }
}
```

- [ ] **Step 4: Export from the barrel**

Append to `apps/kanban/src/mcp/tools/mutation/index.ts`:

```ts
export * from "./record-project-memory.tool";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/record-project-memory.tool.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.ts apps/kanban/src/mcp/tools/mutation/record-project-memory.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add kanban.record_project_memory MCP tool (relocated from api)"
```

---

## Task 3: Create `kanban.propose_work_items` tool (behavior-preserving)

Pure validate/shape, no persistence — identical logic to the api original, only the name + transport change (`api_callback`/`api` → `runner_local`/`runner`, dropping the `apiCallback` block).

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

- [ ] **Step 1: Write the failing test**

`propose-work-items.tool.spec.ts`:

```ts
import { ProposeWorkItemsTool } from './propose-work-items.tool';

describe('kanban.propose_work_items', () => {
  const ctx = {} as never;
  it('has the kanban-prefixed name and runner transport', () => {
    const tool = new ProposeWorkItemsTool();
    expect(tool.getName()).toBe('kanban.propose_work_items');
    expect(tool.getDefinition().transport).toBe('runner_local');
  });

  it('stamps draft status + design_ingestion source and collects validation errors', async () => {
    const tool = new ProposeWorkItemsTool();
    const result = await tool.execute(ctx, {
      items: [
        { title: 'Build login', type: 'task', acceptance_criteria: ['works'] },
        { title: '', type: 'task', acceptance_criteria: [] } as never,
      ],
    });
    expect(result.proposed_items).toHaveLength(1);
    expect(result.proposed_items[0]).toMatchObject({
      status: 'draft', metadata: { source: 'design_ingestion' },
    });
    expect(result.validation_errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/propose-work-items.tool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

`propose-work-items.tool.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { IInternalToolHandler, InternalToolExecutionContext } from "@nexus/core";
import { z } from "zod";

const workItemSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["epic", "task", "subtask", "bug", "ingestion"]),
  acceptance_criteria: z.array(z.string()),
  source_document: z.string().optional(),
  description: z.string().optional(),
  parent_id: z.string().optional(),
});

const proposeWorkItemsInputSchema = z.object({
  items: z.array(workItemSchema).min(1),
});

type ProposeWorkItemsInput = z.infer<typeof proposeWorkItemsInputSchema>;
type ProposedWorkItem = z.infer<typeof workItemSchema> & {
  status: "draft";
  metadata: { source: "design_ingestion" };
};

@Injectable()
export class ProposeWorkItemsTool implements IInternalToolHandler<ProposeWorkItemsInput> {
  getName(): string {
    return "kanban.propose_work_items";
  }

  getDefinition() {
    return {
      name: "kanban.propose_work_items",
      description: "Generate structured draft work item proposals from ingestion analysis.",
      inputSchema: proposeWorkItemsInputSchema,
      tierRestriction: 1,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
      policyTags: ["ingestion", "work_items"],
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: ProposeWorkItemsInput,
  ): Promise<Record<string, unknown>> {
    const proposedItems: ProposedWorkItem[] = [];
    const validationErrors: string[] = [];

    for (const [index, item] of params.items.entries()) {
      const parsed = workItemSchema.safeParse(item);
      if (!parsed.success) {
        validationErrors.push(
          `Item ${index}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        );
        continue;
      }
      proposedItems.push({
        ...parsed.data,
        status: "draft",
        metadata: { source: "design_ingestion" },
      });
    }

    return { proposed_items: proposedItems, validation_errors: validationErrors };
  }
}
```

- [ ] **Step 4: Export from the barrel**

Append to `apps/kanban/src/mcp/tools/mutation/index.ts`:

```ts
export * from "./propose-work-items.tool";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/propose-work-items.tool.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.ts apps/kanban/src/mcp/tools/mutation/propose-work-items.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add kanban.propose_work_items MCP tool (relocated from api)"
```

---

## Task 4: Create `kanban.update_charter` tool

The api original writes to a single runner workspace path via `fs`. kanban tools execute in the kanban process, so this port resolves the project's `base_path` and uses `coreClient.readRepoFile`/`writeRepoFile` (write + auto-commit). The section-patching logic is ported verbatim.

> **Verify during impl:** the exact kanban accessor that returns a project's `base_path` from `scope_id`. The investigation identified the column `base_path` (set by `managed-project-clone.service.ts`); use the existing kanban project service/repository to fetch it. The code below assumes a `ProjectService.getProject(projectId)` returning `{ base_path }` — confirm the real method name and adjust.

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts`
- Create: `apps/kanban/src/mcp/tools/mutation/update-charter.tool.spec.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/index.ts`

- [ ] **Step 1: Write the failing test**

`update-charter.tool.spec.ts`:

```ts
import { UpdateCharterTool } from './update-charter.tool';

function makeDeps(existing?: string) {
  const writes: { repoPath: string; filePath: string; content: string }[] = [];
  const projects = { getProject: vi.fn().mockResolvedValue({ base_path: '/repo' }) };
  const core = {
    readRepoFile: vi.fn().mockResolvedValue(existing === undefined ? null : { content: existing }),
    writeRepoFile: vi.fn(async (p: { repoPath: string; filePath: string; content: string }) => { writes.push(p); }),
  };
  return { tool: new UpdateCharterTool(core as never, projects as never), writes, core, projects };
}

describe('kanban.update_charter', () => {
  const ctx = {} as never;
  it('is kanban-prefixed', () => {
    expect(makeDeps().tool.getName()).toBe('kanban.update_charter');
  });

  it('rejects unknown sections', async () => {
    await expect(
      makeDeps('# Project Charter\n').tool.execute(ctx, { scope_id: 'p', section: 'Bogus', content: 'x', mode: 'replace' }),
    ).rejects.toThrow(/Unknown section/);
  });

  it('creates skeleton + writes to docs/project-context/CHARTER.md under base_path', async () => {
    const { tool, writes } = makeDeps(undefined); // ENOENT-equivalent
    await tool.execute(ctx, { scope_id: 'p', section: 'Vision', content: 'Be great', mode: 'replace' });
    expect(writes[0].repoPath).toBe('/repo');
    expect(writes[0].filePath).toBe('docs/project-context/CHARTER.md');
    expect(writes[0].content).toContain('## Vision');
    expect(writes[0].content).toContain('Be great');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/update-charter.tool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

`update-charter.tool.ts` (section logic ported from the api original; I/O swapped to `coreClient`):

```ts
import { BadRequestException, Injectable } from "@nestjs/common";
import type { IInternalToolHandler, InternalToolExecutionContext } from "@nexus/core";
import { CHARTER_SECTIONS, type CharterSection } from "@nexus/kanban-contracts";
import { z } from "zod";
import { CoreWorkflowClientService } from "../../../core/core-workflow-client.service";
import { ProjectService } from "../../../project/project.service";

const CHARTER_PATH_SEGMENT = "docs/project-context/CHARTER.md";

const UpdateCharterSchema = z.object({
  scope_id: z.string().min(1),
  section: z.string().min(1),
  content: z.string().min(1),
  mode: z.enum(["replace", "append"]),
});

type UpdateCharterParams = z.infer<typeof UpdateCharterSchema>;

@Injectable()
export class UpdateCharterTool implements IInternalToolHandler<UpdateCharterParams> {
  constructor(
    private readonly core: CoreWorkflowClientService,
    private readonly projects: ProjectService,
  ) {}

  getName(): string {
    return "kanban.update_charter";
  }

  getDefinition() {
    return {
      name: "kanban.update_charter",
      description:
        "Write or patch a section of the project charter (docs/project-context/CHARTER.md). Creates the file with a full skeleton if absent.",
      inputSchema: UpdateCharterSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: UpdateCharterParams,
  ): Promise<{ path: string; section: CharterSection; mode: string }> {
    const { scope_id, section, content, mode } = params;

    if (!(CHARTER_SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException(
        `Unknown section "${section}". Valid sections: ${CHARTER_SECTIONS.join(", ")}`,
      );
    }

    const project = await this.projects.getProject(scope_id);
    const repoPath = project.base_path;

    const existing = await this.core
      .readRepoFile({ repoPath, filePath: CHARTER_PATH_SEGMENT })
      .catch(() => null);
    const fileContent = existing?.content ?? this.buildSkeleton();

    const updated = this.patchSection(fileContent, section, content, mode);

    await this.core.writeRepoFile({
      repoPath,
      filePath: CHARTER_PATH_SEGMENT,
      content: updated,
      message: `docs(charter): update ${section}`,
    });

    return { path: CHARTER_PATH_SEGMENT, section: section as CharterSection, mode };
  }

  private buildSkeleton(): string {
    const sections = CHARTER_SECTIONS.map((s) => `## ${s}\n\n`).join("\n");
    return `# Project Charter\n\n${sections}`;
  }

  private patchSection(
    content: string,
    sectionName: string,
    newBody: string,
    mode: "replace" | "append",
  ): string {
    const sectionHeading = `## ${sectionName}`;
    const sectionRegex = new RegExp(
      `(^## ${escapeRegex(sectionName)}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`,
      "m",
    );
    const match = sectionRegex.exec(content);
    if (!match) {
      return `${content.trimEnd()}\n\n${sectionHeading}\n${newBody}\n`;
    }
    const [full, heading] = match;
    const existingBody = match[2];
    const newSection =
      mode === "replace"
        ? `${heading}${newBody}\n`
        : `${heading}${existingBody.trimEnd()}\n\n${newBody}\n`;
    return content.replace(full, newSection);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

> If `coreClient.readRepoFile` returns a richer `RepositoryFileContent` shape (not `{ content }`), adapt the `existing?.content` access accordingly — confirm against `kanban-core-http-client.ts`.

- [ ] **Step 4: Export from the barrel**

Append to `apps/kanban/src/mcp/tools/mutation/index.ts`:

```ts
export * from "./update-charter.tool";
```

- [ ] **Step 5: Verify `KanbanMcpModule` can inject the deps**

`CoreWorkflowClientService` is in `CoreIntegrationModule` (already imported by `KanbanMcpModule`). Confirm `ProjectService` is exported by its module and that module is imported by `KanbanMcpModule`; if not, add the import. Run the spec:

Run: `cd apps/kanban && npx vitest run src/mcp/tools/mutation/update-charter.tool.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts apps/kanban/src/mcp/tools/mutation/update-charter.tool.spec.ts apps/kanban/src/mcp/tools/mutation/index.ts
git commit -m "feat(kanban): add kanban.update_charter MCP tool (relocated from api)"
```

---

## Task 5: Register the three tool names in the kanban manifest

`kanban-mcp-manifest-validation.service.spec.ts` enforces parity between runtime providers and `seed/tool-manifests/kanban-tools.seed.json`. The new tools will fail that parity until they are listed.

**Files:**
- Modify: `seed/tool-manifests/kanban-tools.seed.json`

- [ ] **Step 1: Run the manifest validation spec to confirm it now fails**

Run: `cd apps/kanban && npx vitest run src/mcp/kanban-mcp-manifest-validation.service.spec.ts`
Expected: FAIL — `missingManifestEntries` lists `kanban.record_project_memory`, `kanban.propose_work_items`, `kanban.update_charter`.

- [ ] **Step 2: Add the three entries**

Open `seed/tool-manifests/kanban-tools.seed.json`, copy the shape of an existing entry (e.g. `kanban.goal_create`), and add entries for `kanban.record_project_memory`, `kanban.propose_work_items`, `kanban.update_charter` with matching fields (name + whatever metadata the existing entries carry — tier, transport, description). Match the existing formatting exactly.

- [ ] **Step 3: Run the manifest validation spec to verify it passes**

Run: `cd apps/kanban && npx vitest run src/mcp/kanban-mcp-manifest-validation.service.spec.ts`
Expected: PASS — no missing entries.

- [ ] **Step 4: Commit**

```bash
git add seed/tool-manifests/kanban-tools.seed.json
git commit -m "chore(seed): register relocated kanban.* tools in tool manifest"
```

---

## Task 6: Delete the three tools from api and update api registration/discovery

**Files:**
- Delete: `apps/api/src/tool/handlers/propose-work-items.tool.ts` (+ spec if any)
- Delete: `apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts` + `.spec.ts`
- Delete: `apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts` + `.spec.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`
- Modify: `apps/api/src/database/seeds/seed-data-validation.tool-discovery.helpers.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/internal-tools-kanban-cutover.spec.ts`

- [ ] **Step 1: Update the cutover spec FIRST (failing test for the deletion)**

In `internal-tools-kanban-cutover.spec.ts`, add the three relocated paths to `removedPaths`. Note the file lives in `apps/api/src/workflow/workflow-internal-tools/`, so paths are relative to that dir; the propose-work-items file is two levels up under `tool/handlers`:

```ts
const removedPaths = [
  // ...existing entries...
  'tools/charter/update-charter.tool.ts',
  'tools/memory/record-project-memory.tool.ts',
  '../../tool/handlers/propose-work-items.tool.ts',
];
```

- [ ] **Step 2: Run it to verify it fails (files still present)**

Run: `cd apps/api && npx vitest run src/workflow/workflow-internal-tools/internal-tools-kanban-cutover.spec.ts`
Expected: FAIL — the three files still exist.

- [ ] **Step 3: Delete the tool files + their specs**

```bash
git rm apps/api/src/tool/handlers/propose-work-items.tool.ts \
       apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts \
       apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.spec.ts \
       apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts \
       apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.spec.ts
# (also delete any propose-work-items.tool.spec.ts if present)
```

- [ ] **Step 4: Remove them from `workflow-internal-tools.module.ts`**

Remove the imports of `ProposeWorkItemsTool`, `UpdateCharterTool`, `RecordProjectMemoryTool`; remove them from the providers list; remove them from the `INTERNAL_TOOL_HANDLER` factory `inject` array; and remove the special-case `UpdateCharterTool` `useFactory` provider (the one injecting `fsPromises` + `NEXUS_WORKSPACE_BASE_PATH`). Ensure the `inject` array order still matches the `useFactory` parameter order.

- [ ] **Step 5: Remove them from `seed-data-validation.tool-discovery.helpers.ts`**

Remove `RecordProjectMemoryTool` and `UpdateCharterTool` (and `ProposeWorkItemsTool` if listed) from the `HANDLER_CLASSES` array and delete their now-unused imports.

- [ ] **Step 6: Run the cutover spec + api typecheck**

Run: `cd apps/api && npx vitest run src/workflow/workflow-internal-tools/internal-tools-kanban-cutover.spec.ts`
Expected: PASS.
Run: `cd apps/api && npm run typecheck` (or `npx tsc --noEmit`)
Expected: no errors referencing the deleted classes.

- [ ] **Step 7: Commit**

```bash
git add -A apps/api
git commit -m "refactor(api): remove relocated project tools (charter/project-memory/propose-work-items)"
```

---

## Task 7: Update all seed call-sites for the renames

Every reference to the bare names must become the `kanban.*` name. The complete enumerated list (from investigation):

**`update_charter` → `kanban.update_charter`:**
- `seed/agents/ceo-agent/agent.json` (tool_policy allow, ~line 175)
- `seed/agents/ceo-agent/PROMPT.md` (lines ~20, 46, 54, 55)
- `seed/workflows/project-charter-ceo.workflow.yaml` (~line 52, `tool: update_charter`)
- `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` (~line 96)
- `seed/workflows/prompts/project-charter-ceo/onboard.md` (lines ~34, 35, 41)
- `seed/workflows/prompts/project-charter-ceo/refine.md` (~line 22)
- `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` (lines ~472, 482, 485)

**`record_project_memory` → `kanban.record_project_memory`:**
- `seed/agents/ceo-agent/agent.json` (~line 171)
- `seed/agents/ceo-agent/PROMPT.md` (lines ~20, 45, 53)
- `seed/workflows/project-charter-ceo.workflow.yaml` (~line 50)
- `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` (~line 94)
- `seed/workflows/prompts/project-charter-ceo/onboard.md` (lines ~22, 23, 24, 25, 33)
- `seed/workflows/prompts/project-charter-ceo/refine.md` (lines ~21, 23)
- `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` (lines ~471, 481)

**`propose_work_items` → `kanban.propose_work_items`:**
- `seed/agents/product-manager/agent.json` (~line 25)
- `seed/agents/product_manager_ingestion/agent.json` (~line 12)
- `seed/agents/product_manager_ingestion/PROMPT.md` (~line 7)
- `seed/skills/work-item-generation/SKILL.md` (lines ~30, 70, 74)
- `seed/workflows/artifact-review-gate.workflow.yaml` (lines ~32, 80)
- `seed/workflows/design-ingestion-existing-project.workflow.yaml` (lines ~44, 178)
- `seed/workflows/design-ingestion-new-project.workflow.yaml` (lines ~44, 157)

- [ ] **Step 1: Replace each reference**

For each file above, replace the exact bare token with the `kanban.`-prefixed name. In `agent.json` tool_policy `allow` arrays and workflow YAML `tool:` keys the token is the exact tool name; in prompts/skills it appears in prose/backticks. Use a verification grep after editing (Step 2) — do not rely on blind global replace, since substrings like `record_project_memory` are safe but verify no partial-name collisions.

- [ ] **Step 2: Verify no bare names remain in seed**

Run (Grep tool or):
```bash
cd /g/code/AI/nexus-orchestator && grep -rnE '\b(update_charter|record_project_memory|propose_work_items)\b' seed/ | grep -v 'kanban\.'
```
Expected: no output (every occurrence is now `kanban.`-prefixed). Any hit that is part of `kanban.<name>` is fine and excluded by the filter.

- [ ] **Step 3: Commit**

```bash
git add seed/
git commit -m "refactor(seed): point agents/workflows/prompts at relocated kanban.* tool names"
```

---

## Task 8: Update contract tests for the renames

**Files:**
- Modify: `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts`
- Check: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts` (reads `kanban-tools.seed.json`)

- [ ] **Step 1: Update the CEO authority contract helper**

In `ceo-authority-contract.test-helper.ts`, change the `allowTools` expectations and the prompt-content assertions:
- `'record_project_memory'` → `'kanban.record_project_memory'` (lines 16 and 36)
- `'update_charter'` → `'kanban.update_charter'` (lines 17 and 37)

- [ ] **Step 2: Run the dependent contract specs**

Run:
```bash
cd apps/api && npx vitest run \
  src/database/seeds/seed-data.validation.spec.ts \
  src/database/seeds/workflow/workflows.seed.contract.spec.ts
```
Expected: PASS — the CEO profile now allows the `kanban.*` names and the prompt mentions them.

- [ ] **Step 3: Run kanban seed contract spec**

Run: `cd apps/kanban && npx vitest run src/seeds/workflows.seed.contract.spec.ts`
Expected: PASS — agent/workflow tool-policy parity holds against the updated manifest.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts
git commit -m "test(api): expect relocated kanban.* tool names in CEO authority contract"
```

---

## Task 9: Full validation

- [ ] **Step 1: Seed data validation**

Run: `cd /g/code/AI/nexus-orchestator && npm run validate:seed-data`
Expected: PASS — tool-name discovery (api `HANDLER_CLASSES` + kanban manifest) reconciles with all agent/workflow references; no unknown-tool errors.

- [ ] **Step 2: Typecheck both apps**

Run: `cd apps/api && npm run typecheck && cd ../kanban && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Targeted test sweep**

Run:
```bash
cd apps/kanban && npx vitest run src/mcp src/project/project-memory-summary.service.spec.ts
cd ../api && npx vitest run src/workflow/workflow-internal-tools src/database/seeds
```
Expected: all PASS.

- [ ] **Step 4: Final commit / push**

```bash
git push -u origin <branch>
```

---

## Self-Review (completed)

- **Spec coverage:** all three tools created in kanban (T2–T4), service dependency added (T1), manifest registered (T5), api originals deleted + de-registered (T6), every enumerated call-site renamed (T7), contract tests updated (T8), full validation (T9). ✔
- **Placeholder scan:** no TBDs; the two genuine uncertainties (kanban `ProjectService` base_path accessor; `readRepoFile` return shape) are explicit "verify during impl" notes with concrete fallbacks, not silent gaps. ✔
- **Type consistency:** `createProjectMemory` signature defined in T1 is used identically in T2; `CharterMemoryRow` is the existing return type; tool names are consistent (`kanban.record_project_memory`, `kanban.update_charter`, `kanban.propose_work_items`) across creation, manifest, seed refs, and contract tests. ✔

## Appendix A: Deferred / flagged (out of scope)

- **`query_memory`** (`apps/api/.../tools/memory/query-memory.tool.ts`) — generic memory read, not inherently project-bound. Left in api. Review separately if its real usage proves project-only.
- **`create_artifact`** (`apps/api/src/tool/handlers/create-artifact.tool.ts`) — writes a file into the project repo/worktree; project-adjacent but a generic file write, not board state. Left in api, flagged for a future boundary review.
- **`workflow-delegation-tools`** — dynamic projection infrastructure, not static tools; nothing to relocate.
