# EPIC-204 Completion — Design & Roadmap

**Date:** 2026-06-11
**Status:** Approved (roadmap); Workstream A approved for implementation
**Author:** Brainstorming session
**Related:** `docs/epics/EPIC-204-rbac-hierarchy-configurable-platform-gitops.md`, `docs/superpowers/specs/2026-06-09-epic-204-frontend-rbac-scope-design.md`

## Context

EPIC-204 ("hierarchical scope + RBAC") landed in a single big-bang push on 2026-06-09 and was
declared "fully shipped," but in practice it is **half-wired**. The scope selector and the
global-role auth are two disconnected systems; the bridge between "selected scope" and "what the
user sees" was only ever built for the Users page. This document records the diagnosis and a
decomposed roadmap to finish the feature properly, targeting a **genuine multi-tenant future**.

### Symptoms reported

1. The globe scope switcher lists ~20 `project-<hash>` entries when only one real project exists.
2. Switching the selected scope changes nothing anywhere except the Users page.
3. The sidebar became a narrow icon-only rail since the RBAC changes (was wide with text).
4. Kanban projects do not change based on the selected scope.

### Root causes (evidence-based)

| Symptom | Root cause                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Migration `20260609010000-backfill-scope-nodes.ts` minted one permanent `scope_nodes` row per `DISTINCT scope_id` across 8 source tables — including stale e2e UUIDs. `name = 'project-' + first 8 chars of UUID`. **Nothing ever deletes them** (no runtime lifecycle, no prune, FK `ON DELETE RESTRICT`). The switcher (`GET /scopes/tree`) returns **all** nodes with no membership filtering. |
| 2       | `activeScopeNodeId` is a UI-only React context wired into a fetch in exactly **one** place (`Users.tsx`). No request carries the active scope to the backend; `/me/permissions` is never called. Server-side per-scope list filtering (204D) is implemented in **one** controller (`WorkflowController.findAll`). RBAC ships in **`audit` mode** by default — it denies nothing.                  |
| 3       | Commit `2cfc8b1e` swapped the 256px text sidebar for a 48px icon rail. The design required this be gated behind a `hierarchyEnabled` flag (zero-regression when off); **that flag was never implemented on the web**, so the rail is unconditional. Old sidebar code is orphaned dead code.                                                                                                       |
| 4       | `useProjectList` → `GET /projects` is fully scope-unaware (static query key, no scope param, no scope-context subscription). Scope-tree `project` nodes are also a distinct entity from Kanban `Project`s.                                                                                                                                                                                        |

## Decomposition

Finishing EPIC-204 splits into four largely independent workstreams. Each gets its own spec →
plan → implement cycle.

| #     | Workstream                                                                                                                                                                       | Fixes     | Size                    | Depends on |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------- | ---------- |
| **A** | **Collapsible sidebar** — wide↔rail toggle, auto-collapse when scope panel opens, delete dead code                                                                               | Symptom 3 | Small (web only)        | —          |
| **B** | **Scope-node lifecycle & cleanup** — purge orphans, real create/delete lifecycle for scope nodes, membership-filter the switcher                                                 | Symptom 1 | Medium (backend/data)   | —          |
| **C** | **Scope propagation & visibility** — active-scope HTTP header, list filtering across all governed resources, drive client visibility from `/me/permissions`, enforcement rollout | Symptom 2 | Large (api + web)       | B          |
| **D** | **Kanban-project ↔ scope bridge** — provision/deprovision a neutral scope node from Kanban project lifecycle, scope the projects list (respecting the core/kanban boundary)      | Symptom 4 | Medium (cross-boundary) | B          |

**Agreed sequencing:** A → B → C → D. A is a standalone quick win; B is foundational so the
switcher shows real owned scopes before selection is made meaningful; C is the core of the work;
D builds on B's lifecycle.

### Cross-cutting principle: the `hierarchyEnabled` flag

EPIC-204's design mandated a `hierarchyEnabled` feature flag so existing installs see zero change
when hierarchy is not in use. It was never implemented on the web. Because the user wants a genuine
multi-tenant future, the flag is **not** used to hide the sidebar (Workstream A is independent of
it), but it **should** be (re)introduced in Workstream C to stage the rollout of scope-driven
visibility and enforcement per the original phased design. Tracked as part of C.

## Workstream summaries (B/C/D — to be expanded into full specs when reached)

These are intentionally high-level; each will be brainstormed and specced before implementation.

### B — Scope-node lifecycle & cleanup

- One-time cleanup of orphaned `project-<hash>` nodes (those with no live source `scope_id` and no
  role assignments other than implicit ones).
- A real lifecycle for `project` scope nodes: created when their originating domain entity is
  created, removed (or soft-archived) when it is gone — replacing the one-shot backfill model.
- Membership-aware switcher: `GET /scopes/tree` returns only the subtrees the caller can access
  (platform/global admins still see all). Decide: filter server-side via `getAccessibleScopeIds`.

### C — Scope propagation & visibility (the core)

- Active-scope HTTP header (e.g. `X-Scope-Node-Id`) injected by the web API client interceptor and
  resolved by a Nest interceptor, so every request is scope-aware in one place (DRY).
- Extend `ScopeAccessService.getAccessibleScopeIds`-style list filtering to all governed resources
  (agents, skills, secrets, runs, schedules, budgets, chat sessions, etc.), not just workflows.
- Drive client-side visibility from `/me/permissions(scopeNodeId)` instead of only the global
  `admin`/`user` role; resolve and persist the `activeScopePath` breadcrumb on load.
- (Re)introduce `hierarchyEnabled` and stage `audit → warn → enforce` per resource.

### D — Kanban-project ↔ scope bridge

- Respect the strict core/kanban boundary: API/core stays Kanban-neutral. Kanban owns projects;
  on project create/delete it provisions/deprovisions a **neutral** scope node via the scope API
  (or an event), keyed by the neutral `scope_id`.
- Scope the web projects list to the active scope; reconcile the `project` scope-node identity with
  the Kanban `Project` identity.

## Workstream A — detailed spec

See `docs/superpowers/specs/2026-06-11-collapsible-sidebar-design.md`.
