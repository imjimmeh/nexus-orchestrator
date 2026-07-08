# EPIC-204: Granular RBAC, Organizational Hierarchy, Configurable Platform Objects & GitOps

**Epic ID:** EPIC-204
**Status:** Proposed
**Priority:** P1
**Type:** Umbrella Initiative (decomposes into child sub-epics 204A–204J)
**Theme:** Multi-Tenancy, Access Control, Configurability & Declarative Operations
**Created:** 2026-06-08
**Depends On:** EPIC-016 (Authentication/Authorization baseline), EPIC-108 (Platform Global Scope & Project Decoupling), EPIC-140 (Capability Registry & Policy Unification), EPIC-159 (Unified Tool Policy)
**Soft Depends On:** EPIC-069/EPIC-071 (project conventions / AGENTS.md), EPIC-115 (granular approval UX), EPIC-199 (cost/budget governance — a natural per-node policy consumer)

---

## 1. Context

Today the platform has **strong agent-level governance** but **weak human access control**, **no organizational hierarchy**, and **no declarative config management**. This initiative closes all three gaps at once because they share a single backbone: a **scope hierarchy** that permissions inherit down, that configuration layers over, and that GitOps declares.

### 1.1 Current Reality (verified in code)

**Authentication / RBAC — coarse and partly stubbed**
- JWT + Passport + bcrypt auth is solid: `apps/api/src/auth/auth.module.ts`, `jwt.strategy.ts`, `token.service.ts`, `refresh-token.service.ts`.
- Authorization is **coarse**: only two roles (`admin`, `user`) seeded in `apps/api/src/database/seeds/authorization/roles.seed.ts`, enforced via `@Roles(...)` + `RolesGuard` (`apps/api/src/auth/roles.guard.ts`) across ~297 routes.
- A **fine-grained `Permission` / `RolePermission` schema already exists but is completely unenforced** — `apps/api/src/auth/database/entities/permission.entity.ts` (`name`, `resource`, `action`) and `role-permission.entity.ts`. No guard, service, or check reads it. **This is the foundation we activate, not rebuild.**
- No resource-level checks ("can this user edit *this* workflow?"), no scope-filtered queries by user.

**Hierarchy / tenancy — flat and opaque**
- No `Organization`, `Region`, `Team`, or even a first-class `Project` entity in Core. "Project" is a Kanban concept, kept behind a neutral-contract boundary (see `CONTEXT.md`).
- Scoping today is a single opaque `scope_id` (UUID, usually a Kanban project) plus an implicit global scope, used for **execution isolation, not access control**. Present on `workflows`, `chat_sessions`, `scheduled_jobs`, `automation_hooks`, `workflow_run_todos`, learning candidates, approvals, etc.
- A newer ownership pattern (`owner_type`/`owner_id`) was added for `llm_providers` and `secret_store` (`20260604130000-add-scoped-configurable-resource-ownership.ts`) — a hint of where this is going.
- Runtime context is carried by `ExecutionContext` (`packages/core/src/interfaces/execution-context.types.ts`): `{ scopeId, contextId, contextType }`.

**Customization — DB-backed but no override/inheritance**
- **Agents:** DB-backed `AgentProfile` (`apps/api/src/ai-config/database/entities/agent-profile.entity.ts`) with full runtime CRUD (`agent-profiles.controller.ts`), seeded idempotently from `seed/agents/*` (`agent-profile-seed.service.ts`). Has `source` ('seeded'|'admin'|'agent_factory'), `tool_policy` JSONB. **No scope binding; global only.**
- **Workflows:** DB-backed `Workflow` (`apps/api/src/workflow/database/entities/workflow.entity.ts`, has a `scope_id` column already) seeded from `seed/workflows/*.workflow.yaml` (`workflows.seed.ts`). Edit API exists (`workflow.controller.ts` exposes `@Post()`, `@Put(':id')`, `@Patch(':id')`, `@Delete(':id')`). **No override resolution** (scope-aware fork-by-scope added in EPIC-204G).
- **Skills:** **File-only** (`AgentSkillLibraryService`, `storage/skills/`), no DB entity, no scope isolation.
- **No defaults-vs-override mechanism anywhere.** Re-seeding is idempotent but **can clobber** user edits (it reconciles to the seed file, not to user intent). `source`/locking is not honored on overwrite.

**Governance / approvals — the mature subsystem to align with**
- A genuinely strong, unified `PolicyEngineService` (10-phase decision pipeline) governs **agent tool calls**: `apps/api/src/capability-governance/policy-engine.service.ts`, with scoped `tool_approval_rules` (`global|project|agent_profile|workflow_run|chat_session`) and an approval-request lifecycle. This is the most advanced permission engine in the system and should **inform** (and ideally share scope/audit primitives with) human RBAC rather than diverge from it.
- `AuditLog` exists (`apps/api/src/audit/database/entities/audit-log.entity.ts`) but coverage is partial; approvals and authz decisions are not consistently recorded.

**GitOps — absent**
- Seeding is **one-way at boot** (`startup-seed.service.ts`); no watcher, no reconciliation, no drift detection. `AGENTS.md` is editable via UI (EPIC-071) but never pulled from git. Nothing resembling declarative desired-state convergence exists.

### 1.2 Why one initiative

These four asks are not independent features — they are four facets of one backbone:

```
                 ┌──────────────────────────────┐
   GitOps  ──────►  Scope Hierarchy (scope_node) ◄────── Config layering /
 (declares       └──────────────┬───────────────┘        override resolution
  desired                       │ inherits down
  state)                        ▼
                       Scoped RBAC + Permissions
                  (who can do what, where in the tree)
```

Permissions inherit down the tree; configuration (workflows/agents/skills) layers over the tree; GitOps declares the whole thing. Building them separately would mean three incompatible scoping models. This epic defines the shared backbone first, then layers RBAC, configurability, and GitOps on top.

---

## 2. Target State

- A **generic, arbitrary-depth scope hierarchy** (`scope_node`): Organization → Region → Team → Project → … with no schema change required to add new level types. The existing flat `scope_id` becomes a leaf node; global scope becomes the implicit root.
- **Granular, scope-aware RBAC** built on the *existing* `Permission`/`RolePermission` schema: roles bundle `resource:action` permissions; role assignments are **bound to a hierarchy node and inherit downward**. Every governed resource (work items, projects, workflows, agents, skills, approvals, goals, memory, secrets, budgets…) is permission-checked.
- **Configurable platform objects with layered overrides**: today's seeded workflows/agents/skills become **platform defaults**; any can be **overridden, forked, or extended** at any hierarchy level, resolved by a precedence chain (default → org → region → team → project), with seeded defaults protected from clobber.
- **GitOps**: a declarative, version-controlled representation of hierarchy + RBAC + workflows + agents + skills, applied to the running system by a **reconciliation loop** (apply/prune/drift-detect, dry-run/plan, audit-linked).
- **Unified audit & policy posture**: human authz decisions and agent tool governance share scope primitives and a complete audit trail of who-did-what-where.

---

## 3. Architectural Decisions (agreed)

| # | Decision | Rationale | Rejected alternative |
|---|----------|-----------|----------------------|
| AD-1 | **Generic `scope_node` tree** (self-referencing, typed nodes, arbitrary depth) | New levels ("etc.") need no migration; one inheritance model serves RBAC + config + GitOps | Fixed typed entities per level (every new level = migration) |
| AD-2 | **Scoped RBAC + downward inheritance**, built on the existing `Permission`/`RolePermission` schema | Reuses stubbed-but-present schema (DRY); well-understood; pragmatic | ReBAC/Zanzibar (heavy new subsystem); standalone ABAC engine (overlaps existing PolicyEngine) |
| AD-3 | **Git-as-source-of-truth + reconciliation loop** with drift detection | Matches the "GitOps" ask; declarative, reviewable, auditable | Export/import snapshots (not true GitOps); two-way sync (conflict complexity) |
| AD-4 | **Single umbrella epic → phased child sub-epics** | High-level plan now; each sub-area ships independently behind flags | Big-bang implementation |

**Guiding principles**
- **Reuse, don't rebuild.** Activate `Permission`/`RolePermission`; promote `scope_id` into the tree; extend `Workflow.scope_id`, `owner_type/owner_id`; align with `PolicyEngineService` and `AuditLog`.
- **Preserve the Kanban/Core boundary.** Core stays neutral (`scope_node`, not "project"); Kanban maps its project identity onto leaf nodes at the boundary (per `CONTEXT.md`).
- **Backward compatible & flag-gated.** No regression when hierarchy = single global root; every phase behind a feature flag.
- **Performance-aware authz.** Permission resolution across an inherited tree must be O(depth) with caching, not N queries per request.

---

## 4. Shared Domain Model (high level)

**Scope hierarchy**
- `scope_node`: `{ id, parent_id (nullable), type (org|region|team|project|…), name, slug, metadata, created/updated }`. Closure table **or** materialized path for efficient ancestor/descendant queries (decided in 204A).
- Migration: existing `scope_id` values become leaf `project`-type nodes; legacy columns continue to resolve via the node id.

**RBAC**
- `permission` (exists): `resource:action` catalog, expanded to cover every governed resource.
- `role` (exists) + `role_permission` (exists): system roles (seeded) + custom roles definable per org.
- **NEW** `role_assignment`: `{ user_id, role_id, scope_node_id }` — a user holds a role *at a node*; the grant inherits to all descendants.
- `membership` (NEW or folded into role_assignment): which users belong to which org/team.

**Config layering**
- A resolution function: `resolve(objectType, name, scopeNodeId) → effective definition` by walking node ancestry, applying override/merge/fork semantics, falling back to the platform default (today's seed).
- `source` + `locked` honored to protect seeded defaults; overrides recorded as distinct rows bound to a `scope_node_id`.

**GitOps desired-state**
- A canonical declarative repo layout (YAML/JSON) for hierarchy, roles/permissions/assignments, and per-scope config objects; a reconciler that diffs desired-vs-actual and converges.

---

## 5. Decomposition into Child Sub-Epics

> Each child becomes its own `EPIC-204x-*.md` with PR-ready tasks. Sequencing and dependencies below. Phases gate on each other; sub-epics *within* a phase can parallelize.

### Phase 0 — Backbone (must land first)

**EPIC-204A — Hierarchical Scope Tree**
- Introduce `scope_node` (generic, typed, arbitrary depth); ancestor/descendant query strategy (closure table vs materialized path) decided & benchmarked.
- Migrate existing `scope_id`/`owner_id` usage to nodes (leaf = project, root = global); compatibility shims so existing scoped queries keep working.
- Extend `ExecutionContext` to carry the node path; Kanban boundary mapping (project ↔ leaf node).
- **Deliverables:** entity + migrations + backfill; ancestry service; contract tests. **Depends on:** EPIC-108. **Blocks:** everything else.

**EPIC-204B — Permission Catalog & Enforcement Core**
- Activate the dormant `Permission`/`RolePermission` schema: define the full `resource:action` catalog; seed system roles (beyond admin/user).
- Build an `AuthorizationService` + `@RequirePermission(resource, action)` guard/decorator that resolves a user's effective permissions **at a given scope node, with inheritance**, cached per request.
- Coexist with `@Roles` during migration (no big-bang cutover).
- **Deliverables:** authz service, guard/decorator, permission catalog, perf-tested resolver, tests. **Depends on:** 204A. **Blocks:** Phase 1.

### Phase 1 — RBAC across the hierarchy

**EPIC-204C — Scoped Role Assignments & Inheritance**
- `role_assignment` (user × role × scope_node) + membership; assignment APIs; downward inheritance; custom roles per org; effective-permission introspection ("why can I do this?").
- **Depends on:** 204B.

**EPIC-204D — Granular Resource Enforcement Rollout**
- Apply `@RequirePermission` + scope-filtered queries to every governed resource across `apps/api` and `apps/kanban`: work items, projects/scopes, workflows, agents, skills, goals, memory, approvals, secrets, budgets, schedules/hooks, chat sessions.
- Row-level/list filtering by accessible scopes; retire coarse `@Roles` where superseded.
- **Depends on:** 204C. Largest surface area — may split by domain.

**EPIC-204E — Unified Authz/Governance & Audit**
- Share scope primitives between human RBAC and the agent `PolicyEngineService`; route approvals through one model; complete `AuditLog` coverage of authz decisions and grant changes (who-did-what-where).
- **Depends on:** 204B; aligns with EPIC-140/159/115. Can overlap with 204D.

### Phase 2 — Configurable / overridable platform objects

**EPIC-204F — Config Layering & Override Resolution Engine**
- The generic precedence/merge/fork engine: `resolve(type, name, node)` walking ancestry → platform default. Protect seeded defaults (`source`/`locked`); make re-seed override-safe (reconcile to defaults layer only, never clobber overrides).
- **Depends on:** 204A. **Blocks:** 204G.

**EPIC-204G — Customizable Workflows / Agents / Skills per Scope**
- Bind workflows (already has `scope_id`) and agent profiles to scope nodes with override/fork semantics; bring **Skills into a scope-aware store** (DB-backed or scoped library) so they too are overridable.
- Admin UI (`apps/web`) for viewing the resolved/effective object and editing per-scope overrides.
- **Depends on:** 204F, 204D (edits are permission-gated).

### Phase 3 — GitOps

**EPIC-204H — Declarative Config Schema & Repository**
- Canonical YAML/JSON representation of hierarchy + roles/permissions/assignments + per-scope workflows/agents/skills; repo layout; schema validation & linting; export of current state to bootstrap a repo.
- **Depends on:** 204A–204G (declares what they model).

**EPIC-204I — Reconciliation Engine & Drift Detection**
- Controller loop: read desired state from git → diff vs DB → apply (create/update/prune) → detect & report drift; `plan`/dry-run; rollout safety (staged, abortable); audit-linked.
- **Depends on:** 204H.

**EPIC-204J — GitOps DX & Observability**
- CLI/UI for plan/apply/status; PR-based change workflow; drift dashboards; surfacing reconcile results & audit in `apps/web`.
- **Depends on:** 204I.

### Dependency graph (summary)

```
204A ──► 204B ──► 204C ──► 204D ─┐
  │        └────► 204E ──────────┤
  └──► 204F ──► 204G ────────────┤
                                 ▼
                       204H ──► 204I ──► 204J
```

---

## 6. Cross-Cutting Concerns

- **Migration & backfill:** every existing scoped row maps to a node; existing `admin`/`user` users map to root-level role assignments; zero-downtime, reversible migrations.
- **Kanban/Core boundary:** Core persists neutral `scope_node`; Kanban translates project identity at the boundary — no Kanban terms leak into Core (`CONTEXT.md`).
- **Security posture:** default-deny on newly enforced resources is risky for existing installs — roll out **default-allow-with-audit → warn → enforce** per resource, behind flags. Never weaken the existing agent tool governance.
- **Performance:** effective-permission resolution must be cached (per-request and short-TTL); ancestry queries must use closure table/materialized path, not recursive N+1.
- **Web/admin surfaces:** org/team management, role & assignment management, effective-permission inspector, per-scope config override editor, GitOps status — phased into `apps/web`.
- **Testing:** unit (resolver/inheritance edge cases), contract (seed + schema), integration (scope-filtered queries), e2e (a multi-org tenant exercising inheritance + override + reconcile).
- **Feature flags:** `hierarchy_enabled`, `granular_rbac_enabled`, `config_overrides_enabled`, `gitops_enabled` — each phase shippable & reversible.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Enforcing RBAC breaks existing access for current users | Phased rollout per resource (audit-only → warn → enforce); backfill root-level grants; flag-gated |
| Permission resolution becomes a per-request hotspot | Closure table/materialized path + cached effective-permission sets; benchmark in 204A/204B |
| Re-seeding clobbers user/per-scope overrides | 204F reconciles only the *defaults layer*; honor `source`/`locked`; overrides are distinct scoped rows |
| Two divergent permission models (human RBAC vs agent PolicyEngine) | 204E shares scope primitives & audit; align rather than duplicate |
| Generic scope tree loses per-level guarantees | Type-aware validation rules on `scope_node.type`; optional typed views if needed |
| GitOps reconcile applies a destructive/incorrect change | Mandatory `plan`/dry-run, staged apply, prune guards, drift report, full audit, rollback |
| Kanban boundary erosion | Boundary mapping tests; Core stays neutral; no project terms in Core persistence |
| Initiative scope overwhelms delivery | Strict phase gates; each sub-epic independently flagged and valuable |

---

## 8. Definition of Done (Epic Level)

- [ ] `scope_node` hierarchy live; existing scopes migrated; ancestry queries performant (204A)
- [ ] `Permission`/`RolePermission` activated; `@RequirePermission` enforcing with inheritance + caching (204B)
- [ ] Scoped role assignments with downward inheritance and custom roles (204C)
- [ ] Granular enforcement rolled out across all governed resources, scope-filtered (204D)
- [ ] Human authz + agent governance share scope primitives; full audit coverage (204E)
- [ ] Config override-resolution engine; seeded defaults protected from clobber (204F)
- [ ] Workflows/agents/skills overridable/forkable per scope, with admin UI (204G)
- [ ] Declarative config schema + repo + export (204H)
- [ ] Reconciliation engine with plan/apply/prune/drift, audit-linked (204I)
- [ ] GitOps DX/observability surfaced (204J)
- [ ] All phases flag-gated, backward compatible, tested (unit/contract/integration/e2e); `validate:seed-data` passes; builds green
- [ ] Documentation: architecture docs + ADRs for AD-1…AD-4

---

## 9. Open Questions (resolve per child epic)

1. **Ancestry storage:** closure table vs materialized path vs `ltree` — decide in 204A by benchmark.
2. **Override granularity for config:** whole-object override vs field-level merge vs prompt/step-level patch (esp. agent prompts & workflow YAML) — decide in 204F/204G.
3. **Skills storage:** promote skills to a DB-backed scoped store, or keep file library with scope-prefixed directories — decide in 204G.
4. **GitOps conflict policy:** is DB-side editing of GitOps-managed objects forbidden, or allowed-as-drift-then-reverted — decide in 204I (AD-3 leans git-authoritative).
5. **Custom-role boundaries:** can custom roles span orgs, or are they org-local — decide in 204C.
6. **Region semantics:** is "region" purely organizational, or does it carry data-residency/runtime placement meaning — confirm before 204A finalizes node types.

---

## 10. References

**Auth / RBAC**
- `apps/api/src/auth/` — `auth.module.ts`, `jwt.strategy.ts`, `roles.guard.ts`, `roles.decorator.ts`, `internal-service-scope.guard.ts`
- `apps/api/src/auth/database/entities/` — `role.entity.ts`, `user-role.entity.ts`, **`permission.entity.ts`**, **`role-permission.entity.ts`** (to activate)
- `apps/api/src/users/database/entities/user.entity.ts`
- `apps/api/src/database/seeds/authorization/roles.seed.ts`

**Scope / hierarchy**
- `packages/core/src/interfaces/execution-context.types.ts`
- `apps/api/src/workflow/database/entities/workflow.entity.ts` (`scope_id`)
- `apps/api/src/database/migrations/20260604130000-add-scoped-configurable-resource-ownership.ts` (`owner_type`/`owner_id`)
- `CONTEXT.md` (Kanban/Core neutral-contract boundary)

**Customization**
- `apps/api/src/ai-config/database/entities/agent-profile.entity.ts`, `controllers/agent-profiles.controller.ts`
- `apps/api/src/database/seeds/agent-profiles/agent-profile-seed.service.ts`
- `apps/api/src/database/seeds/workflow/workflows.seed.ts`; `seed/workflows/*.workflow.yaml`
- `apps/api/src/ai-config/services/agent-skill-library.service.ts`; `seed/skills/*`
- `apps/api/src/database/seeds/startup-seed.service.ts`

**Governance / approvals / audit**
- `apps/api/src/capability-governance/policy-engine.service.ts`
- `apps/api/src/tool/database/entities/tool-approval-rule.entity.ts`, `tool-call-approval-request.entity.ts`
- `apps/api/src/audit/database/entities/audit-log.entity.ts`

**Related Epics:** EPIC-016, EPIC-069, EPIC-071, EPIC-108, EPIC-115, EPIC-140, EPIC-159, EPIC-165, EPIC-199.
