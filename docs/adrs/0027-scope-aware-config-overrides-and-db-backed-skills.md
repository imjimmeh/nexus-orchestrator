# ADR-027: Scope-Aware Config Overrides and DB-Backed Skills

## Status
Accepted

## Context
EPIC-204G introduces per-scope overrides for agent profiles, workflows, and skills. Previously all three types were global (no scope binding). Skills were file-only with no DB representation.

## Decision

### Copy-on-write whole-object overrides
An override is a **new row** sharing the default's `name`, bound to a `scope_node_id`, with a `base_*_id` back-pointer. At resolution time, `ScopedConfigResolver` (204F) walks the scope ancestry and returns the highest-precedence row. This avoids mutating the default and keeps the default recoverable.

### DB-backed skills with file library as import source only
Skills gain a `skills` table with the same override columns as agents/workflows. The existing `storage/skills/` file library is demoted to the **platform-default import source**: seeded into `skills` as `source='imported', scope_node_id=NULL`. At runtime, skills are always resolved from the DB via `ScopedConfigResolver`, never from files directly.

### Whole-object granularity for v1
All three types use whole-object replacement for v1. Field-level merge is deferred. The resolver contract exposes `strategy` so layered merge can be added without a schema change.

### `@Roles`/`@RequirePermission` coexistence
Fork/override endpoints keep both `@Roles('Admin')` and `@RequirePermission(...)` during the EPIC-204D migration period. Once 204D is fully rolled out and enforcement mode is `enforce`, `@Roles` can be removed.

## Consequences
- Platform defaults are never clobbered by re-seed (204F locked/overrides guard)
- Scoped overrides are fully isolated by scope ancestry
- Skills are queryable, overridable, and GitOps-ready (EPIC-204H/204I)
- File library (`storage/skills/`) is no longer the runtime source of truth
