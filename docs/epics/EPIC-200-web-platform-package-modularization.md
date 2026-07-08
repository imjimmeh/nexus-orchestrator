# EPIC-200: Web Platform Package Modularization

**Status:** Proposed
**Priority:** P1
**Created:** 2026-06-02
**Updated:** 2026-06-02
**Owner:** Web Platform / Frontend Architecture
**Parent:** None
**Depends on:** EPIC-156 (Web Kanban Service Cutover), EPIC-API-KANBAN-SEPARATION (API and Kanban Domain Separation Enforcement)
**Related:** EPIC-108 (Platform Global Scope and Project Decoupling), EPIC-188 (Third-Party Plugin Platform), EPIC-191 (Plugin Contribution Contracts and Projection Adapters), EPIC-195 (Plugin Developer Experience, Management UI, and Observability)

## Summary

Split the Web app into explicit package-level frontend modules while continuing to serve one website. The current `apps/web` deployment should become a thin composition shell that mounts a platform/core module and a Kanban domain module. The package seam should make it straightforward to add future project/domain modules without mixing their routes, API clients, contracts, navigation, and tests into the core Web surface.

The target architecture is not a micro-frontend system. All modules remain built and deployed through the existing Web application, but they are authored as workspace packages with enforceable dependency direction, lazy-loaded route surfaces, and typed contribution contracts.

## Problem Statement

The backend has been moving toward clear core/Kanban separation, but the Web app still presents a single mixed frontend codebase. Core platform concerns and Kanban-specific project-management concerns are interleaved through route declarations, navigation, API types, hooks, and page directories.

This creates several problems:

- Core Web changes often require understanding Kanban pages and contracts.
- Kanban UI imports are eagerly wired into the root router even when users only need core platform screens.
- `apps/web/src/lib/api/types.ts` mixes `@nexus/core` and `@nexus/kanban-contracts` behind one API type surface.
- `apps/web/src/lib/api/client.ts` exposes one composed client that mixes core, workflow, admin, project, work-item, and orchestration methods.
- `apps/web/src/components/layout/navigation.config.ts` hardcodes platform and Kanban navigation in one list.
- Future project/domain modules have no clear interface for contributing routes, navigation, settings, API clients, or tests.

Without a package-level seam, frontend code can drift back into the same coupling that API/core boundary work is trying to remove.

## Goals

- Keep one deployed Web site and one operator experience.
- Create explicit workspace packages for core Web platform functionality and Kanban Web functionality.
- Make `apps/web` a composition shell, not the owner of every page, route, API type, and navigation entry.
- Move Kanban-specific pages, hooks, API clients, types, and tests behind a Kanban-owned frontend package.
- Keep `@nexus/kanban-contracts` out of core Web packages and shared shell code.
- Provide a typed module contribution contract for routes, navigation, settings cards, command-palette entries, query keys, and optional health/status surfaces.
- Support route-level lazy loading so Kanban UI does not need to load with the initial core shell.
- Establish dependency and lint guardrails that prevent core packages from importing Kanban modules.
- Leave room for future domain modules and plugin-provided UI contributions without adopting independently deployed micro-frontends.

## Non-Goals

- Do not redesign the Kanban board, project workspace, or core platform UI in this epic.
- Do not split the Web deployment into independently deployed micro-frontends.
- Do not introduce runtime remote module loading, module federation, or a frontend marketplace in this epic.
- Do not move backend ownership boundaries; this epic consumes the service split established by existing API/Kanban epics.
- Do not make all plugin custom UI contribution types production-ready; this epic should define compatible seams that EPIC-195 can build on later.
- Do not preserve legacy import paths through compatibility re-export packages once migrations complete.

## Current-State Baseline

### Existing Web Structure

The current Web app is a Vite + React SPA under `apps/web`.

Key files and seams:

- `apps/web/src/App.tsx` owns one monolithic route table and eagerly imports core and Kanban pages.
- `apps/web/src/components/layout/navigation.config.ts` hardcodes both platform navigation and Kanban navigation.
- `apps/web/src/lib/config.ts` already routes `/projects`, `/work-items`, `/orchestration`, and `/kanban-settings` requests to `kanbanApiUrl`.
- `apps/web/src/lib/api/client.ts` owns the shared Axios wrapper and mixes `projectApiMethods`, `workflowApiMethods`, and `adminApiMethods` into one `ApiClient` instance.
- `apps/web/src/lib/api/types.ts` is a broad mixed type surface that imports from both `@nexus/core` and `@nexus/kanban-contracts`.
- `apps/web/src/pages/kanban`, `apps/web/src/pages/projects`, `apps/web/src/pages/project-workspace`, and `apps/web/src/pages/work-items` contain Kanban-owned UI concepts.
- `apps/web/src/hooks/useProjects.ts`, `apps/web/src/hooks/useProjectOrchestration.ts`, `apps/web/src/hooks/useProjectGoals.ts`, and related hooks expose Kanban concepts from shared hook folders.

### Existing Helpful Foundations

- `apps/web/src/lib/config.ts` already understands service routing by URL prefix and can remain a shell-level runtime configuration seam.
- `apps/web/src/features/control-plane` shows a small feature-folder precedent with colocated API, types, and UI.
- `apps/web/src/hooks/lib/createCrudHooks.ts` provides a reusable hook factory pattern that can remain available to feature packages.
- Plugin contribution epics define backend contribution inventory and projection concepts that can inform frontend module contribution contracts.
- EPIC-156 has already framed the browser client as an explicit core/Kanban service-routing boundary.

## Target Architecture

### Package Layout

Introduce frontend workspace packages with one deployable shell:

```text
apps/web/
  src/
    main.tsx
    App.tsx
    app-modules.ts
    stores/
      auth.store.ts

packages/web-core/
  src/
    shell/
    routing/
    navigation/
    api/
    hooks/
    components/
    pages/
    testing/

packages/web-kanban/
  src/
    module.ts
    routes.tsx
    navigation.ts
    api/
    hooks/
    pages/
    components/
    testing/
```

`apps/web` remains the deployment unit and bootstrap layer. It should load runtime config, hydrate auth, create shared providers, import module manifests, and pass those manifests into the shell compositor.

`packages/web-core` owns the platform shell and core platform screens. It may depend on `@nexus/core`, shared UI primitives, React, React Router, React Query, and shell-level runtime configuration. It must not depend on `@nexus/kanban-contracts` or `packages/web-kanban`.

`packages/web-kanban` owns project, work-item, Kanban board, Kanban settings, Kanban orchestration, and Kanban-specific active-session entry points. It may depend on `@nexus/kanban-contracts` and on stable shell interfaces from `packages/web-core`.

### Module Contribution Contract

Define a small typed frontend module contract in `packages/web-core`:

```ts
export interface WebModuleManifest {
  id: string;
  displayName: string;
  routes: WebRouteContribution[];
  navigation?: WebNavigationContribution[];
  settings?: WebSettingsContribution[];
  commandPalette?: WebCommandContribution[];
  providers?: WebProviderContribution[];
}
```

The interface should stay small. The shell should know how to compose contributions, but it should not know Kanban domain rules.

Initial contribution types:

- Route contributions for React Router route objects and lazy-loaded page factories.
- Navigation contributions grouped by shell-defined placement identifiers.
- Settings contributions for cards or sections that appear on the shared settings page.
- Command-palette contributions for navigable module actions.
- Provider contributions for feature-level React Query defaults or feature context providers when needed.

Future plugin UI work can either adapt plugin contribution inventory into this same contract or define a compatible runtime-safe subset later.

### Dependency Direction

The dependency direction should be:

```text
apps/web -> packages/web-core
apps/web -> packages/web-kanban
packages/web-kanban -> packages/web-core
packages/web-core -> @nexus/core
packages/web-kanban -> @nexus/kanban-contracts
```

Forbidden dependencies:

- `packages/web-core` must not import `@nexus/kanban-contracts`.
- `packages/web-core` must not import `packages/web-kanban`.
- Shell/shared code must not use Kanban vocabulary except in explicit module-registration metadata owned by the app composition layer.
- Kanban package code must not add new generic shell behavior directly; it should use the module contribution contract.

### Routing And Lazy Loading

Replace the route table in `apps/web/src/App.tsx` with route composition from registered module manifests. Core routes can live in `packages/web-core`; Kanban routes can live in `packages/web-kanban`.

Kanban route groups should be lazy-loaded at the route level for paths such as:

- `/projects`
- `/projects/new`
- `/projects/:projectId`
- `/projects/:projectId/board`
- `/projects/:projectId/work-items/:workItemId/active-session`
- `/projects/:projectId/runs/:runId/active-session`
- `/work-items`

The shell should continue to serve all routes from one website and should preserve direct-link behavior for protected routes.

### API Clients And Types

Split the current mixed API surface into package-owned clients:

- `packages/web-core/src/api` owns core API clients, core contracts, workflow/admin/session/tool/model/provider clients, and runtime config integration.
- `packages/web-kanban/src/api` owns Kanban API clients, project/work-item/orchestration/goals/settings clients, and all direct imports from `@nexus/kanban-contracts`.

The shell may provide a shared HTTP transport or base-client factory from `packages/web-core`, but each module owns the methods and types for its service. This preserves one auth/runtime-config path without recreating a single all-knowing API client.

### Navigation And Settings

Move static navigation from a hardcoded list into a compositor:

- `packages/web-core` contributes platform navigation such as Dashboard, Sessions, Memories, Notifications, Workflows, Schedules, Events, Doctor, Agents, Skills, Models, Providers, Tools, Secrets, Settings, and Users.
- `packages/web-kanban` contributes Projects, Work Items, and Kanban-owned settings cards.
- `apps/web` provides module ordering and feature enablement policy if needed.

Navigation labels and icons can still be statically bundled, but the shell should consume them through contribution data rather than importing Kanban pages or hooks.

## Workstreams

### 1. Define Frontend Module Interfaces

Create the shell-facing module manifest contract in `packages/web-core` and add tests around composition rules.

Acceptance criteria:

- A module can contribute routes and navigation without editing shell internals.
- Duplicate route ids or navigation ids fail deterministically in tests.
- The interface is documented for future domain modules.

### 2. Extract Core Web Package

Move shell, shared UI primitives, layout, core routes, core API clients, and shared test utilities into `packages/web-core`.

Acceptance criteria:

- Core package builds independently.
- Core package has no dependency on `@nexus/kanban-contracts`.
- Existing core platform routes still render through `apps/web`.
- Auth, runtime config, error boundaries, and layout behavior remain unchanged.

### 3. Extract Kanban Web Package

Move Kanban pages, project/work-item hooks, Kanban API clients, Kanban route contributions, and Kanban tests into `packages/web-kanban`.

Acceptance criteria:

- Kanban package owns all direct imports from `@nexus/kanban-contracts`.
- Project/work-item routes still render through the same deployed website.
- Kanban API calls continue to resolve to `kanbanApiUrl`.
- Kanban tests run from the package or through the app-level Web test command.

### 4. Replace Root Route And Navigation Wiring

Change `apps/web` to import module manifests, compose route objects, and compose navigation groups.

Acceptance criteria:

- `App.tsx` no longer eagerly imports every page.
- The sidebar and command palette read composed module contributions.
- Direct links to core and Kanban routes still work after refresh.
- Kanban route chunks are lazy-loaded.

### 5. Split API Transport From API Ownership

Keep shared HTTP/auth/runtime behavior in a small core transport, but move method ownership into package-specific clients.

Acceptance criteria:

- Core clients do not expose project/work-item/Kanban methods.
- Kanban clients do not require changes to core API client types.
- Tests prove core paths route to `coreApiUrl` and Kanban paths route to `kanbanApiUrl`.
- The old mixed `apps/web/src/lib/api/types.ts` surface is deleted or reduced to shell-only compatibility-free exports after migration.

### 6. Add Boundary Guardrails

Add lint, dependency, and test guardrails for frontend package ownership.

Acceptance criteria:

- Lint blocks `@nexus/kanban-contracts` imports from `packages/web-core` and shell/shared files.
- Lint blocks imports from `packages/web-kanban` into `packages/web-core`.
- CI builds `packages/web-core`, `packages/web-kanban`, and `apps/web` in dependency order.
- A search for Kanban domain terms in `packages/web-core` returns only documented allowlisted app-composition metadata if any allowlist is unavoidable.

### 7. Document The Frontend Module Model

Update Web architecture documentation after the package seam exists.

Acceptance criteria:

- Documentation explains how to add a new frontend domain package.
- Documentation explains the dependency direction and forbidden imports.
- Documentation explains when to add a shell contribution versus a domain module contribution.
- Documentation references EPIC-156 and API/Kanban separation so future work follows the same boundary model.

## Migration Strategy

Prefer an incremental migration that keeps the website releasable after each step:

1. Add module interfaces and compositor while existing code remains in `apps/web`.
2. Register existing routes through the compositor without moving files.
3. Create `packages/web-core` and move shell-safe code first.
4. Create `packages/web-kanban` and move Kanban API/types/hooks before moving pages.
5. Move Kanban routes and pages behind lazy route contributions.
6. Remove mixed root API/type/navigation surfaces after all callers migrate.
7. Add lint and CI guardrails only after package ownership is clear enough to avoid noisy transitional exceptions.

## Testing And Quality Gates

Suggested verification commands:

```bash
npm run test:unit:web
npm run build:web
npm run lint:web
```

Additional package-level gates should be added when packages exist:

```bash
npm run build --workspace=packages/web-core
npm run build --workspace=packages/web-kanban
npm run test --workspace=packages/web-core
npm run test --workspace=packages/web-kanban
```

Required test coverage:

- Module manifest composition and duplicate detection.
- Core route rendering through the shell.
- Kanban route rendering through the shell.
- Runtime service targeting for core, chat, and Kanban request paths.
- Navigation composition from multiple modules.
- Boundary tests preventing Kanban contracts from entering core Web packages.
- Lazy-loading smoke coverage or bundle analysis proving Kanban pages are not in the initial core shell chunk.

## Risks And Mitigations

### Risk: Package Split Becomes File Shuffling

Moving files without reducing the interface would preserve the current coupling in a new shape.

Mitigation: define the module manifest and API transport seams first, then migrate callers through those seams.

### Risk: Shared UI Becomes A Dumping Ground

Domain components could accumulate in `packages/web-core` because it is easy to import from everywhere.

Mitigation: keep `packages/web-core` focused on shell, primitives, and core platform concerns. Kanban board cards, project summaries, work-item panels, and Kanban settings belong in `packages/web-kanban`.

### Risk: App Composition Metadata Reintroduces Domain Knowledge

`apps/web` must import both core and Kanban modules, so it may need minimal domain labels for module ordering or feature flags.

Mitigation: keep composition metadata shallow and declarative. Domain rules, routes, hooks, and contracts stay inside the owning module package.

### Risk: Test And Build Configuration Becomes Fragile

Moving React/Vite code into packages can expose path alias, CSS, Tailwind, and Vitest setup assumptions.

Mitigation: extract shared test setup and Vite-compatible package configuration early. Keep package builds aligned with the existing Web app toolchain.

### Risk: Lazy Loading Breaks Protected Direct Links

Route-level lazy loading can accidentally change auth, layout, error-boundary, or not-found behavior.

Mitigation: preserve a single shell-level protected route wrapper and add direct-link tests for representative core and Kanban paths.

## Backlog

- [ ] E200-001 Define `WebModuleManifest` and contribution types in `packages/web-core`.
- [ ] E200-002 Add a module compositor for routes, navigation, settings, and command-palette contributions.
- [ ] E200-003 Register current `apps/web` routes through the compositor without moving pages.
- [ ] E200-004 Create `packages/web-core` and migrate shell-safe layout, shared UI, core routes, core clients, and test utilities.
- [ ] E200-005 Create `packages/web-kanban` and migrate Kanban API clients, contract imports, hooks, route contributions, and navigation contributions.
- [ ] E200-006 Move Kanban pages and tests into `packages/web-kanban` behind lazy-loaded routes.
- [ ] E200-007 Replace the mixed API type/client surface with package-owned clients and a shared transport factory.
- [ ] E200-008 Add frontend boundary lint rules and dependency checks.
- [ ] E200-009 Add package build/test scripts and CI ordering for Web packages.
- [ ] E200-010 Update Web architecture docs with the package module model.

## Acceptance Criteria

- `apps/web` remains the only deployed Web application.
- `apps/web` composes route, navigation, settings, and command-palette contributions from frontend module packages.
- `packages/web-core` builds and tests without importing `@nexus/kanban-contracts` or `packages/web-kanban`.
- `packages/web-kanban` owns Kanban routes, pages, hooks, API clients, and direct `@nexus/kanban-contracts` imports.
- Core platform routes and Kanban routes continue to work from the same website and preserve direct-link refresh behavior.
- Kanban routes use `kanbanApiUrl`; core routes use `coreApiUrl`; chat routes use `chatApiUrl`.
- The old monolithic route table, navigation list, and mixed API type surface are removed or reduced to shell-only composition points.
- Future domain modules have documented steps for contributing routes, navigation, settings, commands, API clients, and tests without editing core package internals.
