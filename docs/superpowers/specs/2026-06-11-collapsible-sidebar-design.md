# Collapsible Sidebar — Design Spec (Workstream A)

**Date:** 2026-06-11
**Status:** Approved for implementation
**Parent:** `docs/superpowers/specs/2026-06-11-epic-204-completion-design.md`
**Fixes:** Symptom 3 — the sidebar became a narrow icon-only rail since the RBAC changes.

## Goal

Restore a wide, text-labelled navigation sidebar while keeping the compact icon rail available,
toggleable by the user, and integrated cleanly with the existing globe scope panel. Remove the dead
code left behind by the 2026-06-09 sidebar swap.

Non-goals: favourites/recents (deleted as dead code), the `hierarchyEnabled` flag (Workstream C),
and any wiring of scope data into page queries (Workstreams B–D).

## Behaviour

- The nav has two visual modes: **wide** (256px, logo + wordmark + group titles + icon-and-label
  rows) and **rail** (48px icon-only with tooltips — today's appearance).
- A toggle (chevron) switches between modes. The user's preference persists in `localStorage`
  (`nexus_nav_expanded`), **defaulting to wide** on first load.
- **Auto-collapse:** opening the scope panel (the globe) rails the nav to reclaim horizontal space;
  closing it restores the user's preferred width. The user's stored preference is never overwritten
  by auto-collapse.
- Group section titles (`Work`, `Configuration` from `navigation.config.ts`) are shown as headers
  in wide mode. Active-route highlighting and navigation behaviour are unchanged.

### Effective state

```
effectiveExpanded = isNavExpanded && !isScopePanelOpen
```

| isNavExpanded | isScopePanelOpen | Nav renders  | Content padding               |
| ------------- | ---------------- | ------------ | ----------------------------- |
| true          | false            | wide (256px) | `pl-64`                       |
| false         | false            | rail (48px)  | `pl-12`                       |
| any           | true             | rail (48px)  | `pl-[288px]` (48 + 240 panel) |

The panel-open row is identical to today's behaviour, so blast radius is limited to the two
panel-closed rows.

## Components & state

### `useNavSidebar` (new)

A focused Zustand store (consistent with the existing auth store pattern — no new provider nesting,
shared reactive state, simple persistence):

```ts
interface NavSidebarState {
  isNavExpanded: boolean; // user preference, persisted
  toggleNav: () => void;
  setNavExpanded: (v: boolean) => void;
}
```

Persisted to `localStorage` key `nexus_nav_expanded`, default `true`.

### `Sidebar.tsx` (rewrite)

- Reads `isNavExpanded` (`useNavSidebar`) and `isScopePanelOpen` (`useScopeContext`); computes
  `effectiveExpanded`.
- **Rail mode** (`!effectiveExpanded`): today's 48px icon rail + tooltips, plus an **expand**
  chevron.
- **Wide mode** (`effectiveExpanded`): 256px; logo + "Nexus" wordmark; a **collapse** chevron; the
  scope/globe entry as a labelled row (still toggles the panel); nav rendered **by group** —
  section title then icon + label rows. Width transition animated (`transition-all duration-200`).
- Toggle button has `aria-label` and `aria-expanded`.

### `Layout.tsx` (edit)

Compute padding from `effectiveExpanded` and `isScopePanelOpen` per the table above (replace the
current binary `pl-[288px]`/`pl-12`).

### `navigation.config.ts` (edit)

- Keep group `title` and `items` (label, icon, path).
- Remove `isFavoriteEligible`, `storageKey`, and `defaultCollapsed` (favourites/per-group-collapse
  machinery is being deleted).

### Deletions (dead code — per repo "eliminate, don't deprecate" rule)

- `apps/web/src/components/layout/useSidebarState.ts`
- `apps/web/src/components/layout/SidebarParts.tsx`
- `apps/web/src/components/layout/useFavoriteHotkeys.ts`

(Confirmed orphaned: no `import` references anywhere in `apps/web/src`.)

## Testing (TDD — write first)

- `useNavSidebar.spec.ts`: defaults to expanded; `toggleNav` flips; persists to and rehydrates from
  `localStorage`.
- `Sidebar.spec.tsx`: wide mode renders group titles + labels; rail mode renders icons + tooltips
  and no labels; toggle switches modes; auto-rails when `isScopePanelOpen` is true regardless of
  preference; active route highlighted in both modes.
- `Layout.spec.tsx` (or extend existing): content padding matches the three-state table.

## Files touched (summary)

| Action   | File                                                   |
| -------- | ------------------------------------------------------ |
| add      | `apps/web/src/components/layout/useNavSidebar.ts`      |
| rewrite  | `apps/web/src/components/layout/Sidebar.tsx`           |
| edit     | `apps/web/src/components/layout/Layout.tsx`            |
| edit     | `apps/web/src/components/layout/navigation.config.ts`  |
| delete   | `apps/web/src/components/layout/useSidebarState.ts`    |
| delete   | `apps/web/src/components/layout/SidebarParts.tsx`      |
| delete   | `apps/web/src/components/layout/useFavoriteHotkeys.ts` |
| add      | `apps/web/src/components/layout/useNavSidebar.spec.ts` |
| add/edit | `apps/web/src/components/layout/Sidebar.spec.tsx`      |
| add/edit | `apps/web/src/components/layout/Layout.spec.tsx`       |
