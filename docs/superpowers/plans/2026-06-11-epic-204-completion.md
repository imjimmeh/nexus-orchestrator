# EPIC-204 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the half-wired EPIC-204 RBAC/scope feature so scope selection actually drives the UI and data, scope nodes have a real lifecycle, and the sidebar is collapsible — across four sequenced workstreams (A → B → C → D).

**Architecture:** Web is Vite + React + Tailwind with Zustand stores and TanStack Query. API is NestJS + TypeORM. Scope is a `scope_nodes` adjacency tree + closure table; RBAC is `role_assignments` (user×role×scope_node) resolved by `AuthorizationService`/`PermissionsGuard`, with scope-based row filtering via `ScopeAccessService.getAccessibleScopeIds`. The completion work threads the active scope from the web client through an HTTP header into existing guard/filtering machinery, gives `project` scope nodes a create/delete lifecycle, and restores a collapsible nav.

**Tech Stack:** React 18, Zustand (+ persist middleware), TanStack Query, react-router, Tailwind, lucide-react, Vitest + @testing-library/react (web); NestJS, TypeORM, Vitest (api).

**Specs:** `docs/superpowers/specs/2026-06-11-epic-204-completion-design.md` (umbrella), `docs/superpowers/specs/2026-06-11-collapsible-sidebar-design.md` (Workstream A).

---

## Plan fidelity & sequencing

- **Phase A** is **execution-ready** — every step has real code and exact commands.
- **Phases B, C, D** are **task-level**: exact files, services, approach, and test intent, grounded in the codebase investigation. Each begins with a **Design-lock task** to confirm the remaining forks, after which its tasks should be expanded into bite-sized TDD steps (re-run the writing-plans skill per phase, or expand inline). Code for B–D is written as sketches/templates, explicitly referencing the existing implementation each task mirrors. This is deliberate: those workstreams carry design decisions that should be locked against current code at execution time, not guessed now.
- **Dependencies:** A is independent. B is foundational. C depends on B. D depends on B. Do not start C/D filtering work before B's membership-filtered switcher and lifecycle land.

## Branch & commit strategy

- Work on branch `feat/epic-204-completion` (or a per-phase branch off it, e.g. `feat/collapsible-sidebar` for A).
- Commit after every green step in Phase A. For B–D, commit per task.
- Run quality gates before declaring a phase done: `npm run lint:web` / `npm run lint:api`, `npm run test:unit:web` / `npm run test:api`, and the relevant build.

---

# Phase A — Collapsible Sidebar (execution-ready)

**Outcome:** Wide labelled nav by default, toggleable to the icon rail, auto-railing when the scope panel opens, with the three orphaned sidebar files deleted.

**Run tests with:** `npm run test:unit:web -- <path>` (Vitest, from repo root) or `npm run test --workspace=apps/web -- <path>`.

### Task A1: `useNavSidebar` Zustand store

**Files:**

- Create: `apps/web/src/components/layout/useNavSidebar.ts`
- Test: `apps/web/src/components/layout/useNavSidebar.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/layout/useNavSidebar.spec.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useNavSidebar } from "./useNavSidebar";

describe("useNavSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useNavSidebar.setState({ isNavExpanded: true });
  });

  it("defaults to expanded", () => {
    expect(useNavSidebar.getState().isNavExpanded).toBe(true);
  });

  it("toggleNav flips the expanded state", () => {
    useNavSidebar.getState().toggleNav();
    expect(useNavSidebar.getState().isNavExpanded).toBe(false);
    useNavSidebar.getState().toggleNav();
    expect(useNavSidebar.getState().isNavExpanded).toBe(true);
  });

  it("setNavExpanded sets the value explicitly", () => {
    useNavSidebar.getState().setNavExpanded(false);
    expect(useNavSidebar.getState().isNavExpanded).toBe(false);
  });

  it("persists the preference to localStorage", () => {
    useNavSidebar.getState().setNavExpanded(false);
    expect(localStorage.getItem("nexus-nav-sidebar")).toContain(
      '"isNavExpanded":false',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- src/components/layout/useNavSidebar.spec.ts`
Expected: FAIL — cannot resolve `./useNavSidebar`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/components/layout/useNavSidebar.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface NavSidebarStore {
  isNavExpanded: boolean;
  toggleNav: () => void;
  setNavExpanded: (value: boolean) => void;
}

export const useNavSidebar = create<NavSidebarStore>()(
  persist(
    (set) => ({
      isNavExpanded: true,
      toggleNav: () =>
        set((state) => ({ isNavExpanded: !state.isNavExpanded })),
      setNavExpanded: (value) => set({ isNavExpanded: value }),
    }),
    {
      name: "nexus-nav-sidebar",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- src/components/layout/useNavSidebar.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/useNavSidebar.ts apps/web/src/components/layout/useNavSidebar.spec.ts
git commit -m "feat(web): add useNavSidebar store for collapsible sidebar"
```

### Task A2: `layout-offset` pure helper (shared by Sidebar + Layout)

**Files:**

- Create: `apps/web/src/components/layout/layout-offset.ts`
- Test: `apps/web/src/components/layout/layout-offset.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/layout/layout-offset.spec.ts
import { describe, expect, it } from "vitest";
import {
  getContentOffsetClass,
  getEffectiveNavExpanded,
} from "./layout-offset";

describe("getEffectiveNavExpanded", () => {
  it("is true only when expanded and panel closed", () => {
    expect(getEffectiveNavExpanded(true, false)).toBe(true);
    expect(getEffectiveNavExpanded(true, true)).toBe(false);
    expect(getEffectiveNavExpanded(false, false)).toBe(false);
  });
});

describe("getContentOffsetClass", () => {
  it("returns the panel offset when the scope panel is open", () => {
    expect(getContentOffsetClass(true, true)).toBe("pl-[288px]");
    expect(getContentOffsetClass(false, true)).toBe("pl-[288px]");
  });

  it("returns the wide offset when expanded and panel closed", () => {
    expect(getContentOffsetClass(true, false)).toBe("pl-64");
  });

  it("returns the rail offset when collapsed and panel closed", () => {
    expect(getContentOffsetClass(false, false)).toBe("pl-12");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- src/components/layout/layout-offset.spec.ts`
Expected: FAIL — cannot resolve `./layout-offset`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/components/layout/layout-offset.ts
const RAIL_OFFSET = "pl-12";
const WIDE_OFFSET = "pl-64";
const PANEL_OFFSET = "pl-[288px]"; // 48px rail + 240px scope panel

export function getEffectiveNavExpanded(
  isNavExpanded: boolean,
  isScopePanelOpen: boolean,
): boolean {
  return isNavExpanded && !isScopePanelOpen;
}

export function getContentOffsetClass(
  isNavExpanded: boolean,
  isScopePanelOpen: boolean,
): string {
  if (isScopePanelOpen) {
    return PANEL_OFFSET;
  }
  return getEffectiveNavExpanded(isNavExpanded, isScopePanelOpen)
    ? WIDE_OFFSET
    : RAIL_OFFSET;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- src/components/layout/layout-offset.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/layout-offset.ts apps/web/src/components/layout/layout-offset.spec.ts
git commit -m "feat(web): add layout-offset helper for sidebar/panel padding"
```

### Task A3: Delete orphaned sidebar code

**Files:**

- Delete: `apps/web/src/components/layout/useSidebarState.ts`
- Delete: `apps/web/src/components/layout/SidebarParts.tsx`
- Delete: `apps/web/src/components/layout/useFavoriteHotkeys.ts`

- [ ] **Step 1: Confirm the files are orphaned**

Run: `grep -rn "useSidebarState\|SidebarParts\|useFavoriteHotkeys" apps/web/src --include=*.ts --include=*.tsx | grep -v "useSidebarState.ts\|SidebarParts.tsx\|useFavoriteHotkeys.ts"`
Expected: no output (no live importers).

- [ ] **Step 2: Delete the files**

```bash
git rm apps/web/src/components/layout/useSidebarState.ts \
       apps/web/src/components/layout/SidebarParts.tsx \
       apps/web/src/components/layout/useFavoriteHotkeys.ts
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run build:web` (or the workspace typecheck: `npm run typecheck --workspace=apps/web` if defined)
Expected: builds without referencing the deleted files.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(web): delete orphaned sidebar favourites/recents dead code"
```

### Task A4: Trim `navigation.config.ts`

**Files:**

- Modify: `apps/web/src/components/layout/navigation.config.ts`

- [ ] **Step 1: Remove dead fields from the types and data**

Change the `NavItem` and `NavGroup` types and every entry so that `isFavoriteEligible`, `storageKey`, and `defaultCollapsed` are removed. The resulting types:

```ts
type NavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};
```

Remove `isFavoriteEligible: true|false` from all items, and remove `storageKey` + `defaultCollapsed` from both groups. Keep `title`, `items`, and the `NAV_GROUPS` contents otherwise unchanged. Leave `findNavItemByPath`, `getNavLabelForPath`, `NAV_ITEM_BY_PATH`, and `NAV_ORDER` intact.

- [ ] **Step 2: Verify typecheck + existing usages compile**

Run: `npm run build:web`
Expected: PASS. (`Sidebar.tsx` currently reads `NAV_GROUPS`/`findNavItemByPath` only — no field removed is referenced.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/navigation.config.ts
git commit -m "refactor(web): drop unused favourites/collapse fields from navigation.config"
```

### Task A5: Rewrite `Sidebar.tsx` for wide/rail modes

**Files:**

- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Test: `apps/web/src/components/layout/Sidebar.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/layout/Sidebar.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { useNavSidebar } from "./useNavSidebar";
import { Sidebar } from "./Sidebar";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <ScopeProvider>
        <Sidebar />
      </ScopeProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useNavSidebar.setState({ isNavExpanded: true });
  });

  it("renders group titles and item labels when expanded", () => {
    renderSidebar();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /collapse sidebar/i }),
    ).toBeInTheDocument();
  });

  it("collapses to the icon rail when toggled, hiding group titles", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- src/components/layout/Sidebar.spec.tsx`
Expected: FAIL — no "collapse sidebar" button / group titles in current icon-only Sidebar.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/src/components/layout/Sidebar.tsx
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Globe, Hexagon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useScopeContext } from "@/context/ScopeContext";
import { NAV_GROUPS, findNavItemByPath } from "./navigation.config";
import { useNavSidebar } from "./useNavSidebar";
import { getEffectiveNavExpanded } from "./layout-offset";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isScopePanelOpen, toggleScopePanel } = useScopeContext();
  const { isNavExpanded, toggleNav } = useNavSidebar();

  const expanded = getEffectiveNavExpanded(isNavExpanded, isScopePanelOpen);
  const activeItem = findNavItemByPath(location.pathname);
  const navItems = NAV_GROUPS.flatMap((group) => group.items);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card/95 backdrop-blur transition-all duration-200",
          expanded ? "w-64" : "w-12",
        )}
      >
        {/* Logo + collapse/expand toggle */}
        <div
          className={cn(
            "flex h-16 items-center border-b border-border",
            expanded ? "justify-between px-3" : "justify-center",
          )}
        >
          {expanded && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
                <Hexagon className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold">Nexus</span>
            </div>
          )}
          {!expanded && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Hexagon className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          {expanded && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleNav}
              aria-label="Collapse sidebar"
              aria-expanded={true}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Expand control (rail mode only) */}
        {!expanded && (
          <div className="flex justify-center border-b border-border py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={toggleNav}
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Scope toggle */}
        <div
          className={cn(
            "border-b border-border py-2",
            expanded ? "px-2" : "flex flex-col items-center gap-1",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={expanded ? "default" : "icon"}
                className={cn(
                  expanded ? "w-full justify-start gap-2 h-9 px-2" : "h-8 w-8",
                  isScopePanelOpen && "bg-accent text-accent-foreground",
                )}
                onClick={toggleScopePanel}
              >
                <Globe className="h-4 w-4 shrink-0" />
                {expanded ? (
                  <span className="text-sm">Scope tree</span>
                ) : (
                  <span className="sr-only">Scope tree</span>
                )}
              </Button>
            </TooltipTrigger>
            {!expanded && (
              <TooltipContent side="right">Scope tree</TooltipContent>
            )}
          </Tooltip>
        </div>

        {/* Nav */}
        <nav
          className={cn(
            "flex flex-1 flex-col overflow-y-auto py-2",
            expanded ? "gap-2 px-2" : "items-center gap-1",
          )}
        >
          {expanded
            ? NAV_GROUPS.map((group) => (
                <div key={group.title} className="flex flex-col gap-0.5">
                  <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem?.path === item.path;
                    return (
                      <Button
                        key={item.path}
                        variant="ghost"
                        className={cn(
                          "w-full justify-start gap-2 h-9 px-2",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                        onClick={() => {
                          navigate(item.path);
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-sm">{item.label}</span>
                      </Button>
                    );
                  })}
                </div>
              ))
            : navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeItem?.path === item.path;
                return (
                  <Tooltip key={item.path}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-8 w-8",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                        onClick={() => {
                          navigate(item.path);
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="sr-only">{item.label}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- src/components/layout/Sidebar.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.spec.tsx
git commit -m "feat(web): collapsible sidebar with wide labelled and rail modes"
```

### Task A6: Wire `Layout.tsx` to the offset helper

**Files:**

- Modify: `apps/web/src/components/layout/Layout.tsx:12-31`

- [ ] **Step 1: Replace the inline padding ternary with the helper**

In `LayoutInner`, consume `useNavSidebar` and `getContentOffsetClass`:

```tsx
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { KeyboardShortcutsProvider } from "./KeyboardShortcutsProvider";
import { CommandPalette } from "./CommandPalette";
import { Breadcrumbs } from "./Breadcrumbs";
import { GlobalRealtimeProvider } from "../../context/GlobalRealtimeContext";
import { ScopeProvider, useScopeContext } from "../../context/ScopeContext";
import { ScopePanel } from "../scope/ScopePanel";
import { cn } from "@/lib/utils";
import { useNavSidebar } from "./useNavSidebar";
import { getContentOffsetClass } from "./layout-offset";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { isScopePanelOpen } = useScopeContext();
  const { isNavExpanded } = useNavSidebar();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {isScopePanelOpen && <ScopePanel />}
      <div
        className={cn(
          "flex flex-1 flex-col min-w-0 transition-all duration-200",
          getContentOffsetClass(isNavExpanded, isScopePanelOpen),
        )}
      >
        <Header />
        <Breadcrumbs />
        <main className="flex-1 overflow-y-auto min-w-0 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
```

(Leave the exported `Layout` wrapper unchanged.)

- [ ] **Step 2: Verify build + full web unit suite**

Run: `npm run build:web && npm run test:unit:web -- src/components/layout`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run the web dev server (`npm run dev:web`), confirm: nav is wide+labelled by default; collapse chevron rails it; preference survives reload; opening the globe panel rails the nav and restores width on close.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/Layout.tsx
git commit -m "feat(web): derive content offset from nav + scope panel state"
```

- [ ] **Step 5: Phase A quality gate**

Run: `npm run lint:web && npm run test:unit:web && npm run build:web`
Expected: all green. Phase A complete.

---

# Phase B — Scope-node lifecycle & cleanup (task-level)

**Outcome:** Orphaned `project-<hash>` scope nodes are purged, `project` nodes gain a real lifecycle instead of one-shot backfill, and the switcher only shows scopes the caller can access.

**Reference implementations:** `apps/api/src/scope/scope.service.ts` (`getTree`, `createNode`, `ensureNode`), `apps/api/src/auth/authorization/scope-access.service.ts` (`getAccessibleScopeIds`), migration `apps/api/src/database/migrations/20260609010000-backfill-scope-nodes.ts` (the source of the orphans), `apps/api/src/scope/database/entities/scope-node.entity.ts` / `scope-node-closure.entity.ts`.

### Task B0: Design lock (no code)

Confirm and record in the umbrella spec:

- [ ] **Orphan definition.** A `project`-type `scope_nodes` row is an orphan when its `id` is absent from every live `SCOPE_SOURCES` table (`workflows`, `chat_sessions`, `scheduled_jobs`, `automation_hooks`, `heartbeat_profiles`, `standing_orders`, `workflow_run_todos`, `notifications`) **and** has no `role_assignments` other than seed/admin grants. (Confirm: do we also keep nodes that match a live Kanban project id? See Phase D identity mapping.)
- [ ] **Archive vs hard-delete.** Hard-delete orphans (closure + role_assignments cascade) vs soft-archive via a `scope_nodes.archived_at` column. Recommendation: soft-archive (reversible, audit-friendly), hide archived from the switcher.
- [ ] **Lifecycle ownership.** Which entity creations should `ensureNode` a project scope? API-owned scoped entities (workflows etc.) vs Kanban projects (Phase D). Recommendation: API entities call `ScopeService.ensureNode` on write for their own `scope_id`; Kanban projects are handled in Phase D.
- [ ] **Switcher filtering rule.** Platform/global admins see the whole tree; everyone else sees only accessible subtrees. Confirm the permission used (`scopes:read`).

### Task B1: Orphan-report read path

**Files:** Create `apps/api/src/scope/scope-maintenance.service.ts`; test `apps/api/src/scope/scope-maintenance.service.spec.ts`.

- [ ] Add a service method `findOrphanedProjectNodes(): Promise<ScopeNode[]>` that queries `project`-type nodes whose `id` is not present in any `SCOPE_SOURCES` table and has no non-root role assignment, per the B0 rule. TDD with a NestJS testing module seeding a mix of referenced and orphaned nodes (follow `testing-unit-patterns` skill). Expose read-only via `ScopeController` (`GET /scopes/maintenance/orphans`, guarded `scopes:manage`).

### Task B2: Cleanup of existing orphans

**Files:** Create migration `apps/api/src/database/migrations/<timestamp>-archive-orphan-scope-nodes.ts` (use `adding-entity-migration` skill conventions). If B0 chose soft-archive, also add the `archived_at` column migration first.

- [ ] Write a migration that sets `archived_at = now()` (or deletes, per B0) for project nodes matching the orphan rule, using the same `SELECT DISTINCT scope_id` source logic as the backfill but **inverted** (nodes NOT in the union). Guard so it never touches the global root or non-`project` types. Include a `down()` that clears `archived_at` (or refuses, matching existing backfill convention). Sketch of the core predicate:

```sql
UPDATE scope_nodes SET archived_at = now()
WHERE type = 'project'
  AND id <> '00000000-0000-0000-0000-000000000000'
  AND id NOT IN (
    SELECT scope_id FROM workflows WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM chat_sessions WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM scheduled_jobs WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM automation_hooks WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM heartbeat_profiles WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM standing_orders WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM workflow_run_todos WHERE scope_id IS NOT NULL
    UNION SELECT scope_id FROM notifications WHERE scope_id IS NOT NULL
  );
```

- [ ] Test the migration via the API integration harness (apply migration, assert orphan count → archived, referenced/root untouched).

### Task B3: Replace backfill with a real `project` lifecycle

**Files:** `apps/api/src/scope/scope.service.ts` (`ensureNode`), and the write paths of API-owned scoped entities (e.g. workflow creation service).

- [ ] On creation of an API-owned entity carrying a `scope_id`, call `ScopeService.ensureNode({ id: scopeId, type: 'project', parentId: GLOBAL_SCOPE_NODE_ID })` so the node exists exactly when real data exists. TDD each write path. (Note: this makes the backfill migration obsolete for new data; existing data is handled by B2.)
- [ ] Decide deletion semantics: when the last referencing row for a `scope_id` is deleted, archive the node (a periodic reconcile or a delete hook). If reconcile, add it to `scope-maintenance.service.ts` and schedule it; reuse the orphan query from B1.

### Task B4: Membership-filter the switcher

**Files:** `apps/api/src/scope/scope.service.ts` (`getTree`), `apps/api/src/scope/scope.controller.ts`; test `scope.service.spec.ts`.

- [ ] Change `getTree` to accept the caller and, for non-platform-admins, prune to subtrees reachable from the caller's accessible scope ids (via `ScopeAccessService.getAccessibleScopeIds(userId, 'scopes:read')`) plus their ancestors for context. Platform-role callers get the full tree. Exclude archived nodes (B0). TDD: admin sees all; scoped user sees only their subtree; archived excluded.

### Task B5: Phase B quality gate

- [ ] Run `npm run lint:api && npm run test:api && npm run build:api`. Re-seed/validate with `npm run validate:seed-data`. Confirm the switcher in the web UI now lists only real, accessible scopes.

---

# Phase C — Scope propagation & visibility (task-level)

**Outcome:** The active scope reaches the backend on every request, list endpoints filter by accessible scope across resources (not just workflows), client visibility is driven by real permissions, and rollout is staged behind a flag.

**Reference implementations:** `apps/web/src/lib/api/client.auth.ts:105-119` (request interceptor — currently only adds the bearer token), `apps/api/src/auth/authorization/permissions.guard.ts` (`resolveScopeNodeId`), `apps/api/src/workflow/workflow.controller.ts:116` + `workflow.repository.ts:172-184` (the one existing scope-filtered list — the template for all others), `apps/api/src/auth/authorization/enforcement-mode.ts` (`DEFAULT_ENFORCEMENT_MODE`), `apps/web/src/lib/api/client.authz.ts:25` (`getMyPermissions`, currently unused), `apps/web/src/context/ScopeContext.tsx`.

### Task C0: Design lock (no code)

- [ ] **Header name & precedence.** Use `X-Scope-Node-Id`. Confirm precedence vs existing per-route `scopeNodeId` params in `PermissionsGuard.resolveScopeNodeId` (explicit param should win over header; header is the default when no param).
- [ ] **Resource coverage list.** Enumerate which list endpoints get `getAccessibleScopeIds` filtering: agents, skills, secrets, providers, schedules, budgets/spend, chat sessions, workflow **runs**, notifications, events. Confirm the "platform/NULL-scoped rows always visible" rule (matches the workflow fix `f5b7499c`).
- [ ] **Client visibility model.** Confirm pages gate on `/me/permissions(activeScopeNodeId)` via a new `usePermissions` hook rather than the global `admin`/`user` role. Confirm `activeScopePath` is resolved from the tree on load (fixes the stale "Platform" breadcrumb).
- [ ] **Flag & enforcement.** Confirm `hierarchyEnabled` web flag (and its source — config endpoint vs build env), and the `audit → warn → enforce` promotion plan per resource.

### Task C1: Inject active-scope header (web)

**Files:** `apps/web/src/lib/api/client.auth.ts:105-119`; test alongside.

- [ ] Extend the request interceptor to read the active scope (from the `nexus_active_scope_node_id` localStorage key / `ScopeContext` source of truth) and attach `X-Scope-Node-Id` when it is not the global scope. TDD the interceptor: header present for a project scope, absent/global for platform.

### Task C2: Resolve header server-side

**Files:** `apps/api/src/auth/authorization/permissions.guard.ts` (`resolveScopeNodeId`); test `permissions.guard.spec.ts`.

- [ ] Add the request header `x-scope-node-id` to the resolution chain, after explicit `params`/`query`/`body` scope ids and before the `GLOBAL_SCOPE_NODE_ID` fallback. TDD: explicit param wins; header used when no param; global fallback when neither.

### Task C3: Generalise list filtering across resources

**Files:** per resource — its controller `findAll` + repository (mirror `workflow.controller.ts:116` and `workflow.repository.ts:172-184`). One sub-task per resource from the C0 list.

- [ ] For each resource: in the controller, fetch `getAccessibleScopeIds(userId, '<resource>:read')`; pass to the repository; in the repository apply `(<entity>.scope_id IS NULL OR <entity>.scope_id = ANY(:scopeIds))`. TDD each repository with the existing workflow repo test as the template. **Critical:** also cover `WorkflowController.findRuns` (runs list currently unfiltered).

### Task C4: Permission-driven client visibility

**Files:** Create `apps/web/src/hooks/usePermissions.ts` (wraps `getMyPermissions(activeScopeNodeId)` via TanStack Query, keyed by scope); a `<Can permission="...">` gate component; update `ScopeContext` to resolve `activeScopePath` from the scope tree on load.

- [ ] TDD the hook (returns permission set for the active scope, refetches on scope change) and the gate component (renders children only when the permission is present). Migrate page/route gating from the global role to `Can`/`usePermissions` incrementally. Fix `activeScopePath` resolution on mount.

### Task C5: Flag + staged enforcement

**Files:** web flag plumbing (config source per C0) gating scope UI; `apps/api/src/auth/authorization/enforcement-mode.*` promotion path.

- [ ] Introduce `hierarchyEnabled` on the web; when off, hide the scope panel toggle and redirect `/scopes/*` (restores zero-regression). Provide an admin path to promote resources `audit → warn → enforce`. TDD flag-off hides scope UI; flag-on shows it.

### Task C6: Phase C quality gate

- [ ] `npm run lint && npm run test:api && npm run test:unit:web && npm run build:api && npm run build:web`. Manually verify switching scope now changes visible workflows, runs, agents, etc.

---

# Phase D — Kanban-project ↔ scope bridge (task-level)

**Outcome:** Kanban projects provision/deprovision neutral scope nodes and the web projects list reacts to the active scope — without teaching API/core the Kanban domain.

**Boundary rule (from CLAUDE.md):** `apps/api/src` and `packages/core/src` stay Kanban-neutral (`scopeId`/`contextId` only). Kanban behaviour lives in `apps/kanban`, `packages/kanban-contracts`, `packages/kanban-mcp`. Use the `core-kanban-boundaries` skill before editing either side.

**Reference implementations:** `apps/web/src/hooks/useProjects.ts` + `apps/web/src/lib/api/client.projects.ts:56` (scope-unaware project list), `apps/api/src/scope/scope.controller.ts` (`POST /scopes/ensure`), `apps/api/src/chat/chat-actions/chat-core-lookup.service.ts:39-58` (existing Kanban→scope_id resolution pattern).

### Task D0: Design lock (no code)

- [ ] **Provisioning mechanism.** Kanban calls the neutral scope API (`POST /scopes/ensure`) on project create, and archives the node on project delete — vs an event the API consumes. Recommendation: direct neutral API call from Kanban (Kanban already calls API).
- [ ] **Identity mapping.** Confirm a Kanban project's id is used directly as the `scope_id`/scope-node id (matches existing `scope_id`-as-project-id usage), so no separate mapping table is needed. Reconcile with Phase B orphan rule (a node matching a live Kanban project must never be archived).
- [ ] **Projects-list scoping.** The web projects list filters to the active scope: either `GET /projects?scopeNodeId=` or via the `X-Scope-Node-Id` header from C1, plus a scope-dependent query key.

### Task D1: Provision/deprovision scope nodes from Kanban project lifecycle

**Files:** Kanban project create/delete service in `apps/kanban`.

- [ ] On project create, call the neutral scope API to `ensureNode({ id: projectId, type: 'project', parentId: GLOBAL_SCOPE_NODE_ID })`. On project delete, archive the node. TDD on the Kanban side; mock the API client. Respect the boundary — no Kanban identifiers added to API/core.

### Task D2: Scope the web projects list

**Files:** `apps/web/src/hooks/useProjects.ts:6-11`, `apps/web/src/lib/api/client.projects.ts:56-60`.

- [ ] Make `useProjectList` scope-aware: include `activeScopeNodeId` in the query key and pass it through (param or rely on the C1 header). TDD: switching scope refetches and the key changes. Mirror for `GlobalWorkItemsPage`.

### Task D3: Reconcile project scope-node identity end-to-end

- [ ] Verify the scope-tree `project` node id equals the Kanban project id so selecting a project scope filters the projects/work-items list to that project. Add an integration test (e2e or API-side) covering create-project → node appears in tree → selecting it scopes the projects list → delete-project → node archived. Use `test:e2e:kanban:deterministic` patterns.

### Task D4: Phase D quality gate

- [ ] `npm run lint && npm run test:api && npm run test:kanban && npm run test:unit:web` + relevant e2e. Manually verify creating/deleting a Kanban project adds/removes a scope and that selecting a project scope filters the projects list.

---

## Self-review notes

- **Spec coverage:** Symptom 3 → Phase A (A1–A6). Symptom 1 → Phase B (B1–B4). Symptom 2 → Phase C (C1–C5). Symptom 4 → Phase D (D1–D3). The umbrella spec's cross-cutting `hierarchyEnabled` flag → C5.
- **Type consistency:** `useNavSidebar` exposes `isNavExpanded`/`toggleNav`/`setNavExpanded`; `layout-offset` exposes `getEffectiveNavExpanded`/`getContentOffsetClass`; both names are used consistently in A5/A6.
- **Fidelity gap (intentional):** B–D tasks are task-level and each opens with a design-lock; expand them into bite-sized TDD steps (re-run writing-plans per phase) before implementing, since they encode forks best decided against live code.
