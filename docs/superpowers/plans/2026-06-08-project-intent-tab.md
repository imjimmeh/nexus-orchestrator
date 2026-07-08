# Project Intent Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Goals tab with a two-column "Project Intent" tab showing structured goals alongside charter category memories, fix the broken Refine Charter button, and add four REST endpoints for charter memory CRUD.

**Architecture:** `ProjectMemorySummaryService` is extended with charter-specific raw SQL methods (using `entity_type = 'project'` — the same value written by the agent tools). Four endpoints are added to `ProjectController`. The frontend gains a `useCharterMemories` hook and three new components; `ProjectIntentTab` wraps the existing `GoalsTab` alongside the new `CharterColumn`.

**Tech Stack:** TypeScript, NestJS, Vitest, React, TanStack Query, Tailwind/shadcn, sonner (toasts)

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Modify | `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx` | Button fix + lazy-import swap + tab label |
| Modify | `apps/kanban/src/project/project-memory-summary.service.ts` | Add 4 charter CRUD methods |
| Modify | `apps/kanban/src/project/project.controller.ts` | Add 4 charter endpoints |
| Modify | `apps/kanban/src/project/project.controller.spec.ts` | Tests for 4 new endpoints |
| Modify | `apps/web/src/lib/api/client.projects.ts` | Add 4 charter API methods + types |
| Create | `apps/web/src/hooks/useCharterMemories.ts` | React Query hook + mutations |
| Create | `apps/web/src/pages/project-workspace/CharterCategorySection.tsx` | Per-category accordion |
| Create | `apps/web/src/pages/project-workspace/CharterColumn.tsx` | Full right-hand column |
| Create | `apps/web/src/pages/project-workspace/ProjectIntentTab.tsx` | Two-column wrapper |

---

## Task 1: Fix the Refine Charter Button

**Files:**
- Modify: `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`

- [ ] **Step 1: Update the handler at line 194**

Replace lines 194–196 in `ProjectWorkspace.tsx`:

```tsx
onRefineCharter={async () => {
  try {
    await api.launchCharterOnboarding(projectId, 'refine');
    toast.success('Charter refinement started', 'The CEO agent will walk you through updating the project charter.');
    setSearchParams({ tab: 'sessions' }, { replace: true });
  } catch {
    toast.error('Failed to start charter refinement', 'Check the sessions tab for details.');
  }
}}
```

Add the `toast` import at the top of the file (it uses `sonner`):

```tsx
import { toast } from 'sonner';
```

- [ ] **Step 2: Verify type-check passes**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep ProjectWorkspace
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/project-workspace/ProjectWorkspace.tsx
git commit -m "fix(onboarding): refine charter button now toasts and navigates to sessions tab"
```

---

## Task 2: Add Charter CRUD Methods to ProjectMemorySummaryService

**Files:**
- Modify: `apps/kanban/src/project/project-memory-summary.service.ts`

> **Important:** The `record_project_memory` agent tool writes with `entity_type = 'project'`. All charter queries here use `'project'`, not the `'kanban.project'` used by the summary methods above.

- [ ] **Step 1: Add the `CharterMemoryRow` type and four methods**

Append to `project-memory-summary.service.ts` (before the closing `}`):

```typescript
export interface CharterMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// -- Charter memory CRUD (entity_type = 'project', category stored in metadata) --

async getCharterMemories(projectId: string): Promise<CharterMemoryRow[]> {
  try {
    const rows = await this.dataSource.query<CharterMemoryRow[]>(
      `SELECT id, content, memory_type, metadata, created_at, updated_at
       FROM memory_segments
       WHERE entity_type = 'project'
         AND entity_id = $1
         AND metadata IS NOT NULL
         AND metadata->>'category' IS NOT NULL
       ORDER BY created_at ASC`,
      [projectId],
    );
    return rows;
  } catch (error) {
    if (isMissingMemoryTableError(error)) return [];
    throw error;
  }
}

async createCharterMemory(
  projectId: string,
  category: string,
  content: string,
  memoryType: string,
): Promise<CharterMemoryRow> {
  const rows = await this.dataSource.query<CharterMemoryRow[]>(
    `INSERT INTO memory_segments (entity_type, entity_id, content, memory_type, version, metadata)
     VALUES ('project', $1, $2, $3, 1, jsonb_build_object('category', $4, 'source', 'user_edit'))
     RETURNING id, content, memory_type, metadata, created_at, updated_at`,
    [projectId, content, memoryType, category],
  );
  return rows[0];
}

async updateCharterMemory(
  memoryId: string,
  projectId: string,
  content: string,
): Promise<CharterMemoryRow | null> {
  const rows = await this.dataSource.query<CharterMemoryRow[]>(
    `UPDATE memory_segments
     SET content = $1, updated_at = NOW()
     WHERE id = $2 AND entity_type = 'project' AND entity_id = $3
     RETURNING id, content, memory_type, metadata, created_at, updated_at`,
    [content, memoryId, projectId],
  );
  return rows[0] ?? null;
}

async deleteCharterMemory(memoryId: string, projectId: string): Promise<boolean> {
  const result = await this.dataSource.query<{ count: string }[]>(
    `DELETE FROM memory_segments
     WHERE id = $1 AND entity_type = 'project' AND entity_id = $2
     RETURNING id`,
    [memoryId, projectId],
  );
  return result.length > 0;
}
```

- [ ] **Step 2: Type-check the service**

```bash
npx tsc --noEmit -p apps/kanban/tsconfig.json 2>&1 | grep project-memory-summary
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/kanban/src/project/project-memory-summary.service.ts
git commit -m "feat(onboarding): add charter CRUD methods to ProjectMemorySummaryService"
```

---

## Task 3: Charter Memory Endpoints on ProjectController (TDD)

**Files:**
- Modify: `apps/kanban/src/project/project.controller.ts`
- Modify: `apps/kanban/src/project/project.controller.spec.ts`

### Step 1 — Write the failing tests

- [ ] Add the following test block to `project.controller.spec.ts`, inside the existing `describe('ProjectController', ...)` block:

```typescript
describe('charter memories', () => {
  it('GET :project_id/charter-memories returns grouped memories', async () => {
    const rows = [
      { id: 'm1', content: 'Must have SSO', memory_type: 'fact', metadata: { category: 'requirement', source: 'user_edit' }, created_at: '', updated_at: '' },
      { id: 'm2', content: 'No IE11', memory_type: 'fact', metadata: { category: 'constraint', source: 'user_edit' }, created_at: '', updated_at: '' },
    ];
    const getMock = vi.fn().mockResolvedValue(rows);
    const controller = createController({ projectMemorySummary: { getCharterMemories: getMock } });

    const response = await controller.getCharterMemories('p1');

    expect(getMock).toHaveBeenCalledWith('p1');
    expect(response).toEqual({
      success: true,
      data: {
        requirement: [rows[0]],
        constraint: [rows[1]],
      },
    });
  });

  it('POST :project_id/charter-memories creates a memory', async () => {
    const created = { id: 'm3', content: 'Must support SSO', memory_type: 'fact', metadata: { category: 'requirement', source: 'user_edit' }, created_at: '', updated_at: '' };
    const createMock = vi.fn().mockResolvedValue(created);
    const controller = createController({ projectMemorySummary: { createCharterMemory: createMock } });

    const response = await controller.createCharterMemory('p1', { category: 'requirement', content: 'Must support SSO' });

    expect(createMock).toHaveBeenCalledWith('p1', 'requirement', 'Must support SSO', 'fact');
    expect(response).toEqual({ success: true, data: created });
  });

  it('POST :project_id/charter-memories rejects unknown category', async () => {
    const controller = createController({ projectMemorySummary: { createCharterMemory: vi.fn() } });
    await expect(
      controller.createCharterMemory('p1', { category: 'bogus', content: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PATCH :project_id/charter-memories/:memoryId updates content', async () => {
    const updated = { id: 'm1', content: 'Updated', memory_type: 'fact', metadata: { category: 'requirement', source: 'user_edit' }, created_at: '', updated_at: '' };
    const updateMock = vi.fn().mockResolvedValue(updated);
    const controller = createController({ projectMemorySummary: { updateCharterMemory: updateMock } });

    const response = await controller.updateCharterMemory('p1', 'm1', { content: 'Updated' });

    expect(updateMock).toHaveBeenCalledWith('m1', 'p1', 'Updated');
    expect(response).toEqual({ success: true, data: updated });
  });

  it('PATCH :project_id/charter-memories/:memoryId throws 404 when not found', async () => {
    const controller = createController({ projectMemorySummary: { updateCharterMemory: vi.fn().mockResolvedValue(null) } });
    await expect(
      controller.updateCharterMemory('p1', 'missing', { content: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('DELETE :project_id/charter-memories/:memoryId deletes the memory', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    const controller = createController({ projectMemorySummary: { deleteCharterMemory: deleteMock } });

    const response = await controller.deleteCharterMemory('p1', 'm1');

    expect(deleteMock).toHaveBeenCalledWith('m1', 'p1');
    expect(response).toEqual({ success: true });
  });

  it('DELETE :project_id/charter-memories/:memoryId throws 404 when not found', async () => {
    const controller = createController({ projectMemorySummary: { deleteCharterMemory: vi.fn().mockResolvedValue(false) } });
    await expect(
      controller.deleteCharterMemory('p1', 'missing'),
    ).rejects.toThrow(NotFoundException);
  });
});
```

Add `NotFoundException` to the existing import at line 1:

```typescript
import { BadRequestException, NotFoundException } from "@nestjs/common";
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test --workspace=apps/kanban -- project.controller
```

Expected: fails with "controller.getCharterMemories is not a function" (or similar).

- [ ] **Step 3: Add the four endpoints to `project.controller.ts`**

Add the following imports to `project.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ProjectMemoryCategorySchema, PROJECT_MEMORY_CATEGORIES } from '@nexus/kanban-contracts';
```

Add the four methods inside `ProjectController`:

```typescript
@Get(':project_id/charter-memories')
async getCharterMemories(@Param('project_id') project_id: string) {
  const rows = await this.projectMemorySummary.getCharterMemories(project_id);
  const grouped: Partial<Record<string, typeof rows>> = {};
  for (const row of rows) {
    const category = (row.metadata as { category?: string }).category;
    if (category) {
      grouped[category] ??= [];
      grouped[category]!.push(row);
    }
  }
  return { success: true, data: grouped };
}

@Post(':project_id/charter-memories')
async createCharterMemory(
  @Param('project_id') project_id: string,
  @Body() body: { category: string; content: string },
) {
  const parsed = ProjectMemoryCategorySchema.safeParse(body.category);
  if (!parsed.success) {
    throw new BadRequestException(
      `Unknown category "${body.category}". Must be one of: ${PROJECT_MEMORY_CATEGORIES.join(', ')}.`,
    );
  }
  const memoryType = parsed.data === 'preference' ? 'preference' : 'fact';
  const data = await this.projectMemorySummary.createCharterMemory(
    project_id,
    parsed.data,
    body.content,
    memoryType,
  );
  return { success: true, data };
}

@Patch(':project_id/charter-memories/:memory_id')
async updateCharterMemory(
  @Param('project_id') project_id: string,
  @Param('memory_id') memory_id: string,
  @Body() body: { content: string },
) {
  const data = await this.projectMemorySummary.updateCharterMemory(memory_id, project_id, body.content);
  if (!data) throw new NotFoundException(`Charter memory ${memory_id} not found`);
  return { success: true, data };
}

@Delete(':project_id/charter-memories/:memory_id')
async deleteCharterMemory(
  @Param('project_id') project_id: string,
  @Param('memory_id') memory_id: string,
) {
  const deleted = await this.projectMemorySummary.deleteCharterMemory(memory_id, project_id);
  if (!deleted) throw new NotFoundException(`Charter memory ${memory_id} not found`);
  return { success: true };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test --workspace=apps/kanban -- project.controller
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/project/project.controller.ts apps/kanban/src/project/project.controller.spec.ts
git commit -m "feat(onboarding): add charter memory CRUD endpoints to ProjectController"
```

---

## Task 4: Frontend API Client Methods + Types

**Files:**
- Modify: `apps/web/src/lib/api/client.projects.ts`

- [ ] **Step 1: Add the `CharterMemoryItem` type and `CharterMemoriesByCategory` type**

Find the top of `client.projects.ts` where other interfaces are declared, and add:

```typescript
export interface CharterMemoryItem {
  id: string;
  content: string;
  memory_type: string;
  metadata: {
    category: string;
    source: string;
    confidence?: number;
  };
  created_at: string;
  updated_at: string;
}

export type CharterMemoriesByCategory = Partial<Record<string, CharterMemoryItem[]>>;
```

- [ ] **Step 2: Add four API methods**

After `launchCharterOnboarding` (around line 277), add:

```typescript
async getCharterMemories(projectId: string): Promise<CharterMemoriesByCategory> {
  return this.get<CharterMemoriesByCategory>(`/projects/${projectId}/charter-memories`);
},

async createCharterMemory(
  projectId: string,
  data: { category: string; content: string },
): Promise<CharterMemoryItem> {
  return this.post<CharterMemoryItem>(`/projects/${projectId}/charter-memories`, data);
},

async updateCharterMemory(
  projectId: string,
  memoryId: string,
  data: { content: string },
): Promise<CharterMemoryItem> {
  return this.patch<CharterMemoryItem>(
    `/projects/${projectId}/charter-memories/${memoryId}`,
    data,
  );
},

async deleteCharterMemory(projectId: string, memoryId: string): Promise<void> {
  return this.delete(`/projects/${projectId}/charter-memories/${memoryId}`);
},
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep client.projects
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/client.projects.ts
git commit -m "feat(onboarding): add charter memory API client methods"
```

---

## Task 5: `useCharterMemories` React Query Hook

**Files:**
- Create: `apps/web/src/hooks/useCharterMemories.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CharterMemoryItem, CharterMemoriesByCategory } from '@/lib/api/client.projects';

const charterMemoriesKey = (projectId: string) => ['charter-memories', projectId] as const;

export function useCharterMemories(projectId: string) {
  return useQuery({
    queryKey: charterMemoriesKey(projectId),
    queryFn: () => api.getCharterMemories(projectId),
  });
}

export function useCreateCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { category: string; content: string }) =>
      api.createCharterMemory(projectId, data),
    onMutate: async (newItem) => {
      await queryClient.cancelQueries({ queryKey: charterMemoriesKey(projectId) });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId));
      queryClient.setQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId), (old = {}) => {
        const optimistic: CharterMemoryItem = {
          id: `optimistic-${Date.now()}`,
          content: newItem.content,
          memory_type: 'fact',
          metadata: { category: newItem.category, source: 'user_edit' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return {
          ...old,
          [newItem.category]: [...(old[newItem.category] ?? []), optimistic],
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(charterMemoriesKey(projectId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: charterMemoriesKey(projectId) });
    },
  });
}

export function useUpdateCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memoryId, content }: { memoryId: string; content: string }) =>
      api.updateCharterMemory(projectId, memoryId, { content }),
    onMutate: async ({ memoryId, content }) => {
      await queryClient.cancelQueries({ queryKey: charterMemoriesKey(projectId) });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId));
      queryClient.setQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId), (old = {}) => {
        const updated: CharterMemoriesByCategory = {};
        for (const [cat, items] of Object.entries(old)) {
          updated[cat] = items?.map((item) =>
            item.id === memoryId ? { ...item, content } : item,
          );
        }
        return updated;
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(charterMemoriesKey(projectId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: charterMemoriesKey(projectId) });
    },
  });
}

export function useDeleteCharterMemory(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memoryId: string) => api.deleteCharterMemory(projectId, memoryId),
    onMutate: async (memoryId) => {
      await queryClient.cancelQueries({ queryKey: charterMemoriesKey(projectId) });
      const previous = queryClient.getQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId));
      queryClient.setQueryData<CharterMemoriesByCategory>(charterMemoriesKey(projectId), (old = {}) => {
        const updated: CharterMemoriesByCategory = {};
        for (const [cat, items] of Object.entries(old)) {
          updated[cat] = items?.filter((item) => item.id !== memoryId);
        }
        return updated;
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(charterMemoriesKey(projectId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: charterMemoriesKey(projectId) });
    },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep useCharterMemories
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useCharterMemories.ts
git commit -m "feat(onboarding): add useCharterMemories React Query hook"
```

---

## Task 6: `CharterCategorySection` Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/CharterCategorySection.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CharterMemoryItem } from '@/lib/api/client.projects';

interface CharterCategorySectionProps {
  readonly label: string;
  readonly category: string;
  readonly items: CharterMemoryItem[];
  readonly onAdd: (content: string) => void;
  readonly onUpdate: (memoryId: string, content: string) => void;
  readonly onDelete: (memoryId: string) => void;
}

export function CharterCategorySection({
  label,
  category,
  items,
  onAdd,
  onUpdate,
  onDelete,
}: Readonly<CharterCategorySectionProps>) {
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [newContent, setNewContent] = useState('');

  const startEdit = (item: CharterMemoryItem) => {
    setEditingId(item.id);
    setEditContent(item.content);
  };

  const commitEdit = () => {
    if (editingId && editContent.trim()) {
      onUpdate(editingId, editContent.trim());
    }
    setEditingId(null);
    setEditContent('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const commitAdd = () => {
    if (newContent.trim()) {
      onAdd(newContent.trim());
    }
    setAdding(false);
    setNewContent('');
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewContent('');
  };

  return (
    <div className="border rounded-md">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{items.length}</span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          {items.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground py-1">None yet</p>
          )}

          {items.map((item) =>
            editingId === item.id ? (
              <div key={item.id} className="flex gap-2 items-start">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="text-sm min-h-[60px] flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" onClick={commitEdit} aria-label="Save">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={cancelEdit} aria-label="Cancel">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div key={item.id} className="flex items-start justify-between group gap-2">
                <p
                  className="text-sm flex-1 cursor-pointer hover:text-foreground text-muted-foreground"
                  onClick={() => startEdit(item)}
                >
                  {item.content}
                </p>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => startEdit(item)}
                    aria-label={`Edit ${category} item`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => onDelete(item.id)}
                    aria-label={`Delete ${category} item`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ),
          )}

          {adding ? (
            <div className="flex gap-2 items-start">
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={`Add a ${label.toLowerCase()} item…`}
                className="text-sm min-h-[60px] flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitAdd(); }
                  if (e.key === 'Escape') cancelAdd();
                }}
              />
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={commitAdd} aria-label="Save new item">
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={cancelAdd} aria-label="Cancel">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground text-xs h-7"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add item
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep CharterCategorySection
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/project-workspace/CharterCategorySection.tsx
git commit -m "feat(onboarding): add CharterCategorySection accordion component"
```

---

## Task 7: `CharterColumn` Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/CharterColumn.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { toast } from 'sonner';
import { CharterCategorySection } from './CharterCategorySection';
import {
  useCharterMemories,
  useCreateCharterMemory,
  useUpdateCharterMemory,
  useDeleteCharterMemory,
} from '@/hooks/useCharterMemories';
import { Button } from '@/components/ui/button';

const CATEGORY_LABELS: Record<string, string> = {
  requirement: 'Requirements',
  constraint: 'Constraints',
  do_dont: "Dos & Don'ts",
  non_goal: 'Non-Goals',
  decision: 'Decisions',
  preference: 'Preferences',
  glossary: 'Glossary',
  stakeholder: 'Stakeholders',
  open_question: 'Open Questions',
};

const CATEGORY_ORDER = [
  'requirement',
  'non_goal',
  'constraint',
  'do_dont',
  'decision',
  'preference',
  'stakeholder',
  'glossary',
  'open_question',
] as const;

interface CharterColumnProps {
  readonly projectId: string;
  readonly onLaunchRefine: () => void;
}

export function CharterColumn({ projectId, onLaunchRefine }: Readonly<CharterColumnProps>) {
  const { data: memoriesByCategory, isLoading, isError } = useCharterMemories(projectId);
  const createMutation = useCreateCharterMemory(projectId);
  const updateMutation = useUpdateCharterMemory(projectId);
  const deleteMutation = useDeleteCharterMemory(projectId);

  const hasAnyMemories = memoriesByCategory
    ? Object.values(memoriesByCategory).some((items) => (items?.length ?? 0) > 0)
    : false;

  const handleAdd = (category: string) => (content: string) => {
    createMutation.mutate(
      { category, content },
      { onError: () => toast.error('Failed to add item') },
    );
  };

  const handleUpdate = (memoryId: string, content: string) => {
    updateMutation.mutate(
      { memoryId, content },
      { onError: () => toast.error('Failed to update item') },
    );
  };

  const handleDelete = (memoryId: string) => {
    deleteMutation.mutate(memoryId, {
      onError: () => toast.error('Failed to delete item'),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Failed to load charter data.</p>
    );
  }

  if (!hasAnyMemories) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground max-w-xs">
          No charter captured yet. Use &ldquo;Refine Charter&rdquo; to start a conversation with
          the CEO agent, or add items manually below.
        </p>
        <Button variant="outline" size="sm" onClick={onLaunchRefine}>
          Refine Charter
        </Button>
        <div className="w-full mt-4 space-y-2">
          {CATEGORY_ORDER.map((category) => (
            <CharterCategorySection
              key={category}
              label={CATEGORY_LABELS[category] ?? category}
              category={category}
              items={memoriesByCategory?.[category] ?? []}
              onAdd={handleAdd(category)}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {CATEGORY_ORDER.map((category) => (
        <CharterCategorySection
          key={category}
          label={CATEGORY_LABELS[category] ?? category}
          category={category}
          items={memoriesByCategory?.[category] ?? []}
          onAdd={handleAdd(category)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep CharterColumn
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/project-workspace/CharterColumn.tsx
git commit -m "feat(onboarding): add CharterColumn component"
```

---

## Task 8: `ProjectIntentTab` Component

**Files:**
- Create: `apps/web/src/pages/project-workspace/ProjectIntentTab.tsx`

This component wraps the existing `GoalsTab` (imported directly, not lazy — the lazy boundary is the `Suspense` in `ProjectWorkspace`) alongside the new `CharterColumn`.

- [ ] **Step 1: Create the component**

```tsx
import { GoalsTab } from './GoalsTab';
import { CharterColumn } from './CharterColumn';

interface ProjectIntentTabProps {
  readonly projectId: string;
  readonly onLaunchRefine: () => void;
}

export function ProjectIntentTab({ projectId, onLaunchRefine }: Readonly<ProjectIntentTabProps>) {
  return (
    <div className="flex gap-6 items-start pt-4">
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold mb-3">Goals</h3>
        <GoalsTab projectId={projectId} />
      </div>
      <div className="w-80 shrink-0">
        <h3 className="text-lg font-semibold mb-3">Charter</h3>
        <CharterColumn projectId={projectId} onLaunchRefine={onLaunchRefine} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep ProjectIntentTab
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/project-workspace/ProjectIntentTab.tsx
git commit -m "feat(onboarding): add ProjectIntentTab two-column component"
```

---

## Task 9: Wire `ProjectIntentTab` into `ProjectWorkspace`

**Files:**
- Modify: `apps/web/src/pages/project-workspace/ProjectWorkspace.tsx`

This task makes the tab visible to users. It does four things: adds the lazy import, updates the tab label, updates the tab content, and passes `onLaunchRefine` down.

- [ ] **Step 1: Replace the `GoalsTab` lazy import with `ProjectIntentTab`**

Replace lines 42–45 in `ProjectWorkspace.tsx`:

```tsx
const ProjectIntentTab = lazy(async () => {
  const loadedModule = await import('./ProjectIntentTab');
  return { default: loadedModule.ProjectIntentTab };
});
```

Remove the old `GoalsTab` lazy import (lines 42–45 with `GoalsTab`).

- [ ] **Step 2: Update the tab trigger label**

Find:
```tsx
<TabsTrigger value="goals">Goals</TabsTrigger>
```

Replace with:
```tsx
<TabsTrigger value="goals">Project Intent</TabsTrigger>
```

- [ ] **Step 3: Update the tab content**

Find:
```tsx
<TabsContent value="goals">
  <Suspense fallback={<TabContentFallback />}>
    <GoalsTab projectId={projectId} />
  </Suspense>
</TabsContent>
```

Replace with:
```tsx
<TabsContent value="goals">
  <Suspense fallback={<TabContentFallback />}>
    <ProjectIntentTab
      projectId={projectId}
      onLaunchRefine={async () => {
        try {
          await api.launchCharterOnboarding(projectId, 'refine');
          toast.success('Charter refinement started');
          setSearchParams({ tab: 'sessions' }, { replace: true });
        } catch {
          toast.error('Failed to start charter refinement');
        }
      }}
    />
  </Suspense>
</TabsContent>
```

- [ ] **Step 4: Type-check the full web app**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/ProjectWorkspace.tsx
git commit -m "feat(onboarding): wire ProjectIntentTab into workspace, rename Goals tab"
```

---

## Task 10: Full Validation

- [ ] **Step 1: Run kanban tests**

```bash
npm run test --workspace=apps/kanban -- project
```

Expected: all pass.

- [ ] **Step 2: Run web type-check**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Run all workspace tests**

```bash
npm run test --workspace=apps/kanban
npm run test --workspace=apps/api
npm run test --workspace=packages/kanban-contracts
```

Expected: all pass.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Expected End State

- "Refine Charter" button toasts on success/failure and navigates to Sessions tab.
- "Goals" tab is relabelled "Project Intent" and shows a two-column layout.
- Left column: existing goals CRUD (unchanged logic).
- Right column: charter categories (Requirements, Constraints, etc.) with inline add/edit/delete.
- Charter data is loaded from the `memory_segments` table (`entity_type = 'project'`) — the same rows written by the CEO onboarding workflow.
- Empty state prompts the user to start a Refine Charter conversation.
- All tests pass; no TypeScript errors.
