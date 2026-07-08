# EPIC-207: Web UI Component Consistency and Theme Readiness

**Status:** Proposed
**Priority:** P2
**Created:** 2026-06-12
**Updated:** 2026-06-12
**Owner:** Web Platform / Frontend
**Parent:** None
**Depends on:** None
**Related:** EPIC-200 (Web Platform Package Modularization), EPIC-073 (Frontend UI/UX Enhancement)

## Summary

Improve the `apps/web` frontend to be DRY, consistent, and ready for future theme changes. The work is structured in two phases. Phase B performs two global sweeps: first replacing all hardcoded Tailwind colour values with CSS-variable semantic tokens and all bare HTML elements with the `ui/` design-system components; then decomposing the largest components and extracting the most common repeated patterns into new shared primitives. Phase C follows domain-by-domain, applying the same principles more deeply to each feature directory.

The goal is that any future theme change — colours, border radius, shadow depth, typography scale — can be applied by changing CSS variables and the component library alone, without hunting for hardcoded values scattered across feature components.

## Problem Statement

The web application has a well-structured `apps/web/src/components/ui/` library built on Radix UI primitives and a CSS-variable token system, but adherence is uneven across feature components:

- Some components use hardcoded Tailwind colour utilities (`bg-blue-600`, `text-red-500`, `border-gray-200`) that bypass the token system and will not respond to a theme change.
- A handful of components use raw `<button>`, `<input>`, `<select>`, and `<textarea>` elements directly instead of their `ui/` counterparts, producing visual and behavioural inconsistency.
- Common UI patterns (a loading-state button, a nullable select wrapper, a checkbox filter) are re-implemented multiple times rather than extracted into shared primitives.
- Eight components exceed 400 lines and mix layout, logic, and sub-component rendering, making them hard to understand and test.
- Several feature directories have no barrel file, forcing consumers to import deep implementation paths.

## Goals

- All colour and radius values in feature components must reference CSS-variable tokens, not hardcoded Tailwind utilities.
- All interactive form and action elements in feature components must use `ui/` components unless a technical constraint prevents it.
- New shared `ui/` primitives cover the patterns that are currently reimplemented in multiple places.
- No feature component file exceeds a reasonable line budget without a clear justification.
- Each feature directory exports a barrel file so import paths are shallow and stable.
- The codebase can be re-themed by changing CSS variable values alone.

## Non-Goals

- Do not redesign or change visual appearance beyond colour-token alignment; this is a code-quality pass, not a design refresh.
- Do not restructure the folder layout, routing, or package boundaries (that is EPIC-200).
- Do not migrate to a different component library or styling system.
- Do not add new product features or change application behaviour.
- Do not modify the backend, API types, or data contracts.

## Current-State Baseline

### UI Component Library (`apps/web/src/components/ui/`)

Twenty-two components covering buttons, inputs, labels, selects, checkboxes, dialogs, cards, alerts, badges, tabs, accordions, tooltips, popovers, tables, skeletons, empty states, and a full data-table system. All are built on Radix UI primitives and styled with Tailwind CSS using CSS variables (`--primary`, `--secondary`, `--destructive`, `--muted`, etc.) defined in the app's global stylesheet.

### Token System

`apps/web/tailwind.config.js` maps Tailwind colour utilities to HSL CSS variables. Semantic tokens include `primary`, `secondary`, `destructive`, `muted`, `accent`, `popover`, `card`, `success`, `warning`, `error`, and `info` — all with matching `*-foreground` counterparts.

### Known Issues

**Hardcoded colours (sample):**

- `ScopedConfigViewer.tsx` — repeated `bg-blue-600 text-white hover:bg-blue-700` inline on three buttons.
- Several workflow and orchestration components use `text-gray-*`, `border-gray-*`, and status-specific hex colours not mapped to tokens.

**Raw HTML elements:**

- `ScopedConfigViewer.tsx` — `<button>`, `<input>`, `<select>` without `ui/` wrappers.
- `Header.tsx` (scope selector) — raw `<button>` for the scope toggle.
- `AttachmentChip.tsx` — minimal raw `<button>` for the remove control.
- `FileDropzone.tsx` — native `<input type="file">` (partially justified; needs audit).
- `DateRangePicker.tsx` — native `<input type="date">`.

**Large files (400+ lines):**

| File                                                    | Lines |
| ------------------------------------------------------- | ----- |
| `orchestration/WarRoomSessionManagerPanel.hooks.tsx`    | 471   |
| `orchestration/SubagentExecutionPanel.tsx`              | 465   |
| `budget/BudgetOverviewTab.tsx`                          | 453   |
| `sessions/NewSessionDialog.tsx`                         | 447   |
| `orchestration/WarRoomSessionManagerPanel.sections.tsx` | 442   |
| `orchestration/OrchestrationStatusCard.tsx`             | 438   |
| `workflow/WorkflowActivityFeed.tsx`                     | 372   |
| `workflow/WorkflowVisualizer.tsx`                       | 364   |

**Repeated patterns (re-implemented 2–4× each):**

- Loading-state button: inline `disabled={mutation.isPending}` + `{isPending ? <Loader2 /> : <Icon />}` pattern.
- Nullable select: `value={x || NO_VALUE}` / `onValueChange` sentinel unwrapping.
- Filter checkbox: `<Checkbox checked={x} onCheckedChange={(c) => set(c === true)} />` with aria label.

**Missing barrel files:**

- `apps/web/src/components/workflow/`
- `apps/web/src/components/scope/`
- `apps/web/src/components/layout/`
- `apps/web/src/components/sessions/`
- `apps/web/src/components/orchestration/`

## Phase B — Foundation Sweeps

Phase B is two sequential global passes, followed by new shared primitives and structural cleanup. It must be completed before Phase C begins.

### B1 — Semantic Token Pass

Audit every file under `apps/web/src/components/` and `apps/web/src/pages/` for hardcoded Tailwind colour utilities and replace them with semantic token equivalents.

Mapping examples:

| Hardcoded                                  | Semantic equivalent                                      |
| ------------------------------------------ | -------------------------------------------------------- |
| `bg-blue-600 text-white hover:bg-blue-700` | `bg-primary text-primary-foreground hover:bg-primary/90` |
| `text-gray-500`                            | `text-muted-foreground`                                  |
| `border-gray-200`                          | `border-border`                                          |
| `bg-gray-100`                              | `bg-muted`                                               |
| `text-red-500`                             | `text-destructive`                                       |
| `bg-green-500`                             | `bg-success`                                             |

Acceptance criteria:

- `grep -r "bg-blue\|text-red-[0-9]\|bg-gray\|text-gray\|border-gray\|bg-green-[0-9]\|bg-yellow-[0-9]" apps/web/src/components apps/web/src/pages` returns no matches outside of `ui/` files and explicitly justified exceptions with inline comments.
- All existing visual tests and Playwright E2E tests pass.
- No new CSS variables or token names are introduced; only the existing token set is used.

### B2 — Raw HTML Element Pass

Audit all non-`ui/` component files for bare `<button>`, `<input>`, `<select>`, and `<textarea>` elements. Replace each with the corresponding `ui/` component unless a documented technical constraint applies (e.g., native file-input behaviour, React Flow node internals).

Justified exceptions that may remain with an inline comment:

- `<input type="file">` in `FileDropzone.tsx` — browser file-input API requires a native element.
- `<input type="date">` in `DateRangePicker.tsx` — native date picker; evaluate whether a Radix-compatible alternative exists first.
- Bare elements inside React Flow node render functions — the graph library controls the container; wrapper components may not compose correctly.
- Markdown render output — user-generated content, not design-system surface.

Acceptance criteria:

- `grep -rn "<button\b\|<input\b\|<select\b\|<textarea\b" apps/web/src/components apps/web/src/pages` returns only explicitly justified exceptions.
- `ScopedConfigViewer.tsx` uses `Button`, `Input`, and `Select` from `ui/`.
- All existing tests pass.

### B3 — New Shared Primitives

Extract three recurring inline patterns into new `ui/` components. Each new component must have unit tests and follow the CVA/Radix conventions already established in the library.

**`ui/async-button.tsx` — `AsyncButton`**

A `Button` wrapper that accepts `isLoading: boolean`, an optional `loadingIcon` (defaults to `<Loader2 className="animate-spin" />`), and all standard `Button` props. Automatically sets `disabled` when loading and swaps the leading icon slot.

```tsx
<AsyncButton isLoading={mutation.isPending} onClick={handleSubmit}>
  <Save /> Save
</AsyncButton>
```

**`ui/nullable-select.tsx` — `NullableSelect`**

A `Select` wrapper that maps a `null | string` value to an internal sentinel, exposes `onValueChange: (value: string | null) => void`, and accepts a `placeholder` prop for the null state. Eliminates the `NO_VALUE` pattern repeated across form components.

**`ui/filter-checkbox.tsx` — `FilterCheckbox`**

A compact `Checkbox` + `Label` pair for filter toolbars. Accepts `checked`, `onCheckedChange: (checked: boolean) => void`, and `label`. Handles the `checked === true` coercion and provides consistent layout and spacing.

Acceptance criteria:

- All three components exist in `apps/web/src/components/ui/` with tests.
- All sites of the existing inline patterns are migrated to use the new components.
- The `ui/` barrel file (or `index.ts` if one is added) exports the new components.

### B4 — Large File Decomposition

Decompose the eight files over 400 lines. Each should be split along natural responsibility boundaries. Suggested targets:

**`WarRoomSessionManagerPanel.hooks.tsx` (471 lines)**
Split into one hook file per logical concern: agent lifecycle, blackboard state, consensus tracking. The main panel hooks file becomes a thin re-export of these focused hooks.

**`SubagentExecutionPanel.tsx` (465 lines)**
Extract the subagent list rendering, individual subagent row, and status-summary strip as named sub-components. The panel file orchestrates them.

**`BudgetOverviewTab.tsx` (453 lines)**
Extract `BudgetAllocationTable`, `BudgetUsageChart`, and `BudgetSummaryCards` as separate files. The tab file composes them.

**`NewSessionDialog.tsx` (447 lines)**
The form, the agent-profile selector, and the scope-selector sections are each large enough to be named sub-components. Extract them; the dialog file manages form state and submission.

**`WarRoomSessionManagerPanel.sections.tsx` (442 lines)**
Each major panel section (participant list, agenda, consensus) is a candidate for its own file.

**`OrchestrationStatusCard.tsx` (438 lines)**
Extract the timeline strip, the status-badge row, and the action group as named components.

**`WorkflowActivityFeed.tsx` (372 lines)**
Extract `ActivityFilters` as a component and `useActivityFilters` as a hook. The feed component becomes layout + composition only.

**`WorkflowVisualizer.tsx` (364 lines)**
Move `collectStepsByJob`, `stripJobPrefix`, `toJobFlowNode`, and related graph-transform functions into `workflow-graph.utils.ts`. The visualizer file handles only rendering.

Acceptance criteria:

- No decomposed file exceeds 250 lines (excluding comments and blank lines) without a written justification in a comment at the top of the file.
- All existing unit and E2E tests pass unchanged or are updated to import from the new file locations.
- No behaviour changes; decomposition is purely structural.

### B5 — Barrel Files

Add `index.ts` barrel files to feature component directories that do not have one.

Directories requiring barrels:

- `apps/web/src/components/workflow/`
- `apps/web/src/components/scope/`
- `apps/web/src/components/layout/`
- `apps/web/src/components/sessions/`
- `apps/web/src/components/orchestration/`

Each barrel should export only the public-facing components, not internal sub-components.

Acceptance criteria:

- Each listed directory has an `index.ts` that re-exports its public components.
- At least one consumer per directory is updated to use the barrel import path.
- No circular imports are introduced.

## Phase C — Domain-by-Domain Deep Refactor

Phase C applies a thorough refactor to each feature directory in turn, following the same principles established in Phase B but going deeper: reviewing prop interfaces, hook design, component boundaries, test coverage, and adherence to the quality gates defined in `.github/instructions/web-quality-gate.instructions.md`.

Phase C is explicitly deferred until Phase B is complete and merged. Domains are listed in suggested priority order based on complexity and change frequency.

### C1 — Workflow Domain

Scope: `apps/web/src/components/workflow/`, `apps/web/src/components/workflow-editor/`, `apps/web/src/components/workflows/`.

Focus areas:

- Complete the graph-utils extraction begun in B4.
- Review `WorkflowLaunchContractForm` for further sub-component promotion.
- Audit hook design in `workflow-editor/` for SRP violations.
- Verify all interactive elements use `ui/` components.
- Ensure test files mirror the file structure (one spec per component).

### C2 — Orchestration Domain

Scope: `apps/web/src/components/orchestration/`.

Focus areas:

- Complete the decomposition begun in B4 (`WarRoomSessionManagerPanel`, `OrchestrationStatusCard`, `SubagentExecutionPanel`).
- Extract shared orchestration-status display logic that appears in multiple components.
- Review prop drilling; introduce context or co-located hooks where appropriate.

### C3 — Sessions Domain

Scope: `apps/web/src/components/sessions/`, `apps/web/src/components/chat/`.

Focus areas:

- Complete `NewSessionDialog` decomposition begun in B4.
- Audit `chat/` components for raw HTML and hardcoded colours missed in Phase B.
- Review thread/message list rendering for list-item extraction opportunities.

### C4 — Budget Domain

Scope: `apps/web/src/components/budget/`.

Focus areas:

- Complete `BudgetOverviewTab` decomposition begun in B4.
- Unify budget-status badge patterns into a single `BudgetStatusBadge` component.

### C5 — Layout and Navigation Domain

Scope: `apps/web/src/components/layout/`.

Focus areas:

- Extract nav-item rendering to a `NavItemList` component.
- Extract `useNavItems` hook for active-state detection.
- Extract command-palette action groups to `buildCommandActions` utility.
- Review Sidebar for state management clarity.

### C6 — Remaining Domains

Scope: `harnesses/`, `projects/`, `scope/`, `events/`, `notifications/`, `attachments/`, `auth/`, `error-boundary/`.

Apply the same sweep to each: token compliance, raw HTML audit, barrel file, line-budget check, and hook extraction where appropriate.

## Testing and Quality Gates

Run after each Phase B workstream and after each Phase C domain:

```bash
npm run test:unit:web
npm run lint:web
npm run build:web
```

Run after Phase B is complete before starting Phase C:

```bash
npm run test:e2e:web
```

Additional gates:

- `grep` checks described in B1 and B2 acceptance criteria must pass before the Phase B PR merges.
- Every new `ui/` component added in B3 must have co-located unit tests covering default behaviour, loading/null states, and prop forwarding.

## Risks and Mitigations

### Risk: Token Replacement Introduces Visual Regressions

Replacing `bg-blue-600` with `bg-primary` is safe only if `--primary` resolves to the same or intentionally equivalent colour.

Mitigation: run visual diff or manual browser check of key screens (dashboard, session view, workflow editor, admin config) after B1. Keep the PR focused on token substitution only so diffs are easy to audit.

### Risk: Raw HTML Replacement Breaks Accessibility or Behaviour

`ui/` wrappers may add ARIA attributes or focus behaviour that conflicts with existing usage.

Mitigation: test interactive components in a browser after B2. The file-input and date-input exceptions are pre-approved; others must be verified individually.

### Risk: Large File Splits Break Imports Across the App

Moving sub-components into new files can cause import failures if any file imports the sub-component directly from the parent file.

Mitigation: use barrel files introduced in B5 to maintain stable public import paths. Run `npm run build:web` after each file split.

### Risk: Phase C Scope Creep

Domain-by-domain refactors can grow into redesigns if not kept focused on the quality criteria.

Mitigation: each Phase C workstream must be reviewed against the Non-Goals section. If a domain review surfaces a product-level change, file a separate issue rather than expanding the scope in-place.

## Backlog

### Phase B

- [ ] E207-B01 Audit all feature components for hardcoded Tailwind colour utilities; produce replacement list.
- [ ] E207-B02 Apply semantic token replacements across `components/` and `pages/`.
- [ ] E207-B03 Audit all feature components for bare `<button>`, `<input>`, `<select>`, `<textarea>` elements.
- [ ] E207-B04 Replace raw HTML elements with `ui/` components; document justified exceptions inline.
- [ ] E207-B05 Implement `AsyncButton` in `ui/` with tests.
- [ ] E207-B06 Implement `NullableSelect` in `ui/` with tests.
- [ ] E207-B07 Implement `FilterCheckbox` in `ui/` with tests.
- [ ] E207-B08 Migrate all inline `AsyncButton` pattern sites to the new component.
- [ ] E207-B09 Migrate all inline `NullableSelect` pattern sites to the new component.
- [ ] E207-B10 Migrate all inline `FilterCheckbox` pattern sites to the new component.
- [ ] E207-B11 Decompose `WarRoomSessionManagerPanel.hooks.tsx` into focused hook files.
- [ ] E207-B12 Decompose `SubagentExecutionPanel.tsx` into sub-components.
- [ ] E207-B13 Decompose `BudgetOverviewTab.tsx` into sub-components.
- [ ] E207-B14 Decompose `NewSessionDialog.tsx` into sub-components.
- [ ] E207-B15 Decompose `WarRoomSessionManagerPanel.sections.tsx` into section components.
- [ ] E207-B16 Decompose `OrchestrationStatusCard.tsx` into sub-components.
- [ ] E207-B17 Decompose `WorkflowActivityFeed.tsx` and extract `useActivityFilters`.
- [ ] E207-B18 Extract graph-transform utilities from `WorkflowVisualizer.tsx` into `workflow-graph.utils.ts`.
- [ ] E207-B19 Add barrel `index.ts` to `workflow/`, `scope/`, `layout/`, `sessions/`, `orchestration/` directories.

### Phase C

- [ ] E207-C01 Deep refactor of workflow domain (`workflow/`, `workflow-editor/`, `workflows/`).
- [ ] E207-C02 Deep refactor of orchestration domain.
- [ ] E207-C03 Deep refactor of sessions and chat domain.
- [ ] E207-C04 Deep refactor of budget domain.
- [ ] E207-C05 Deep refactor of layout and navigation domain.
- [ ] E207-C06 Deep refactor of remaining domains (`harnesses/`, `projects/`, `scope/`, `events/`, `notifications/`, `attachments/`, `auth/`, `error-boundary/`).

## Acceptance Criteria

### Phase B complete when:

- No hardcoded Tailwind colour utilities (`bg-blue-*`, `text-gray-*`, `border-gray-*`, etc.) exist in feature components outside `ui/`; all colour references use semantic token classes.
- No bare `<button>`, `<input>`, `<select>`, or `<textarea>` elements exist outside `ui/` or explicitly documented exceptions.
- `AsyncButton`, `NullableSelect`, and `FilterCheckbox` exist in `ui/` with tests, and all prior inline implementations are replaced.
- All eight 400+ line components have been decomposed; no resulting file exceeds 250 lines without justification.
- Barrel `index.ts` files exist in the five listed feature directories.
- `npm run test:unit:web`, `npm run lint:web`, `npm run build:web`, and `npm run test:e2e:web` all pass.

### Phase C complete when:

- All feature directories have been reviewed and brought to Phase B standards.
- All interactive elements use `ui/` components; all colours reference tokens.
- No component file in any domain exceeds 250 lines without justification.
- No feature component re-implements a pattern already covered by the `ui/` library.
- All tests pass.
