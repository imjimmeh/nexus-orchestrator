# GitOps Seeding Migration Runbook

Use this runbook to move platform defaults from startup seed files into a repository-backed GitOps binding. The goal is to make Git the long-term source of truth for reusable workflows, agent profiles, skills, roles, and scoped overrides while keeping startup seeders as a bootstrap fallback.

## Scope

This runbook covers platform configuration owned by the Core API:

- global workflow definitions
- global agent profile definitions
- global skill definitions
- scope hierarchy documents
- roles and role assignments
- scoped workflow, agent profile, and skill overrides

Kanban-owned repository workflow settings remain separate. Repository-managed project workflows under `.nexus/workflows/` are not migrated by this runbook.

## Preconditions

1. API migrations have run and the GitOps binding tables exist.
2. The platform scope exists in `scope_nodes`.
3. The GitOps repository is reachable from the API host.
4. The target repository has a branch intended for platform configuration, normally `main`.
5. The operator has `gitops:manage` permission at the binding scope.

## Export Current Defaults

Export the current database state through the GitOps export endpoint:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/gitops/export > desired-state.yaml
```

The export now includes first-class platform default documents:

```text
agents/<name>.yaml
workflows/<name>.yaml
skills/<name>.yaml
```

It also includes scoped override documents under:

```text
scopes/<scope-path>/agents/<name>.yaml
scopes/<scope-path>/workflows/<name>.yaml
scopes/<scope-path>/skills/<name>.yaml
```

Commit the exported desired-state files to the platform configuration repository. Keep seed files in place until the binding has reconciled successfully in the target environment.

## Create The Platform Binding

Create a binding at the platform scope. Use `git_to_app` if Git should be authoritative and UI edits should be blocked. Use `two_way` if operators should be able to edit from the web app and sync changes back to Git.

```bash
curl -X POST http://localhost:3010/gitops/bindings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scopeNodeId": "00000000-0000-0000-0000-000000000000",
    "name": "platform-config",
    "repoUrl": "https://github.com/example/nexus-platform-config.git",
    "defaultRef": "main",
    "rootPath": ".",
    "syncMode": "two_way",
    "includedObjectTypes": [
      "scope_node",
      "role",
      "role_assignment",
      "workflow",
      "agent_profile",
      "skill"
    ]
  }'
```

## Validate, Plan, And Apply

Run the binding validation and plan endpoints before applying:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/gitops/bindings/$SCOPE_NODE_ID/$BINDING_ID/validate

curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/gitops/bindings/$SCOPE_NODE_ID/$BINDING_ID/plan
```

Review creates, updates, deletes, skipped locked objects, and conflicts. Apply only when the plan matches the expected seed migration:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/gitops/bindings/$SCOPE_NODE_ID/$BINDING_ID/apply
```

The apply run updates the binding `lastAppliedRevision` and records a reconcile run. If the binding is `two_way`, later web edits create pending outbound changes that can be synced back to Git with:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/gitops/bindings/$SCOPE_NODE_ID/$BINDING_ID/outbound-sync
```

## Reduce Startup Seeders

Do not delete seeders immediately after the first apply. Use this staged rollout:

1. Keep startup seeders enabled while the GitOps binding is introduced.
2. Confirm `/gitops/status` shows the binding with no unexpected drift or conflicts.
3. Move ongoing changes for reusable workflows, agent profiles, and skills to the GitOps repository.
4. Treat startup seed files as bootstrap defaults only.
5. Reduce seeders only after every deployment environment has a working platform binding.

Seeders should eventually maintain only invariants required before GitOps can run, such as schema prerequisites and minimum access needed to configure repository bindings.

## Rollback

If the binding applies an incorrect desired state:

1. Revert the repository commit.
2. Run a new plan for the binding.
3. Apply the reverted plan.
4. If app-side edits are pending on a `two_way` binding, review or clear them before reapplying.

If the repository is unreachable, keep seeders enabled and treat the GitOps binding as degraded until connectivity is restored.

## Verification

After migration:

```bash
npm run validate:seed-data
npm run test --workspace=apps/api -- config-export.service
npm run build --workspace=packages/gitops-contracts
npm run build:api
```

Also verify the web GitOps page shows:

- the platform binding
- first-class workflow, agent profile, and skill drift when repo and DB diverge
- outbound pending changes for `two_way` app edits
- no conflicts after apply
