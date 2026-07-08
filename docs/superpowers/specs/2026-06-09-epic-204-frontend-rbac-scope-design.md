# EPIC-204 Frontend: RBAC, Scope Hierarchy & GitOps UI Design

**Date:** 2026-06-09
**Epic:** EPIC-204 (Granular RBAC, Organizational Hierarchy, Configurable Platform Objects & GitOps)
**Status:** Approved
**Scope:** Frontend only — all backend APIs are already implemented

---

## 1. Context & Current State

EPIC-204 backend is fully shipped across sub-epics 204A–204J. The following frontend work was already completed as part of the epic:

- `/admin/scoped-config` — `ScopedConfigViewer`: point-query resolved config, fork overrides, locked badge (204F/G)
- `/gitops` — `GitOpsStatus`: reconciliation status, drift table, run-reconcile button (204J)
- `useScopedConfig` hooks + API clients for scoped config (204F/G)
- `useGitOps` hooks + API clients for GitOps (204J)

The following frontend surfaces are **missing** and are the subject of this design:

- Scope hierarchy tree browser/editor (204A)
- Role assignment management UI (204C)
- Enforcement mode admin panel (204D)
- Audit log page (204E)
- Scope selector on resource list pages (204D)
- Scope node context/breadcrumbs on resource detail pages (204A/D)
- Config override provenance and scope-awareness improvements (204F/G)
- Scope-awareness for existing admin pages (204B/C/D)

---

## 2. Core Design Decision: Scope as First-Class Navigation

Scope is a **first-class navigation concept**, not an admin-only concern. The active scope context:

- Filters all resource lists (Workflows, Agents, Secrets, Budget, Users, etc.)
- Is visible and switchable at all times via the sidebar
- Persists across page navigations (stored in `ScopeContext` + `localStorage`)
- Affects admin pages as well as regular resource pages

---

## 3. App Shell — Dual-Rail Sidebar

### Layout

The sidebar is restructured into two columns:

1. **Icon rail** (~48px, always visible): icon buttons for each nav destination
2. **Scope panel** (~240px, toggleable): scope tree, slides in beside the rail and pushes main content

```
┌────┬──────────────────────────────────┬─────────────────────────┐
│Rail│ Scope Panel (when open)          │ Main content            │
│    │                                  │ (narrows, not overlaid) │
└────┴──────────────────────────────────┴─────────────────────────┘
```

The panel is **not an overlay** — it pushes the content area. This ensures scope is always a considered, persistent choice rather than a transient flyout.

### Icon Rail (top to bottom)

```
┌────┐
│ 🌐 │  Scope tree toggle (highlighted when panel open)
├────┤
│ 🏠 │  Dashboard
│ ⚡ │  Workflows
│ 🤖 │  Agents
│ 🔧 │  Tools / Skills
│ 🔑 │  Secrets
│ 📋 │  Projects
│ 📅 │  Schedules
│ 💬 │  Sessions
├────┤  (admin items — visible to admins only)
│ 👥 │  Users
│ 💰 │  Budget
│ 🔀 │  GitOps
│ ⚙️ │  Settings
└────┘
```

### Scope Panel

```
┌──────────────────────────────────────┐
│ SCOPE                           [×]  │
├──────────────────────────────────────┤
│ 🔍 Filter nodes...                   │
├──────────────────────────────────────┤
│ 🌐 Platform                          │
│  └─ 🏢 Acme Corp              ⚙     │
│      ├─ 🌍 US Region          ⚙     │
│      │   ├─ ◉ Engineering  ⚙ (active)│
│      │   │   ├─ 📁 Backend            │
│      │   │   └─ 📁 Frontend           │
│      │   └─ 📁 Marketing              │
│      └─ 🌍 EU Region          ⚙     │
├──────────────────────────────────────┤
│ [+ New child scope]                  │
└──────────────────────────────────────┘
```

**Interactions:**
- **Single click** on a node → sets it as the active scope (`◉`), all resource lists re-query with `scopeNodeId`
- **`⚙` icon** (shown on hover) → navigates to `/scopes/:id` detail page
- **`[+ New child scope]`** → creates a child under the currently active node
- **Filter input** → client-side filter of visible nodes by name
- **`[×]`** → closes the panel; active scope is retained

**Visibility rules:**
- `platform_admin` sees the full tree
- Regular members see only nodes they have a role assignment on, plus their ancestors for path context
- Nodes the user cannot access are not shown (not greyed out — fully hidden)

### Header Breadcrumb

A read-only scope breadcrumb in the top nav bar provides orientation:

```
┌────────────────────────────────────────────────────────┐
│ ≡  Nexus          Engineering  (Acme Corp > US Region) │
└────────────────────────────────────────────────────────┘
```

Clicking the breadcrumb opens the scope panel — it does not navigate.

### State Management

- `ScopeContext` React context provides `activeScopeNodeId`, `setActiveScopeNodeId`, and the resolved scope path (name breadcrumb)
- Active scope is persisted to `localStorage` and restored on page load
- All existing query hooks accept an optional `scopeNodeId` param; when `ScopeContext` provides one it is automatically appended to API calls
- Querying with no scope node (root / Platform) behaves identically to today — no regression

---

## 4. Scope Detail Page (`/scopes/:id`)

Navigated to via the `⚙` icon on any scope node. A dedicated page with four tabs.

### Header

```
┌────────────────────────────────────────────────────────┐
│ 🌐 Platform > 🏢 Acme Corp > 🌍 US Region             │
│                                                        │
│ ◉  Engineering                              [team]    │
│    slug: acme-us-engineering                           │
│                                        [Set as Active] │
└────────────────────────────────────────────────────────┘
```

Node type badge (`platform | org | region | team | project`) is displayed alongside the name. `[Set as Active]` sets this node as the active scope context.

### Tab 1 — Members & Roles

Displays all role assignments effective at this scope: direct assignments (granted here) and inherited assignments (granted at an ancestor).

```
┌────────────────────────────────────────────────────────┐
│ Members & Roles                    [+ Assign Role]     │
├──────────────────┬──────────────┬──────────────────────┤
│ User             │ Role         │ Granted at           │
├──────────────────┼──────────────┼──────────────────────┤
│ alice@acme.com   │ org_admin    │ Acme Corp  (inherit) │
│ bob@acme.com     │ member       │ Engineering (direct) │
│ carol@acme.com   │ viewer       │ Engineering (direct) │
└──────────────────┴──────────────┴──────────────────────┘

Inherited from platform:
┌────────────────────────────────────────────────────────┐
│ dave@acme.com    │ platform_admin │ Platform (inherit) │
└────────────────────────────────────────────────────────┘
```

- Direct assignments (granted at this node) show a **[Revoke]** action
- Inherited assignments show the source node as a link and are read-only here
- **`[+ Assign Role]`** opens a modal: user typeahead + role dropdown → calls `POST /scopes/:scopeNodeId/role-assignments`

### Tab 2 — Config Overrides

Lists all config objects resolved for this scope node — both platform defaults and local overrides.

```
┌────────────────────────────────────────────────────────┐
│ Config Overrides               [+ New Override]        │
├───────────┬──────────────┬────────────┬────────────────┤
│ Type      │ Name         │ Source     │ Actions        │
├───────────┼──────────────┼────────────┼────────────────┤
│ workflow  │ code-review  │ override   │ [Edit] [Delete]│
│ agent     │ senior-dev   │ override   │ [Edit] [Delete]│
│ agent     │ planner      │ default ↑  │ [Fork]         │
└───────────┴──────────────┴────────────┴────────────────┘
```

- `default ↑` = resolved from an ancestor; `[Fork]` creates a local override at this node
- `override` = a local override exists; `[Edit]` opens the existing `ScopedConfigViewer` editor pre-filled for this node
- `[Delete]` removes the override, reverting to the inherited default

### Tab 3 — Child Scopes

```
┌────────────────────────────────────────────────────────┐
│ Child Scopes                        [+ New Child]      │
├──────────────────┬──────────────┬──────────────────────┤
│ Name             │ Type         │ Members              │
├──────────────────┼──────────────┼──────────────────────┤
│ Backend Team     │ team         │ 4                    │
│ Frontend Team    │ team         │ 3                    │
└──────────────────┴──────────────┴──────────────────────┘
```

Each row links to that child's `/scopes/:id` page. `[+ New Child]` creates a child node under the current scope with a type selector (`org | region | team | project`).

### Tab 4 — Audit

Scoped audit log pre-filtered to this node's `scopeNodeId`. Reuses the `AuditLogPage` component (see Section 6) with the scope filter locked to this node.

---

## 5. Resource List & Detail Page Changes

### Scope Context Banner

When a non-root scope is active, all resource list pages show a banner:

```
┌────────────────────────────────────────────────────────┐
│ ◉ Engineering  (Acme Corp > US Region)   [Clear scope] │
└────────────────────────────────────────────────────────┘
```

`[Clear scope]` resets to the Platform root (shows all resources). The banner is not shown when the Platform root is active.

### Scope Column in Tables

All resource list tables (Workflows, Agents, Skills, Secrets, etc.) gain a **Scope** column:

```
┌──────────────────┬────────────┬──────────────────────┐
│ Name             │ Status     │ Scope                │
├──────────────────┼────────────┼──────────────────────┤
│ code-review      │ active     │ ◉ Engineering        │
│ deploy-pipeline  │ active     │ ↑ US Region (parent) │
│ incident-triage  │ active     │ ↓ Backend (child)    │
└──────────────────┴────────────┴──────────────────────┘
```

**Legend:**
- `◉` — belongs directly to the active scope
- `↑` — owned by a parent/ancestor scope (visible because descendants include their parents' resources)
- `↓` — owned by a child/descendant scope (visible because include-descendants is on)

### Include Descendants Toggle

Above list tables, defaulting to on:

```
[☑ Include descendants]
```

When off, only resources with `scope_node_id` exactly matching the active scope are shown.

### Resource Detail Page — Scope Breadcrumb

Resource detail pages (Workflow detail, Agent profile editor, etc.) gain a scope breadcrumb below the page title:

```
┌────────────────────────────────────────────────────────┐
│ code-review                              [Edit] [Run]  │
│ 🌐 Platform > 🏢 Acme Corp > ◉ Engineering            │
└────────────────────────────────────────────────────────┘
```

Clicking any crumb segment sets that node as the active scope in the sidebar.

### Fork Override Shortcut

On Workflow and Agent detail pages, when the resource is a platform default inherited by the active scope:

```
┌────────────────────────────────────────────────────────┐
│ senior-dev (agent)                   ↑ Platform default│
│                                                        │
│  This is a platform default inherited by Engineering.  │
│                    [Fork override for Engineering]     │
└────────────────────────────────────────────────────────┘
```

`[Fork override for Engineering]` calls the existing `useForkAgentForScope` / `useForkWorkflowForScope` hooks pre-filled with the active scope node ID.

---

## 6. New Admin Pages

### 6a. Enforcement Mode Controls

A new card added to the `/settings` admin section, visible to `platform_admin` only.

```
┌────────────────────────────────────────────────────────┐
│ RBAC Enforcement Mode                                  │
│ Control how permission denials are handled per         │
│ resource. Roll out enforcement gradually.              │
├──────────────────┬─────────────────────────────────────┤
│ Resource         │ Mode                                │
├──────────────────┼─────────────────────────────────────┤
│ workflows        │ [audit ▾]                           │
│ agents           │ [audit ▾]                           │
│ skills           │ [warn  ▾]                           │
│ secrets          │ [enforce▾]                          │
│ budgets          │ [enforce▾]                          │
│ roles            │ [enforce▾]                          │
│ users            │ [enforce▾]                          │
│ settings         │ [enforce▾]                          │
│ gitops           │ [audit ▾]                           │
│ audit            │ [enforce▾]                          │
└──────────────────┴─────────────────────────────────────┘
│ ⚠ 3 resources in audit mode — denials are not enforced │
└────────────────────────────────────────────────────────┘
```

**Mode semantics** (read-only labels shown on hover):
- `audit` — request allowed; denial logged only
- `warn` — request allowed; denial logged + console warning emitted
- `enforce` — request denied with 403

Each row calls `PUT /authz/enforcement-mode/:resource` immediately on change (optimistic update, rollback on error — no save button). The warning banner counts resources not yet in `enforce` mode as a nudge to complete rollout.

### 6b. Audit Log Page (`/audit`)

New top-level page, accessible from the admin rail and fixing the existing 404 linked from `GitOpsStatus`.

```
┌────────────────────────────────────────────────────────┐
│ Audit Log                                              │
├──────────┬───────────────┬──────────────┬─────────────┤
│ Scope    │ Event type    │ User         │ Date range  │
│ [All ▾]  │ [All ▾]       │ [All ▾]      │ [Last 7d ▾] │
└──────────┴───────────────┴──────────────┴─────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Time              │ Event              │ User  │ Scope       │
├───────────────────┼────────────────────┼───────┼─────────────┤
│ 2026-06-09 14:32  │ authz.role_granted │ alice │ Engineering │
│ 2026-06-09 14:28  │ authz.denied       │ bob   │ US Region   │
│ 2026-06-09 13:11  │ authz.scope_created│ alice │ Platform    │
│ 2026-06-09 12:05  │ authz.role_revoked │ alice │ Acme Corp   │
└───────────────────┴────────────────────┴───────┴─────────────┘
                                    [← Prev]  Page 1  [Next →]
```

Clicking a row expands an inline detail drawer:

```
│ ▼ 2026-06-09 14:32  authz.role_granted                      │
│   User:        alice@acme.com                               │
│   Target:      bob@acme.com                                 │
│   Role:        member                                       │
│   Scope:       Engineering  (acme-us-engineering)           │
│   Inherited by: Backend Team, Frontend Team                 │
```

**Filters:**
- Scope: tree-picker dropdown (same component used in the sidebar); selecting a node includes its descendants
- Event type: multi-select of known `authz.*` event types
- User: typeahead of all users
- Date range: preset options (Last 24h / 7d / 30d) + custom range

When navigated to from the Scope Detail `Audit` tab, the Scope filter is pre-set and locked to that node.

API: `GET /audit?scopeNodeId=&eventType=&userId=&from=&to=&limit=&offset=`

---

## 7. Scope-Aware Admin Pages

Existing admin pages read the active `scopeNodeId` from `ScopeContext` and filter accordingly. When the Platform root is active, they show global data — no regression.

### Users (`/users`)

Becomes "Members at active scope" when a non-root scope is active:

```
┌────────────────────────────────────────────────────────┐
│ ◉ Engineering  (Acme Corp > US Region)   [Clear scope] │
├────────────────────────────────────────────────────────┤
│ Members & Role Assignments             [+ Assign Role] │
├──────────────────┬──────────────┬──────────────────────┤
│ User             │ Role         │ Granted at           │
├──────────────────┼──────────────┼──────────────────────┤
│ alice@acme.com   │ org_admin    │ ↑ Acme Corp          │
│ bob@acme.com     │ member       │ ◉ Engineering        │
│ carol@acme.com   │ viewer       │ ◉ Engineering        │
│ dave@acme.com    │ platform_admin│ ↑ Platform          │
└──────────────────┴──────────────┴──────────────────────┘
```

At Platform scope, reverts to the current full user management table.

### Budget (`/admin/budget-policies`, `/admin/budget-spend`)

```
┌────────────────────────────────────────────────────────┐
│ ◉ Engineering  (Acme Corp > US Region)   [Clear scope] │
├────────────────────────────────────────────────────────┤
│ Budget Policies                      [+ New Policy]    │
├──────────────────┬───────────┬────────────────────────┤
│ Policy           │ Limit     │ Scope                  │
├──────────────────┼───────────┼────────────────────────┤
│ monthly-cap      │ $500/mo   │ ◉ Engineering          │
│ per-run-cap      │ $10/run   │ ↑ Acme Corp (inherit)  │
└──────────────────┴───────────┴────────────────────────┘
```

### GitOps (`/gitops`)

Reconciliation is always platform-wide; scope context filters the drift display only:

```
┌────────────────────────────────────────────────────────┐
│ GitOps Status                  [Plan] [Apply]          │
│ ℹ Reconciliation is platform-wide.                     │
│   Showing drift filtered to: ◉ Engineering             │
└────────────────────────────────────────────────────────┘
```

### Scoped Config Viewer (`/admin/scoped-config`)

The scope node ID input is pre-filled from the active scope context:

```
┌────────────────────────────────────────────────────────┐
│ Scoped Config Viewer                                   │
│ Active scope: ◉ Engineering  [Change]                  │
│ Object type: [agent ▾]   Name: [senior-dev        ]   │
│                                         [Resolve]      │
└────────────────────────────────────────────────────────┘
```

---

## 8. New Components & Pages Summary

| Component / Page | Path | Status |
|---|---|---|
| `ScopeContext` provider | `contexts/ScopeContext.tsx` | New |
| `ScopeTree` panel | `components/scope/ScopeTree.tsx` | New |
| `ScopeNodePicker` dropdown | `components/scope/ScopeNodePicker.tsx` | New — a compact dropdown that renders the scope tree as a flat searchable list with indentation; used in Audit log filters, role assignment modal, and anywhere a single scope node must be selected |
| `ScopeBanner` | `components/scope/ScopeBanner.tsx` | New (reused across all list pages) |
| `ScopeBreadcrumb` | `components/scope/ScopeBreadcrumb.tsx` | New (reused on detail pages) |
| `ScopeDetailPage` | `pages/scopes/ScopeDetailPage.tsx` | New — route `/scopes/:id` |
| `MembersRolesTab` | `pages/scopes/tabs/MembersRolesTab.tsx` | New |
| `ConfigOverridesTab` | `pages/scopes/tabs/ConfigOverridesTab.tsx` | New (wraps existing `ScopedConfigViewer`) |
| `ChildScopesTab` | `pages/scopes/tabs/ChildScopesTab.tsx` | New |
| `AuditLogPage` | `pages/audit/AuditLogPage.tsx` | New — route `/audit` |
| `AuditLogTable` | `pages/audit/AuditLogTable.tsx` | New |
| `AuditEventDetail` | `pages/audit/AuditEventDetail.tsx` | New |
| `EnforcementModeCard` | `pages/settings/EnforcementModeCard.tsx` | New (added to Settings page) |
| Updated: `AppLayout` | `components/layout/Layout.tsx` | Modified — dual-rail sidebar |
| Updated: `Workflows`, `AgentProfiles`, etc. | existing list pages | Modified — scope banner + scope column |
| Updated: `WorkflowDetail`, `AgentProfileEditor`, etc. | existing detail pages | Modified — scope breadcrumb + fork shortcut |
| Updated: `Users`, `BudgetPoliciesPage`, `GitOpsStatus`, `ScopedConfigViewer` | existing admin pages | Modified — scope-aware queries |

---

## 9. API Hooks & Client Methods Needed

| Hook | API call | Notes |
|---|---|---|
| `useScopeTree()` | `GET /scopes/tree` | Full tree for sidebar |
| `useScopeNode(id)` | `GET /scopes/:id` | Detail page header |
| `useCreateScope()` | `POST /scopes` | New child scope |
| `useMoveScope()` | `PATCH /scopes/:id/move` | Out of scope for this iteration — no move UI designed |
| `useRoleAssignments(scopeNodeId)` | `GET /scopes/:scopeNodeId/role-assignments` | Members tab |
| `useAssignRole()` | `POST /scopes/:scopeNodeId/role-assignments` | Assign role modal |
| `useRevokeRole()` | `DELETE /scopes/:scopeNodeId/role-assignments` | Revoke button |
| `useUserRoleAssignments(userId)` | `GET /users/:userId/role-assignments` | User detail view |
| `useMyPermissions(scopeNodeId)` | `GET /me/permissions?scopeNodeId=` | Permission-gating in UI |
| `useEnforcementModes()` | `GET /authz/enforcement-mode` | Enforcement card |
| `useSetEnforcementMode()` | `PUT /authz/enforcement-mode/:resource` | Enforcement card |
| `useAuditLog(filters)` | `GET /audit?...` | Audit log page |

---

## 10. Feature Flag

All new scope-aware UI is gated behind `hierarchy_enabled` (already defined in the backend). When the flag is off:

- The scope panel toggle icon is hidden from the rail
- The scope context banner does not appear on list pages
- `/scopes/*` routes redirect to `/`
- Admin pages behave as today

This matches the backend's phased rollout approach and ensures zero regression for existing installations.
