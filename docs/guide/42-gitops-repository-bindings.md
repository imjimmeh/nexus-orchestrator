# 42 - GitOps Repository Bindings

GitOps repository bindings connect a scope node to a repository that stores desired platform configuration. Bindings let teams keep reusable workflows, agent profiles, skills, roles, assignments, and scoped overrides in Git while still managing day-to-day changes through the web app when `two_way` sync is enabled.

---

## What A Binding Owns

A binding is scoped by `scope_node_id`. The platform binding normally lives at the global scope and can manage shared defaults. Team or project-level bindings can manage narrower scoped overrides.

Each binding stores:

- repository URL, ref, and root path
- sync mode: `git_to_app` or `two_way`
- included object types
- credentials secret reference when needed
- last applied revision
- reconcile runs and pending outbound changes

API/core code uses neutral scope terminology. Project-specific behavior stays in Kanban-owned services.

---

## Sync Modes

| Mode         | Behavior                                                                                                      | Use When                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `git_to_app` | Git is authoritative. Normal app edits to GitOps-managed objects are blocked and reported as drift/conflicts. | Regulated shared platform configuration.               |
| `two_way`    | Git and app both participate. App edits create pending outbound changes that can be synced back to Git.       | Team reusable configuration edited through the web UI. |

Both modes use the same inbound validation, plan, and apply flow. Only `two_way` allows outbound sync from app edits to Git.

---

## Desired State Layout

First-class platform defaults live at the repository root:

```text
agents/<name>.yaml
workflows/<name>.yaml
skills/<name>.yaml
roles/<name>.yaml
assignments.yaml
scopes/<scope-path>/scope.yaml
```

Scoped overrides live below a scope path:

```text
scopes/<scope-path>/agents/<name>.yaml
scopes/<scope-path>/workflows/<name>.yaml
scopes/<scope-path>/skills/<name>.yaml
```

The contracts package parses and serializes both first-class defaults and scoped overrides. This lets the platform export seed defaults into Git without reducing every agent, workflow, or skill to an override against a hidden seeded row.

---

## Web Workflow

The GitOps page supports the binding lifecycle:

1. Add a repository binding with scope, repo URL, ref, root path, sync mode, and included object types.
2. Validate the binding to catch schema and permission errors.
3. Plan inbound changes from Git to the database.
4. Apply the inbound plan when drift/conflicts are understood.
5. For `two_way` bindings, review app-side pending changes.
6. Sync pending changes back to Git.

The status panels separate inbound drift, outbound pending changes, and conflicts so operators can tell whether Git, the app, or both changed an object.

---

## Reconciliation Flow

Reconciliation is the only way GitOps-managed state is mutated into the platform database. The flow has three pieces: the canonical per-binding apply path, the deprecated env-driven adapter that delegates to it, and the scheduled loop that fans the canonical path out across every active binding.

### Canonical Mutation Path

`GitOpsInboundReconcileService.apply(scopeNodeId, bindingId, actor)` is the only mutation path for GitOps reconciliation. It loads the binding and its desired state from the repository, builds a plan, refuses to apply when conflicts are present, applies the plan transactionally, and records a `GitOpsReconcileRun` audit row. Every inbound apply — whether driven by the web UI, the loop, or the legacy adapter — must go through this method.

### Deprecated Adapter

`ReconciliationService.apply()` is preserved as a deprecation adapter. It emits the `gitops.reconciliation.deprecated_apply` diagnostic event and delegates to the canonical path. The legacy `POST /gitops/reconcile` route stays wired to the adapter for backward compatibility, but its response carries a `Deprecation: true` header per the contract-versioning policy. The canonical route is `POST /gitops/bindings/:scopeNodeId/:bindingId/apply`.

### Reconciliation Loop

`GitOpsReconciliationLoopService` runs a scheduled tick driven by the `GITOPS_RECONCILIATION_INTERVAL_MS` interval plus the `GITOPS_RECONCILIATION_JITTER_MS` jitter. Each tick iterates the active bindings via `GitOpsRepositoryBindingService.listActive()` and invokes the canonical path per binding inside a per-binding `try`/`catch` so that one binding's failure does not block the others. The tick emits a `gitops.reconciliation.tick_completed` event with per-binding counts (applied, conflicts, errors) for the metrics pipeline.

### References

- [WI-2026-059](../work-items/WI-2026-059-wire-gitops-reconciliation-loop-per-binding.md) — wires the reconciliation loop to the per-binding canonical apply path and deprecates the legacy env-driven adapter.

---

## Seed Migration

Startup seeders remain the bootstrap path, but GitOps bindings are the target source of truth for reusable platform configuration. Exported desired state now includes global/default workflows, agent profiles, and skills as first-class GitOps documents.

Migration sequence:

1. Export current platform defaults through the GitOps export endpoint.
2. Commit the exported desired state to the platform configuration repository.
3. Create a global repository binding in the web app.
4. Validate, plan, and apply the binding.
5. Keep seeders enabled until every environment has a healthy binding.
6. Move future reusable configuration changes to Git or `two_way` outbound sync.

See [GitOps Seeding Migration Runbook](../operations/gitops-seeding-migration.md) for operator steps and rollback guidance.

---

## Relationship To Repository Workflows

Repository workflows under `.nexus/workflows/` remain separate. They are project repository assets discovered by Kanban-owned project integration. GitOps repository bindings manage platform configuration through the Core API and use generic scope objects, not Kanban project settings.
