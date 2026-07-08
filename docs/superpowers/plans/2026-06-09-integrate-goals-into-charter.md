# Integrate Goals into the Charter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project goals a structured *section of one unified Project Charter* — DB as the single source of truth, `CHARTER.md` a generated always-fresh export — replacing the disconnected two-column Goals|Charter UI and the triple-storage of goals.

**Architecture:** All charter data lives in kanban (board goals + categorized `memory_segments`). A `CharterDocRenderService` renders `CHARTER.md` from that data; a debounced `charter-regen` BullMQ queue regenerates and commits it on any charter mutation (write+commit via the existing `coreClient.writeRepoFile`). The web reads a new `GET /projects/:id/charter` aggregate. The agent stops writing the file entirely (the relocated `kanban.update_charter` is deleted); it only writes goals + categorized memories.

**Tech Stack:** NestJS, BullMQ, TypeScript, Zod, `@nexus/kanban-contracts`, React + TanStack Query, Vitest.

**Design doc:** `docs/superpowers/specs/2026-06-09-integrate-goals-into-charter-design.md`

**PREREQUISITE — must land first:** `docs/superpowers/plans/2026-06-09-relocate-kanban-tooling-api-to-kanban.md` (epic `kanban-1ip`). That moves `update_charter`/`record_project_memory` into kanban. This plan assumes those tools are kanban-side, so all charter writes originate in kanban and regeneration is fully in-process.

---

## File Structure

**Modify (contracts):**
- `packages/kanban-contracts/src/project-charter.schema.ts` — add categories, reorder sections, add `CHARTER_SECTION_TO_CATEGORY`

**Create (kanban):**
- `apps/kanban/src/project/charter-doc-render.service.ts` (+ spec) — render `CHARTER.md` from goals + memories
- `apps/kanban/src/project/charter-regen.queue.ts` — queue name const
- `apps/kanban/src/project/charter-regen.enqueuer.ts` (+ spec) — debounced enqueue
- `apps/kanban/src/project/charter-regen.processor.ts` (+ spec) — render + write+commit
- `apps/kanban/src/project/charter-aggregate.service.ts` (+ spec) — compose the read aggregate

**Modify (kanban):**
- `apps/kanban/src/goals/project-goals.service.ts` — enqueue regen on mutations
- `apps/kanban/src/project/project-memory-summary.service.ts` — enqueue regen on charter-memory mutations
- `apps/kanban/src/project/project.controller.ts` — `GET :project_id/charter`
- `apps/kanban/src/project/project.module.ts` (or owning module) — register queue + new providers
- `apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts` — **delete** (+ barrel, manifest)

**Modify (api/seed):**
- `seed/agents/ceo-agent/agent.json` — drop `kanban.update_charter`
- `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts` — drop `kanban.update_charter`
- `seed/workflows/prompts/project-charter-ceo/{onboard,brownfield-onboard,refine}.md`, `seed/agents/ceo-agent/PROMPT.md`, `seed/workflows/prompts/project-discovery-ceo/discovery.md`

**Modify (web):**
- `apps/web/src/pages/project-workspace/ProjectIntentTab.tsx` — single sectioned document
- `apps/web/src/pages/project-workspace/CharterDocument.tsx` (new) — unified renderer
- `apps/web/src/hooks/useCharter.ts` (new), `apps/web/src/lib/api/client.projects.ts` (+ `getCharter`)
- Delete `apps/web/src/pages/project-workspace/CharterColumn.tsx`
- `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx` — tab `value` fix

**Modify (docs):**
- `docs/architecture/project-charter.md`, `docs/architecture/conversational-project-onboarding.md`

---

## Task 1: Contracts — categories, section order, section↔category map

**Files:**
- Modify: `packages/kanban-contracts/src/project-charter.schema.ts`
- Test: `packages/kanban-contracts/src/project-charter.schema.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import {
  PROJECT_MEMORY_CATEGORIES, CHARTER_SECTIONS, CHARTER_SECTION_TO_CATEGORY,
} from './project-charter.schema';

describe('project-charter contracts', () => {
  it('includes vision and success_criteria categories', () => {
    expect(PROJECT_MEMORY_CATEGORIES).toContain('vision');
    expect(PROJECT_MEMORY_CATEGORIES).toContain('success_criteria');
  });
  it('orders sections canonically with Decisions and Preferences', () => {
    expect(CHARTER_SECTIONS).toEqual([
      'Vision','Goals','Requirements','Constraints',"Dos & Don'ts",
      'Non-Goals','Success Criteria','Decisions','Preferences',
      'Glossary','Stakeholders','Open Questions',
    ]);
  });
  it('maps every memory category to exactly one section (Goals is the only non-memory section)', () => {
    const mapped = Object.values(CHARTER_SECTION_TO_CATEGORY).filter(Boolean);
    for (const cat of PROJECT_MEMORY_CATEGORIES) expect(mapped).toContain(cat);
    expect(CHARTER_SECTION_TO_CATEGORY['Goals']).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/kanban-contracts && npx vitest run src/project-charter.schema.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the top of `project-charter.schema.ts`:

```ts
import { z } from "zod";

export const PROJECT_MEMORY_CATEGORIES = [
  "vision", "requirement", "constraint", "do_dont", "non_goal",
  "success_criteria", "decision", "preference", "glossary",
  "stakeholder", "open_question",
] as const;

export type ProjectMemoryCategory = (typeof PROJECT_MEMORY_CATEGORIES)[number];
export const ProjectMemoryCategorySchema = z.enum(PROJECT_MEMORY_CATEGORIES);

export const CHARTER_SECTIONS = [
  "Vision", "Goals", "Requirements", "Constraints", "Dos & Don'ts",
  "Non-Goals", "Success Criteria", "Decisions", "Preferences",
  "Glossary", "Stakeholders", "Open Questions",
] as const;
export type CharterSection = (typeof CHARTER_SECTIONS)[number];

// Single source of truth: section → memory category. 'Goals' is the only
// non-memory section (rendered from board goals), so it maps to null.
export const CHARTER_SECTION_TO_CATEGORY: Record<CharterSection, ProjectMemoryCategory | null> = {
  "Vision": "vision",
  "Goals": null,
  "Requirements": "requirement",
  "Constraints": "constraint",
  "Dos & Don'ts": "do_dont",
  "Non-Goals": "non_goal",
  "Success Criteria": "success_criteria",
  "Decisions": "decision",
  "Preferences": "preference",
  "Glossary": "glossary",
  "Stakeholders": "stakeholder",
  "Open Questions": "open_question",
};
```

Keep the existing `ProjectMemoryProvenanceSchema` block below unchanged.

- [ ] **Step 4: Run to verify it passes; rebuild the package**

Run: `cd packages/kanban-contracts && npx vitest run src/project-charter.schema.spec.ts && npm run build`
Expected: PASS + build emits new types for consumers.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-contracts/src/project-charter.schema.ts packages/kanban-contracts/src/project-charter.schema.spec.ts
git commit -m "feat(contracts): add vision/success_criteria categories + section→category map"
```

---

## Task 2: CharterDocRenderService (kanban)

Renders the full `CHARTER.md` markdown from board goals + categorized memories, in canonical section order, using the contracts map. Goals section is rendered from board goals; all other sections from memories.

**Files:**
- Create: `apps/kanban/src/project/charter-doc-render.service.ts`
- Create: `apps/kanban/src/project/charter-doc-render.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { CharterDocRenderService } from './charter-doc-render.service';

const goals = { listGoals: vi.fn() };
const memories = { getCharterMemories: vi.fn() };
const svc = new CharterDocRenderService(goals as never, memories as never);

describe('CharterDocRenderService', () => {
  it('renders Goals from board goals and sections from memories in canonical order', async () => {
    goals.listGoals.mockResolvedValue([
      { title: 'Ship MVP', status: 'in_progress', moscow: 'must', priority: 'p0', description: 'launch' },
    ]);
    memories.getCharterMemories.mockResolvedValue([
      { id: '1', content: 'Be the best', memory_type: 'fact', metadata: { category: 'vision' }, created_at: '', updated_at: '' },
      { id: '2', content: 'Support SSO', memory_type: 'fact', metadata: { category: 'requirement' }, created_at: '', updated_at: '' },
    ]);
    const md = await svc.render('proj-1');
    expect(md).toContain('# Project Charter');
    expect(md.indexOf('## Vision')).toBeLessThan(md.indexOf('## Goals'));
    expect(md.indexOf('## Goals')).toBeLessThan(md.indexOf('## Requirements'));
    expect(md).toContain('Be the best');
    expect(md).toContain('Ship MVP');
    expect(md).toContain('Support SSO');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/kanban && npx vitest run src/project/charter-doc-render.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from "@nestjs/common";
import { CHARTER_SECTIONS, CHARTER_SECTION_TO_CATEGORY } from "@nexus/kanban-contracts";
import { ProjectGoalsService } from "../goals/project-goals.service";
import { ProjectMemorySummaryService, type CharterMemoryRow } from "./project-memory-summary.service";

@Injectable()
export class CharterDocRenderService {
  constructor(
    private readonly goals: ProjectGoalsService,
    private readonly memories: ProjectMemorySummaryService,
  ) {}

  async render(projectId: string): Promise<string> {
    const [goals, memories] = await Promise.all([
      this.goals.listGoals(projectId, false),
      this.memories.getCharterMemories(projectId),
    ]);
    const byCategory = new Map<string, CharterMemoryRow[]>();
    for (const m of memories) {
      const cat = String(m.metadata?.category ?? "");
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(m);
    }

    const parts: string[] = ["# Project Charter\n"];
    for (const section of CHARTER_SECTIONS) {
      parts.push(`## ${section}\n`);
      const category = CHARTER_SECTION_TO_CATEGORY[section];
      if (category === null) {
        // Goals — render from board goals
        if (goals.length === 0) { parts.push("_No goals defined._\n"); continue; }
        for (const g of goals) {
          const tags = [g.status, g.moscow, g.priority].filter(Boolean).join(", ");
          parts.push(`- **${g.title}**${tags ? ` _(${tags})_` : ""}${g.description ? ` — ${g.description}` : ""}`);
        }
        parts.push("");
      } else {
        const items = byCategory.get(category) ?? [];
        if (items.length === 0) { parts.push("_None captured._\n"); continue; }
        for (const item of items) parts.push(`- ${item.content}`);
        parts.push("");
      }
    }
    return parts.join("\n");
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/kanban && npx vitest run src/project/charter-doc-render.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/project/charter-doc-render.service.ts apps/kanban/src/project/charter-doc-render.service.spec.ts
git commit -m "feat(kanban): CharterDocRenderService renders CHARTER.md from goals+memories"
```

---

## Task 3: charter-regen queue + processor (write + commit)

**Files:**
- Create: `apps/kanban/src/project/charter-regen.queue.ts`
- Create: `apps/kanban/src/project/charter-regen.processor.ts`
- Create: `apps/kanban/src/project/charter-regen.processor.spec.ts`
- Modify: the owning module (register the BullMQ queue + providers)

- [ ] **Step 1: Queue name const**

`charter-regen.queue.ts`:
```ts
export const CHARTER_REGEN_QUEUE = "charter-regen";
export interface CharterRegenJob { projectId: string; }
```

- [ ] **Step 2: Write the failing processor test**

`charter-regen.processor.spec.ts`:
```ts
import { CharterRegenProcessor } from './charter-regen.processor';

describe('CharterRegenProcessor', () => {
  it('renders and writes+commits CHARTER.md under the project base_path', async () => {
    const render = { render: vi.fn().mockResolvedValue('# Project Charter\n') };
    const projects = { getProject: vi.fn().mockResolvedValue({ base_path: '/repo' }) };
    const core = { writeRepoFile: vi.fn().mockResolvedValue(undefined) };
    const p = new CharterRegenProcessor(render as never, projects as never, core as never);
    await p.process({ data: { projectId: 'proj-1' } } as never);
    expect(core.writeRepoFile).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo', filePath: 'docs/project-context/CHARTER.md',
    }));
  });

  it('skips quietly when project has no base_path', async () => {
    const render = { render: vi.fn() };
    const projects = { getProject: vi.fn().mockResolvedValue({ base_path: null }) };
    const core = { writeRepoFile: vi.fn() };
    const p = new CharterRegenProcessor(render as never, projects as never, core as never);
    await p.process({ data: { projectId: 'p' } } as never);
    expect(core.writeRepoFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/kanban && npx vitest run src/project/charter-regen.processor.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the processor**

`charter-regen.processor.ts` (mirror existing kanban `@Processor` consumers; verify exact import — `@nestjs/bullmq`):
```ts
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectService } from "./project.service";
import { CharterDocRenderService } from "./charter-doc-render.service";
import { CHARTER_REGEN_QUEUE, type CharterRegenJob } from "./charter-regen.queue";

const CHARTER_PATH = "docs/project-context/CHARTER.md";

@Processor(CHARTER_REGEN_QUEUE)
export class CharterRegenProcessor extends WorkerHost {
  private readonly logger = new Logger(CharterRegenProcessor.name);
  constructor(
    private readonly render: CharterDocRenderService,
    private readonly projects: ProjectService,
    private readonly core: CoreWorkflowClientService,
  ) { super(); }

  async process(job: Job<CharterRegenJob>): Promise<void> {
    const { projectId } = job.data;
    const project = await this.projects.getProject(projectId).catch(() => null);
    if (!project?.base_path) { this.logger.warn(`charter-regen skipped: no base_path for ${projectId}`); return; }
    const content = await this.render.render(projectId);
    await this.core.writeRepoFile({
      repoPath: project.base_path,
      filePath: CHARTER_PATH,
      content,
      message: "docs(charter): regenerate from project intent",
    });
  }
}
```

> Confirm `WorkerHost`/`@Processor` is the pattern used by existing kanban processors (e.g. external-sync). If the repo uses the standalone-worker pattern instead, mirror that. Confirm `ProjectService.getProject` returns `base_path` (same accessor as relocation Task 4).

- [ ] **Step 5: Register the queue + providers**

In the owning module (where `ProjectGoalsService`/`ProjectMemorySummaryService` are provided), add `BullModule.registerQueue({ name: CHARTER_REGEN_QUEUE })` and add `CharterDocRenderService`, `CharterRegenProcessor`, `CharterRegenEnqueuer` (Task 4) to providers. Ensure `CoreWorkflowClientService` and `ProjectService` are importable there.

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/kanban && npx vitest run src/project/charter-regen.processor.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/project/charter-regen.queue.ts apps/kanban/src/project/charter-regen.processor.ts apps/kanban/src/project/charter-regen.processor.spec.ts apps/kanban/src/project/<owning-module>.ts
git commit -m "feat(kanban): charter-regen queue + processor (render, write, auto-commit)"
```

---

## Task 4: Debounced enqueuer + wire mutation triggers

**Files:**
- Create: `apps/kanban/src/project/charter-regen.enqueuer.ts` (+ spec)
- Modify: `apps/kanban/src/goals/project-goals.service.ts`
- Modify: `apps/kanban/src/project/project-memory-summary.service.ts`

- [ ] **Step 1: Write the failing enqueuer test**

`charter-regen.enqueuer.spec.ts`:
```ts
import { CharterRegenEnqueuer } from './charter-regen.enqueuer';

describe('CharterRegenEnqueuer', () => {
  it('enqueues a debounced job keyed by project (stable jobId collapses bursts)', async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const e = new CharterRegenEnqueuer(queue as never);
    await e.enqueue('proj-1');
    expect(queue.add).toHaveBeenCalledWith(
      'regen',
      { projectId: 'proj-1' },
      expect.objectContaining({ jobId: 'charter-regen:proj-1' }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/kanban && npx vitest run src/project/charter-regen.enqueuer.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the enqueuer**

```ts
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { CHARTER_REGEN_QUEUE } from "./charter-regen.queue";

const DEBOUNCE_MS = 2000;

@Injectable()
export class CharterRegenEnqueuer {
  private readonly logger = new Logger(CharterRegenEnqueuer.name);
  constructor(@InjectQueue(CHARTER_REGEN_QUEUE) private readonly queue: Queue) {}

  async enqueue(projectId: string): Promise<void> {
    try {
      await this.queue.add(
        "regen",
        { projectId },
        { jobId: `charter-regen:${projectId}`, delay: DEBOUNCE_MS, removeOnComplete: true, removeOnFail: 100 },
      );
    } catch (error) {
      this.logger.warn(`Failed to enqueue charter regen for ${projectId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

> The stable `jobId` makes BullMQ reject a duplicate while one is pending, collapsing a burst into one regen. If the installed BullMQ version replaces (not rejects) delayed duplicates, that is also acceptable (trailing-edge debounce). Do not throw — charter regen is best-effort.

- [ ] **Step 4: Write failing trigger tests + wire calls**

Add a test asserting `ProjectGoalsService.createGoal` calls `enqueuer.enqueue(projectId)` (inject a mock enqueuer). Then inject `CharterRegenEnqueuer` into `ProjectGoalsService` and call `await this.charterRegen.enqueue(project_id)` at the end of: `createGoal`, `updateGoal`, `updateStatus`, `setArchived`, `reorderGoals`. Do the same in `ProjectMemorySummaryService` for `createProjectMemory`, `createCharterMemory`, `updateCharterMemory`, `deleteCharterMemory`.

Example wiring in `ProjectGoalsService.createGoal`:
```ts
async createGoal(project_id: string, input: CreateProjectGoalRequest): Promise<ProjectGoal> {
  const goal = await this.goals.create(project_id, input);
  await this.charterRegen.enqueue(project_id);
  return this.toRecord(goal);
}
```

> Constructor change: add `private readonly charterRegen: CharterRegenEnqueuer`. Ensure the owning module provides it. `ProjectMemorySummaryService` currently takes only `DataSource` — add the enqueuer dependency and update its provider/specs (the Task 1 relocation spec constructs it with one arg; update that construction to pass a stub enqueuer).

- [ ] **Step 5: Run the touched specs**

Run: `cd apps/kanban && npx vitest run src/project/charter-regen.enqueuer.spec.ts src/goals src/project/project-memory-summary.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/project/charter-regen.enqueuer.ts apps/kanban/src/project/charter-regen.enqueuer.spec.ts apps/kanban/src/goals/project-goals.service.ts apps/kanban/src/project/project-memory-summary.service.ts
git commit -m "feat(kanban): enqueue debounced charter regen on goal/memory mutations"
```

---

## Task 5: Unified read aggregate — GET /projects/:id/charter

**Files:**
- Create: `apps/kanban/src/project/charter-aggregate.service.ts` (+ spec)
- Modify: `apps/kanban/src/project/project.controller.ts`

- [ ] **Step 1: Write the failing service test**

`charter-aggregate.service.spec.ts`:
```ts
import { CharterAggregateService } from './charter-aggregate.service';

it('returns vision, goals, and sections keyed by category', async () => {
  const goals = { listGoals: vi.fn().mockResolvedValue([{ id: 'g1', title: 'Ship' }]) };
  const memories = { getCharterMemories: vi.fn().mockResolvedValue([
    { id: 'm1', content: 'Be great', metadata: { category: 'vision' } },
    { id: 'm2', content: 'SSO', metadata: { category: 'requirement' } },
  ]) };
  const svc = new CharterAggregateService(goals as never, memories as never);
  const result = await svc.getCharter('p');
  expect(result.vision?.content).toBe('Be great');
  expect(result.goals).toHaveLength(1);
  expect(result.sections.requirement).toHaveLength(1);
  expect(result.sections.vision).toBeUndefined(); // vision surfaced separately
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/kanban && npx vitest run src/project/charter-aggregate.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from "@nestjs/common";
import { ProjectGoalsService } from "../goals/project-goals.service";
import { ProjectMemorySummaryService, type CharterMemoryRow } from "./project-memory-summary.service";

@Injectable()
export class CharterAggregateService {
  constructor(
    private readonly goals: ProjectGoalsService,
    private readonly memories: ProjectMemorySummaryService,
  ) {}

  async getCharter(projectId: string) {
    const [goals, memories] = await Promise.all([
      this.goals.listGoals(projectId, false),
      this.memories.getCharterMemories(projectId),
    ]);
    const sections: Record<string, CharterMemoryRow[]> = {};
    let vision: CharterMemoryRow | null = null;
    for (const m of memories) {
      const cat = String(m.metadata?.category ?? "");
      if (cat === "vision") { vision = vision ?? m; continue; }
      (sections[cat] ??= []).push(m);
    }
    return { vision, goals, sections };
  }
}
```

- [ ] **Step 4: Add the controller endpoint**

In `project.controller.ts`, inject `CharterAggregateService` and add (mirror the existing `{ success, data }` envelope + `goals:read` permission used by charter-memories):
```ts
@Get(":project_id/charter")
@RequirePermission("goals:read")
async getCharter(@Param("project_id") projectId: string) {
  return { success: true, data: await this.charterAggregate.getCharter(projectId) };
}
```

- [ ] **Step 5: Run service spec + typecheck**

Run: `cd apps/kanban && npx vitest run src/project/charter-aggregate.service.spec.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/project/charter-aggregate.service.ts apps/kanban/src/project/charter-aggregate.service.spec.ts apps/kanban/src/project/project.controller.ts apps/kanban/src/project/<owning-module>.ts
git commit -m "feat(kanban): GET /projects/:id/charter unified read aggregate"
```

---

## Task 6: Remove kanban.update_charter (agent stops writing the file)

With auto-regeneration live, the manual section-write tool is obsolete.

**Files:**
- Delete: `apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts` (+ spec); remove from barrel + `kanban-tools.seed.json`
- Modify: `seed/agents/ceo-agent/agent.json` (drop `kanban.update_charter`)
- Modify: `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts` (drop `kanban.update_charter` expectations)

- [ ] **Step 1: Delete the tool + deregister**

```bash
git rm apps/kanban/src/mcp/tools/mutation/update-charter.tool.ts apps/kanban/src/mcp/tools/mutation/update-charter.tool.spec.ts
```
Remove its `export *` line from `mutation/index.ts` and its entry from `seed/tool-manifests/kanban-tools.seed.json`.

- [ ] **Step 2: Drop from CEO profile + authority contract**

Remove `kanban.update_charter` from `seed/agents/ceo-agent/agent.json` tool_policy and from `ceo-authority-contract.test-helper.ts` (both the `allowTools` arrayContaining entry and the `prompt.toContain('...update_charter...')` assertion — replace with an assertion that the prompt does NOT instruct writing the charter file).

- [ ] **Step 3: Run validations**

Run:
```bash
cd apps/kanban && npx vitest run src/mcp/kanban-mcp-manifest-validation.service.spec.ts
cd ../api && npx vitest run src/database/seeds/seed-data.validation.spec.ts src/database/seeds/workflow/workflows.seed.contract.spec.ts
cd /g/code/AI/nexus-orchestator && npm run validate:seed-data
```
Expected: PASS — no dangling references to `kanban.update_charter`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove kanban.update_charter; charter doc is now generated"
```

---

## Task 7: Web — single sectioned charter document

**Files:**
- Modify: `apps/web/src/lib/api/client.projects.ts` (+ types), `apps/web/src/hooks/useCharter.ts` (new)
- Create: `apps/web/src/pages/project-workspace/CharterDocument.tsx`
- Modify: `apps/web/src/pages/project-workspace/ProjectIntentTab.tsx`
- Delete: `apps/web/src/pages/project-workspace/CharterColumn.tsx`
- Modify: `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`

- [ ] **Step 1: API client + hook**

Add to `client.projects.ts`:
```ts
async getCharter(projectId: string) {
  const res = await this.http.get(`/projects/${projectId}/charter`);
  return res.data.data as {
    vision: CharterMemoryItem | null;
    goals: ProjectGoal[];
    sections: Partial<Record<string, CharterMemoryItem[]>>;
  };
}
```
Create `useCharter.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
export function useCharter(projectId: string) {
  return useQuery({ queryKey: ['charter', projectId], queryFn: () => api.getCharter(projectId) });
}
```

- [ ] **Step 2: CharterDocument component**

Render one scrolling document ordered by `CHARTER_SECTIONS` (import from `@nexus/kanban-contracts`). For the `Goals` section, embed the existing goal UI from `GoalsTab.tsx` (extract the goals list/cards into a reusable `GoalsSection` if needed — do not duplicate logic). For each memory category section, reuse `CharterCategorySection` with the existing create/update/delete charter-memory hooks. Vision renders as a single-item section. Invalidate `['charter', projectId]` (and the goal/memory keys) on edits.

> This is the largest UI change. Keep `CharterCategorySection.tsx` and the goal components; only the container/layout and data source change. Order strictly by `CHARTER_SECTIONS`.

- [ ] **Step 3: Rewrite ProjectIntentTab + retire CharterColumn**

Replace `ProjectIntentTab.tsx` body with a single column rendering `<CharterDocument projectId={projectId} onLaunchRefine={onLaunchRefine} />`. Delete `CharterColumn.tsx` and update any import.

- [ ] **Step 4: Fix the legacy tab value**

In `ProjectWorkspace.tsx`, rename the tab `value="goals"` → `value="charter"` (update `TabsTrigger`, `TabsContent`, and any `setSearchParams`/`activeTab` references). Label stays "Project Intent".

- [ ] **Step 5: Typecheck + build web**

Run: `cd apps/web && npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): unified single-document Project Charter (goals as a section)"
```

---

## Task 8: Prompts + CEO persona

**Files:**
- Modify: `seed/workflows/prompts/project-charter-ceo/onboard.md`, `brownfield-onboard.md`, `refine.md`
- Modify: `seed/agents/ceo-agent/PROMPT.md`
- Modify: `seed/workflows/prompts/project-discovery-ceo/discovery.md`

- [ ] **Step 1: Edit the capture loop**

In the three charter prompts + `PROMPT.md`: remove every instruction to write the charter file (`update_charter` / `kanban.update_charter`) and the three-way split language. New loop = two stores:
- Goals → `kanban.goal_create` / `kanban.goal_update` / `kanban.goal_update_status` / `kanban.goal_add_note`
- Everything else, **including Vision and Success Criteria** → `kanban.record_project_memory` with the matching `category` (now incl. `vision`, `success_criteria`, `decision`, `preference`).
State that `CHARTER.md` is generated automatically and is not the agent's concern. Keep `refine.md`'s dedup guidance (check `kanban.goals` / `query_memory` before re-creating).

- [ ] **Step 2: Discovery prompt**

In `discovery.md`, keep reading `docs/project-context/CHARTER.md` + `query_memory` as ground truth; remove any wording implying the agent generates/maintains the file. Note it is always fresh.

- [ ] **Step 3: Validate seed**

Run: `cd /g/code/AI/nexus-orchestator && npm run validate:seed-data`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add seed/
git commit -m "docs(seed): charter capture writes goals+memories only; doc auto-generated"
```

---

## Task 9: Architecture docs + final validation

**Files:**
- Modify: `docs/architecture/project-charter.md`, `docs/architecture/conversational-project-onboarding.md`

- [ ] **Step 1: Update docs**

Document: charter = board goals + categorized memories (DB is truth); `CHARTER.md` generated/always-fresh via `charter-regen`; new categories + section order; the `GET /projects/:id/charter` aggregate; single-document UI. Remove references to `update_charter` as an agent tool.

- [ ] **Step 2: Full validation**

Run:
```bash
cd apps/kanban && npm run typecheck && npx vitest run src/project src/goals src/mcp
cd ../api && npm run typecheck && npx vitest run src/database/seeds
cd ../web && npm run typecheck && npm run build
cd /g/code/AI/nexus-orchestator && npm run validate:seed-data
```
Expected: all PASS.

- [ ] **Step 3: Commit + push**

```bash
git add docs/architecture
git commit -m "docs(charter): document unified DB-sourced charter + generated CHARTER.md"
git push
```

---

## Self-Review (completed)

- **Spec coverage:** §4.1 contracts (T1), §4.2 renderer (T2), §4.3 regen queue/triggers (T3,T4), §4.4 aggregate (T5), §4.5 remove update_charter (T6), §4.6 web (T7), §4.7 prompts (T8), §6 docs (T9). ✔
- **Placeholder scan:** the two genuine uncertainties (BullMQ processor pattern; `ProjectService.getProject` base_path accessor) are explicit verify-during-impl notes with concrete fallbacks. ✔
- **Type consistency:** `CharterDocRenderService` and `CharterAggregateService` both consume `ProjectGoalsService.listGoals` + `ProjectMemorySummaryService.getCharterMemories` returning `CharterMemoryRow`; `CHARTER_SECTIONS`/`CHARTER_SECTION_TO_CATEGORY` from T1 used in T2 and T7; `CHARTER_REGEN_QUEUE`/`CharterRegenJob` consistent across queue/enqueuer/processor. ✔
- **Dependency on relocation:** T6 deletes `kanban.update_charter`, which only exists after the relocation epic — encoded as a cross-epic dependency in beads. ✔
